import { CONFIG } from '../config/index.js';
import { getAllPythFeedIds, getCoinConfigByPythId, COIN_CONFIGS } from '../config/coins.js';
import { priceCache } from './priceCache.js';
import { rpcManager } from '../client/suiClient.js';
import { logger } from '../ui/logger.js';

export type PriceUpdateCallback = (feedId: string, price: number) => void;

/**
 * Verified Sui Mainnet On-Chain Pyth PriceInfo Object IDs.
 * Bypasses Pyth Hermes 401 API-key gating entirely by reading the authoritative
 * on-chain Move object state directly via Alchemy / multi-RPC.
 */
export const ON_CHAIN_PYTH_OBJECTS: Record<string, { objectId: string; symbols: string[] }> = {
  SUI: {
    objectId: '0x89b2add829cb6fcd017153fff428bc9faec4d06d643ecfc435af5b55a9e987f0',
    symbols: ['SUI', 'HASUI'],
  },
  USDC: {
    objectId: '0x6ddfc6f9921e55998cbc2e68f78eba897981d79ac17f66c5277bc38954a2a3f8',
    symbols: ['USDC', 'WUSDC'],
  },
  USDT: {
    objectId: '0x939e666c48cfac89418f69a24cb857263d4c520f90d94ea0770e295b9857961e',
    symbols: ['USDT', 'WUSDT'],
  },
  WETH: {
    objectId: '0x88d7ef5396b1f885ed347f97f3b58daae8a424122668e96bdb4ee847cff62adf',
    symbols: ['WETH'],
  },
  WBTC: {
    objectId: '0xe64832d1b4c9a75139a7313aee69da891297d8397fda2863b5bdcc4af0b79758',
    symbols: ['WBTC'],
  },
  CETUS: {
    objectId: '0xb14bce71ba7e52cd52947f236604ece40f7a58a1cdf0435c8b94cf6f2d84d302',
    symbols: ['CETUS'],
  },
  DEEP: {
    objectId: '0x562957f70afaf8a0870e2959abc3e3f327a8159f803d8c56cff27ac2df260477',
    symbols: ['DEEP'],
  },
  NAVI: {
    objectId: '0x9b9aeb630697368ca228f3353b34b4f4b1bbc1fbdbd7417b01765cb93013de12',
    symbols: ['NAVI'],
  },
  SCA: {
    objectId: '0xf6de1d3279a269a597d813cbaca59aa906543ab9a8c64e84a4722f1a20863985',
    symbols: ['SCA'],
  },
};

/**
 * Pyth Network Price Service Client
 * Primary: Queries on-chain Pyth PriceInfo objects through Alchemy RPC with sub-second accuracy.
 * Secondary: Fallback to Hermes endpoints with API key headers.
 */
export class PythPriceService {
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private updateListeners: PriceUpdateCallback[] = [];

  constructor(
    private readonly hermesEndpoints: string[] = [
      CONFIG.pythHermesUrl,
      'https://pyth.dourolabs.app/hermes',
      'https://hermes.pyth.network',
      'https://hermes-beta.pyth.network',
    ]
  ) {}

  public onPriceUpdate(callback: PriceUpdateCallback): void {
    this.updateListeners.push(callback);
  }

  public async start(pollIntervalMs: number = 2000): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    logger.info('Starting Pyth Price Service (Alchemy On-Chain + Multi-RPC)...');
    await this.fetchLatestPrices();

