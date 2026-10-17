import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from '../config/index.js';
import { rpcManager } from '../client/suiClient.js';
import { gasManager } from '../client/gasManager.js';
import { logger } from '../ui/logger.js';
import { priceCache } from '../oracles/priceCache.js';
import type { LiquidationOpportunity } from '../types/execution.js';
import type { PgaBroadcastResult } from '../types/execution.js';

export interface PgaBroadcastOptions {
  maxRetries?: number;
  gasStepMultiplier?: number;
  expectedGrossProfitUsd?: number;
  suiPriceUsd?: number;
  refGasPrice?: bigint;
}

/**
 * Standard Priority Gas Auction (PGA) Fallback Broadcaster
 *
 * Handles standard Sui fullnode RPC broadcast race with dynamic priority gas
 * price calculation, automatic gas stepping, and failover retry logic.
 */
export class PgaFallbackBroadcaster {
  private static cachedRefGasPrice: bigint | null = null;
  private static lastRefGasPriceTimeMs: number = 0;

  /**
   * Compute dynamic Priority Gas Auction (PGA) bid with gas stepping support.
   */
  public calculatePriorityGasPrice(
    refGasPrice: bigint,
    expectedGrossProfitUsd: number,
    suiPriceUsd: number,
    attemptStep: number = 1,
    stepMultiplierFactor: number = 0.15
  ): bigint {
    const baseMultiplier = CONFIG.gasPriceMultiplier;
    const maxMultiplier = CONFIG.maxGasPriceMultiplier;

    // Convert estimated profit in USD to SUI
    const profitSui = expectedGrossProfitUsd / Math.max(0.1, suiPriceUsd);
    // Allocate configured percentage of profit as a priority tip to validators
    const tipAllocationMist = BigInt(
      Math.floor(profitSui * CONFIG.priorityProfitShare * 1e9)
    );

    // Typical liquidation PTB uses ~3,500,000 computation gas units on Sui
    const estimatedComputationUnits = 3_500_000n;
    const additionalGasPrice =
      (tipAllocationMist * 1000n) / estimatedComputationUnits;

    let baseGasPrice = refGasPrice + additionalGasPrice;

    // Apply gas stepping for retry attempts (e.g. attempt 2 -> +15%, attempt 3 -> +30%)
    if (attemptStep > 1) {
      const stepFactor = 1.0 + (attemptStep - 1) * stepMultiplierFactor;
      baseGasPrice = BigInt(Math.floor(Number(baseGasPrice) * stepFactor));
    }

    const minGasPrice = BigInt(Math.floor(Number(refGasPrice) * baseMultiplier));
    const maxGasPrice = BigInt(Math.floor(Number(refGasPrice) * maxMultiplier));

    if (baseGasPrice < minGasPrice) return minGasPrice;
    if (baseGasPrice > maxGasPrice) return maxGasPrice;
    return baseGasPrice;
  }

  /**
   * Get cached reference gas price (valid for 30 seconds)
   */
  public async getReferenceGasPrice(): Promise<bigint> {
    const now = Date.now();
    if (
      PgaFallbackBroadcaster.cachedRefGasPrice &&
      now - PgaFallbackBroadcaster.lastRefGasPriceTimeMs < 30_000
    ) {
      return PgaFallbackBroadcaster.cachedRefGasPrice;
    }

    try {
      const price = await rpcManager.executeWithFallback(
        'getReferenceGasPrice',
        (client) => client.getReferenceGasPrice()
      );
      PgaFallbackBroadcaster.cachedRefGasPrice = BigInt(price);
      PgaFallbackBroadcaster.lastRefGasPriceTimeMs = now;
      return PgaFallbackBroadcaster.cachedRefGasPrice;
    } catch {
      return PgaFallbackBroadcaster.cachedRefGasPrice ?? 1000n;
    }
  }

