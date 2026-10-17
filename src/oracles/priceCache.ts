import { OraclePrice } from '../config/types.js';
import { COIN_CONFIGS, getCoinConfigByPythId, getCoinConfigsByPythId, getCoinConfigByType, normalizeStructTag } from '../config/coins.js';
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
  private afsuiRedemptionRate: number = 1.05;

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
      HBTC: 79850.0,
      hBTC: 79850.0,
      LBTC: 82000.0,
      CETUS: 0.023,
      NAVI: 0.010,
      NAVX: 0.010,
      SCA: 0.004,
      HASUI: 0.80,
      DEEP: 0.015,
      WAL: 0.35,
      USDY: 1.05,
      USDSUI: 1.00,
      AFSUI: 0.84,
      CERT: 0.85,
      VSUI: 0.85,
      SCA_SUI: 0.85,
      BUCK: 1.00,
      AUSD: 1.00,
      NS: 0.015,
      SSUI: 0.85,
      BLUB: 0.000001,
      FUD: 0.0000005,
      IKA: 0.002,
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
          isDefaultSeed: true,
        });
      }
    }
  }

  public updatePrice(price: OraclePrice): void {
    const normType = normalizeStructTag(price.coinType);
    const updatedPrice: OraclePrice = {
      ...price,
      isDefaultSeed: price.isDefaultSeed ?? false,
    };
    this.pricesByCoinType.set(normType, updatedPrice);
    this.pricesBySymbol.set(price.symbol.toUpperCase(), updatedPrice);

    const cfg = COIN_CONFIGS[price.symbol.toUpperCase()];
    if (cfg && cfg.pythPriceFeedId) {
      this.pricesByPythId.set(cfg.pythPriceFeedId.toLowerCase(), updatedPrice);
    }
  }

  public updatePriceForSymbol(symbol: string, rawPrice: string | number | bigint, expo: number, publishTime: number): void {
    const cfg = COIN_CONFIGS[symbol.toUpperCase()];
    if (!cfg) return;

    const numPrice = Number(rawPrice) * Math.pow(10, expo);
    if (numPrice <= 0 || isNaN(numPrice)) return;

    const safeRawInt = typeof rawPrice === 'bigint' ? rawPrice : BigInt(Math.floor(Number(rawPrice)));

    const oraclePrice: OraclePrice = {
      symbol: cfg.symbol,
      coinType: cfg.coinType,
      price: numPrice,
      confidence: 0,
      exponent: expo,
      rawPrice: safeRawInt,
      publishTime,
      lastUpdatedMs: Date.now(),
      isDefaultSeed: false,
    };

    this.updatePrice(oraclePrice);

    // If SUI price updated, automatically adjust afSUI redemption pricing regardless of isDefaultSeed state
    if (symbol.toUpperCase() === 'SUI') {
      const afsuiCfg = COIN_CONFIGS.AFSUI;
      if (afsuiCfg) {
        const afsuiExisting = this.pricesBySymbol.get('AFSUI');
        const afsuiPrice = numPrice * this.afsuiRedemptionRate;
        this.updatePrice({
          symbol: afsuiCfg.symbol,
          coinType: afsuiCfg.coinType,
          price: afsuiPrice,
          confidence: 0,
          exponent: expo,
          rawPrice: safeRawInt,
          publishTime,
          lastUpdatedMs: Date.now(),
          isDefaultSeed: afsuiExisting ? afsuiExisting.isDefaultSeed : false,
        });
      }
    }
  }

  public updateFromPyth(feedId: string, rawPrice: string | number, expo: number, publishTime: number): void {
    const configs = getCoinConfigsByPythId(feedId);
    if (!configs || configs.length === 0) return;

    const basePrice = Number(rawPrice) * Math.pow(10, expo);
    if (basePrice <= 0 || isNaN(basePrice)) return;

    const safeRawInt = typeof rawPrice === 'bigint' ? rawPrice : BigInt(Math.floor(Number(rawPrice)));

    for (const cfg of configs) {
      let numPrice = basePrice;

      // afSUI feed is AFSUI/SUI redemption rate (approx 1.05 SUI per afSUI)
      if (cfg.symbol === 'AFSUI') {
        this.afsuiRedemptionRate = numPrice;
        const suiPrice = this.getPriceBySymbol('SUI')?.price || 0.80;
        numPrice = suiPrice * this.afsuiRedemptionRate;
      }

      const oraclePrice: OraclePrice = {
        symbol: cfg.symbol,
        coinType: cfg.coinType,
        price: numPrice,
        confidence: 0,
        exponent: expo,
        rawPrice: safeRawInt,
        publishTime,
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      };

      this.updatePrice(oraclePrice);
    }
  }

  public getPriceByCoinType(coinType: string): OraclePrice | undefined {
    return this.pricesByCoinType.get(normalizeStructTag(coinType));
  }

  public getPrice(coinType: string): OraclePrice | undefined {
    return this.getPriceByCoinType(coinType) || (getCoinConfigByType(coinType) ? this.getPriceBySymbol(getCoinConfigByType(coinType)!.symbol) : undefined);
  }

  public getPriceBySymbol(symbol: string): OraclePrice | undefined {
    const sym = symbol.toUpperCase();
    const price = this.pricesBySymbol.get(sym);
    if (price) return price;
    if (sym === 'NAVX') return this.pricesBySymbol.get('NAVI');
    return undefined;
  }

  public getPriceUsd(coinType: string): number {
    if (!coinType) return 0;

    const cfg = getCoinConfigByType(coinType);
    const isAfsui = cfg?.symbol === 'AFSUI' || coinType.toLowerCase().includes('afsui');
    if (isAfsui) {
      const suiPrice = this.getPriceBySymbol('SUI')?.price || 0.80;
      return suiPrice * this.afsuiRedemptionRate;
    }

    const direct = this.getPriceByCoinType(coinType);
    if (direct && direct.price > 0) return direct.price;

    if (cfg) {
      const bySym = this.getPriceBySymbol(cfg.symbol);
      if (bySym && bySym.price > 0) return bySym.price;
    }

    const parts = coinType.split('::');
    if (parts.length === 3) {
      const structName = parts[2].toUpperCase();
      const byStruct = this.getPriceBySymbol(structName);
      if (byStruct && byStruct.price > 0) return byStruct.price;
      if (structName.includes('AFSUI')) {
        const suiPrice = this.getPriceBySymbol('SUI')?.price || 0.80;
        return suiPrice * this.afsuiRedemptionRate;
      }
      if (structName.includes('BTC') || structName.includes('HBTC')) {
        return (
          this.getPriceBySymbol('HBTC')?.price ||
          this.getPriceBySymbol('hBTC')?.price ||
          this.getPriceBySymbol('LBTC')?.price ||
          this.getPriceBySymbol('WBTC')?.price ||
          80000
        );
      }
      if (structName.includes('ETH')) return this.getPriceBySymbol('WETH')?.price || 2500;
      if (structName.includes('USD')) return 1.0;
      if (structName.includes('SUI')) return this.getPriceBySymbol('SUI')?.price || 0.80;
    }

    return 0;
  }

  private lastBtcPrice: number = 79850.0;

  /**
   * Tracks Bitcoin volatility delta to flag rapid market crashes
   */
  public recordBtcPriceUpdate(newPrice: number): { dropBps: number; isDrop: boolean } {
    if (this.lastBtcPrice <= 0) {
      this.lastBtcPrice = newPrice;
      return { dropBps: 0, isDrop: false };
    }
    const delta = newPrice - this.lastBtcPrice;
    const dropBps = Math.round((-delta / this.lastBtcPrice) * 10000);
    this.lastBtcPrice = newPrice;
    return { dropBps: Math.max(0, dropBps), isDrop: delta < 0 };
  }

  public getAllPrices(): OraclePrice[] {
    return Array.from(this.pricesBySymbol.values());
  }

  /**
   * Check if a price exists, is NOT a cold-start static seed default,
   * and was updated within maxAgeMs (default 60s per audit plan & AGENTS.md §8).
   */
  public isPriceFresh(coinType: string, maxAgeMs: number = 60_000): boolean {
    if (!coinType) return false;
    let price = this.getPriceByCoinType(coinType);
    if (!price) {
      const cfg = getCoinConfigByType(coinType);
      if (cfg) {
        price = this.getPriceBySymbol(cfg.symbol);
      }
    }
    if (!price || price.price <= 0) return false;
    if (price.isDefaultSeed) return false;
    return Date.now() - price.lastUpdatedMs <= maxAgeMs;
  }

  /**
   * Check if a price is purely a static cold-start fallback seed
   */
  public isPriceDefaultSeed(coinType: string): boolean {
    if (!coinType) return false;
    let price = this.getPriceByCoinType(coinType);
    if (!price) {
      const cfg = getCoinConfigByType(coinType);
      if (cfg) {
        price = this.getPriceBySymbol(cfg.symbol);
      }
    }
    return Boolean(price?.isDefaultSeed);
  }

  /**
   * Validate that all required coin types possess fresh live oracle prices
   */
  public arePricesFresh(coinTypes: string[], maxAgeMs: number = 60_000): boolean {
    return coinTypes.every((ct) => this.isPriceFresh(ct, maxAgeMs));
  }

  /**
   * Check that all debt and collateral assets in a liquidation opportunity have fresh live prices
   */
  public arePricesFreshForOpportunity(
    opportunity: {
      debtCoinType: string;
      collateralCoinType: string;
      obligation: {
        collaterals: { coinType: string }[];
        debts: { coinType: string }[];
      };
    },
    maxAgeMs: number = 60_000
  ): boolean {
    const coinTypes = [
      opportunity.debtCoinType,
      opportunity.collateralCoinType,
      ...opportunity.obligation.collaterals.map((c) => c.coinType),
      ...opportunity.obligation.debts.map((d) => d.coinType),
    ];
    const uniqueCoins = Array.from(new Set(coinTypes));
    return this.arePricesFresh(uniqueCoins, maxAgeMs);
  }
}

export const priceCache = PriceCache.getInstance();
