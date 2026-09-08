import { suiWsClient } from '../../client/websocket.js';
import { suiClient, rpcManager } from '../../client/suiClient.js';
import { NAVI_CONFIG } from '../../config/constants.js';
import { COIN_CONFIGS, getCoinConfigByType } from '../../config/coins.js';
import { ObligationState, CollateralPosition, DebtPosition } from '../../config/types.js';
import { HealthFactorEngine } from '../../oracles/healthFactor.js';
import { logger } from '../../ui/logger.js';
import * as navi from '@naviprotocol/lending';

export type ObligationCallback = (obligation: ObligationState) => void;

/**
 * NAVI Protocol Borrower Indexer
 * Ingests borrow/deposit events and maintains in-memory borrower states.
 */
export class NaviIndexer {
  private knownBorrowers: Set<string> = new Set();
  private obligations: Map<string, ObligationState> = new Map();
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
    this.knownBorrowers.add(address);
  }

  public async discoverBorrowersFromHistory(): Promise<void> {
    try {
      logger.info('Querying recent NAVI lending events to discover active borrowers...');
      const events = await rpcManager.executeWithFallback('naviQueryEvents', (client) =>
        client.queryEvents({
          query: { MoveModule: { package: NAVI_CONFIG.packageId, module: 'lending' } },
          limit: 50,
        })
      );

      for (const ev of events.data) {
        const json = ev.parsedJson as Record<string, unknown> | undefined;
        const sender = (json?.sender || json?.borrower || json?.user) as string | undefined;
        if (sender && typeof sender === 'string' && sender.startsWith('0x')) {
          this.addBorrower(sender);
        }
      }

      logger.info(`Discovered ${this.knownBorrowers.size} active NAVI borrower accounts`);
      await this.refreshAllBorrowers();
    } catch (err) {
      logger.warn({ error: err }, 'Could not fetch historical NAVI events');
    }
  }

  public async refreshAllBorrowers(): Promise<void> {
    for (const borrower of this.knownBorrowers) {
      await this.refreshBorrowerState(borrower);
    }
  }

  public async refreshBorrowerState(borrowerAddress: string): Promise<ObligationState | null> {
    try {
      // Query lending positions from NAVI SDK
      const positions = await navi.getLendingPositions(borrowerAddress);
      if (!positions || !Array.isArray(positions)) return null;

      const collaterals: CollateralPosition[] = [];
      const debts: DebtPosition[] = [];

      for (const pos of positions) {
        if (pos.type === 'navi-lending-supply' && pos['navi-lending-supply']) {
          const supply = pos['navi-lending-supply'];
          const coinType = supply.token.coinType;
          const rawAmount = BigInt(supply.amount ?? '0');
          if (rawAmount > 0n) {
            const cfg = getCoinConfigByType(coinType);
            collaterals.push({
              coinType,
              symbol: cfg?.symbol ?? supply.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals: cfg?.decimals ?? supply.token.decimals ?? 9,
              valueUsd: 0,
              liquidationThreshold: cfg?.liquidationThreshold ?? 0.80,
            });
          }
        } else if (pos.type === 'navi-lending-borrow' && pos['navi-lending-borrow']) {
          const borrow = pos['navi-lending-borrow'];
          const coinType = borrow.token.coinType;
          const rawAmount = BigInt(borrow.amount ?? '0');
          if (rawAmount > 0n) {
            const cfg = getCoinConfigByType(coinType);
            debts.push({
              coinType,
              symbol: cfg?.symbol ?? borrow.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals: cfg?.decimals ?? borrow.token.decimals ?? 9,
              valueUsd: 0,
            });
          }
        } else if (pos.type === 'navi-lending-emode-supply' && pos['navi-lending-emode-supply']) {
          const supply = pos['navi-lending-emode-supply'];
          const coinType = supply.token.coinType;
          const rawAmount = BigInt(supply.amount ?? '0');
          if (rawAmount > 0n) {
            const cfg = getCoinConfigByType(coinType);
            collaterals.push({
              coinType,
              symbol: cfg?.symbol ?? supply.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals: cfg?.decimals ?? supply.token.decimals ?? 9,
              valueUsd: 0,
              liquidationThreshold: cfg?.liquidationThreshold ?? 0.85,
            });
          }
        } else if (pos.type === 'navi-lending-emode-borrow' && pos['navi-lending-emode-borrow']) {
          const borrow = pos['navi-lending-emode-borrow'];
          const coinType = borrow.token.coinType;
          const rawAmount = BigInt(borrow.amount ?? '0');
          if (rawAmount > 0n) {
            const cfg = getCoinConfigByType(coinType);
            debts.push({
              coinType,
              symbol: cfg?.symbol ?? borrow.token.symbol ?? 'UNKNOWN',
              amount: rawAmount,
              decimals: cfg?.decimals ?? borrow.token.decimals ?? 9,
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
    }
  }

  public getObligation(borrowerAddress: string): ObligationState | undefined {
    return this.obligations.get(borrowerAddress);
  }

  public getAllObligations(): ObligationState[] {
    return Array.from(this.obligations.values());
  }
}

export const naviIndexer = new NaviIndexer();
