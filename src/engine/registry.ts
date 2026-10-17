import { ObligationState, ProtocolType, IObligationRepository } from '../types/index.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { logger } from '../ui/logger.js';
import { ObligationRepository, stateToRecord, recordToState } from '../persistence/index.js';

/**
 * Global Obligation Registry & Prioritized Watchlist
 * Categorizes monitored borrower obligations into 3 priority buckets:
 * 1. Immediate Targets (HF < 1.0): Dispatched immediately to simulation & execution pipeline
 * 2. Hot Watchlist (1.0 <= HF < 1.05): Re-evaluated on every Pyth price tick
 * 3. Safe Watchlist (HF >= 1.05): Re-evaluated on periodic sweeps
 *
 * Integrated with SQLite state persistence layer for boot recovery across reboots.
 * Hardened with bounded capacity ceiling (default 10,000) and prioritized LRU eviction:
 * - Safest obligations (HF >= 1.5) or zero-debt obligations evicted first
 * - NEVER evicts liquidatable obligations (HF <= 1.0) or immediate targets
 */
export class ObligationRegistry {
  private static instance: ObligationRegistry;
  private obligations: Map<string, ObligationState> = new Map();

  private immediateTargets: Map<string, ObligationState> = new Map();
  private hotWatchlist: Map<string, ObligationState> = new Map();
  private safeWatchlist: Map<string, ObligationState> = new Map();

  private accessOrder: Map<string, number> = new Map();
  private maxCapacity: number = 10_000;
  private evictionCount: number = 0;

  private repository?: IObligationRepository;
  private autoPersist: boolean = true;

  public constructor(
    repository?: IObligationRepository,
    autoPersist: boolean = true,
    maxCapacity: number = 10_000
  ) {
    this.repository = repository ?? new ObligationRepository();
    this.autoPersist = autoPersist;
    this.maxCapacity = Math.max(1, maxCapacity);
  }

  public static getInstance(repository?: IObligationRepository): ObligationRegistry {
    if (!ObligationRegistry.instance) {
      ObligationRegistry.instance = new ObligationRegistry(repository);
    } else if (repository && ObligationRegistry.instance.repository !== repository) {
      ObligationRegistry.instance.setRepository(repository);
    } else if (!ObligationRegistry.instance.repository) {
      ObligationRegistry.instance.setRepository(new ObligationRepository());
    }
    return ObligationRegistry.instance;
  }

  public static resetInstance(closeRepository: boolean = false): void {
    if (ObligationRegistry.instance) {
      if (closeRepository && ObligationRegistry.instance.repository) {
        try {
          ObligationRegistry.instance.repository.close();
        } catch {
          // Ignore close errors during reset
        }
      }
      ObligationRegistry.instance.clear();
      ObligationRegistry.instance = (undefined as any);
    }
  }

  public static createForTesting(
    repository?: IObligationRepository,
    autoPersist: boolean = true,
    maxCapacity: number = 10_000
  ): ObligationRegistry {
    return new ObligationRegistry(repository, autoPersist, maxCapacity);
  }

  public setRepository(repository: IObligationRepository): void {
    this.repository = repository;
  }

  public getRepository(): IObligationRepository | undefined {
    return this.repository;
  }

  public setAutoPersist(enabled: boolean): void {
    this.autoPersist = enabled;
  }

  public getMaxCapacity(): number {
    return this.maxCapacity;
  }

  public getCapacity(): number {
    return this.maxCapacity;
  }

  public setMaxCapacity(maxCapacity: number): void {
    this.maxCapacity = Math.max(1, maxCapacity);
    this.enforceCapacity();
  }

  public getEvictionCount(): number {
    return this.evictionCount;
  }

  private touch(key: string): void {
    this.accessOrder.set(key, Date.now());
  }

