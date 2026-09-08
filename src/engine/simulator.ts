import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, SimulationResult } from '../config/types.js';
import { rpcManager } from '../client/suiClient.js';
import { CONFIG } from '../config/index.js';
import { priceCache } from '../oracles/priceCache.js';
import { logger } from '../ui/logger.js';

/**
 * Pre-Flight Dry-Run Simulation Engine
 * Validates execution success and calculates net USD profit before consensus broadcast.
 */
export class PreFlightSimulator {
  /**
   * Simulate a built liquidation PTB
   */
  public static async simulate(
    tx: Transaction,
    opportunity: LiquidationOpportunity
  ): Promise<SimulationResult> {
    try {
      const suiPriceUsd = priceCache.getPriceUsd('0x2::sui::SUI') || 2.50;

      // Dev-inspect transaction block against live RPC state
      const inspectResult = await rpcManager.executeWithFallback(
        'devInspectTransactionBlock',
        async (client) => {
          return await client.devInspectTransactionBlock({
            transactionBlock: tx,
            sender: CONFIG.operatorAddress,
          });
        }
      );

      const effects = inspectResult.effects;
      const status = effects?.status?.status;

      if (status !== 'success') {
        const errorMsg = effects?.status?.error || 'Transaction simulation reverted on-chain';
        return {
          success: false,
          opportunity,
          gasUsedSui: 0,
          gasCostUsd: 0,
          netProfitUsd: 0,
          netProfitSui: 0,
          isProfitable: false,
          errorMessage: errorMsg,
          rawEffects: effects,
        };
      }

      // Calculate gas consumption: computation + storage - rebate
      const gasUsed = effects.gasUsed;
      const computationCost = BigInt(gasUsed?.computationCost || '0');
      const storageCost = BigInt(gasUsed?.storageCost || '0');
      const storageRebate = BigInt(gasUsed?.storageRebate || '0');

      let netGasMist = computationCost + storageCost - storageRebate;
      if (netGasMist < 0n) netGasMist = computationCost; // rebate floor

      const gasUsedSui = Number(netGasMist) / 1e9;
      const gasCostUsd = gasUsedSui * suiPriceUsd;

      // Compute Net Profit: Gross Profit (USD) - Gas Cost (USD)
      const grossProfitUsd = opportunity.expectedGrossProfitUsd;
      const netProfitUsd = grossProfitUsd - gasCostUsd;
      const netProfitSui = netProfitUsd / suiPriceUsd;

      const isProfitable = netProfitUsd >= CONFIG.minProfitUsd;

      logger.info(
        {
          protocol: opportunity.protocol,
          grossProfitUsd: grossProfitUsd.toFixed(3),
          gasCostUsd: gasCostUsd.toFixed(3),
          netProfitUsd: netProfitUsd.toFixed(3),
          isProfitable,
        },
        `Pre-flight simulation: ${isProfitable ? '✅ PROFITABLE' : '⚠️ UNPROFITABLE'}`
      );

      return {
        success: true,
        opportunity,
        gasUsedSui,
        gasCostUsd,
        netProfitUsd,
        netProfitSui,
        isProfitable,
        rawEffects: effects,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.debug({ error: errorMsg }, 'Pre-flight simulation encountered an RPC error');

      return {
        success: false,
        opportunity,
        gasUsedSui: 0,
        gasCostUsd: 0,
        netProfitUsd: 0,
        netProfitSui: 0,
        isProfitable: false,
        errorMessage: errorMsg,
      };
    }
  }
}
