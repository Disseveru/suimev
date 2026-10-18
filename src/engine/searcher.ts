import { CONFIG } from '../config/index.js';
import { LiquidationOpportunity, ObligationState, SystemStats } from '../config/types.js';
import { pythService } from '../oracles/pythService.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';
import { obligationRegistry } from './registry.js';
import { ZeroCapitalPtbBuilder } from './ptbBuilder.js';
import { PreFlightSimulator } from './simulator.js';
import { TransactionExecutor } from './executor.js';
import { gasManager } from '../client/gasManager.js';
import { CetusRouter } from '../protocols/dex/cetusRouter.js';
import { validateSharedVersions } from '../config/constants.js';
import { rpcManager } from '../client/suiClient.js';
import { priceCache } from '../oracles/priceCache.js';
import { logger } from '../ui/logger.js';
import { telemetryBridge } from './telemetryBridge.js';
import { MaxHeap } from '../utils/heap.js';

/**
 * Main MEV Liquidation Searcher Daemon
 */
export class LiquidationSearcher {
  public isRunning = false;
  private startTime = Date.now();
  private isProcessingQueue = false;
  private isTickRunning = false;
  private tickInterval: NodeJS.Timeout | null = null;
  private queue: MaxHeap<string> = new MaxHeap<string>();
  private queuedOpportunities: Map<string, LiquidationOpportunity> = new Map();
  private inFlightObligations: Set<string> = new Set();
  private lastOnDemandRefreshByObligation: Map<string, number> = new Map();
  private activePipelineCount = 0;
  private readonly MAX_CONCURRENT_PIPELINES = 3;

  public stats: SystemStats = {
    uptimeSeconds: 0,
    totalObligationsMonitored: 0,
    immediateTargetsCount: 0,
    hotWatchlistCount: 0,
    safeCount: 0,
    totalSimulations: 0,
    successfulSimulations: 0,
    totalLiquidationsAttempted: 0,
    successfulLiquidations: 0,
    failedLiquidations: 0,
    cumulativeNetProfitUsd: 0,
    cumulativeGasSpentSui: 0,
  };

  constructor() {}

  private enqueueOpportunity(opportunity: LiquidationOpportunity): void {
    const obligationId = opportunity.obligation.obligationId;
    const existing = this.queuedOpportunities.get(obligationId);

    if (existing && existing.expectedGrossProfitUsd >= opportunity.expectedGrossProfitUsd) {
      return;
    }

    if (existing) {
      this.queue.remove(obligationId);
    }

    this.queue.push(obligationId, Number(opportunity.expectedGrossProfitUsd) || 0);
    this.queuedOpportunities.set(obligationId, opportunity);
  }

  private dequeueOpportunity(): LiquidationOpportunity | undefined {
    const obligationId = this.queue.popMax();
    if (!obligationId) return undefined;
    const opportunity = this.queuedOpportunities.get(obligationId);
    this.queuedOpportunities.delete(obligationId);
    return opportunity;
  }

  private hasQueuedOpportunity(obligationId: string): boolean {
    return this.queuedOpportunities.has(obligationId);
  }

  private clearQueue(): void {
    this.queue.clear();
    this.queuedOpportunities.clear();
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startTime = Date.now();

    logger.info('Starting SuiMEV Zero-Capital Liquidation Engine...');
    logger.info(`Mode: ${CONFIG.dryRun ? '🛡️ DRY-RUN (Safe)' : '⚡ LIVE EXECUTION'}`);
    logger.info(`Operator: ${CONFIG.operatorAddress}`);
    logger.info(`Protocols: ${CONFIG.protocols.join(', ')}`);
    logger.info(`Min Profit Threshold: $${CONFIG.minProfitUsd}`);

    // Gas Readiness Check & Zero-RPC Gas Coin Cache Initialization
    await gasManager.initialize();
    const gasCheck = await TransactionExecutor.checkOperatorGasBalance();
    logger.info(
      {
        operator: CONFIG.operatorAddress,
        balanceSui: `${gasCheck.balanceSui.toFixed(4)} SUI`,
        gasBudgetSui: `${(Number(CONFIG.gasBudget) / 1e9).toFixed(4)} SUI`,
        cachedGasCoin: gasManager.getGasPayment()?.objectId ?? 'None',
        status: gasCheck.isSufficient ? 'SUFFICIENT' : 'INSUFFICIENT_FOR_LIVE',
      },
      gasCheck.isSufficient
        ? '⛽ Operator Gas Balance & Zero-RPC Cache Verified — Ready for Consensus Execution'
        : CONFIG.dryRun
        ? 'ℹ️ Operator Balance is 0 SUI (Acceptable in DRY-RUN mode; fund wallet with >= 0.1 SUI before switching to live)'
        : '⚠️ WARNING: Operator Gas Balance is insufficient for live gas budgets!'
    );

    // Dynamic Cetus Pool Discovery & Background Refresh
    await CetusRouter.syncDynamicPools();
    CetusRouter.startDynamicSync(600_000);

    // Start Telemetry Bridge Daemon immediately so dashboard has live metrics from boot
    telemetryBridge.start(1000);

    // Initialize protocols
    if (CONFIG.protocols.includes('navi')) {
      await naviProtocol.initialize();
      naviIndexer.onObligationUpdate((state) => this.handleObligationUpdate(state));
      await naviIndexer.start();
    }

    if (CONFIG.protocols.includes('scallop')) {
      await scallopProtocol.initialize();
      try {
        await validateSharedVersions(rpcManager.getClient());
        logger.info('Verified Scallop shared object initial versions against on-chain state');
      } catch (err) {
        logger.warn({ error: err }, 'Scallop shared versions validation warning');
      }
      scallopIndexer.onObligationUpdate((state) => this.handleObligationUpdate(state));
      await scallopIndexer.start();
    }

    // Start Pyth price feeds and register price-tick trigger
    pythService.onPriceUpdate((feedId, price, symbol) => {
      this.handlePriceTick(feedId, price, symbol).catch(() => {});
    });
    await pythService.start(1000);

    // Continuous tick loop
    this.tickInterval = setInterval(() => {
      this.updateStats();
      this.processImmediateTargets().catch((err) => {
        logger.warn({ error: err?.message }, 'Error in periodic searcher tick');
      });
    }, 1000);
  }

