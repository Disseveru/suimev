import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, SimulationResult } from '../config/types.js';
import { formatGrpcExecutionError, grpcManager } from '../client/grpcClient.js';
import { CONFIG } from '../config/index.js';
import { priceCache } from '../oracles/priceCache.js';
import { GasPriceOracle, TransactionExecutor } from './executor.js';
import { gasManager } from '../client/gasManager.js';
import { logger } from '../ui/logger.js';

/**
 * Pre-Flight Dry-Run & Simulation Engine
 * Validates execution success and calculates net USD profit before consensus broadcast.
 * Uses the native gRPC transaction simulation API.
 */
export class PreFlightSimulator {
  /**
   * Simulate a built liquidation PTB against current chain state.
   */
  public static async simulate(
    tx: Transaction,
    opportunity: LiquidationOpportunity
  ): Promise<SimulationResult> {
    if (
      !priceCache.arePricesFreshForOpportunity(opportunity, 10_000) ||
      !priceCache.isPriceFresh('0x2::sui::SUI', 10_000)
    ) {
      return {
        success: false,
        opportunity,
        gasUsedSui: 0,
        gasCostUsd: 0,
        netProfitUsd: 0,
        netProfitSui: 0,
        isProfitable: false,
        errorMessage: 'Simulation rejected: one or more liquidation or gas prices are stale, future-dated, or unverified.',
        simulationType: 'devInspect',
      };
    }

    try {
      const suiPriceUsd = priceCache.getPriceUsd('0x2::sui::SUI');

      await grpcManager.checkHealth();
      const inspectResult = await grpcManager.getClient().simulateTransaction({
        transaction: tx,
        include: { effects: true },
      });
      const transactionResult = inspectResult.$kind === 'Transaction'
        ? inspectResult.Transaction
        : inspectResult.FailedTransaction;
      const effects = transactionResult.effects;
      const status = transactionResult.status;

      if (!status.success || !effects) {
        const errorMsg = formatGrpcExecutionError(status) ?? 'Transaction simulation did not return execution effects';
        if (gasManager.isGasObjectError(errorMsg)) {
          gasManager.handleGasError(errorMsg).catch(() => {});
        }
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
          simulationType: 'devInspect',
          sentioSimulatorUrl: `https://app.sentio.xyz/sui`,
        };
      }

      // Calculate gas consumption: computation + storage - rebate
      const gasUsed = effects.gasUsed;
      const computationCost = BigInt(gasUsed?.computationCost || '0');
      const storageCost = BigInt(gasUsed?.storageCost || '0');
      const storageRebate = BigInt(gasUsed?.storageRebate || '0');

      let netGasMist = computationCost + storageCost - storageRebate;
      if (netGasMist < 0n) netGasMist = 0n; // rebate floor: sponsored tx clamp

      if (computationCost > 0n) {
        const currentRgp = TransactionExecutor.getCachedRefGasPriceSync();
        const normalizedUnits = (computationCost * 1000n) / (currentRgp > 0n ? currentRgp : 1000n);
        GasPriceOracle.recordSample({
          timestamp: Date.now(),
          computationUnits: normalizedUnits,
          refGasPrice: currentRgp,
          wasIncluded: false,
        });
      }

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
        `Pre-flight devInspect: ${isProfitable ? '✅ PROFITABLE' : '⚠️ UNPROFITABLE'}`
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
        simulationType: 'devInspect',
        computationCostMist: computationCost,
        storageCostMist: storageCost,
        storageRebateMist: storageRebate,
        sentioSimulatorUrl: `https://app.sentio.xyz/sui`,
      };
    } catch (err) {
      if (gasManager.isGasObjectError(err)) {
        gasManager.handleGasError(err).catch(() => {});
      }
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
        simulationType: 'devInspect',
        sentioSimulatorUrl: `https://app.sentio.xyz/sui`,
      };
    }
  }

  /**
   * Run the gRPC simulation path used for the final pre-broadcast preflight.
   */
  public static async dryRun(
    tx: Transaction,
    opportunity: LiquidationOpportunity
  ): Promise<SimulationResult> {
    const result = await this.simulate(tx, opportunity);
    return { ...result, simulationType: 'dryRun' };
  }
}
