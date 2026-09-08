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
        { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'collateral' } },
        (event) => {
          this.handleScallopEvent(event);
        }
      );

      logger.info('Subscribed to Scallop Protocol WebSocket events');
    } catch (err) {
      logger.warn({ error: err }, 'Could not subscribe to Scallop WebSocket events');
    }
  }

  private handleScallopEvent(event: Record<string, unknown>): void {
    try {
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

  public async discoverObligationsFromHistory(): Promise<void> {
    try {
      logger.info('Querying recent Scallop events to discover active obligations...');
      const events = await rpcManager.executeWithFallback('scallopQueryEvents', (client) =>
        client.queryEvents({
          query: { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'borrow' } },
          limit: 50,
        })
      );

      for (const ev of events.data) {
        const json = ev.parsedJson as Record<string, unknown> | undefined;
        const obligationId = (json?.obligation || json?.obligation_id) as string | undefined;
        if (obligationId && typeof obligationId === 'string' && obligationId.startsWith('0x')) {
          this.addObligation(obligationId);
        }
      }

      logger.info(`Discovered ${this.knownObligationIds.size} active Scallop obligations`);
      await this.refreshAllObligations();
    } catch (err) {
      logger.warn({ error: err }, 'Could not fetch historical Scallop events');
    }
  }

  public async refreshAllObligations(): Promise<void> {
    for (const id of this.knownObligationIds) {
      await this.refreshObligationState(id);
    }
  }

  public async refreshObligationState(obligationId: string): Promise<ObligationState | null> {
    try {
      const sdk = scallopProtocol.getSdk();
      if (sdk) {
        const query = await sdk.createScallopQuery();
        const oblData = await query.queryObligation(obligationId);

        if (oblData) {
          const collaterals: CollateralPosition[] = [];
          const debts: DebtPosition[] = [];

          if (oblData.collaterals && Array.isArray(oblData.collaterals)) {
            for (const col of oblData.collaterals) {
              const coinType = col.type;
              const cfg = getCoinConfigByType(coinType);
              const lowerType = coinType.toLowerCase();
              const inferredDecimals = cfg?.decimals ?? (
                lowerType.includes('btc') ? 8 :
                lowerType.includes('eth') ? 8 :
                lowerType.includes('usdc') || lowerType.includes('usdt') || lowerType.includes('usd') || lowerType.includes('deep') ? 6 : 9
              );
              const inferredLt = cfg?.liquidationThreshold ?? (
                lowerType.includes('usdc') || lowerType.includes('usdt') || lowerType.includes('sui') || lowerType.includes('usd') ? 0.90 : 0.80
              );
              collaterals.push({
                coinType,
                symbol: cfg?.symbol ?? coinType.split('::')[2] ?? 'UNKNOWN',
                amount: BigInt(col.amount ?? '0'),
                decimals: inferredDecimals,
                valueUsd: 0,
                liquidationThreshold: inferredLt,
              });
            }
          }

          if (oblData.debts && Array.isArray(oblData.debts)) {
            for (const d of oblData.debts) {
              const coinType = d.type;
              const cfg = getCoinConfigByType(coinType);
              const lowerType = coinType.toLowerCase();
              const inferredDecimals = cfg?.decimals ?? (
                lowerType.includes('btc') ? 8 :
                lowerType.includes('eth') ? 8 :
                lowerType.includes('usdc') || lowerType.includes('usdt') || lowerType.includes('usd') || lowerType.includes('deep') ? 6 : 9
              );
              debts.push({
                coinType,
                symbol: cfg?.symbol ?? coinType.split('::')[2] ?? 'UNKNOWN',
                amount: BigInt(d.amount ?? '0'),
                decimals: inferredDecimals,
                valueUsd: 0,
              });
            }
          }

          if (debts.length === 0 && collaterals.length === 0) return null;

          const state: ObligationState = {
            protocol: 'scallop',
            obligationId,
            ownerAddress: obligationId,
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

          for (const listener of this.listeners) {
            listener(state);
          }

          return state;
        }
      }

      return null;
    } catch (err) {
      logger.debug({ obligationId, error: err }, 'Error refreshing Scallop obligation');
      return null;
    }
  }

  public getObligation(id: string): ObligationState | undefined {
    return this.obligations.get(id);
  }

  public getAllObligations(): ObligationState[] {
    return Array.from(this.obligations.values());
  }
}

export const scallopIndexer = new ScallopIndexer();
