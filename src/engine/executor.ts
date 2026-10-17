import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, ExecutionResult, TelemetryRecentLiquidationItem } from '../config/types.js';
import { rpcManager } from '../client/suiClient.js';
import { gasManager } from '../client/gasManager.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import { priceCache } from '../oracles/priceCache.js';
import { telemetry } from './telemetry.js';
import { telemetryBridge } from './telemetryBridge.js';
import { getCoinConfigBySymbol } from '../config/coins.js';

/**
 * High-Performance Transaction Executor & Gas Optimizer
 */
export class TransactionExecutor {
  /**
   * Execute or dry-run a verified profitable liquidation PTB
   */
  public static async execute(
    tx: Transaction,
    opportunity: LiquidationOpportunity,
    netProfitUsd: number
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const suiPriceUsd = priceCache.getPriceUsd('0x2::sui::SUI') || 2.50;
    // Safety Gate: Pyth Price Freshness Validation
    // Per AGENTS.md §4.3 & §9.3, live broadcast mandates freshness <= 45s (allow 60s in dry-run mode for local tests)
    const nowMs = Date.now();
    const MAX_AGE_MS = CONFIG.dryRun ? 60000 : 45000;
    const debtPrice = priceCache.getPriceBySymbol(opportunity.debtSymbol);
    const colPrice = priceCache.getPriceBySymbol(opportunity.collateralSymbol);
    
    if (!debtPrice || debtPrice.isDefaultSeed || (nowMs - debtPrice.lastUpdatedMs > MAX_AGE_MS)) {
      throw new Error(`Oracle price for ${opportunity.debtSymbol} is unverified or static seed default. Aborting per AGENTS.md freshness rules.`);
    }
    if (!colPrice || colPrice.isDefaultSeed || (nowMs - colPrice.lastUpdatedMs > MAX_AGE_MS)) {
      throw new Error(`Oracle price for ${opportunity.collateralSymbol} is unverified or static seed default. Aborting per AGENTS.md freshness rules.`);
    }

    // Safety Gate: Net Profit Validation (Accounts for flash loan, DEX swap, and gas costs)
    if (netProfitUsd < CONFIG.minProfitUsd) {
      throw new Error(`Net profit ${netProfitUsd.toFixed(2)} USD is below minimum threshold ${CONFIG.minProfitUsd} USD. Aborting.`);
    }

    // Set priority gas price to front-run competing searchers via Dynamic Priority Gas Auction (PGA)
    try {
      const refGasPrice = await this.getReferenceGasPrice();
      const priorityGasPrice = this.calculatePriorityGasPrice(
        refGasPrice,
        opportunity.expectedGrossProfitUsd,
        suiPriceUsd
      );
      tx.setGasPrice(priorityGasPrice);
      logger.info(
        {
          refGasPrice: refGasPrice.toString(),
          priorityGasPrice: priorityGasPrice.toString(),
          multiplier: (Number(priorityGasPrice) / Number(refGasPrice)).toFixed(2) + 'x',
        },
        '⚡ Dynamic Priority Gas Price computed for PGA consensus ordering'
      );
    } catch {
      // Keep default gas price if RPC query fails
    }

    // Safety Gate: DRY_RUN mode validation
    if (CONFIG.dryRun) {
      const mockDigest = 'DRY_RUN_' + Math.random().toString(36).substring(2, 15).toUpperCase();
      logger.info(
        {
          digest: mockDigest,
          protocol: opportunity.protocol,
          repayDebt: `${opportunity.debtAmountToRepay} ${opportunity.debtSymbol}`,
          seizeCollateral: `${opportunity.collateralToReceive} ${opportunity.collateralSymbol}`,
          netProfitUsd: netProfitUsd.toFixed(2),
        },
        '🛡️ DRY-RUN SUCCESS: Liquidation validated without on-chain broadcast'
      );

      const event: TelemetryRecentLiquidationItem = {
        timestamp: new Date().toISOString(),
        protocol: opportunity.protocol,
        borrower: opportunity.obligation.ownerAddress,
        debtRepaid: this.formatCoinAmount(opportunity.debtAmountToRepay, opportunity.debtSymbol),
        collateralSeized: this.formatCoinAmount(opportunity.collateralToReceive, opportunity.collateralSymbol),
        netProfitUsd: Number(netProfitUsd.toFixed(2)),
        gasCostSui: 0.005,
        txDigest: mockDigest,
        txDigestLink: `https://suiscan.xyz/mainnet/tx/${mockDigest}`,
      };
      telemetryBridge.recordLiquidation(event);

      return {
        digest: mockDigest,
        success: true,
        opportunity,
        gasUsedSui: 0.005,
        gasCostUsd: 0.005 * suiPriceUsd,
        netProfitUsd,
        timestamp: Date.now(),
      };
    }

    // LIVE EXECUTION PATH
    try {
      // Verify operator has sufficient SUI balance for gas budget (at least 2x budget per AGENTS.md §4.3)
      const minRequiredMist = BigInt(CONFIG.gasBudget) * 2n;
      const gasCheck = await this.checkOperatorGasBalance();
      if (!gasCheck.isSufficient) {
        throw new Error(
          `Operator wallet ${CONFIG.operatorAddress} has insufficient SUI (${gasCheck.balanceSui.toFixed(4)} SUI). Required gas reserve: ${(Number(minRequiredMist) / 1e9).toFixed(4)} SUI (2x budget per AGENTS.md §4.3)`
        );
      }

      logger.info(
        { protocol: opportunity.protocol, borrower: opportunity.obligation.ownerAddress, gasBalanceSui: gasCheck.balanceSui.toFixed(4) },
        '🚀 BROADCASTING LIVE LIQUIDATION PTB TO SUI CONSENSUS...'
      );

      // Zero-RPC Gas Object Optimization: Use locally tracked in-memory gas coin to eliminate implicit getCoins RPC round-trip
      const cachedGas = gasManager.getGasPayment();
      if (cachedGas) {
        tx.setGasPayment([{
          objectId: cachedGas.objectId,
          version: cachedGas.version,
          digest: cachedGas.digest,
        }]);
      }

      // 🏁 PARALLEL BROADCAST RACE — broadcast to all healthy endpoints simultaneously
      const response = await rpcManager.executeBroadcastRace(
        'signAndExecuteTransaction',
        async (client) => {
          return await client.signAndExecuteTransaction({
            signer: CONFIG.operatorKeypair,
            transaction: tx,
            options: {
              showEffects: true,
              showEvents: true,
            },
          });
        }
      );

      // Surgically update in-memory gas coin version and digest from execution effects in 0ms
      gasManager.updateFromExecutionEffects(response.effects);

      const digest = response.digest;
      const status = response.effects?.status?.status;
      const isSuccess = status === 'success';

      const gasUsed = response.effects?.gasUsed;
      const netGasMist = BigInt(gasUsed?.computationCost || '0') + BigInt(gasUsed?.storageCost || '0') - BigInt(gasUsed?.storageRebate || '0');
      const gasUsedSui = Number(netGasMist > 0n ? netGasMist : 0n) / 1e9;
      const gasCostUsd = gasUsedSui * suiPriceUsd;

      if (gasUsed?.computationCost) {
        GasPriceOracle.recordSample({
          timestamp: Date.now(),
          computationUnits: BigInt(gasUsed.computationCost),
          refGasPrice: BigInt(tx.getData().gasData.price || 1000n),
          wasIncluded: isSuccess,
        });
      }

      const latencyMs = Date.now() - startTime;
      telemetry.recordExecution({
        opportunityId: opportunity.obligation.obligationId,
        protocol: opportunity.protocol,
        debtSymbol: opportunity.debtSymbol,
        collateralSymbol: opportunity.collateralSymbol,
        expectedProfitUsd: opportunity.expectedGrossProfitUsd,
        actualProfitUsd: isSuccess ? netProfitUsd : 0,
        gasCostSui: gasUsedSui,
        success: isSuccess,
        digest,
        error: response.effects?.status?.error,
        timestampMs: Date.now(),
        latencies: {
          evalDurationMs: 0,
          ptbBuildDurationMs: 0,
          simulationDurationMs: 0,
          broadcastDurationMs: latencyMs,
          totalCycleDurationMs: latencyMs,
        },
      });

      if (isSuccess) {
        logger.info(
          { digest, latencyMs, netProfitUsd: netProfitUsd.toFixed(2) },
          '🎉 LIQUIDATION EXECUTED SUCCESSFULLY ON-CHAIN!'
        );
        const event: TelemetryRecentLiquidationItem = {
          timestamp: new Date().toISOString(),
          protocol: opportunity.protocol,
          borrower: opportunity.obligation.ownerAddress,
          debtRepaid: this.formatCoinAmount(opportunity.debtAmountToRepay, opportunity.debtSymbol),
          collateralSeized: this.formatCoinAmount(opportunity.collateralToReceive, opportunity.collateralSymbol),
          netProfitUsd: Number(netProfitUsd.toFixed(2)),
          gasCostSui: Number(gasUsedSui.toFixed(4)),
          txDigest: digest,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/${digest}`,
        };
        telemetryBridge.recordLiquidation(event);
      } else {
        const statusErr = response.effects?.status?.error;
        if (gasManager.isGasObjectError(statusErr)) {
          gasManager.handleGasError(statusErr).catch(() => {});
        }
        logger.error(
          { digest, status, error: statusErr },
          '❌ LIQUIDATION TRANSACTION FAILED ON-CHAIN'
        );
      }

      return {
        digest,
        success: isSuccess,
        opportunity,
        gasUsedSui,
        gasCostUsd,
        netProfitUsd: isSuccess ? netProfitUsd : -gasCostUsd,
        timestamp: Date.now(),
        errorMessage: response.effects?.status?.error,
      };
    } catch (err) {
      if (gasManager.isGasObjectError(err)) {
        gasManager.handleGasError(err).catch(() => {});
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errorMsg }, 'Execution failed during transaction submission');

      telemetry.recordExecution({
        opportunityId: opportunity.obligation.obligationId,
        protocol: opportunity.protocol,
        debtSymbol: opportunity.debtSymbol,
        collateralSymbol: opportunity.collateralSymbol,
        expectedProfitUsd: opportunity.expectedGrossProfitUsd,
        gasCostSui: 0,
        success: false,
        error: errorMsg,
        timestampMs: Date.now(),
        latencies: {
          evalDurationMs: 0,
          ptbBuildDurationMs: 0,
          simulationDurationMs: 0,
          broadcastDurationMs: Date.now() - startTime,
          totalCycleDurationMs: Date.now() - startTime,
        },
      });

      return {
        digest: 'FAILED',
        success: false,
        opportunity,
        gasUsedSui: 0,
        gasCostUsd: 0,
        netProfitUsd: 0,
        timestamp: Date.now(),
        errorMessage: errorMsg,
      };
    }
  }

  /**
   * Compute dynamic Priority Gas Auction (PGA) bid based on expected opportunity profit.
   * On Sui, validator priority ordering in consensus is governed by the computation gas price.
   */
  public static calculatePriorityGasPrice(
    refGasPrice: bigint,
    expectedGrossProfitUsd: number,
    suiPriceUsd: number
  ): bigint {
    const baseMultiplier = CONFIG.gasPriceMultiplier;
    const maxMultiplier = CONFIG.maxGasPriceMultiplier;

    // Convert estimated profit in USD to SUI
    const profitSui = expectedGrossProfitUsd / Math.max(0.1, suiPriceUsd);
    // Allocate configured percentage of profit as a priority tip to validators
    const tipAllocationMist = BigInt(Math.floor(profitSui * CONFIG.priorityProfitShare * 1e9));

    // Dynamic Computation Units estimation:
    // Calibrated dynamically from recent P75 devInspect / consensus execution samples (defaults to 3,500,000)
    const estimatedComputationUnits = GasPriceOracle.getP75ComputationUnits();
    const additionalGasPrice = (tipAllocationMist * 1000n) / estimatedComputationUnits;

    const calculatedGasPrice = refGasPrice + additionalGasPrice;
    const minGasPrice = BigInt(Math.floor(Number(refGasPrice) * baseMultiplier));
    const maxGasPrice = BigInt(Math.floor(Number(refGasPrice) * maxMultiplier));

    if (calculatedGasPrice < minGasPrice) return minGasPrice;
    if (calculatedGasPrice > maxGasPrice) return maxGasPrice;
    return calculatedGasPrice;
  }

  private static cachedRefGasPrice: bigint | null = null;
  private static lastRefGasPriceTimeMs: number = 0;
  private static cachedGasBalance: { balanceMist: bigint; balanceSui: number; lastCheckedMs: number } | null = null;

  public static getCachedRefGasPriceSync(): bigint {
    return this.cachedRefGasPrice ?? 1000n;
  }

  /**
   * Cached Reference Gas Price (valid for 30s to avoid latency on execution hot path)
   */
  public static async getReferenceGasPrice(): Promise<bigint> {
    const now = Date.now();
    if (this.cachedRefGasPrice && now - this.lastRefGasPriceTimeMs < 30_000) {
      return this.cachedRefGasPrice;
    }

    try {
      const price = await rpcManager.executeWithFallback('getReferenceGasPrice', (client) =>
        client.getReferenceGasPrice()
      );
      this.cachedRefGasPrice = BigInt(price);
      this.lastRefGasPriceTimeMs = now;
      return this.cachedRefGasPrice;
    } catch (e) {
      return this.cachedRefGasPrice ?? 1000n;
    }
  }

  /**
   * Check operator wallet SUI balance and verify sufficiency for gas budget.
   * Caches balance for 5 seconds during burst liquidation sequences.
   */
  public static async checkOperatorGasBalance(forceRefresh: boolean = false): Promise<{
    balanceMist: bigint;
    balanceSui: number;
    isSufficient: boolean;
  }> {
    const minRequiredMist = BigInt(CONFIG.gasBudget) * 2n;
    const now = Date.now();
    if (!forceRefresh && this.cachedGasBalance && now - this.cachedGasBalance.lastCheckedMs < 5_000) {
      return {
        balanceMist: this.cachedGasBalance.balanceMist,
        balanceSui: this.cachedGasBalance.balanceSui,
        isSufficient: this.cachedGasBalance.balanceMist >= minRequiredMist,
      };
    }

    try {
      const balance = await rpcManager.executeWithFallback('getBalance', (client) =>
        client.getBalance({ owner: CONFIG.operatorAddress })
      );
      const balanceMist = BigInt(balance.totalBalance);
      const balanceSui = Number(balanceMist) / 1e9;
      this.cachedGasBalance = { balanceMist, balanceSui, lastCheckedMs: now };

      return {
        balanceMist,
        balanceSui,
        isSufficient: balanceMist >= minRequiredMist,
      };
    } catch {
      return { balanceMist: 0n, balanceSui: 0, isSufficient: false };
    }
  }

  public static formatCoinAmount(amountRaw: bigint, symbol: string): string {
    const cfg = getCoinConfigBySymbol(symbol);
    const decimals = cfg?.decimals ?? 9;
    const num = Number(amountRaw) / Math.pow(10, decimals);
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${symbol}`;
  }

  public static recordLiquidation(event: TelemetryRecentLiquidationItem): void {
    telemetryBridge.recordLiquidation(event);
  }

  public static getRecentLiquidations(): TelemetryRecentLiquidationItem[] {
    return telemetryBridge.getRecentLiquidations();
  }
}

export interface GasMarketSample {
  timestamp: number;
  computationUnits: bigint;
  refGasPrice: bigint;
  wasIncluded: boolean;
}

export class GasPriceOracle {
  private static samples: GasMarketSample[] = [];
  private static readonly SAMPLE_WINDOW = 60;

  public static recordSample(sample: GasMarketSample): void {
    this.samples.push(sample);
    if (this.samples.length > this.SAMPLE_WINDOW) {
      this.samples.shift();
    }
  }

  public static getP75ComputationUnits(): bigint {
    if (this.samples.length < 5) return 3_500_000n;
    const sorted = [...this.samples]
      .map((s) => s.computationUnits)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const p75idx = Math.floor(sorted.length * 0.75);
    return sorted[p75idx] > 0n ? sorted[p75idx] : 3_500_000n;
  }
}