    this.pollInterval = setInterval(async () => {
      try {
        await this.fetchLatestPrices();
      } catch (err) {
        logger.debug({ error: err }, 'Failed to refresh Pyth prices');
      }
    }, pollIntervalMs);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Primary price sync: Reads on-chain Pyth PriceInfo objects directly via Alchemy RPC.
   * Eliminates Hermes 401 unauthorized errors and provides sub-second on-chain truth.
   */
  public async fetchOnChainPricesViaAlchemy(): Promise<boolean> {
    const objectMap = new Map<string, string[]>();
    for (const info of Object.values(ON_CHAIN_PYTH_OBJECTS)) {
      const existing = objectMap.get(info.objectId) ?? [];
      objectMap.set(info.objectId, Array.from(new Set([...existing, ...info.symbols])));
    }
    const ids = Array.from(objectMap.keys());

    try {
      const responses = await rpcManager.executeWithFallback('pythMultiGetObjects', (client) =>
        client.multiGetObjects({
          ids,
          options: { showContent: true },
        })
      );

      let updatedCount = 0;
      for (const obj of responses) {
        if (!obj.data?.content || obj.data.content.dataType !== 'moveObject') continue;
        const objectId = obj.data.objectId;
        const symbols = objectMap.get(objectId);
        if (!symbols || symbols.length === 0) continue;

        const fields = (obj.data.content as any).fields;
        const priceData = fields?.price_info?.fields?.price_feed?.fields?.price?.fields;
        if (!priceData) continue;

        const rawMag = BigInt(priceData.price?.fields?.magnitude ?? priceData.price ?? 0);
        const isNeg = priceData.price?.fields?.negative ?? false;
        const expoMag = Number(priceData.expo?.fields?.magnitude ?? 8);
        const isExpoNeg = priceData.expo?.fields?.negative ?? true;
        const expo = isExpoNeg ? -expoMag : expoMag;
        const publishTime = Number(priceData.timestamp);
        const rawPrice = isNeg ? -rawMag : rawMag;
        const normPrice = Number(rawPrice) * Math.pow(10, expo);

        for (const symbol of symbols) {
          priceCache.updatePriceForSymbol(symbol, rawPrice, expo, publishTime);
          const cfg = COIN_CONFIGS[symbol];
          if (cfg) {
            for (const listener of this.updateListeners) {
              listener(cfg.pythPriceFeedId, normPrice);
            }
          }
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        logger.debug({ updatedFeeds: updatedCount }, 'Successfully refreshed on-chain Pyth prices via Alchemy RPC');
        return true;
      }
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to query on-chain Pyth prices via Alchemy RPC'
      );
    }
    return false;
  }

  /**
   * Fetch latest price feeds for all monitored tokens
   */
  public async fetchLatestPrices(): Promise<void> {
    // 1. Primary: Direct on-chain multiGetObjects via Alchemy RPC
    const onChainSuccess = await this.fetchOnChainPricesViaAlchemy();
    if (onChainSuccess) return;

    // 2. Secondary: Fallback to Hermes endpoints if on-chain query fails
    const feedIds = getAllPythFeedIds();
    let lastError: unknown;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (CONFIG.pythApiKey) {
      headers.Authorization = `Bearer ${CONFIG.pythApiKey}`;
    }

    for (const endpoint of this.hermesEndpoints) {
      try {
        const url = new URL(`${endpoint.replace(/\/$/, '')}/v2/updates/price/latest`);
        for (const id of feedIds) {
          url.searchParams.append('ids[]', id);
        }
        url.searchParams.set('parsed', 'true');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers,
        });
        clearTimeout(timer);

        if (!res.ok) {
          if (res.status === 401) {
            logger.debug({ endpoint }, 'Pyth Hermes returned 401 (API key required for live Hermes endpoints since Aug 2026)');
          }
          throw new Error(`Hermes responded with status ${res.status}`);
        }

        const data = (await res.json()) as { parsed?: Array<{ id: string; price?: { price: string; expo: number; publish_time: number } }> };
        if (data.parsed && Array.isArray(data.parsed)) {
          for (const item of data.parsed) {
            const feedId = item.id.startsWith('0x') ? item.id : '0x' + item.id;
            const priceInfo = item.price;
            if (priceInfo) {
              priceCache.updateFromPyth(feedId, priceInfo.price, priceInfo.expo, priceInfo.publish_time);
              const cfg = getCoinConfigByPythId(feedId);
              if (cfg) {
                const normPrice = Number(priceInfo.price) * Math.pow(10, priceInfo.expo);
                for (const listener of this.updateListeners) {
                  listener(feedId, normPrice);
                }
              }
            }
          }
          return;
        }
      } catch (err) {
        lastError = err;
      }
    }

    logger.debug({ error: lastError }, 'Pyth Hermes fetch attempt completed (fallback cache active)');
  }

  /**
   * Fetch binary VAA price update data to inject into PTB on-chain oracle refresh
   */
  public async getPriceUpdateDataForPTB(feedIds: string[]): Promise<string[]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (CONFIG.pythApiKey) {
      headers.Authorization = `Bearer ${CONFIG.pythApiKey}`;
    }

    for (const endpoint of this.hermesEndpoints) {
      try {
        const url = new URL(`${endpoint.replace(/\/$/, '')}/v2/updates/price/latest`);
        for (const id of feedIds) {
          url.searchParams.append('ids[]', id);
        }
        url.searchParams.set('encoding', 'base64');
        url.searchParams.set('parsed', 'false');

        const res = await fetch(url.toString(), { headers });

        if (!res.ok) continue;

        const data = (await res.json()) as { binary?: { data?: string[] } };
        if (data.binary && Array.isArray(data.binary.data)) {
          return data.binary.data;
        }
      } catch {
        continue;
      }
    }

    return [];
  }
}

export const pythService = new PythPriceService();