  public stop(): void {
    this.isRunning = false;
    telemetryBridge.stop();
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.clearQueue();
    this.inFlightObligations.clear();
    this.activePipelineCount = 0;
    pythService.stop();
    naviIndexer.stop();
    scallopIndexer.stop();
    gasManager.stopBackgroundReconciliation();
    logger.info('SuiMEV Liquidation Engine stopped');
  }

  private handleObligationUpdate(state: ObligationState): void {
    obligationRegistry.upsertObligation(state);
    ZeroCapitalPtbBuilder.invalidateLockCache(state.obligationId);
    if (state.healthFactor < 1.0) {
      this.processImmediateTargets().catch(() => {});
    } else if (state.healthFactor <= 1.03 && state.protocol === 'scallop') {
      // Institutional Predictive Pre-Warm: Pre-fetch Scallop lock status into RAM before 1.0 breach
      scallopProtocol.isObligationLocked(state.obligationId).catch(() => {});
    }
  }

  private async handlePriceTick(feedId?: string, price?: number, symbol?: string): Promise<void> {
    if (this.isTickRunning) return;
    this.isTickRunning = true;
    try {
      const isBtcUpdate =
        symbol?.toUpperCase().includes('BTC') ||
        feedId === '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';

      let newlyUndercollateralized = obligationRegistry.reevaluateHotWatchlist();

      if (isBtcUpdate) {
        if (price !== undefined && price > 0) {
          const { dropBps, isDrop } = priceCache.recordBtcPriceUpdate(price);
          if (isDrop && dropBps >= 50) {
            logger.warn(
              { symbol: symbol ?? 'BTC', price, dropBps },
              `📉 Steep BTC drop detected (-${(dropBps / 100).toFixed(2)}%) — triggering full hBTC collateral cascade sweep`
            );
          }
        }

        const volatileTargets = obligationRegistry.reevaluateVolatileCollaterals('BTC');
        const existingIds = new Set(newlyUndercollateralized.map((o) => o.obligationId));
        for (const t of volatileTargets) {
          if (!existingIds.has(t.obligationId)) {
            newlyUndercollateralized.push(t);
          }
        }
      }

      if (newlyUndercollateralized.length > 0) {
        logger.warn(
          { count: newlyUndercollateralized.length, isBtcUpdate },
          `🚨 Liquidation targets emerged after price update — initiating immediate processing`
        );
        await this.processImmediateTargets();
      }
    } catch (err: any) {
      logger.warn({ error: err?.message }, 'Error during price tick evaluation');
    } finally {
      this.isTickRunning = false;
    }
  }

  private updateStats(): void {
    const counts = obligationRegistry.getCounts();
    this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    this.stats.totalObligationsMonitored = counts.total;
    this.stats.immediateTargetsCount = counts.immediate;
    this.stats.hotWatchlistCount = counts.hot;
    this.stats.safeCount = counts.safe;
  }

