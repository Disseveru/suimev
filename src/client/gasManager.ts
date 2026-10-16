import { CONFIG } from '../config/index.js';
import { rpcManager } from './suiClient.js';
import { suiGraphQL } from './graphqlClient.js';
import { logger } from '../ui/logger.js';

export interface CachedGasCoin {
  objectId: string;
  version: string;
  digest: string;
  balanceMist: bigint;
  lastUpdatedMs: number;
}

/**
 * Institutional Zero-RPC Gas Coin Manager
 * Eliminates implicit getCoins / getObject round-trips by maintaining an in-memory
 * state of the operator's gas coin object ID, version, and digest.
 */
export class GasManager {
  private static instance: GasManager;
  private primaryGasCoin: CachedGasCoin | null = null;
  private isInitialized = false;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private readonly RECONCILIATION_INTERVAL_MS = 30_000;

  private constructor() {}

  public static getInstance(): GasManager {
    if (!GasManager.instance) {
      GasManager.instance = new GasManager();
    }
    return GasManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized && this.primaryGasCoin) return;
    await this.refreshGasCoins();
    this.startBackgroundReconciliation();
    this.isInitialized = true;
  }

  /**
   * Refresh operator gas coins from GraphQL or RPC
   */
  public async refreshGasCoins(): Promise<CachedGasCoin | null> {
    try {
      // 1. Try modern GraphQL first
      const query = `
        query GetOwnerGasCoins($owner: SuiAddress!) {
          address(address: $owner) {
            coins(first: 10, type: "0x2::sui::SUI") {
              nodes {
                address
                version
                digest
                coinBalance
              }
            }
          }
        }
      `;

      const res = await suiGraphQL.query<any>(query, { owner: CONFIG.operatorAddress });
      const nodes = res?.address?.coins?.nodes;

      if (Array.isArray(nodes) && nodes.length > 0) {
        // Find coin with highest balance
        const sorted = [...nodes].sort((a, b) => {
          const diff = BigInt(b.coinBalance || 0) - BigInt(a.coinBalance || 0);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        });
        const primary = sorted[0];

        this.primaryGasCoin = {
          objectId: primary.address,
          version: String(primary.version),
          digest: primary.digest,
          balanceMist: BigInt(primary.coinBalance || 0),
          lastUpdatedMs: Date.now(),
        };

        logger.debug(
          { coin: this.primaryGasCoin.objectId, balanceSui: Number(this.primaryGasCoin.balanceMist) / 1e9 },
          'Initialized Zero-RPC Gas Coin Cache via GraphQL'
        );
        return this.primaryGasCoin;
      }
    } catch {
      // Fall through to standard RPC
    }

    try {
      const coins = await rpcManager.executeWithFallback('getGasCoins', (client) =>
        client.getCoins({
          owner: CONFIG.operatorAddress,
          coinType: '0x2::sui::SUI',
        })
      );

      if (coins.data && coins.data.length > 0) {
        const sorted = [...coins.data].sort((a, b) => {
          const diff = BigInt(b.balance) - BigInt(a.balance);
          return diff > 0n ? 1 : diff < 0n ? -1 : 0;
        });
        const primary = sorted[0];

        this.primaryGasCoin = {
          objectId: primary.coinObjectId,
          version: String(primary.version),
          digest: primary.digest,
          balanceMist: BigInt(primary.balance),
          lastUpdatedMs: Date.now(),
        };

        logger.debug(
          { coin: this.primaryGasCoin.objectId, balanceSui: Number(this.primaryGasCoin.balanceMist) / 1e9 },
          'Initialized Zero-RPC Gas Coin Cache via RPC'
        );
        return this.primaryGasCoin;
      }
    } catch (err) {
      logger.warn({ error: err }, 'Failed to refresh gas coins');
    }

    return null;
  }

  /**
   * Get cached gas payment object for Zero-RPC PTB construction
   */
  public getGasPayment(): { objectId: string; version: string; digest: string } | null {
    if (!this.primaryGasCoin) return null;
    return {
      objectId: this.primaryGasCoin.objectId,
      version: this.primaryGasCoin.version,
      digest: this.primaryGasCoin.digest,
    };
  }

  public getCachedBalanceSui(): number {
    if (!this.primaryGasCoin) return 0;
    return Number(this.primaryGasCoin.balanceMist) / 1e9;
  }

  /**
   * Surgically update gas coin version and digest from transaction execution effects in 0ms
   */
  public updateFromExecutionEffects(effects: any): void {
    if (!effects) return;

    try {
      // In Sui execution effects, the gas object is updated in effects.gasObject or effects.mutated
      const gasObj = effects.gasObject;
      if (this.primaryGasCoin && gasObj?.reference?.objectId && gasObj.reference.objectId === this.primaryGasCoin.objectId) {
        this.primaryGasCoin.version = String(gasObj.reference.version);
        this.primaryGasCoin.digest = gasObj.reference.digest;
        this.primaryGasCoin.lastUpdatedMs = Date.now();
        return;
      }

      // Check mutated list
      const mutated = effects.mutated;
      if (Array.isArray(mutated) && this.primaryGasCoin) {
        const matching = mutated.find((m: any) => m.reference?.objectId === this.primaryGasCoin?.objectId);
        if (matching?.reference) {
          this.primaryGasCoin.version = String(matching.reference.version);
          this.primaryGasCoin.digest = matching.reference.digest;
          this.primaryGasCoin.lastUpdatedMs = Date.now();
        }
      }
    } catch {
      // Non-fatal; background reconciliation will refresh
    }
  }

  /**
   * Get active valid gas object reference from cache (convenience alias to getGasPayment)
   */
  public getActiveGasObject(): { objectId: string; version: string; digest: string } | null {
    return this.getGasPayment();
  }

  /**
   * Explicitly invalidate the in-memory gas coin reference
   */
  public invalidate(): void {
    this.primaryGasCoin = null;
  }

  /**
   * Detect whether an error or status string relates to an invalid, missing, or desynced gas object
   */
  public isGasObjectError(error: any): boolean {
    if (!error) return false;
    const msg = (typeof error === 'string' ? error : error?.message || error?.toString?.() || '').toLowerCase();
    return (
      msg.includes('invalidgasobject') ||
      msg.includes('objectnotfound') ||
      msg.includes('objectversionunavailable') ||
      msg.includes('objectversionmismatch') ||
      msg.includes('gasobjectnotowned') ||
      msg.includes('not available for consumption') ||
      msg.includes('already consumed') ||
      msg.includes('gas object') ||
      msg.includes('invalid object')
    );
  }

  /**
   * Recover from a desynced gas coin version: invalidate cache and immediately refresh from RPC
   */
  public async handleGasError(error?: any): Promise<CachedGasCoin | null> {
    logger.warn(
      { error: error?.message || error },
      'Invalid or desynced gas object detected. Invalidating in-memory gas cache and querying fresh coin references...'
    );
    this.invalidate();
    return await this.refreshGasCoins();
  }

  /**
   * Start 30s background reconciliation loop to periodically reconcile gas coin state
   */
  public startBackgroundReconciliation(intervalMs: number = this.RECONCILIATION_INTERVAL_MS): void {
    if (this.reconciliationTimer) return;
    this.reconciliationTimer = setInterval(() => {
      this.refreshGasCoins().catch((err) => {
        logger.debug({ error: err }, 'Background gas reconciliation refresh failed');
      });
    }, intervalMs);
    if (this.reconciliationTimer.unref) {
      this.reconciliationTimer.unref();
    }
  }

  /**
   * Stop background reconciliation loop
   */
  public stopBackgroundReconciliation(): void {
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }
}

export const gasManager = GasManager.getInstance();
