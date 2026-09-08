import { describe, it, expect } from 'vitest';
import { priceCache } from '../src/oracles/priceCache.js';
import { obligationRegistry } from '../src/engine/registry.js';
import { ObligationState } from '../src/config/types.js';

describe('PriceCache & Oracle Pipeline', () => {
  it('should store and retrieve normalized USD prices', () => {
    priceCache.updateFromPyth(
      '0x23d731513e78642a6b3076878b31a196142ae58914b4fb2c65a08332d72f96cf',
      '312450000',
      -8,
      1700000000
    );

    const suiPrice = priceCache.getPriceBySymbol('SUI');
    expect(suiPrice).toBeDefined();
    expect(suiPrice?.price).toBeCloseTo(3.1245, 4);
    expect(priceCache.getPriceUsd('0x2::sui::SUI')).toBeCloseTo(3.1245, 4);
  });

  it('should re-evaluate hot watchlist when prices change', () => {
    // SUI at $2.00
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: '0x2::sui::SUI',
      price: 2.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 200000000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });

    // 1000 SUI collateral ($2000) with 80% LT = $1600 risk-adjusted
    // 1550 USDC debt -> HF = 1600 / 1550 = 1.032 -> Placed in Hot Watchlist!
    const borderlineObligation: ObligationState = {
      protocol: 'navi',
      obligationId: '0xBorderline',
      ownerAddress: '0xBorderline',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 1000_000_000_000n,
          decimals: 9,
          valueUsd: 2000,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 1550_000_000n,
          decimals: 6,
          valueUsd: 1550,
        },
      ],
      totalCollateralUsd: 2000,
      totalDebtUsd: 1550,
      liquidationThresholdCollateralUsd: 1600,
      healthFactor: 1.032,
      isLiquidatable: false,
      lastUpdatedMs: Date.now(),
    };

    obligationRegistry.upsertObligation(borderlineObligation);

    const countsBefore = obligationRegistry.getCounts();
    expect(countsBefore.hot).toBeGreaterThanOrEqual(1);

    // Simulate market price drop: SUI drops from $2.00 to $1.90
    // Collateral value = $1900, LT collateral = $1520
    // Debt = $1550 -> HF = 1520 / 1550 = 0.9806 < 1.0 -> Newly undercollateralized!
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: '0x2::sui::SUI',
      price: 1.90,
      confidence: 0,
      exponent: -8,
      rawPrice: 190000000n,
      publishTime: 1700000100,
      lastUpdatedMs: Date.now(),
    });

    const newlyLiquidatable = obligationRegistry.reevaluateHotWatchlist();
    expect(newlyLiquidatable.length).toBeGreaterThanOrEqual(1);
    expect(newlyLiquidatable[0].healthFactor).toBeLessThan(1.0);
    expect(newlyLiquidatable[0].isLiquidatable).toBe(true);
  });
});
