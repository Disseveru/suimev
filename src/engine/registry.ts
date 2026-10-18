import { ObligationState, ProtocolType } from '../config/types.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { logger } from '../ui/logger.js';
import { MaxHeap } from '../utils/heap.js';

/**
 * Global Obligation Registry & Prioritized Watchlist
 * Categorizes monitored borrower obligations into 3 priority buckets:
 * 1. Immediate Targets (HF < 1.0): Dispatched immediately to simulation & execution pipeline
 * 2. Hot Watchlist (1.0 <= HF < 1.05): Re-evaluated on every Pyth price tick
 * 3. Safe Watchlist (HF >= 1.05): Re-evaluated on periodic sweeps
 *
 * This implementation uses a max-heap for the Immediate Targets bucket to avoid
 * full-array sorting on every access. The heap stores keys (protocol:id) and a
 * numeric priority (by default totalDebtUsd) so retrieving the top-k accounts is
 * O(k log n) instead of O(n log n) sorting of the entire set.
 */
export class ObligationRegistry {
  private static instance: ObligationRegistry;
  private obligations: Map<string, ObligationState> = new Map();

  // Keep Maps for presence & fast lookup (same API as before)
  private immediateTargets: Map<string, ObligationState> = new Map();
  private hotWatchlist: Map<string, ObligationState> = new Map();
  private safeWatchlist: Map<string, ObligationState> = new Map();

  // Max-heap keyed by priority (higher priority popped first)
  // Priority chosen: totalDebtUsd (can be replaced by expected profit in future)
  private immediateHeap: MaxHeap<string> = new MaxHeap<string>();

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
    // Remove from all buckets first (idempotent)
    const wasImmediate = this.immediateTargets.has(key);
    const wasHot = this.hotWatchlist.has(key);
    const wasSafe = this.safeWatchlist.has(key);

    if (wasImmediate) {
      this.immediateTargets.delete(key);
      this.immediateHeap.remove(key);
    }
    if (wasHot) this.hotWatchlist.delete(key);
    if (wasSafe) this.safeWatchlist.delete(key);

    const hf = state.healthFactor;
    if (hf < 1.0 && state.totalDebtUsd > 0.01 && state.totalCollateralUsd > 0) {
      this.immediateTargets.set(key, state);
      // Use totalDebtUsd as priority (higher debt = higher priority)
      // Use Date.now() as tiebreaker implicitly by adding a small fractional part
      const priority = Number(state.totalDebtUsd) || 0;
      this.immediateHeap.push(key, priority);

      logger.warn(
        { protocol: state.protocol, id: state.obligationId, hf: hf.toFixed(4), debtUsd: state.totalDebtUsd.toFixed(2), colUsd: state.totalCollateralUsd.toFixed(2) },
        `🚨 UNDERCOLLATERALIZED OBLIGATION DETECTED (HF: ${hf.toFixed(4)})`
      );
    } else if (hf < 1.07 && state.totalDebtUsd > 0.01 && state.totalCollateralUsd > 0) {
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
    // Snapshot entries to prevent infinite loop when bucketObligation deletes and re-inserts into this.hotWatchlist
    const entries = Array.from(this.hotWatchlist.entries());

    for (const [key, state] of entries) {
      HealthFactorEngine.evaluateObligation(state);
      this.bucketObligation(key, state);
      if (state.healthFactor < 1.0 && state.totalDebtUsd > 0.01) {
        newlyUndercollateralized.push(state);
      }
    }

    return newlyUndercollateralized;
  }

  /**
   * Re-evaluates all obligations containing volatile collateral (e.g. BTC, hBTC)
   * across both hotWatchlist and safeWatchlist.
   * Because Bitcoin is highly volatile, rapid BTC price drops trigger cascading liquidations
   * on loans previously deemed safe (HF >= 1.07).
   */
  public reevaluateVolatileCollaterals(symbolKeyword: string = 'BTC'): ObligationState[] {
    const newlyUndercollateralized: ObligationState[] = [];
    const allEntries = Array.from(this.obligations.entries());

    for (const [key, state] of allEntries) {
      const hasTargetCollateral = state.collaterals.some((c) => {
        const sym = c.symbol.toUpperCase();
        const type = c.coinType.toUpperCase();
        return sym.includes(symbolKeyword) || type.includes(symbolKeyword);
      });

      if (hasTargetCollateral) {
        HealthFactorEngine.evaluateObligation(state);
        this.bucketObligation(key, state);
        if (state.healthFactor < 1.0 && state.totalDebtUsd > 0.01 && state.totalCollateralUsd > 0) {
          newlyUndercollateralized.push(state);
        }
      }
    }

    return newlyUndercollateralized;
  }

  /**
   * Return the current immediate targets ordered by priority (highest first).
   * This operation avoids sorting the entire obligations map — instead it walks a
   * copy of the heap and extracts up to `limit` items (default: all immediate targets).
   */
  public getImmediateTargets(limit?: number): ObligationState[] {
    const size = this.immediateTargets.size;
    const k = typeof limit === 'number' ? Math.min(limit, size) : size;
    if (k === 0) return [];

    const keys = this.immediateHeap.peekTopK(k);
    const result: ObligationState[] = [];
    for (const key of keys) {
      const st = this.immediateTargets.get(key);
      if (st) result.push(st);
    }
    return result;
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

  public getHotWatchlistAccounts(minHf: number = 1.00, maxHf: number = 1.05): ObligationState[] {
    return Array.from(this.obligations.values()).filter(
      (state) =>
        state.healthFactor >= minHf &&
        state.healthFactor < maxHf &&
        state.totalDebtUsd > 0.01 &&
        state.totalCollateralUsd > 0
    );
  }

  public getCounts(): {
    total: number;
    navi: number;
    scallop: number;
    naviCount: number;
    scallopCount: number;
    immediate: number;
    hot: number;
    safe: number;
  } {
    let navi = 0;
    let scallop = 0;
    for (const ob of this.obligations.values()) {
      if (ob.protocol === 'navi') navi++;
      else if (ob.protocol === 'scallop') scallop++;
    }
    return {
      total: this.obligations.size,
      navi,
      scallop,
      naviCount: navi,
      scallopCount: scallop,
      immediate: this.immediateTargets.size,
      hot: this.hotWatchlist.size,
      safe: this.safeWatchlist.size,
    };
  }

  public clear(): void {
    this.obligations.clear();
    this.immediateTargets.clear();
    this.hotWatchlist.clear();
    this.safeWatchlist.clear();
    this.immediateHeap.clear();
  }
}

export const obligationRegistry = ObligationRegistry.getInstance();
