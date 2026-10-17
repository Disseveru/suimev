import { CONFIG } from '../config/index.js';
import { rpcManager } from '../client/suiClient.js';
import { priceCache } from '../oracles/priceCache.js';
import { logger } from '../ui/logger.js';
import type {
  IGasPriceCalibrator,
  GasPriceCalibration,
  P95ProfitabilityCheckResult,
} from '../types/security.js';
import type { LiquidationOpportunity } from '../types/execution.js';

export interface GasPriceCalibratorOptions {
  windowSize?: number;
  defaultP95Multiplier?: number;
  defaultGasUnits?: bigint;
}

/**
 * 95th-Percentile Network Gas Price Calibrator
 *
 * Mitigates liveness and negative MEV risks by evaluating liquidation profitability
 * under 95th-percentile network gas price congestion conditions:
 *   EstimatedProfit_P95 = GrossBonusUsd - SwapFeesUsd - GasCostUsd(P95)
 */
export class GasPriceCalibrator implements IGasPriceCalibrator {
  private static instance: GasPriceCalibrator;
  private samples: bigint[] = [];
  private maxSamples: number;
  private defaultP95Multiplier: number;
  private defaultGasUnits: bigint;
  private cachedRgp: bigint = 1000n;
  private lastCalibrationMs: number = 0;

  constructor(options?: GasPriceCalibratorOptions) {
    this.maxSamples = options?.windowSize ?? 100;
    this.defaultP95Multiplier = options?.defaultP95Multiplier ?? 1.5;
    this.defaultGasUnits = options?.defaultGasUnits ?? 15_000_000n;
  }

  public static getInstance(): GasPriceCalibrator {
    if (!GasPriceCalibrator.instance) {
      GasPriceCalibrator.instance = new GasPriceCalibrator();
    }
    return GasPriceCalibrator.instance;
  }

