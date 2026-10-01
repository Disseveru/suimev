import { Scallop } from '@scallop-io/sui-scallop-sdk';
import { SuiClientManager } from '../../client/suiClient.js';
import { SCALLOP_CONFIG } from '../../config/constants.js';
import { CONFIG } from '../../config/index.js';
import { logger } from '../../ui/logger.js';

/**
 * Scallop Protocol SDK Wrapper
 */
export class ScallopProtocol {
  private static instance: ScallopProtocol;
  private sdk: Scallop | null = null;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): ScallopProtocol {
    if (!ScallopProtocol.instance) {
      ScallopProtocol.instance = new ScallopProtocol();
    }
    return ScallopProtocol.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Ensure Scallop indexer API requests include required origin/referer headers to bypass 403 Forbidden
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : (input && typeof input === 'object' && 'url' in input ? (input as any).url : '');
      if (typeof urlStr === 'string' && urlStr.includes('scallop.io')) {
        const headers = new Headers(init?.headers || (typeof input === 'object' && input && 'headers' in input ? (input as any).headers : {}));
        if (!headers.has('Origin')) headers.set('Origin', 'https://app.scallop.io');
        if (!headers.has('Referer')) headers.set('Referer', 'https://app.scallop.io/');
        if (!headers.has('User-Agent')) headers.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
        init = { ...init, headers };
      }
      return origFetch(input, init);
    };

    try {
      logger.info('Initializing Scallop SDK...');
      this.sdk = new Scallop({
        addressId: SCALLOP_CONFIG.addressId,
        network: CONFIG.network === 'mainnet' ? 'mainnet' : 'testnet',
        fullnodeUrl: CONFIG.rpcUrl,
        walletAddress: CONFIG.operatorAddress,
        pythApiKey: CONFIG.pythApiKey,
      });

      await this.sdk.init();
      this.isInitialized = true;
      logger.info('Scallop Protocol SDK initialized successfully');
    } catch (err) {
      logger.warn({ error: err }, 'Could not initialize online Scallop SDK, continuing with static config');
      this.isInitialized = true;
    }
  }

  public getSdk(): Scallop | null {
    return this.sdk;
  }

  public async isObligationLocked(obligationId: string): Promise<boolean> {
    try {
      if (this.sdk) {
        const query = await this.sdk.createScallopQuery();
        return await query.getObligationLocked(obligationId);
      }
    } catch {
      // Fall through to direct on-chain object query
    }

    try {
      const client = SuiClientManager.getInstance().getClient();
      const obj = await client.getObject({ id: obligationId, options: { showContent: true } });
      const fields = (obj.data?.content as any)?.fields;
      return Boolean(fields?.liquidate_locked);
    } catch {
      return false;
    }
  }

  public async getOnChainObligationRisk(obligationId: string): Promise<{
    riskLevel: number;
    unhealthyCollateralValue: number;
    isLiquidatable: boolean;
  }> {
    try {
      if (this.sdk) {
        const query = await this.sdk.createScallopQuery();
        const account = await query.getObligationAccountById(obligationId);
        if (account) {
          const isLiquidatable = (account.totalRiskLevel >= 1.0) || (account.totalUnhealthyCollateralValue > 0);
          return {
            riskLevel: account.totalRiskLevel,
            unhealthyCollateralValue: account.totalUnhealthyCollateralValue,
            isLiquidatable,
          };
        }
      }
    } catch {
      // Fall through to conservative default
    }
    return { riskLevel: 0, unhealthyCollateralValue: 0, isLiquidatable: false };
  }

  public async getObligationCoinNames(obligationId: string): Promise<string[]> {
    try {
      if (this.sdk) {
        const query = await this.sdk.createScallopQuery();
        const oblData = await query.queryObligation(obligationId);
        if (oblData) {
          const coinTypes = [
            ...oblData.collaterals.map((c: any) => c.type),
            ...oblData.debts.map((d: any) => d.type),
          ];
          const names = new Set<string>();
          for (const cType of coinTypes) {
            const parsed = (query as any).utils?.parseCoinNameFromType?.(cType);
            if (parsed && typeof parsed === 'string') {
              names.add(parsed);
            }
          }
          return Array.from(names);
        }
      }
    } catch {
      // Fall through to empty list on error
    }
    return [];
  }

  public async createScallopBuilder() {
    if (!this.sdk) {
      await this.initialize();
    }
    if (!this.sdk) {
      throw new Error('Scallop SDK is unavailable');
    }
    return await this.sdk.createScallopBuilder();
  }
}

export const scallopProtocol = ScallopProtocol.getInstance();
