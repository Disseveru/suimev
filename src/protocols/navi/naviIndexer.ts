import { suiWsClient } from '../../client/websocket.js';
import { suiClient, rpcManager } from '../../client/suiClient.js';
import { NAVI_CONFIG } from '../../config/constants.js';
import { CONFIG } from '../../config/index.js';
import { COIN_CONFIGS, getCoinConfigByType } from '../../config/coins.js';
import { ObligationState, CollateralPosition, DebtPosition } from '../../config/types.js';
import { HealthFactorEngine } from '../../oracles/healthFactor.js';
import { priceCache } from '../../oracles/priceCache.js';
import { logger } from '../../ui/logger.js';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import * as navi from '@naviprotocol/lending';

export type ObligationCallback = (obligation: ObligationState) => void;

/**
 * NAVI Protocol Borrower Indexer
 * Ingests borrow/deposit events and maintains in-memory borrower states.
 */
export class NaviIndexer {
  private knownBorrowers: Set<string> = new Set();
  private obligations: Map<string, ObligationState> = new Map();
  private inFlightRefreshes: Map<string, Promise<ObligationState | null>> = new Map();
  private listeners: ObligationCallback[] = [];
  private isRunning = false;
  private sweepInterval: NodeJS.Timeout | null = null;

  constructor() {}

  public onObligationUpdate(callback: ObligationCallback): void {
    this.listeners.push(callback);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('Starting NAVI Protocol Indexer...');
    this.subscribeEvents();

    // Initial historical event discovery to find active borrowers
    await this.discoverBorrowersFromHistory();

    // Periodic sweep of known borrower states
    this.sweepInterval = setInterval(() => {
      this.refreshAllBorrowers();
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
      // Subscribe to borrow events
      suiWsClient.subscribeEvent(
        { MoveModule: { package: NAVI_CONFIG.packageId, module: 'lending' } },
        (event) => {
          this.handleNaviEvent(event);
        }
      );

      // Subscribe to incentive/liquidation events
      suiWsClient.subscribeEvent(
        { MoveModule: { package: NAVI_CONFIG.packageId, module: 'incentive_v3' } },
        (event) => {
          this.handleNaviEvent(event);
        }
      );

      logger.info('Subscribed to NAVI Protocol WebSocket events');
    } catch (err) {
      logger.warn({ error: err }, 'Could not subscribe to NAVI WebSocket events');
    }
  }

  private handleNaviEvent(event: Record<string, unknown>): void {
    try {
      const typeStr = (event.type as string | undefined) ?? '';
      // Pre-filter: skip event if explicit type does not relate to borrow, deposit, incentive, or liquidation
      if (
        typeStr &&
        !typeStr.includes('borrow') &&
        !typeStr.includes('deposit') &&
        !typeStr.includes('lending') &&
        !typeStr.includes('incentive') &&
        !typeStr.includes('liquidat')
      ) {
        return;
      }

      const parsedJson = event.parsedJson as Record<string, unknown> | undefined;
      const sender = (parsedJson?.sender || parsedJson?.borrower || parsedJson?.user) as string | undefined;

      if (sender && typeof sender === 'string' && sender.startsWith('0x')) {
        this.addBorrower(sender);
        this.refreshBorrowerState(sender);
      }
    } catch (err) {
      logger.debug({ error: err }, 'Error processing NAVI event');
    }
  }

  public addBorrower(address: string): void {
    let normalized: string;
    try {
      normalized = normalizeSuiAddress(address).toLowerCase();
    } catch {
      normalized = address.toLowerCase();
    }
    const nullAddr = '0x0000000000000000000000000000000000000000000000000000000000000000';
    let operatorNorm = '';
    try {
      operatorNorm = normalizeSuiAddress(CONFIG.operatorAddress).toLowerCase();
    } catch {
      operatorNorm = CONFIG.operatorAddress.toLowerCase();
    }

    if (
      normalized === nullAddr ||
      normalized === '0x0' ||
      normalized === operatorNorm
    ) {
      return;
    }
    this.knownBorrowers.add(normalized);
  }

  public async discoverBorrowersFromHistory(maxPages: number = 200): Promise<void> {
    try {
      logger.info('Querying historical NAVI lending & incentive events with cursor pagination in parallel...');
      
      const paginateModule = async (moduleName: string): Promise<number> => {
        let cursor: any = null;
        let pages = 0;
        while (pages < maxPages) {
          try {
            const res = await rpcManager.executeWithFallback(`naviQuery_${moduleName}`, (client) =>
              client.queryEvents({
                query: { MoveModule: { package: NAVI_CONFIG.packageId, module: moduleName } },
                cursor,
                limit: 100,
              })
            );
            pages++;
            if (res.data) {
              for (const ev of res.data) {
                const json = ev.parsedJson as Record<string, unknown> | undefined;
                const sender = (json?.sender || json?.borrower || json?.user || json?.recipient) as string | undefined;
                if (sender && typeof sender === 'string' && sender.startsWith('0x')) {
                  this.addBorrower(sender);
                }
              }
            }
            if (!res.hasNextPage || !res.nextCursor) break;
            cursor = res.nextCursor;
          } catch (err) {
            logger.debug({ error: err, module: moduleName }, 'Error during NAVI event pagination');
            break;
          }
        }
        return pages;
      };

      const [lendingRes, incentiveRes] = await Promise.allSettled([
        paginateModule('lending'),
        paginateModule('incentive_v3'),
      ]);

      const lendingPages = lendingRes.status === 'fulfilled' ? lendingRes.value : 0;
      const incentivePages = incentiveRes.status === 'fulfilled' ? incentiveRes.value : 0;

      logger.info(`Discovered ${this.knownBorrowers.size} active NAVI borrower accounts across ${lendingPages + incentivePages} historical pages`);
      await this.refreshAllBorrowers();
    } catch (err) {
      logger.warn({ error: err }, 'Could not fetch historical NAVI events');
    }
  }

  public async refreshAllBorrowers(): Promise<void> {
    const borrowers = Array.from(this.knownBorrowers);
    const BATCH_SIZE = 25;
    for (let i = 0; i < borrowers.length; i += BATCH_SIZE) {
      const batch = borrowers.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map((b) => this.refreshBorrowerState(b)));
    }
  }

