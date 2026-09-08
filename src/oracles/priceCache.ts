import { OraclePrice } from '../config/types.js';
import { COIN_CONFIGS, getCoinConfigByPythId, getCoinConfigByType, normalizeStructTag } from '../config/coins.js';
import { logger } from '../ui/logger.js';

/**
 * Ultra-Low-Latency In-Memory Price Cache
 * Thread-safe, lock-free reads for sub-millisecond Health Factor evaluations.
 */
export class PriceCache {
  private static instance: PriceCache;
  private pricesByCoinType: Map<string, OraclePrice> = new Map();
  private pricesBySymbol: Map<string, OraclePrice> = new Map();
  private pricesByPythId: Map<string, OraclePrice> = new Map();

  private constructor() {
    // Seed default baseline prices for instant cold-start capability
    this.seedDefaults();
  }

  public static getInstance(): PriceCache {
    if (!PriceCache.instance) {
      PriceCache.instance = new PriceCache();
    }
    return PriceCache.instance;
  }

  private seedDefaults(): void {
    const seedTable: Record<string, number> = {
      SUI: 0.80,
      USDC: 1.00,
      USDT: 1.00,
      WETH: 2505.0,
      WBTC: 79850.0,
      CETUS: 0.023,
      NAVI: 0.010,
      SCA: 0.004,
      HASUI: 0.80,
      DEEP: 0.015,
      WAL: 0.35,
      USDY: 1.05,
      USDSUI: 1.00,
      AFSUI: 0.85,
      SCA_SUI: 0.85,
    };

    const now = Date.now();
    for (const [symbol, defaultPrice] of Object.entries(seedTable)) {
      const cfg = COIN_CONFIGS[symbol];
      if (cfg) {
        this.updatePrice({
          symbol: cfg.symbol,
          coinType: cfg.coinType,
          price: defaultPrice,
          confidence: defaultPrice * 0.001,
          exponent: -8,
          rawPrice: BigInt(Math.floor(defaultPrice * 1e8)),
          publishTime: Math.floor(now / 1000),
          lastUpdatedMs: now,
        });
      }
    }
  }

  public updatePrice(price: OraclePrice): void {
    const normType = normalizeStructTag(price.coinType);
    this.pricesByCoinType.set(normType, price);
    this.pricesBySymbol.set(price.symbol.toUpperCase(), price);

    const cfg = COIN_CONFIGS[price.symbol.toUpperCase()];
    if (cfg) {
      this.pricesByPythId.set(cfg.pythPriceFeedId.toLowerCase(), price);
    }
  }

  public updatePriceForSymbol(symbol: string, rawPrice: string | number | bigint, expo: number, publishTime: number): void {
    const cfg = COIN_CONFIGS[symbol.toUpperCase()];
    if (!cfg) return;

    const numPrice = Number(rawPrice) * Math.pow(10, expo);
    if (numPrice <= 0 || isNaN(numPrice)) return;

    const oraclePrice: OraclePrice = {
      symbol: cfg.symbol,
      coinType: cfg.coinType,
      price: numPrice,
      confidence: 0,
      exponent: expo,
      rawPrice: BigInt(rawPrice),
      publishTime,
      lastUpdatedMs: Date.now(),
    };

    this.updatePrice(oraclePrice);
  }

  public updateFromPyth(feedId: string, rawPrice: string | number, expo: number, publishTime: number): void {
    const cfg = getCoinConfigByPythId(feedId);
    if (!cfg) return;

    const numPrice = Number(rawPrice) * Math.pow(10, expo);
    if (numPrice <= 0 || isNaN(numPrice)) return;

    const oraclePrice: OraclePrice = {
      symbol: cfg.symbol,
      coinType: cfg.coinType,
      price: numPrice,
      confidence: 0,
      exponent: expo,
      rawPrice: BigInt(rawPrice),
      publishTime,
      lastUpdatedMs: Date.now(),
    };

    this.updatePrice(oraclePrice);
  }

  public getPriceByCoinType(coinType: string): OraclePrice | undefined {
    return this.pricesByCoinType.get(normalizeStructTag(coinType));
  }

  public getPriceBySymbol(symbol: string): OraclePrice | undefined {
    return this.pricesBySymbol.get(symbol.toUpperCase());
  }

  public getPriceUsd(coinType: string): number {
    if (!coinType) return 0;
    const direct = this.getPriceByCoinType(coinType);
    if (direct && direct.price > 0) return direct.price;

    const cfg = getCoinConfigByType(coinType);
    if (cfg) {
      const bySym = this.getPriceBySymbol(cfg.symbol);
      if (bySym && bySym.price > 0) return bySym.price;
    }

    const parts = coinType.split('::');
    if (parts.length === 3) {
      const structName = parts[2].toUpperCase();
      const byStruct = this.getPriceBySymbol(structName);
      if (byStruct && byStruct.price > 0) return byStruct.price;
      if (structName.includes('BTC')) return this.getPriceBySymbol('WBTC')?.price || 80000;
      if (structName.includes('ETH')) return this.getPriceBySymbol('WETH')?.price || 2500;
      if (structName.includes('USD')) return 1.0;
      if (structName.includes('SUI')) return this.getPriceBySymbol('SUI')?.price || 0.83;
    }

    return 0;
  }

  public getAllPrices(): OraclePrice[] {
    return Array.from(this.pricesBySymbol.values());
  }
}

export const priceCache = PriceCache.getInstance();
