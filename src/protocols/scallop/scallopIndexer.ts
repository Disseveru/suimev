import { scallopProtocol } from './scallopProtocol.js';
import { SCALLOP_CONFIG } from '../../config/constants.js';
import { suiClient, rpcManager } from '../../client/suiClient.js';
import { suiWsClient } from '../../client/websocket.js';
import { ObligationState, CollateralPosition, DebtPosition } from '../../config/types.js';
import { COIN_CONFIGS, getCoinConfigByType } from '../../config/coins.js';
import { HealthFactorEngine } from '../../oracles/healthFactor.js';
import { logger } from '../../ui/logger.js';

export type ScallopObligationCallback = (obligation: ObligationState) => void;

/**
 * Scallop Protocol Obligation Indexer
 * Ingests Scallop borrow & obligation events and tracks active borrower positions.
 */
export class ScallopIndexer {
  private knownObligationIds: Set<string> = new Set();
  private obligations: Map<string, ObligationState> = new Map();
  private inFlightRefreshes: Map<string, Promise<ObligationState | null>> = new Map();
  private listeners: ScallopObligationCallback[] = [];
  private isRunning = false;
  private sweepInterval: NodeJS.Timeout | null = null;

  constructor() {}

  public onObligationUpdate(callback: ScallopObligationCallback): void {
    this.listeners.push(callback);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('Starting Scallop Protocol Indexer...');
    this.subscribeEvents();
    await this.discoverObligationsFromHistory();

    this.sweepInterval = setInterval(() => {
      this.refreshAllObligations();
    }, 15_000);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  private subscribeEvents(): void {
    try {
      suiWsClient.subscribeEvent(
        { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'borrow' } },
        (event) => {
          this.handleScallopEvent(event);
        }
      );

      suiWsClient.subscribeEvent(
        { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'deposit_collateral' } },
        (event) => {
          this.handleScallopEvent(event);
        }
      );

      suiWsClient.subscribeEvent(
        { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'open_obligation' } },
        (event) => {
          this.handleScallopEvent(event);
        }
      );