  /**
   * Record an observed gas price sample into the rolling window
   */
  public recordGasPriceSample(gasPrice: bigint): void {
    if (gasPrice <= 0n) return;
    this.samples.push(gasPrice);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  public recordGasPriceSamples(gasPrices: bigint[]): void {
    for (const p of gasPrices) {
      this.recordGasPriceSample(p);
    }
  }

  public clearSamples(): void {
    this.samples = [];
  }

  public getSamplesCount(): number {
    return this.samples.length;
  }

  public setDefaultGasUnits(units: bigint): void {
    this.defaultGasUnits = units;
  }

  public setDefaultP95Multiplier(multiplier: number): void {
    this.defaultP95Multiplier = multiplier;
  }

  /**
   * Query network Reference Gas Price (RGP) with fallback
   */
  public async getReferenceGasPrice(): Promise<bigint> {
    try {
      const rgp = await rpcManager.executeWithFallback('getReferenceGasPrice', (client) =>
        client.getReferenceGasPrice()
      );
      this.cachedRgp = BigInt(rgp);
      return this.cachedRgp;
    } catch (err) {
      logger.warn({ error: err }, 'Failed to query RGP from RPC; using cached RGP');
      return this.cachedRgp;
    }
  }

  /**
   * Calculate the 95th-percentile network gas price (P95)
   * If sample window is sufficiently populated (>= 5 samples), computes empirical P95.
   * Otherwise falls back to calibrated multiplier over RGP.
   */
  public async getP95GasPrice(): Promise<bigint> {
    const rgp = await this.getReferenceGasPrice();

    if (this.samples.length >= 5) {
      const sorted = [...this.samples].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const p95Index = Math.min(
        sorted.length - 1,
        Math.floor(0.95 * (sorted.length - 1))
      );
      const empiricalP95 = sorted[p95Index];
      const finalP95 = empiricalP95 > rgp ? empiricalP95 : rgp;
      this.lastCalibrationMs = Date.now();
      return finalP95;
    }

    // Default calibrated congestion multiplier over RGP
    const multiplier = Math.max(this.defaultP95Multiplier, CONFIG.gasPriceMultiplier * 1.3);
    const estimatedP95 = BigInt(Math.round(Number(rgp) * multiplier));
    this.lastCalibrationMs = Date.now();
    return estimatedP95;
  }

  /**
   * Calibrate from recent checkpoints via RPC
   */
  public async calibrateFromRecentCheckpoints(count: number = 20): Promise<GasPriceCalibration> {
    const rgp = await this.getReferenceGasPrice();
    try {
      const checkpoints = await rpcManager.executeWithFallback('getCheckpoints', (client) =>
        client.getCheckpoints({
          descendingOrder: true,
          limit: count,
        })
      );

      if (checkpoints.data && checkpoints.data.length > 0) {
        for (const cp of checkpoints.data) {
          const rawCp = cp as any;
          const costStr =
            rawCp.epochRollingGasCostSummary?.computationCost ||
            rawCp.computationCostSummary?.computationCost ||
            rawCp.computationCost;
          if (costStr) {
            const cost = BigInt(costStr);
            if (cost > 0n) {
              const normalizedPrice = cost > 10_000n ? rgp : cost;
              this.recordGasPriceSample(normalizedPrice);
            }
          }
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Checkpoint sampling non-fatal; using RGP multiplier');
    }

    const p95GasPrice = await this.getP95GasPrice();
    const multiplier = Number(p95GasPrice) / Number(rgp || 1000n);

    return {
      referenceGasPrice: rgp,
      p95GasPrice,
      multiplier,
      sampleCount: this.samples.length,
      lastCalibrationMs: Date.now(),
    };
  }

  public getCalibration(): GasPriceCalibration {
    let p95: bigint;
    if (this.samples.length >= 5) {
      const sorted = [...this.samples].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const p95Index = Math.min(
        sorted.length - 1,
        Math.floor(0.95 * (sorted.length - 1))
      );
      const empiricalP95 = sorted[p95Index];
      p95 = empiricalP95 > this.cachedRgp ? empiricalP95 : this.cachedRgp;
    } else {
      p95 = BigInt(Math.round(Number(this.cachedRgp) * this.defaultP95Multiplier));
    }

    return {
      referenceGasPrice: this.cachedRgp,
      p95GasPrice: p95,
      multiplier: Number(p95) / Number(this.cachedRgp || 1000n),
      sampleCount: this.samples.length,
      lastCalibrationMs: this.lastCalibrationMs || Date.now(),
    };
  }

  /**
   * Estimate transaction gas cost in USD given gas units, gas price, and SUI price:
   * GasCostMist = (GasUnits * GasPriceMist) / 1000
   * GasCostSui = GasCostMist / 10^9
   * GasCostUsd = GasCostSui * SuiPriceUsd
   */
  public estimateGasCostUsd(
    gasUnits: bigint,
    gasPriceMist: bigint,
    suiPriceUsd: number
  ): number {
    const gasCostMist = (gasUnits * gasPriceMist) / 1000n;
    const gasCostSui = Number(gasCostMist) / 1e9;
    return gasCostSui * suiPriceUsd;
  }

  /**
   * Evaluate whether a liquidation opportunity remains profitable at the 95th-percentile gas price:
   * EstimatedProfit_P95 = GrossBonusUsd - SwapFeesUsd - GasCostUsd(P95)
   */
  public async evaluateProfitabilityAtP95(
    opportunity: LiquidationOpportunity,
    options?: {
      gasUnits?: bigint;
      suiPriceUsd?: number;
      minProfitUsd?: number;
      swapFeeUsd?: number;
      p95GasPrice?: bigint;
    }
  ): Promise<P95ProfitabilityCheckResult> {
    const suiPriceUsd =
      options?.suiPriceUsd ??
      priceCache.getPriceUsd('0x2::sui::SUI') ??
      2.5;

    const thresholdUsd = options?.minProfitUsd ?? CONFIG.minProfitUsd;
    const gasUnits = options?.gasUnits ?? this.defaultGasUnits;
    const p95GasPrice = options?.p95GasPrice ?? (await this.getP95GasPrice());

    const grossProfitUsd = opportunity.expectedGrossProfitUsd;

    // Estimate swap fee (DEX fee 0.3% of collateral/debt value rebalanced)
    const volumeUsd = opportunity.collateralReceiveUsd || opportunity.debtRepayUsd || 0;
    const estimatedSwapFeeUsd =
      options?.swapFeeUsd !== undefined
        ? options.swapFeeUsd
        : Number(volumeUsd * 0.003);

    const p95GasCostUsd = this.estimateGasCostUsd(gasUnits, p95GasPrice, suiPriceUsd);

    // Formula: EstimatedProfit_P95 = GrossBonusUsd - SwapFeesUsd - GasCostUsd(P95)
    const calibratedNetProfitUsd = grossProfitUsd - estimatedSwapFeeUsd - p95GasCostUsd;
    const isProfitable = calibratedNetProfitUsd >= thresholdUsd;

    const reason = isProfitable
      ? undefined
      : `Opportunity unprofitable under P95 congestion: Calibrated net profit $${calibratedNetProfitUsd.toFixed(2)} is below minimum threshold $${thresholdUsd.toFixed(2)} (Gross: $${grossProfitUsd.toFixed(2)}, Swap fee: $${estimatedSwapFeeUsd.toFixed(2)}, P95 gas cost: $${p95GasCostUsd.toFixed(2)} at P95 price ${p95GasPrice.toString()} MIST)`;

    return {
      isProfitable,
      grossProfitUsd,
      estimatedSwapFeeUsd,
      p95GasCostUsd,
      calibratedNetProfitUsd,
      p95GasPrice,
      thresholdUsd,
      reason,
    };
  }

  /**
   * Interface IGasPriceCalibrator implementation
   */
  public async isProfitableAtP95(
    estimatedGrossProfitUsd: number,
    estimatedGasUnits: bigint,
    suiPriceUsd: number,
    estimatedSwapFeeUsd: number = 0.05,
    minProfitUsd?: number
  ): Promise<boolean> {
    const p95GasPrice = await this.getP95GasPrice();
    const p95GasCostUsd = this.estimateGasCostUsd(estimatedGasUnits, p95GasPrice, suiPriceUsd);
    const netProfitUsd = estimatedGrossProfitUsd - estimatedSwapFeeUsd - p95GasCostUsd;
    const threshold = minProfitUsd !== undefined ? minProfitUsd : CONFIG.minProfitUsd;
    return netProfitUsd >= threshold;
  }
}

export const gasPriceCalibrator = GasPriceCalibrator.getInstance();
