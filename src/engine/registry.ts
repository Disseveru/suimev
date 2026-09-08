import { ObligationState, ProtocolType } from '../config/types.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { logger } from '../ui/logger.js';

/**
 * Global Obligation Registry & Prioritized Watchlist
 * Categorizes monitored borrower obligations into 3 priority buckets:
 * 1. Immediate Targets (HF < 1.0): Dispatched immediately to simulation & execution pipeline
 * 2. Hot Watchlist (1.0 <= HF < 1.05): Re-evaluated on every Pyth price tick
 * 3. Safe Watchlist (HF >= 1.05): Re-evaluated on periodic sweeps
 */
export class ObligationRegistry {
  private static instance: ObligationRegistry;
  private obligations: Map<string, ObligationState> = new Map();

  private immediateTargets: Map<string, ObligationState> = new Map();
  private hotWatchlist: Map<string, ObligationState> = new Map();
  private safeWatchlist: Map<string, ObligationState> = new Map();

  private constructor() {}

  public static getInstance(): ObligationRegistry {
    if (!ObligationRegistry.instance) {
      ObligationRegistry.instance = new ObligationRegistry();
    }
    return ObligationRegistry.instance;
  }

  private getKey(protocol: ProtocolType, id: string): string {
    return `${protocol}:${id.toLowerCase()}`;
  }

  public upsertObligation(state: ObligationState): void {
    const key = this.getKey(state.protocol, state.obligationId);
    this.obligations.set(key, state);
    this.bucketObligation(key, state);
  }

  private bucketObligation(key: string, state: ObligationState): void {
    this.immediateTargets.delete(key);
    this.hotWatchlist.delete(key);
    this.safeWatchlist.delete(key);

    const hf = state.healthFactor;
    if (hf < 1.0 && state.totalDebtUsd > 0.01) {
      this.immediateTargets.set(key, state);
      logger.warn(
        { protocol: state.protocol, id: state.obligationId, hf: hf.toFixed(4), debtUsd: state.totalDebtUsd.toFixed(2) },
        `🚨 UNDERCOLLATERALIZED OBLIGATION DETECTED (HF: ${hf.toFixed(4)})`
      );
    } else if (hf < 1.05 && state.totalDebtUsd > 0.01) {
      this.hotWatchlist.set(key, state);
    } else {
      this.safeWatchlist.set(key, state);
    }
  }

  /**
   * Re-evaluate all obligations in the hot watchlist when a Pyth price changes
   */
  public reevaluateHotWatchlist(): ObligationState[] {
    const newlyUndercollateralized: ObligationState[] = [];

    for (const [key, state] of this.hotWatchlist.entries()) {
      HealthFactorEngine.evaluateObligation(state);
      this.bucketObligation(key, state);
      if (state.healthFactor < 1.0 && state.totalDebtUsd > 0.01) {
        newlyUndercollateralized.push(state);
      }
    }

    return newlyUndercollateralized;
  }

  public getImmediateTargets(): ObligationState[] {
    return Array.from(this.immediateTargets.values());
  }

  public getHotWatchlist(): ObligationState[] {
    return Array.from(this.hotWatchlist.values());
  }

  public getSafeWatchlist(): ObligationState[] {
    return Array.from(this.safeWatchlist.values());
  }

  public getAllObligations(): ObligationState[] {
    return Array.from(this.obligations.values());
  }

  public getCounts(): { total: number; immediate: number; hot: number; safe: number } {
    return {
      total: this.obligations.size,
      immediate: this.immediateTargets.size,
      hot: this.hotWatchlist.size,
      safe: this.safeWatchlist.size,
    };
  }
}

export const obligationRegistry = ObligationRegistry.getInstance();