  /**
   * Process all currently liquidatable obligations using a bounded concurrency queue.
   * Queue ordering is maintained by a max-heap keyed by expected gross profit to avoid
   * repeated sort calls on a large array.
   */
  public async processImmediateTargets(): Promise<void> {
    const targets = obligationRegistry.getImmediateTargets();
    if (targets.length === 0 && this.queuedOpportunities.size === 0) {
      return;
    }

    for (const target of targets) {
      const oblId = target.obligationId;
      if (this.inFlightObligations.has(oblId) || this.hasQueuedOpportunity(oblId)) {
        continue;
      }

      const opp = HealthFactorEngine.findBestLiquidationOpportunity(target);
      if (opp && opp.expectedGrossProfitUsd >= CONFIG.minProfitUsd) {
        if (!priceCache.arePricesFreshForOpportunity(opp)) {
          const lastRefresh = this.lastOnDemandRefreshByObligation.get(oblId) ?? 0;
          if (Date.now() - lastRefresh > 15_000) {
            this.lastOnDemandRefreshByObligation.set(oblId, Date.now());
            logger.warn(
              { borrower: target.ownerAddress, protocol: target.protocol },
              'Opportunity references stale or unverified cold-start seed prices — triggering on-demand Pyth refresh'
            );
            pythService.fetchLatestPrices().catch(() => {});
          }
          continue;
        }

        this.enqueueOpportunity(opp);
      }
    }

    this.drainQueue();
  }

  /**
   * Drain opportunity queue ensuring concurrency never exceeds MAX_CONCURRENT_PIPELINES.
   */
  private drainQueue(): void {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (this.activePipelineCount < this.MAX_CONCURRENT_PIPELINES) {
        const opp = this.dequeueOpportunity();
        if (!opp) break;

        const oblId = opp.obligation.obligationId;
        if (this.inFlightObligations.has(oblId)) {
          continue;
        }

        this.inFlightObligations.add(oblId);
        this.activePipelineCount++;

        this.executeLiquidationPipeline(opp)
          .catch((err) => {
            logger.warn({ error: err?.message, borrower: opp.obligation.ownerAddress }, 'Pipeline execution encountered an error');
          })
          .finally(() => {
            this.activePipelineCount--;
            this.inFlightObligations.delete(oblId);
            ZeroCapitalPtbBuilder.invalidateLockCache(oblId);
            this.drainQueue();
          });
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Complete zero-capital pipeline: Build PTB -> Simulate / Fast-Path -> Execute
   */
  public async executeLiquidationPipeline(opportunity: LiquidationOpportunity): Promise<boolean> {
    try {
      logger.info(
        {
          protocol: opportunity.protocol,
          borrower: opportunity.obligation.ownerAddress,
          repay: `${opportunity.debtSymbol} ($${opportunity.debtRepayUsd.toFixed(2)})`,
          seize: `${opportunity.collateralSymbol} ($${opportunity.collateralReceiveUsd.toFixed(2)})`,
          expectedProfitUsd: `$${opportunity.expectedGrossProfitUsd.toFixed(2)}`,
        },
        '🎯 LIQUIDATION OPPORTUNITY IDENTIFIED — BUILDING ZERO-CAPITAL PTB'
      );

      // STEP 1: Construct atomic PTB (with async oracle freshness and unlock handling)
      const builtPtb = await ZeroCapitalPtbBuilder.buildLiquidationPTBAsync(opportunity);

      // STEP 2: Pre-Flight Simulation Guard per AGENTS.md §4 & §15
      this.stats.totalSimulations++;
      const simResult = await PreFlightSimulator.simulate(builtPtb.tx, opportunity);

      if (!simResult.success || !simResult.isProfitable) {
        logger.warn(
          { error: simResult.errorMessage, isProfitable: simResult.isProfitable, borrower: opportunity.obligation.ownerAddress },
          'Pre-flight simulation rejected liquidation (prevented consensus revert & gas loss)'
        );
        return false;
      }
      this.stats.successfulSimulations++;
      const simulatedProfitUsd = simResult.netProfitUsd;

      // STEP 3: Execute transaction via Parallel Broadcast Race
      this.stats.totalLiquidationsAttempted++;
      const execResult = await TransactionExecutor.execute(
        builtPtb.tx,
        opportunity,
        simulatedProfitUsd
      );

      if (execResult.success) {
        this.stats.successfulLiquidations++;
        this.stats.cumulativeNetProfitUsd += execResult.netProfitUsd;
        this.stats.cumulativeGasSpentSui += execResult.gasUsedSui;
        this.stats.lastLiquidationTime = execResult.timestamp;
        telemetryBridge.exportSnapshot().catch(() => {});
        return true;
      } else {
        this.stats.failedLiquidations++;
        return false;
      }
    } catch (err: any) {
      logger.error(
        {
          error: err?.message || String(err),
          stack: err?.stack,
          details: JSON.stringify(err, Object.getOwnPropertyNames(err), 2),
        },
        'Unhandled error in liquidation pipeline'
      );
      return false;
    } finally {
      ZeroCapitalPtbBuilder.invalidateLockCache(opportunity.obligation.obligationId);
    }
  }

  public getRecentLiquidations() {
    return telemetryBridge.getRecentLiquidations();
  }
}

export const searcher = new LiquidationSearcher();