  /**
   * Boot loading: Rehydrates obligations from SQLite persistence into memory across restarts.
   */
  public loadFromPersistence(repository?: IObligationRepository): number {
    if (repository) {
      this.repository = repository;
    }
    if (!this.repository) {
      this.repository = new ObligationRepository();
    }

    const records = this.repository.getAllActiveObligations();
    let count = 0;

    for (const record of records) {
      const state = recordToState(record);
      const key = this.getKey(state.protocol, state.obligationId);

      // Enforce capacity bounds during boot loading
      if (this.obligations.size >= this.maxCapacity) {
        if (state.healthFactor <= 1.0) {
          // Evict a safe obligation to make space for a liquidatable target
          this.evictOne();
        } else {
          // Skip loading non-critical safe entry beyond capacity
          continue;
        }
      }

      this.obligations.set(key, state);
      this.touch(key);
      this.bucketObligation(key, state, false);
      count++;
    }

    logger.info({ count, capacity: this.maxCapacity }, `Rehydrated ${count} active obligation(s) from SQLite persistence`);
    return count;
  }

  private getKey(protocol: ProtocolType, id: string): string {
    return `${protocol}:${id.toLowerCase()}`;
  }

  public upsertObligation(state: ObligationState, syncToDb: boolean = true): void {
    const key = this.getKey(state.protocol, state.obligationId);
    const isNew = !this.obligations.has(key);

    if (isNew && this.obligations.size >= this.maxCapacity) {
      if (state.healthFactor > 1.0) {
        const evicted = this.evictOne();
        if (!evicted) {
          logger.warn(
            { id: state.obligationId, hf: state.healthFactor },
            'Registry at capacity ceiling with all liquidatable targets; rejecting safe obligation'
          );
          return;
        }
      } else {
        // High priority: Incoming obligation is liquidatable (HF <= 1.0)
        this.evictOne();
      }
    }

    this.obligations.set(key, state);
    this.touch(key);
    this.bucketObligation(key, state, true);

    if (syncToDb && this.autoPersist && this.repository) {
      try {
        this.repository.upsertObligation(stateToRecord(state));
      } catch (err) {
        logger.error({ err, id: state.obligationId }, 'Failed to persist obligation to SQLite');
      }
    }
  }

  public deleteObligation(protocol: ProtocolType, id: string): void {
    const key = this.getKey(protocol, id);
    this.obligations.delete(key);
    this.immediateTargets.delete(key);
    this.hotWatchlist.delete(key);
    this.safeWatchlist.delete(key);
    this.accessOrder.delete(key);

    if (this.autoPersist && this.repository) {
      try {
        this.repository.deleteObligation(`${protocol}:${id.toLowerCase()}`);
      } catch (err) {
        logger.error({ err, id }, 'Failed to delete obligation from SQLite');
      }
    }
  }

  public clear(): void {
    this.obligations.clear();
    this.immediateTargets.clear();
    this.hotWatchlist.clear();
    this.safeWatchlist.clear();
    this.accessOrder.clear();
    this.evictionCount = 0;
  }

  /**
   * Enforces capacity ceiling by evicting lowest priority obligations until size <= maxCapacity.
   */
  private enforceCapacity(): void {
    while (this.obligations.size > this.maxCapacity) {
      const evicted = this.evictOne();
      if (!evicted) {
        break;
      }
    }
  }

