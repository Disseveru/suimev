import { logger } from '../ui/logger.js';

export interface LatencyMetric {
  evalDurationMs: number;
  ptbBuildDurationMs: number;
  simulationDurationMs: number;
  broadcastDurationMs: number;
  totalCycleDurationMs: number;
}

export interface ExecutionMetric {
  opportunityId: string;
  protocol: 'navi' | 'scallop';
  debtSymbol: string;
  collateralSymbol: string;
  expectedGrossProfitUsd: number;
  realizedProfitUsd?: number;
  gasCostSui: number;
  success: boolean;
  digest?: string;
  error?: string;
  timestampMs: number;
  latencies: LatencyMetric;
}

/**
 * High-Performance Sui MEV Telemetry & Runtime Metrics Tracker
 * Monitored via Sentio and local searcher dashboard.
 */
export class TelemetryManager {
  private static instance: TelemetryManager;
  private metrics: ExecutionMetric[] = [];
  private totalProfitUsd: number | null = null;
  private totalLiquidationsAttempted = 0;
  private totalLiquidationsSucceeded = 0;
  private totalRevertsPrevented = 0;

  private constructor() {}

  public static getInstance(): TelemetryManager {
    if (!TelemetryManager.instance) {
      TelemetryManager.instance = new TelemetryManager();
    }
    return TelemetryManager.instance;
  }

  public recordRevertPrevented(reason: string, details?: Record<string, unknown>): void {
    this.totalRevertsPrevented++;
    logger.warn({ reason, ...details }, `[SAFETY GATE] Prevented on-chain revert and saved gas (Total avoided: ${this.totalRevertsPrevented})`);
  }

  public recordExecution(metric: ExecutionMetric): void {
    this.metrics.push(metric);
    this.totalLiquidationsAttempted++;

    if (metric.success) {
      this.totalLiquidationsSucceeded++;
      if (metric.realizedProfitUsd !== undefined) {
        this.totalProfitUsd = (this.totalProfitUsd ?? 0) + metric.realizedProfitUsd;
      }
      logger.info(
        {
          digest: metric.digest,
          realizedProfitUsd: metric.realizedProfitUsd,
          totalCycleMs: metric.latencies.totalCycleDurationMs,
        },
        '🎉 MEV Liquidation Succeeded On-Chain!'
      );
    } else {
      logger.warn(
        {
          error: metric.error,
          opportunity: `${metric.collateralSymbol} -> ${metric.debtSymbol}`,
          ptbMs: metric.latencies.ptbBuildDurationMs,
        },
        'MEV Liquidation Execution Failed'
      );
    }

    // Keep metrics memory-bounded
    if (this.metrics.length > 500) {
      this.metrics = this.metrics.slice(-500);
    }
  }

  public getSummary(): {
    totalProfitUsd: number | null;
    attempted: number;
    succeeded: number;
    successRatePct: number;
    revertsPrevented: number;
    recentMetrics: ExecutionMetric[];
  } {
    const successRatePct = this.totalLiquidationsAttempted > 0
      ? (this.totalLiquidationsSucceeded / this.totalLiquidationsAttempted) * 100
      : 0;

    return {
      totalProfitUsd: this.totalProfitUsd,
      attempted: this.totalLiquidationsAttempted,
      succeeded: this.totalLiquidationsSucceeded,
      successRatePct,
      revertsPrevented: this.totalRevertsPrevented,
      recentMetrics: this.metrics.slice(-10),
    };
  }
}

export const telemetry = TelemetryManager.getInstance();
