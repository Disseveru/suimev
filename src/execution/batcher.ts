import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import type {
  LiquidationOpportunity,
  BatchedPTBResult,
  BatcherOptions,
} from '../types/execution.js';

export const MAX_SUI_PTB_COMMANDS = 1000; // Protocol limit is 1024; 1000 provides safety cushion
export const DEFAULT_MAX_GAS_BUDGET_MIST = 100_000_000n; // 0.1 SUI
export const BASE_BATCH_GAS_MIST = 15_000_000n; // Base execution cost
export const PER_TARGET_GAS_MIST = 12_000_000n; // Gas cost per liquidation branch

/**
 * Multi-Obligation Programmable Transaction Block (PTB) Batcher
 *
 * Combines multiple liquidation targets into a single atomic PTB to amortize
 * base gas fees, eliminate redundant gas coin mutations, and execute multiple
 * undercollateralized liquidations in a single consensus checkpoint.
 */
export class TransactionBatcher {
  private maxCommands: number;
  private maxGasBudgetMist: bigint;

  constructor(options?: BatcherOptions) {
    this.maxCommands = options?.maxCommands ?? MAX_SUI_PTB_COMMANDS;
    this.maxGasBudgetMist =
      options?.maxGasBudgetMist ?? DEFAULT_MAX_GAS_BUDGET_MIST;
  }

  /**
   * Estimate the gas budget required for a given batch size
   */
  public estimateGasBudget(targetCount: number): bigint {
    if (targetCount <= 0) return 0n;
    const estimated =
      BASE_BATCH_GAS_MIST + BigInt(targetCount) * PER_TARGET_GAS_MIST;
    return estimated > this.maxGasBudgetMist
      ? this.maxGasBudgetMist
      : estimated;
  }

  /**
   * Check whether an additional target can fit within PTB command limits
   */
  public canBatch(
    currentCommandCount: number,
    estimatedAdditionalCommands: number = 20
  ): boolean {
    return currentCommandCount + estimatedAdditionalCommands <= this.maxCommands;
  }

  /**
   * Batch multiple liquidation opportunities into a single atomic PTB.
   * Respects both max command count (1024 on Sui) and max gas budget.
   */
  public batchOpportunities(
    opportunities: LiquidationOpportunity[],
    options?: BatcherOptions
  ): BatchedPTBResult {
    if (!opportunities || opportunities.length === 0) {
      throw new Error('Cannot batch empty list of liquidation opportunities');
    }

    const maxCommands = options?.maxCommands ?? this.maxCommands;
    const maxGasBudgetMist =
      options?.maxGasBudgetMist ?? this.maxGasBudgetMist;
    const maxTargets = options?.maxTargets ?? 10;

    const tx = new Transaction();
    tx.setSender(CONFIG.operatorAddress);

    const includedOpportunities: LiquidationOpportunity[] = [];

    for (const opp of opportunities) {
      if (includedOpportunities.length >= maxTargets) {
        logger.info(
          { included: includedOpportunities.length, maxTargets },
          'Batch reached maximum target limit; finalizing current PTB'
        );
        break;
      }

      // Check current command count before adding next liquidation
      let currentCommandCount = 0;
      try {
        currentCommandCount = tx.getData().commands.length;
      } catch {
        currentCommandCount = 0;
      }

      // Average liquidation PTB uses 10-15 Move commands
      if (!this.canBatch(currentCommandCount, 15)) {
        logger.warn(
          { currentCommandCount, maxCommands },
          'Approaching PTB command limit; stopping batch addition'
        );
        break;
      }

      // Check gas budget limit
      const nextGasEstimate = this.estimateGasBudget(
        includedOpportunities.length + 1
      );
      if (nextGasEstimate > maxGasBudgetMist && includedOpportunities.length > 0) {
        logger.warn(
          { nextGasEstimate: nextGasEstimate.toString(), maxGasBudgetMist: maxGasBudgetMist.toString() },
          'Batch reached max gas budget; finalizing current PTB'
        );
        break;
      }

      try {
        // Atomically assemble liquidation commands into the shared PTB
        ZeroCapitalPtbBuilder.buildLiquidationPTB(opp, tx);
        includedOpportunities.push(opp);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          {
            obligationId: opp.obligation.obligationId,
            protocol: opp.protocol,
            error: errMsg,
          },
          'Failed to append liquidation target to batch; skipping target'
        );
      }
    }

    if (includedOpportunities.length === 0) {
      throw new Error('Failed to assemble any valid liquidation targets into batch');
    }

    const finalCommandCount = tx.getData().commands.length;
    const finalGasBudget = this.estimateGasBudget(includedOpportunities.length);
    tx.setGasBudget(finalGasBudget);

    logger.info(
      {
        targetsCount: includedOpportunities.length,
        commandCount: finalCommandCount,
        gasBudgetMist: finalGasBudget.toString(),
      },
      '📦 Assembled multi-obligation atomic liquidation PTB batch'
    );

    return {
      tx,
      opportunities: includedOpportunities,
      commandCount: finalCommandCount,
      estimatedTotalGasMist: finalGasBudget,
      targetCount: includedOpportunities.length,
    };
  }

  /**
   * Group opportunities by debt coin to allow aggregated single-flash-loan batching
   */
  public groupOpportunitiesByDebt(
    opportunities: LiquidationOpportunity[]
  ): Map<string, LiquidationOpportunity[]> {
    const groups = new Map<string, LiquidationOpportunity[]>();
    for (const opp of opportunities) {
      const existing = groups.get(opp.debtCoinType) ?? [];
      existing.push(opp);
      groups.set(opp.debtCoinType, existing);
    }
    return groups;
  }
}

export const transactionBatcher = new TransactionBatcher();
