import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, ExecutionResult, TelemetryRecentLiquidationItem } from '../config/types.js';
import { formatGrpcExecutionError, grpcManager } from '../client/grpcClient.js';
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
    opportunity: LiquidationOpportunity
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    if (CONFIG.dryRun) {
      throw new Error('DRY_RUN is enabled; refusing to submit a transaction. Use the simulation path instead.');
    }
    if (!CONFIG.liveExecutionApproved) {
      throw new Error('LIVE_EXECUTION_APPROVED is not true; refusing to broadcast a transaction.');
    }
    if (!CONFIG.liveExecutionReady) {
      throw new Error('Live execution is disabled until all Sui gRPC, indexer, protocol, and profit-accounting migrations are complete.');
    }

    if (!priceCache.arePricesFreshForOpportunity(opportunity, 10_000)) {
      throw new Error('One or more liquidation asset prices are stale, future-dated, or unverified; refusing to broadcast.');
    }
    if (!priceCache.isPriceFresh('0x2::sui::SUI', 10_000)) {
      throw new Error('SUI gas price is stale, future-dated, or unverified; refusing to broadcast.');
    }
    const suiPriceUsd = priceCache.getPriceUsd('0x2::sui::SUI');
    if (!Number.isFinite(suiPriceUsd) || suiPriceUsd <= 0) {
      throw new Error('SUI gas price is unavailable or invalid; refusing to broadcast.');
    }

    try {
      // Set priority gas price to front-run competing searchers via Dynamic Priority Gas Auction (PGA)
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

      // LIVE EXECUTION PATH
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

      const { PreFlightSimulator } = await import('./simulator.js');
      const finalSimulation = await PreFlightSimulator.simulate(tx, opportunity);
      if (!finalSimulation.success || !finalSimulation.isProfitable) {
        throw new Error(
          `Final pre-broadcast simulation rejected the transaction: ${finalSimulation.errorMessage ?? 'net profit is below the configured minimum.'}`
        );
      }
      const estimatedNetProfitUsd = finalSimulation.netProfitUsd;
      if (estimatedNetProfitUsd < CONFIG.minProfitUsd) {
        throw new Error(
          `Final simulated net profit ${estimatedNetProfitUsd.toFixed(2)} USD is below minimum threshold ${CONFIG.minProfitUsd} USD.`
        );
      }

      // Submit once: after an ambiguous transport failure, retrying can duplicate a broadcast.
      const response = await grpcManager.getClient().signAndExecuteTransaction({
        signer: CONFIG.operatorKeypair,
        transaction: tx,
        include: { effects: true, events: true },
      });

      // Surgically update in-memory gas coin version and digest from execution effects in 0ms
      const transactionResult = response.$kind === 'Transaction'
        ? response.Transaction
        : response.FailedTransaction;
      const effects = transactionResult.effects;
      if (!effects) {
        throw new Error(
          `gRPC returned no execution effects for submitted transaction ${transactionResult.digest}; its on-chain outcome must be checked before retrying.`
        );
      }
      gasManager.updateFromGrpcExecutionEffects(effects);

      const digest = transactionResult.digest;
      const status = transactionResult.status;
      const isSuccess = status.success;
      const statusError = formatGrpcExecutionError(status);

      const gasUsed = effects?.gasUsed;
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
        expectedGrossProfitUsd: opportunity.expectedGrossProfitUsd,
        gasCostSui: gasUsedSui,
        success: isSuccess,
        digest,
        error: statusError,
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
          { digest, latencyMs, estimatedNetProfitUsd: estimatedNetProfitUsd.toFixed(2) },
          '🎉 LIQUIDATION EXECUTED SUCCESSFULLY ON-CHAIN!'
        );
        const event: TelemetryRecentLiquidationItem = {
          timestamp: new Date().toISOString(),
          protocol: opportunity.protocol,
          borrower: opportunity.obligation.ownerAddress,
          debtRepaid: this.formatCoinAmount(opportunity.debtAmountToRepay, opportunity.debtSymbol),
          collateralSeized: this.formatCoinAmount(opportunity.collateralToReceive, opportunity.collateralSymbol),
          estimatedNetProfitUsd: Number(estimatedNetProfitUsd.toFixed(2)),
          gasCostSui: Number(gasUsedSui.toFixed(4)),
          txDigest: digest,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/${digest}`,
        };
        telemetryBridge.recordLiquidation(event);
      } else {
        const statusErr = statusError;
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
        estimatedNetProfitUsd: isSuccess ? estimatedNetProfitUsd : -gasCostUsd,
        timestamp: Date.now(),
        errorMessage: statusError,
      };
    } catch (err) {
      if (gasManager.isGasObjectError(err)) {
        gasManager.handleGasError(err).catch(() => {});
      }
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ error: errorMsg }, 'Live execution halted before or during transaction submission');

      telemetry.recordExecution({
        opportunityId: opportunity.obligation.obligationId,
        protocol: opportunity.protocol,
        debtSymbol: opportunity.debtSymbol,
        collateralSymbol: opportunity.collateralSymbol,
        expectedGrossProfitUsd: opportunity.expectedGrossProfitUsd,
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
        success: false,
        opportunity,
        gasUsedSui: 0,
        gasCostUsd: 0,
        estimatedNetProfitUsd: null,
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
      await grpcManager.checkHealth();
      const { referenceGasPrice } = await grpcManager.getClient().getReferenceGasPrice();
      if (!referenceGasPrice) throw new Error('Sui gRPC response omitted the reference gas price');
      this.cachedRefGasPrice = BigInt(referenceGasPrice);
      this.lastRefGasPriceTimeMs = now;
      return this.cachedRefGasPrice;
    } catch (e) {
      throw new Error(
        `Unable to obtain a current Sui reference gas price: ${e instanceof Error ? e.message : String(e)}`
      );
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
      await grpcManager.checkHealth();
      const balance = await grpcManager.getClient().getBalance({ owner: CONFIG.operatorAddress });
      const balanceMist = BigInt(balance.balance.balance);
      const balanceSui = Number(balanceMist) / 1e9;
      this.cachedGasBalance = { balanceMist, balanceSui, lastCheckedMs: now };

      return {
        balanceMist,
        balanceSui,
        isSufficient: balanceMist >= minRequiredMist,
      };
    } catch (error) {
      throw new Error(
        `Unable to verify operator SUI gas balance: ${error instanceof Error ? error.message : String(error)}`
      );
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
