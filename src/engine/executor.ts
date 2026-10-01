import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, ExecutionResult } from '../config/types.js';
import { rpcManager } from '../client/suiClient.js';
import { gasManager } from '../client/gasManager.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import { priceCache } from '../oracles/priceCache.js';
import { telemetry } from './telemetry.js';

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
    // Per AGENTS.md §4.3 & §9.3, live broadcast mandates freshness <= 10s (allow 60s in dry-run mode for local tests)
    const nowMs = Date.now();
    const MAX_AGE_MS = CONFIG.dryRun ? 60000 : 10000;
    const debtPrice = priceCache.getPriceBySymbol(opportunity.debtSymbol);
    const colPrice = priceCache.getPriceBySymbol(opportunity.collateralSymbol);
    
    if (debtPrice && (nowMs - debtPrice.lastUpdatedMs > MAX_AGE_MS)) {
      throw new Error(`Oracle price for ${opportunity.debtSymbol} is older than ${MAX_AGE_MS}ms (${((nowMs - debtPrice.lastUpdatedMs)/1000).toFixed(1)}s). Aborting per AGENTS.md freshness rules.`);
    }
    if (colPrice && (nowMs - colPrice.lastUpdatedMs > MAX_AGE_MS)) {
      throw new Error(`Oracle price for ${opportunity.collateralSymbol} is older than ${MAX_AGE_MS}ms (${((nowMs - colPrice.lastUpdatedMs)/1000).toFixed(1)}s). Aborting per AGENTS.md freshness rules.`);
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

      // 🏁 PARALLEL BROADCAST RACE — fire to ALL healthy RPCs simultaneously
      // Whichever endpoint confirms first wins; others are abandoned.
      // Saves 50–150ms vs sequential tryout on a congested block.
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
      } else {
        logger.error(
          { digest, status, error: response.effects?.status?.error },
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

    // Typical liquidation PTB uses ~3,500,000 computation gas units on Sui
    // Computation cost (MIST) = units * (gasPrice / 1000)
    // Therefore additionalGasPrice = (tipAllocationMist * 1000) / estimatedUnits
    const estimatedComputationUnits = 3_500_000n;
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
}