  public async refreshBorrowerState(borrowerAddress: string): Promise<ObligationState | null> {
    const existing = this.inFlightRefreshes.get(borrowerAddress);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        // Query lending positions from NAVI SDK
        const positions = await navi.getLendingPositions(borrowerAddress);
        if (!positions || !Array.isArray(positions)) return null;

      const collaterals: CollateralPosition[] = [];
      const debts: DebtPosition[] = [];

      function parseNaviAmount(amtStr: string | number | undefined, decimals: number): bigint {
        if (!amtStr) return 0n;
        const s = String(amtStr).trim();
        if (!s || s === '0') return 0n;
        if (s.includes('.')) {
          const [intPart, fracPartRaw] = s.split('.');
          const fracPart = (fracPartRaw || '').padEnd(decimals, '0').slice(0, decimals);
          return BigInt(intPart + fracPart);
        }
        return BigInt(s) * (10n ** BigInt(decimals));
      }

      for (const pos of positions) {
        if (pos.type === 'navi-lending-supply' && pos['navi-lending-supply']) {
          const supply = pos['navi-lending-supply'];
          const coinType = supply.token.coinType;
          const cfg = getCoinConfigByType(coinType);
          const decimals = cfg?.decimals ?? supply.token.decimals ?? 9;
          const rawAmount = parseNaviAmount(supply.amount, decimals);
          if (supply.token?.price && supply.token.price > 0) {
            priceCache.updatePrice({
              symbol: cfg?.symbol ?? supply.token.symbol ?? 'UNKNOWN',
              coinType,
              price: Number(supply.token.price),
              confidence: 0,
              exponent: -decimals,
              rawPrice: BigInt(Math.floor(Number(supply.token.price) * Math.pow(10, decimals))),
              publishTime: Math.floor(Date.now() / 1000),
              lastUpdatedMs: Date.now(),
            });
          }
          if (rawAmount > 0n) {
            collaterals.push({
              coinType,
              symbol: cfg?.symbol ?? supply.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals,
              valueUsd: 0,
              liquidationThreshold: cfg?.liquidationThreshold ?? 0.80,
            });
          }
        } else if (pos.type === 'navi-lending-borrow' && pos['navi-lending-borrow']) {
          const borrow = pos['navi-lending-borrow'];
          const coinType = borrow.token.coinType;
          const cfg = getCoinConfigByType(coinType);
          const decimals = cfg?.decimals ?? borrow.token.decimals ?? 9;
          const rawAmount = parseNaviAmount(borrow.amount, decimals);
          if (borrow.token?.price && borrow.token.price > 0) {
            priceCache.updatePrice({
              symbol: cfg?.symbol ?? borrow.token.symbol ?? 'UNKNOWN',
              coinType,
              price: Number(borrow.token.price),
              confidence: 0,
              exponent: -decimals,
              rawPrice: BigInt(Math.floor(Number(borrow.token.price) * Math.pow(10, decimals))),
              publishTime: Math.floor(Date.now() / 1000),
              lastUpdatedMs: Date.now(),
            });
          }
          if (rawAmount > 0n) {
            debts.push({
              coinType,
              symbol: cfg?.symbol ?? borrow.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals,
              valueUsd: 0,
            });
          }
        } else if (pos.type === 'navi-lending-emode-supply' && pos['navi-lending-emode-supply']) {
          const supply = pos['navi-lending-emode-supply'];
          const coinType = supply.token.coinType;
          const cfg = getCoinConfigByType(coinType);
          const decimals = cfg?.decimals ?? supply.token.decimals ?? 9;
          const rawAmount = parseNaviAmount(supply.amount, decimals);
          if (rawAmount > 0n) {
            collaterals.push({
              coinType,
              symbol: cfg?.symbol ?? supply.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals,
              valueUsd: 0,
              liquidationThreshold: supply.pool?.emode?.lt ?? cfg?.liquidationThreshold ?? 0.85,
            });
          }
        } else if (pos.type === 'navi-lending-emode-borrow' && pos['navi-lending-emode-borrow']) {
          const borrow = pos['navi-lending-emode-borrow'];
          const coinType = borrow.token.coinType;
          const cfg = getCoinConfigByType(coinType);
          const decimals = cfg?.decimals ?? borrow.token.decimals ?? 9;
          const rawAmount = parseNaviAmount(borrow.amount, decimals);
          if (rawAmount > 0n) {
            debts.push({
              coinType,
              symbol: cfg?.symbol ?? borrow.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals,
              valueUsd: 0,
            });
          }
        }
      }

      if (debts.length === 0 && collaterals.length === 0) {
        return null;
      }

      const obligation: ObligationState = {
        protocol: 'navi',
        obligationId: borrowerAddress,
        ownerAddress: borrowerAddress,
        collaterals,
        debts,
        totalCollateralUsd: 0,
        totalDebtUsd: 0,
        liquidationThresholdCollateralUsd: 0,
        healthFactor: Infinity,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      // Calculate health factor with current prices
      HealthFactorEngine.evaluateObligation(obligation);
      this.obligations.set(borrowerAddress, obligation);

      for (const listener of this.listeners) {
        listener(obligation);
      }

      return obligation;
    } catch (err) {
      logger.debug({ borrowerAddress, error: err }, 'Error refreshing borrower state');
      return null;
    } finally {
      this.inFlightRefreshes.delete(borrowerAddress);
    }
  })();

  this.inFlightRefreshes.set(borrowerAddress, promise);
  return promise;
}

  public getObligation(borrowerAddress: string): ObligationState | undefined {
    return this.obligations.get(borrowerAddress);
  }

  public getAllObligations(): ObligationState[] {
    return Array.from(this.obligations.values());
  }
}

export const naviIndexer = new NaviIndexer();