  /**
   * Prioritized LRU eviction:
   * 1. Safest obligations (HF >= 1.5) or zero-debt obligations evicted first.
   * 2. Safe watchlist entries (1.05 <= HF < 1.5) evicted next.
   * 3. Hot watchlist entries (1.0 < HF < 1.05) evicted only if no safe entries exist.
   * 4. NEVER evict liquidatable obligations (HF <= 1.0) or immediate targets.
   */
  public evictOne(): boolean {
    const candidates: Array<{ key: string; state: ObligationState; lastAccess: number }> = [];

    for (const [key, state] of this.obligations.entries()) {
      // NEVER evict liquidatable obligations (HF <= 1.0) or immediate targets
      if (state.healthFactor <= 1.0 || this.immediateTargets.has(key)) {
        continue;
      }
      const lastAccess = this.accessOrder.get(key) ?? 0;
      candidates.push({ key, state, lastAccess });
    }

    if (candidates.length === 0) {
      logger.warn(
        { capacity: this.maxCapacity, size: this.obligations.size },
        '⚠️ Registry capacity reached, but all obligations are protected liquidatable targets (HF <= 1.0). Eviction skipped.'
      );
      return false;
    }

    // Sort candidates according to prioritized eviction policy:
    // Tier 1: Zero-debt obligations (totalDebtUsd <= 0.0001 or debts.length === 0)
    // Tier 2: Safest obligations (HF >= 1.5)
    // Tier 3: Safe watchlist (1.05 <= HF < 1.5)
    // Tier 4: Hot watchlist (1.0 < HF < 1.05)
    // Higher health factor is safer -> evict first. Tie-breaker: oldest access time (LRU)
    candidates.sort((a, b) => {
      const aZeroDebt = a.state.totalDebtUsd <= 0.0001 || a.state.debts.length === 0;
      const bZeroDebt = b.state.totalDebtUsd <= 0.0001 || b.state.debts.length === 0;

      if (aZeroDebt && !bZeroDebt) return -1;
      if (!aZeroDebt && bZeroDebt) return 1;
      if (aZeroDebt && bZeroDebt) {
        return a.lastAccess - b.lastAccess; // LRU for zero-debt
      }

      const aSafe15 = a.state.healthFactor >= 1.5;
      const bSafe15 = b.state.healthFactor >= 1.5;

      if (aSafe15 && !bSafe15) return -1;
      if (!aSafe15 && bSafe15) return 1;

      // Higher health factor is safer -> evict first
      if (Math.abs(a.state.healthFactor - b.state.healthFactor) > 0.001) {
        return b.state.healthFactor - a.state.healthFactor;
      }

      // Tie-breaker: oldest access time (LRU)
      return a.lastAccess - b.lastAccess;
    });

    const victim = candidates[0];
    this.obligations.delete(victim.key);
    this.safeWatchlist.delete(victim.key);
    this.hotWatchlist.delete(victim.key);
    this.accessOrder.delete(victim.key);
    this.evictionCount++;

    logger.debug(
      {
        evictedKey: victim.key,
        healthFactor: victim.state.healthFactor,
        debtUsd: victim.state.totalDebtUsd,
        evictionCount: this.evictionCount,
      },
      'Bounded registry: Evicted obligation to enforce capacity ceiling'
    );

    return true;
  }

  private bucketObligation(key: string, state: ObligationState, logWarnings: boolean = true): void {
    this.immediateTargets.delete(key);
    this.hotWatchlist.delete(key);
    this.safeWatchlist.delete(key);

    const hf = state.healthFactor;
    if (hf < 1.0 && state.totalDebtUsd > 0.01 && state.totalCollateralUsd > 0) {
      this.immediateTargets.set(key, state);
      if (logWarnings) {
        logger.warn(
          { protocol: state.protocol, id: state.obligationId, hf: hf.toFixed(4), debtUsd: state.totalDebtUsd.toFixed(2), colUsd: state.totalCollateralUsd.toFixed(2) },
          `🚨 UNDERCOLLATERALIZED OBLIGATION DETECTED (HF: ${hf.toFixed(4)})`
        );
      }
    } else if (hf < 1.05 && state.totalDebtUsd > 0.01 && state.totalCollateralUsd > 0) {
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
    const entries = Array.from(this.hotWatchlist.entries());

    for (const [key, state] of entries) {
      this.touch(key);
      HealthFactorEngine.evaluateObligation(state);
      this.bucketObligation(key, state, true);
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

  public getCounts(): { total: number; immediate: number; hot: number; safe: number; capacity: number; evictions: number } {
    return {
      total: this.obligations.size,
      immediate: this.immediateTargets.size,
      hot: this.hotWatchlist.size,
      safe: this.safeWatchlist.size,
      capacity: this.maxCapacity,
      evictions: this.evictionCount,
    };
  }
}

export const obligationRegistry = ObligationRegistry.getInstance();
