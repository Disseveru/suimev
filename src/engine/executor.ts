import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, ExecutionResult } from '../config/types.js';
import { rpcManager } from '../client/suiClient.js';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import { priceCache } from '../oracles/priceCache.js';

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

    // Set priority gas price to front-run competing searchers via Dynamic Priority Gas Auction (PGA)
    try {
      const refGasPrice = await rpcManager.executeWithFallback('getReferenceGasPrice', (client) =>
        client.getReferenceGasPrice()
      );
      const priorityGasPrice = this.calculatePriorityGasPrice(
        BigInt(refGasPrice),
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
      // Verify operator has sufficient SUI balance for gas budget
      const gasCheck = await this.checkOperatorGasBalance();
      if (!gasCheck.isSufficient) {
        throw new Error(
          `Operator wallet ${CONFIG.operatorAddress} has insufficient SUI (${gasCheck.balanceSui.toFixed(4)} SUI). Required gas budget: ${(Number(CONFIG.gasBudget) / 1e9).toFixed(4)} SUI`
        );
      }

      logger.info(
        { protocol: opportunity.protocol, borrower: opportunity.obligation.ownerAddress, gasBalanceSui: gasCheck.balanceSui.toFixed(4) },
        '🚀 BROADCASTING LIVE LIQUIDATION PTB TO SUI CONSENSUS...'
      );

      const response = await rpcManager.executeWithFallback(
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

      const digest = response.digest;
      const status = response.effects?.status?.status;
      const isSuccess = status === 'success';

      const gasUsed = response.effects?.gasUsed;
      const netGasMist = BigInt(gasUsed?.computationCost || '0') + BigInt(gasUsed?.storageCost || '0') - BigInt(gasUsed?.storageRebate || '0');
      const gasUsedSui = Number(netGasMist > 0n ? netGasMist : 0n) / 1e9;
      const gasCostUsd = gasUsedSui * suiPriceUsd;

      if (isSuccess) {
        logger.info(
          { digest, latencyMs: Date.now() - startTime, netProfitUsd: netProfitUsd.toFixed(2) },
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

    // Typical PTB uses ~4,000 computation gas units
    const estimatedComputationUnits = 4000n;
    const additionalGasPricePerUnit = tipAllocationMist / estimatedComputationUnits;

    const calculatedGasPrice = refGasPrice + additionalGasPricePerUnit;
    const minGasPrice = BigInt(Math.floor(Number(refGasPrice) * baseMultiplier));
    const maxGasPrice = BigInt(Math.floor(Number(refGasPrice) * maxMultiplier));

    if (calculatedGasPrice < minGasPrice) return minGasPrice;
    if (calculatedGasPrice > maxGasPrice) return maxGasPrice;
    return calculatedGasPrice;
  }

  /**
   * Check operator wallet SUI balance and verify sufficiency for gas budget.
   */
  public static async checkOperatorGasBalance(): Promise<{
    balanceMist: bigint;
    balanceSui: number;
    isSufficient: boolean;
  }> {
    try {
      const balance = await rpcManager.executeWithFallback('getBalance', (client) =>
        client.getBalance({ owner: CONFIG.operatorAddress })
      );
      const balanceMist = BigInt(balance.totalBalance);
      const balanceSui = Number(balanceMist) / 1e9;
      return {
        balanceMist,
        balanceSui,
        isSufficient: balanceMist >= BigInt(CONFIG.gasBudget),
      };
    } catch {
      return { balanceMist: 0n, balanceSui: 0, isSufficient: false };
    }
  }
}

