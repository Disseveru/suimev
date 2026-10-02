import { SwapQuote } from '../../config/types.js';
import { getCoinConfigByType, normalizeStructTag } from '../../config/coins.js';
import { priceCache } from '../../oracles/priceCache.js';
import { logger } from '../../ui/logger.js';

export interface AstrosRouteResponse {
  data?: {
    amount_in: number | string;
    amount_out: number | string;
    routes: Array<{
      dex: string;
      path: string[];
      amount_in: number | string;
      amount_out: number | string;
    }>;
    from_token: {
      address: string;
      decimals: number;
      price: number;
    };
    to_token: {
      address: string;
      decimals: number;
      price: number;
    };
    from: string;
    target: string;
    high_price_impact?: boolean;
    is_accurate?: boolean;
    trace_id?: string;
  };
}

/**
 * Astros DEX Aggregator Router (NAVI Ecosystem DEX Aggregator)
 * Official API: https://open-aggregator-api.naviprotocol.io/find_routes
 * Provides optimal multi-hop routing across Cetus, DeepBook, Kriya, Turbos, FlowX, and Aftermath.
 */
export class AstrosRouter {
  private static quoteCache: Map<string, { quote: SwapQuote; timestampMs: number }> = new Map();
  private static readonly CACHE_TTL_MS = 3_000; // 3 seconds TTL for fast MEV pipeline

  /**
   * Fetch live optimal DEX swap quotation from Astros Aggregator API
   */
  public static async fetchQuote(
    fromCoinType: string,
    toCoinType: string,
    amountIn: bigint,
    slippageBps: number = 100
  ): Promise<SwapQuote | null> {
    const normFrom = normalizeStructTag(fromCoinType);
    const normTo = normalizeStructTag(toCoinType);
    const cacheKey = `${normFrom}:${normTo}:${amountIn.toString()}:${slippageBps}`;

    const cached = this.quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.timestampMs < this.CACHE_TTL_MS) {
      return cached.quote;
    }

    try {
      const url = `https://open-aggregator-api.naviprotocol.io/find_routes?from=${encodeURIComponent(fromCoinType)}&target=${encodeURIComponent(toCoinType)}&amount=${amountIn.toString()}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1_500);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`Astros API HTTP ${res.status}`);
      }

      const json: AstrosRouteResponse = (await res.json()) as AstrosRouteResponse;
      if (!json?.data?.amount_out) {
        return null;
      }

      const expectedAmountOut = BigInt(Math.floor(Number(json.data.amount_out)));
      const minAmountOut = (expectedAmountOut * BigInt(10_000 - slippageBps)) / 10_000n;

      const quote: SwapQuote = {
        dex: 'astros',
        fromCoinType,
        toCoinType,
        amountIn,
        expectedAmountOut,
        minimumAmountOut: minAmountOut,
        slippageBps,
        priceImpactPct: json.data.high_price_impact ? 0.05 : 0.001,
        poolId: 'astros-aggregator',
        a2b: true,
      };

      this.quoteCache.set(cacheKey, { quote, timestampMs: Date.now() });
      return quote;
    } catch (err) {
      logger.debug({ from: fromCoinType, to: toCoinType, error: err }, 'Astros route quote fetch failed, using fallback');
      return null;
    }
  }

  /**
   * Synchronous local quote fallback based on high-frequency Pyth oracle cache
   */
  public static getQuote(
    fromCoinType: string,
    toCoinType: string,
    amountIn: bigint,
    slippageBps: number = 100
  ): SwapQuote {
    const fromCfg = getCoinConfigByType(fromCoinType);
    const toCfg = getCoinConfigByType(toCoinType);

    const fromDecimals = fromCfg?.decimals ?? 9;
    const toDecimals = toCfg?.decimals ?? 6;

    const fromPrice = fromCfg ? priceCache.getPriceBySymbol(fromCfg.symbol) : undefined;
    const toPrice = toCfg ? priceCache.getPriceBySymbol(toCfg.symbol) : undefined;

    const pIn = fromPrice?.price ?? 1.0;
    const pOut = toPrice?.price ?? 1.0;

    const inUnits = Number(amountIn) / Math.pow(10, fromDecimals);
    const inValueUsd = inUnits * pIn;
    const outUnits = inValueUsd / pOut;
    const expectedOut = BigInt(Math.floor(outUnits * Math.pow(10, toDecimals)));
    const minOut = (expectedOut * BigInt(10_000 - slippageBps)) / 10_000n;

    return {
      dex: 'astros',
      fromCoinType,
      toCoinType,
      amountIn,
      expectedAmountOut: expectedOut,
      minimumAmountOut: minOut,
      slippageBps,
      priceImpactPct: 0.001,
      poolId: 'astros-aggregator',
      a2b: true,
    };
  }
}
