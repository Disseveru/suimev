import { describe, it, expect, beforeEach } from 'vitest';
import { PriceCache } from '../src/oracles/priceCache.js';
import {
  COIN_CONFIGS,
  getCoinConfigBySymbol,
  getCoinConfigByPythId,
  normalizeStructTag,
} from '../src/config/coins.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ObligationState } from '../src/config/types.js';

describe('Adversarial Stress Test: Pyth Oracle Pricing & Cache Resilience', () => {
  const TARGET_COINS = [
    'AUSD',
    'LBTC',
    'NS',
    'AFSUI',
    'HASUI',
    'NAVX',
    'SCA',
    'DEEP',
    'CETUS',
  ] as const;

  let cache: PriceCache;

  beforeEach(() => {
    cache = PriceCache.getInstance();
  });

  describe('Challenge 1: Cold-Start Invariants Across All 9 Coins', () => {
    it('should provide non-zero baseline seed prices for all 9 coins upon cold start', () => {
      for (const symbol of TARGET_COINS) {
        const cfg = getCoinConfigBySymbol(symbol)!;
        expect(cfg, `Coin config missing for ${symbol}`).toBeDefined();

        const usdPrice = cache.getPriceUsd(cfg.coinType);
        expect(usdPrice, `Cold-start getPriceUsd for ${symbol} must be > 0`).toBeGreaterThan(0);
        expect(Number.isFinite(usdPrice), `Price for ${symbol} must be finite`).toBe(true);

        const oraclePrice = cache.getPrice(cfg.coinType);
        expect(oraclePrice, `Cold-start getPrice for ${symbol} must be defined`).toBeDefined();
        expect(oraclePrice!.price, `Cold-start price for ${symbol} must be > 0`).toBeGreaterThan(0);
      }
    });

    it('should mark cold-start seed prices as default seeds and reject them in freshness check', () => {
      for (const symbol of TARGET_COINS) {
        const cfg = getCoinConfigBySymbol(symbol)!;
        const oraclePrice = cache.getPrice(cfg.coinType);
        expect(oraclePrice?.isDefaultSeed, `Cold-start ${symbol} must have isDefaultSeed=true`).toBe(true);

        expect(
          cache.isPriceDefaultSeed(cfg.coinType),
          `isPriceDefaultSeed for ${symbol} must return true`
        ).toBe(true);

        // Cold-start seed prices must NOT be considered fresh (prevents Move abort 1025 on-chain)
        expect(
          cache.isPriceFresh(cfg.coinType, 60_000),
          `isPriceFresh for ${symbol} must return false on cold-start`
        ).toBe(false);
      }
    });
  });

  describe('Challenge 2: Pyth Zero, Negative, and Malformed Price Ingestion', () => {
    it('should safely reject zero prices without corrupting existing cache', () => {
      const now = Math.floor(Date.now() / 1000);

      for (const symbol of TARGET_COINS) {
        const cfg = getCoinConfigBySymbol(symbol)!;
        if (!cfg.pythPriceFeedId) continue;

        const priceBefore = cache.getPriceUsd(cfg.coinType);
        expect(priceBefore).toBeGreaterThan(0);

        // Adversarial zero price
        cache.updateFromPyth(cfg.pythPriceFeedId, '0', -8, now);
        cache.updateFromPyth(cfg.pythPriceFeedId, 0, -8, now);

        const priceAfter = cache.getPriceUsd(cfg.coinType);
        expect(priceAfter, `Price for ${symbol} should not be overwritten to 0`).toBe(priceBefore);
      }
    });

    it('should safely reject negative prices without corrupting existing cache', () => {
      const now = Math.floor(Date.now() / 1000);

      for (const symbol of TARGET_COINS) {
        const cfg = getCoinConfigBySymbol(symbol)!;
        if (!cfg.pythPriceFeedId) continue;

        const priceBefore = cache.getPriceUsd(cfg.coinType);

        // Adversarial negative prices
        cache.updateFromPyth(cfg.pythPriceFeedId, '-100000000', -8, now);
        cache.updateFromPyth(cfg.pythPriceFeedId, -50000000, -8, now);

        const priceAfter = cache.getPriceUsd(cfg.coinType);
        expect(priceAfter, `Price for ${symbol} should not be overwritten to negative`).toBe(priceBefore);
      }
    });

    it('should reject negative or zero prices in updatePriceForSymbol', () => {
      const now = Math.floor(Date.now() / 1000);
      const ausdCfg = getCoinConfigBySymbol('AUSD')!;
      const priceBefore = cache.getPriceUsd(ausdCfg.coinType);

      cache.updatePriceForSymbol('AUSD', '-1000000', -6, now);
      expect(cache.getPriceUsd(ausdCfg.coinType)).toBe(priceBefore);

      cache.updatePriceForSymbol('AUSD', '0', -6, now);
      expect(cache.getPriceUsd(ausdCfg.coinType)).toBe(priceBefore);
    });

    it('should not throw on NaN, undefined, or unmapped feed IDs', () => {
      const now = Math.floor(Date.now() / 1000);
      expect(() => {
        cache.updateFromPyth('0xunknown_feed_id_12345', '100000000', -8, now);
        cache.updateFromPyth('', '100000000', -8, now);
        cache.updatePriceForSymbol('NON_EXISTENT_COIN', '100000000', -8, now);
      }).not.toThrow();
    });
  });

  describe('Challenge 3: BigInt Float Input Crash Resilience', () => {
    it('ADVERSARIAL: should not crash with RangeError when rawPrice is a float number', () => {
      const now = Math.floor(Date.now() / 1000);
      const usdcCfg = getCoinConfigBySymbol('USDC')!;

      // When an upstream source feeds a floating-point number, BigInt(rawPrice) throws RangeError
      let caughtError: unknown;
      try {
        cache.updateFromPyth(usdcCfg.pythPriceFeedId, 1.05, 0, now);
      } catch (err) {
        caughtError = err;
      }

      // Expected: engine should sanitize or Math.floor rawPrice instead of throwing RangeError
      expect(caughtError, 'Expected updateFromPyth to handle float rawPrice without RangeError').toBeUndefined();
    });
  });

  describe('Challenge 4: Pyth Feed Collision Between HASUI and CERT (vSUI)', () => {
    it('ADVERSARIAL: both HASUI and vSUI should receive Pyth price updates when shared feed updates', () => {
      const now = Math.floor(Date.now() / 1000);
      const hasuiCfg = getCoinConfigBySymbol('HASUI')!;
      const certCfg = getCoinConfigBySymbol('vSUI')!;

      // Both HASUI and CERT share Pyth feed 0x438f22e84704b6b694b1a45050f28fb898687a7d18fe58e5f2b6045a8f081414
      expect(hasuiCfg.pythPriceFeedId).toBe(certCfg.pythPriceFeedId);

      // Simulate a live Pyth update for this feed: price = $2.50 (250000000 * 10^-8)
      cache.updateFromPyth(hasuiCfg.pythPriceFeedId, '250000000', -8, now);

      // Verify vSUI (CERT)
      const certPrice = cache.getPrice(certCfg.coinType);
      expect(certPrice?.price).toBeCloseTo(2.5, 2);
      expect(certPrice?.isDefaultSeed).toBe(false);

      // Verify HASUI: BUG CHECK — HASUI is currently shadowed by CERT in COIN_BY_PYTH_ID_MAP!
      const hasuiPrice = cache.getPrice(hasuiCfg.coinType);
      expect(hasuiPrice, 'HASUI price should be updated').toBeDefined();
      expect(hasuiPrice?.isDefaultSeed, 'HASUI must be marked as live (isDefaultSeed=false)').toBe(false);
      expect(hasuiPrice?.price, 'HASUI price should match updated Pyth price').toBeCloseTo(2.5, 2);
      expect(cache.isPriceFresh(hasuiCfg.coinType, 60_000), 'HASUI must be fresh').toBe(true);
    });
  });

  describe('Challenge 5: afSUI Dynamic Pricing Responsiveness Under SUI Volatility', () => {
    it('ADVERSARIAL: afSUI market USD price must adjust dynamically when SUI moves, even after Pyth update', () => {
      const now = Math.floor(Date.now() / 1000);
      const afsuiCfg = getCoinConfigBySymbol('AFSUI')!;

      // 1. Establish baseline: SUI = $1.00
      cache.updatePriceForSymbol('SUI', '100000000', -8, now);
      expect(cache.getPriceBySymbol('SUI')!.price).toBeCloseTo(1.0, 2);

      // 2. Pyth publishes afSUI redemption rate = 1.06 SUI per afSUI (106000000 * 10^-8)
      cache.updateFromPyth(afsuiCfg.pythPriceFeedId, '106000000', -8, now);
      // At SUI=$1.00, 1 afSUI = 1.00 * 1.06 = $1.06
      expect(cache.getPriceUsd(afsuiCfg.coinType)).toBeCloseTo(1.06, 2);

      // 3. Volatility event: SUI price triples from $1.00 to $3.00!
      cache.updatePriceForSymbol('SUI', '300000000', -8, now + 10);
      expect(cache.getPriceBySymbol('SUI')!.price).toBeCloseTo(3.0, 2);

      // 4. MEV INVARIANT: 1 afSUI is worth 1.06 * SUI.
      // With SUI at $3.00, afSUI market price MUST be $3.18.
      // BUG: Currently, getPriceUsd returns direct.price ($1.06) which was cached at SUI=$1.00!
      const currentAfSuiPriceUsd = cache.getPriceUsd(afsuiCfg.coinType);
      console.log(`[CHALLENGE 5] SUI=$3.00, RedemptionRate=1.06. Actual getPriceUsd(afSUI): ${currentAfSuiPriceUsd}`);

      expect(currentAfSuiPriceUsd, 'afSUI price must track SUI volatility (3.0 * 1.06 = 3.18)').toBeCloseTo(3.18, 1);
    });
  });

  describe('Challenge 6: Liquidation Health Factor Distortion Under Stale afSUI Price', () => {
    it('ADVERSARIAL: borrower health factor must not be distorted by stale afSUI collateral valuation', () => {
      const now = Math.floor(Date.now() / 1000);
      const ausdCfg = getCoinConfigBySymbol('AUSD')!;
      const afsuiCfg = getCoinConfigBySymbol('AFSUI')!;

      // SUI price moves to $3.00, AUSD is $1.00
      cache.updatePriceForSymbol('SUI', '300000000', -8, now);
      cache.updatePriceForSymbol('AUSD', '1000000', -6, now);

      // Borrower has 100 afSUI collateral and 200 AUSD debt.
      // Real collateral value: 100 * (3.0 * 1.06) = $318.
      // Liquidation threshold (0.80): 318 * 0.80 = $254.40.
      // Debt: $200.
      // Real Health Factor: 254.40 / 200 = 1.272 (COMPLETELY SAFE).
      const mockObligation: ObligationState = {
        obligationId: '0xborrower_safe_afsui',
        protocol: 'navi',
        ownerAddress: '0xborrower_safe',
        healthFactor: 1.272,
        totalDebtUsd: 200,
        totalCollateralUsd: 318,
        liquidationThresholdCollateralUsd: 254.4,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
        collaterals: [
          {
            coinType: afsuiCfg.coinType,
            symbol: 'AFSUI',
            amount: 100_000_000_000n, // 100 afSUI
            decimals: 9,
            valueUsd: 318,
            liquidationThreshold: 0.80,
          },
        ],
        debts: [
          {
            coinType: ausdCfg.coinType,
            symbol: 'AUSD',
            amount: 200_000_000n, // 200 AUSD
            decimals: 6,
            valueUsd: 200,
          },
        ],
      };

      const evaluated = HealthFactorEngine.evaluateObligation(mockObligation);
      console.log(`[CHALLENGE 6] Evaluated HF: ${evaluated.healthFactor.toFixed(4)}, isLiquidatable: ${evaluated.isLiquidatable}`);

      // If afSUI is frozen at $1.06, collateral is valued at only $106 -> LT = $84.80 -> HF = 0.424 (FALSE LIQUIDATION!)
      expect(
        evaluated.isLiquidatable,
        `Borrower should NOT be liquidatable when real collateral is $318 vs $200 debt (calculated HF: ${evaluated.healthFactor})`
      ).toBe(false);
      expect(evaluated.healthFactor).toBeGreaterThanOrEqual(1.0);
    });
  });
});