  /**
   * Broadcast transaction via standard multi-RPC broadcast race with PGA stepping and retries
   */
  public async broadcast(
    tx: Transaction,
    opportunity?: LiquidationOpportunity,
    options?: PgaBroadcastOptions
  ): Promise<PgaBroadcastResult> {
    const maxRetries = options?.maxRetries ?? 3;
    const stepMultiplier = options?.gasStepMultiplier ?? 0.15;
    const expectedGrossProfitUsd =
      options?.expectedGrossProfitUsd ?? opportunity?.expectedGrossProfitUsd ?? 0;
    const suiPriceUsd =
      options?.suiPriceUsd ??
      priceCache.getPriceUsd('0x2::sui::SUI') ??
      2.5;

    const refGasPrice =
      options?.refGasPrice ?? (await this.getReferenceGasPrice());

    // DRY_RUN mode short-circuit
    if (CONFIG.dryRun) {
      const dryRunDigest =
        'PGA_DRY_RUN_' + Math.random().toString(36).substring(2, 12).toUpperCase();
      logger.info(
        { digest: dryRunDigest, refGasPrice: refGasPrice.toString() },
        '🛡️ PGA Fallback Dry-Run Simulated Successfully'
      );
      return {
        digest: dryRunDigest,
        success: true,
        gasUsedMist: 5_000_000n,
        gasUsedSui: 0.005,
        gasCostUsd: 0.005 * suiPriceUsd,
        gasPriceMist: refGasPrice,
        attemptsUsed: 1,
      };
    }

    // Attach in-memory gas payment coin if available
    const cachedGas = gasManager.getGasPayment();
    if (cachedGas) {
      tx.setGasPayment([
        {
          objectId: cachedGas.objectId,
          version: cachedGas.version,
          digest: cachedGas.digest,
        },
      ]);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const currentGasPrice = this.calculatePriorityGasPrice(
        refGasPrice,
        expectedGrossProfitUsd,
        suiPriceUsd,
        attempt,
        stepMultiplier
      );
      tx.setGasPrice(currentGasPrice);

      logger.info(
        {
          attempt,
          maxRetries,
          gasPriceMist: currentGasPrice.toString(),
          refGasPrice: refGasPrice.toString(),
        },
        `⚡ PGA Broadcast Attempt ${attempt}/${maxRetries} with Gas Stepping`
      );

      try {
        const response = await rpcManager.executeBroadcastRace(
          'pgaBroadcastRace',
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

        if (response.effects) {
          gasManager.updateFromExecutionEffects(response.effects);
        }

        const digest = response.digest;
        const status = response.effects?.status?.status;
        const isSuccess = status === 'success';

        const gasUsed = response.effects?.gasUsed;
        const netGasMist =
          BigInt(gasUsed?.computationCost || '0') +
          BigInt(gasUsed?.storageCost || '0') -
          BigInt(gasUsed?.storageRebate || '0');
        const gasUsedMist = netGasMist > 0n ? netGasMist : 0n;
        const gasUsedSui = Number(gasUsedMist) / 1e9;
        const gasCostUsd = gasUsedSui * suiPriceUsd;

        if (isSuccess) {
          logger.info(
            { digest, attempt, gasPriceMist: currentGasPrice.toString() },
            '🎉 PGA Fallback Broadcast Confirmed Successfully On-Chain!'
          );
          return {
            digest,
            success: true,
            gasUsedMist,
            gasUsedSui,
            gasCostUsd,
            gasPriceMist: currentGasPrice,
            attemptsUsed: attempt,
            effects: response.effects,
          };
        } else {
          // Move logic execution reverted on-chain; further gas stepping will not fix a Move abort
          const errorMsg =
            response.effects?.status?.error || 'Move execution reverted on-chain';
          logger.error(
            { digest, error: errorMsg, attempt },
            '❌ PGA broadcast executed but reverted on-chain'
          );
          return {
            digest,
            success: false,
            gasUsedMist,
            gasUsedSui,
            gasCostUsd,
            gasPriceMist: currentGasPrice,
            attemptsUsed: attempt,
            effects: response.effects,
            error: errorMsg,
          };
        }
      } catch (err: unknown) {
        lastError = err;
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { attempt, maxRetries, error: errMsg },
          `PGA broadcast attempt ${attempt} failed. Evaluating retry with gas stepping...`
        );
      }
    }

    const finalErrMsg =
      lastError instanceof Error ? lastError.message : String(lastError);
    return {
      digest: 'FAILED',
      success: false,
      attemptsUsed: maxRetries,
      error: `PGA broadcast failed after ${maxRetries} attempt(s): ${finalErrMsg}`,
    };
  }
}

export const pgaFallbackBroadcaster = new PgaFallbackBroadcaster();