      suiWsClient.subscribeEvent(
        { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'liquidate' } },
        (event) => {
          this.handleScallopEvent(event);
        }
      );

      logger.info('Subscribed to Scallop Protocol WebSocket events (borrow, deposit_collateral, open_obligation, liquidate)');
    } catch (err) {
      logger.warn({ error: err }, 'Could not subscribe to Scallop WebSocket events');
    }
  }

  private handleScallopEvent(event: Record<string, unknown>): void {
    try {
      const typeStr = (event.type as string | undefined) ?? '';
      // Pre-filter: skip event if explicit type does not relate to obligation state mutations
      if (
        typeStr &&
        !typeStr.includes('borrow') &&
        !typeStr.includes('collateral') &&
        !typeStr.includes('obligation') &&
        !typeStr.includes('liquidate')
      ) {
        return;
      }

      const parsedJson = event.parsedJson as Record<string, unknown> | undefined;
      const obligationId = (parsedJson?.obligation || parsedJson?.obligation_id) as string | undefined;

      if (obligationId && typeof obligationId === 'string' && obligationId.startsWith('0x')) {
        this.addObligation(obligationId);
        this.refreshObligationState(obligationId);
      }
    } catch (err) {
      logger.debug({ error: err }, 'Error processing Scallop event');
    }
  }

  public addObligation(id: string): void {
    this.knownObligationIds.add(id);
  }

  public async discoverObligationsFromHistory(maxPages: number = 200): Promise<void> {
    try {
      logger.info('Querying historical Scallop events with cursor pagination in parallel across open_obligation, borrow, and deposit_collateral...');
      
      const paginateModule = async (moduleName: string): Promise<number> => {
        let cursor: any = null;
        let pages = 0;
        while (pages < maxPages) {
          try {
            const res = await rpcManager.executeWithFallback(`scallopQuery_${moduleName}`, (client) =>
              client.queryEvents({
                query: { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: moduleName } },
                cursor,
                limit: 100,
              })
            );
            pages++;
            if (res.data) {
              for (const ev of res.data) {
                const json = ev.parsedJson as Record<string, unknown> | undefined;
                const oblId = (json?.obligation || json?.obligation_id) as string | undefined;
                if (oblId && typeof oblId === 'string' && oblId.startsWith('0x')) {
                  this.addObligation(oblId);
                }
              }
            }
            if (!res.hasNextPage || !res.nextCursor) break;
            cursor = res.nextCursor;
          } catch (err) {
            logger.debug({ error: err, module: moduleName }, 'Error during Scallop event pagination');
            break;
          }
        }
        return pages;
      };

      const [openRes, borrowRes, colRes] = await Promise.allSettled([
        paginateModule('open_obligation'),
        paginateModule('borrow'),
        paginateModule('deposit_collateral'),
      ]);

      const openPages = openRes.status === 'fulfilled' ? openRes.value : 0;
      const borrowPages = borrowRes.status === 'fulfilled' ? borrowRes.value : 0;
      const colPages = colRes.status === 'fulfilled' ? colRes.value : 0;

      logger.info(`Discovered ${this.knownObligationIds.size} active Scallop obligations across ${openPages + borrowPages + colPages} historical pages`);
      await this.refreshAllObligations();
    } catch (err) {
      logger.warn({ error: err }, 'Could not fetch historical Scallop events');
    }
  }

  public async refreshAllObligations(): Promise<void> {
    const ids = Array.from(this.knownObligationIds);
    const BATCH_SIZE = 25;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map((id) => this.refreshObligationState(id)));
    }
  }

  public async refreshObligationState(obligationId: string): Promise<ObligationState | null> {
    const existing = this.inFlightRefreshes.get(obligationId);
    if (existing) {
      return existing;
    }

    const MAX_PARALLEL_REFRESHES = 15;
    if (this.inFlightRefreshes.size >= MAX_PARALLEL_REFRESHES) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const promise = (async () => {
      try {
        const query = await scallopProtocol.getOrCreateQuery();
        if (query) {
          const oblData = await query.queryObligation(obligationId);

          if (oblData) {
            const collaterals: CollateralPosition[] = [];
            const debts: DebtPosition[] = [];

            if (oblData.collaterals && Array.isArray(oblData.collaterals)) {
              for (const col of oblData.collaterals) {
                const meta = this.inferCoinMetadata(col.type, query);
                collaterals.push({
                  coinType: col.type,
                  symbol: meta.symbol,
                  amount: BigInt(col.amount ?? '0'),
                  decimals: meta.decimals,
                  valueUsd: 0,
                  liquidationThreshold: meta.lt,
                });
              }
            }

            if (oblData.debts && Array.isArray(oblData.debts)) {
              for (const d of oblData.debts) {
                const meta = this.inferCoinMetadata(d.type, query);
                debts.push({
                  coinType: d.type,
                  symbol: meta.symbol,
                  amount: BigInt(d.amount ?? '0'),
                  decimals: meta.decimals,
                  valueUsd: 0,
                });
              }
            }

            if (debts.length === 0 && collaterals.length === 0) return null;

            const state: ObligationState = {
              protocol: 'scallop',
              obligationId,
              ownerAddress: (oblData as any).owner ?? obligationId,
              collaterals,
              debts,
              totalCollateralUsd: 0,
              totalDebtUsd: 0,
              liquidationThresholdCollateralUsd: 0,
              healthFactor: Infinity,
              isLiquidatable: false,
              lastUpdatedMs: Date.now(),
            };

            HealthFactorEngine.evaluateObligation(state);
            this.obligations.set(obligationId, state);

            logger.info(`🔄 Refreshed obligation ${obligationId} with ${collaterals.length} collaterals and ${debts.length} debts`);

            for (const listener of this.listeners) {
              try {
                listener(state);
              } catch (err) {
                logger.debug({ err }, 'Listener error');
              }
            }

            return state;
          }
        }
        return null;
      } catch (err: any) {
        if (err?.code === 'NOT_FOUND' || String(err).includes('NOT_FOUND') || String(err).includes('deleted')) {
          this.knownObligationIds.delete(obligationId);
          this.obligations.delete(obligationId);
          logger.warn(`Obligation ${obligationId} pruned at ${new Date().toISOString()}`);
          return null;
        }
        logger.debug({ obligationId, error: err }, 'Error refreshing Scallop obligation');
        return null;
      } finally {
        this.inFlightRefreshes.delete(obligationId);
      }
    })();

    this.inFlightRefreshes.set(obligationId, promise);
    return promise;
  }

  private inferCoinMetadata(coinType: string, query?: any): { symbol: string; decimals: number; lt: number } {
    const cfg = getCoinConfigByType(coinType);
    const lowerType = coinType.toLowerCase();
    const decimals = cfg?.decimals ?? (
      lowerType.includes('btc') ? 8 :
      lowerType.includes('eth') ? 8 :
      lowerType.includes('usdc') || lowerType.includes('usdt') || lowerType.includes('usd') || lowerType.includes('deep') ? 6 : 9
    );
    const lt = cfg?.liquidationThreshold ?? (
      lowerType.includes('usdc') || lowerType.includes('usdt') || lowerType.includes('sui') || lowerType.includes('usd') ? 0.90 : 0.80
    );
    const parsedName = (query as any)?.utils?.parseCoinNameFromType?.(coinType);
    const symbol = cfg?.symbol ?? (parsedName ? parsedName.toUpperCase() : coinType.split('::')[2]) ?? 'UNKNOWN';
    return { symbol, decimals, lt };
  }

  public pruneStaleObligations(maxAgeMs = 10 * 60 * 1000): number {
    const now = Date.now();
    let count = 0;
    for (const [id, state] of Array.from(this.obligations.entries())) {
      if (now - state.lastUpdatedMs > maxAgeMs) {
        this.obligations.delete(id);
        count++;
      }
    }
    if (count > 0) {
      logger.debug(`Pruned ${count} stale Scallop obligations (> 10m old)`);
    }
    return count;
  }

  public getObligation(id: string): ObligationState | undefined {
    return this.obligations.get(id);
  }

  public getAllObligations(): ObligationState[] {
    return Array.from(this.obligations.values());
  }
}

export const scallopIndexer = new ScallopIndexer();
