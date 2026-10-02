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
import { logger } from '../ui/logger.js';

/**
 * Main MEV Liquidation Searcher Daemon
 */
export class LiquidationSearcher {
  private isRunning = false;
  private startTime = Date.now();
  private isProcessingQueue = false;

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

    // Initialize protocols
    if (CONFIG.protocols.includes('navi')) {
      await naviProtocol.initialize();
      naviIndexer.onObligationUpdate((state) => this.handleObligationUpdate(state));
      await naviIndexer.start();
    }

    if (CONFIG.protocols.includes('scallop')) {
      await scallopProtocol.initialize();
      scallopIndexer.onObligationUpdate((state) => this.handleObligationUpdate(state));
      await scallopIndexer.start();
    }

    // Start Pyth price feeds and register price-tick trigger
    pythService.onPriceUpdate(() => {
      this.handlePriceTick();
    });
    await pythService.start(1000);

    // Continuous tick loop
    setInterval(() => {
      this.updateStats();
      this.processImmediateTargets();
    }, 1000);
  }

  public stop(): void {
    this.isRunning = false;
    pythService.stop();
    naviIndexer.stop();
    scallopIndexer.stop();
    logger.info('SuiMEV Liquidation Engine stopped');
  }

  private handleObligationUpdate(state: ObligationState): void {
    obligationRegistry.upsertObligation(state);
    if (state.healthFactor < 1.0) {
      this.processImmediateTargets();
    } else if (state.healthFactor <= 1.03 && state.protocol === 'scallop') {
      // Institutional Predictive Pre-Warm: Pre-fetch Scallop lock status into RAM before 1.0 breach
      scallopProtocol.isObligationLocked(state.obligationId).catch(() => {});
    }
  }

  private handlePriceTick(): void {
    const newlyUndercollateralized = obligationRegistry.reevaluateHotWatchlist();
    if (newlyUndercollateralized.length > 0) {
      this.processImmediateTargets();
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
   * Process all currently liquidatable obligations
   */
  public async processImmediateTargets(): Promise<void> {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      const targets = obligationRegistry.getImmediateTargets();
      for (const target of targets) {
        const opp = HealthFactorEngine.findBestLiquidationOpportunity(target);
        if (opp && opp.expectedGrossProfitUsd >= CONFIG.minProfitUsd) {
          await this.executeLiquidationPipeline(opp);
        }
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

      // STEP 2: Dual-Tier Execution: Fast-Path vs Safe-Path Simulation
      // For high-confidence liquidations (Hf <= 0.985), bypass devInspect simulation to save ~180ms in the MEV race
      let simulatedProfitUsd = opportunity.expectedGrossProfitUsd;
      const isHighConfidence = opportunity.obligation.healthFactor <= 0.985 && !CONFIG.dryRun;

      if (isHighConfidence) {
        logger.info(
          { hf: opportunity.obligation.healthFactor.toFixed(4) },
          '⚡ FAST-PATH TRIGGERED: High-confidence liquidation (Hf <= 0.985), bypassing devInspect simulation to save ~180ms'
        );
        this.stats.totalSimulations++;
        this.stats.successfulSimulations++;
      } else {
        // Safe-Path: Pre-flight devInspect simulation for borderline opportunities
        this.stats.totalSimulations++;
        const simResult = await PreFlightSimulator.simulate(builtPtb.tx, opportunity);

        if (!simResult.success || !simResult.isProfitable) {
          logger.warn(
            { error: simResult.errorMessage, isProfitable: simResult.isProfitable },
            'Pre-flight simulation rejected liquidation'
          );
          return false;
        }
        this.stats.successfulSimulations++;
        simulatedProfitUsd = simResult.netProfitUsd;
      }

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
        return true;
      } else {
        this.stats.failedLiquidations++;
        return false;
      }
    } catch (err: any) {
      logger.error(
        { error: err?.message || String(err), stack: err?.stack },
        'Unhandled error in liquidation pipeline'
      );
      return false;
    }
  }
}

export const searcher = new LiquidationSearcher();
