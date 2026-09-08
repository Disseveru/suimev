import { describe, it, expect, beforeEach } from 'vitest';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { ObligationState } from '../src/config/types.js';

describe('HealthFactorEngine', () => {
  beforeEach(() => {
    // Seed price cache with known values
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: '0x2::sui::SUI',
      price: 2.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 200_000_000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'USDC',
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      price: 1.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 100_000_000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });
  });

  it('should calculate health factor > 1.0 for safely collateralized account', () => {
    // 1000 SUI collateral ($2000) with 80% LT = $1600 risk-adjusted collateral
    // 1000 USDC debt ($1000)
    // Expected HF = 1600 / 1000 = 1.6 > 1.0
    const obligation: ObligationState = {
      protocol: 'navi',
      obligationId: '0xSafeUser',
      ownerAddress: '0xSafeUser',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 1000_000_000_000n, // 1000 SUI (9 decimals)
          decimals: 9,
          valueUsd: 0,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 1000_000_000n, // 1000 USDC (6 decimals)
          decimals: 6,
          valueUsd: 0,
        },
      ],
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      liquidationThresholdCollateralUsd: 0,
      healthFactor: Infinity,
      isLiquidatable: false,
      lastUpdatedMs: 0,
    };

    const evaluated = HealthFactorEngine.evaluateObligation(obligation);

    expect(evaluated.totalCollateralUsd).toBeCloseTo(2000.0, 1);
    expect(evaluated.totalDebtUsd).toBeCloseTo(1000.0, 1);
    expect(evaluated.liquidationThresholdCollateralUsd).toBeCloseTo(1600.0, 1);
    expect(evaluated.healthFactor).toBeCloseTo(1.6, 2);
    expect(evaluated.isLiquidatable).toBe(false);
  });

  it('should detect undercollateralized account when HF < 1.0', () => {
    // 1000 SUI collateral ($2000) with 80% LT = $1600 risk-adjusted collateral
    // 1800 USDC debt ($1800)
    // Expected HF = 1600 / 1800 = 0.888 < 1.0 -> Liquidatable!
    const obligation: ObligationState = {
      protocol: 'navi',
      obligationId: '0xBadUser',
      ownerAddress: '0xBadUser',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 1000_000_000_000n,
          decimals: 9,
          valueUsd: 0,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 1800_000_000n,
          decimals: 6,
          valueUsd: 0,
        },
      ],
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      liquidationThresholdCollateralUsd: 0,
      healthFactor: Infinity,
      isLiquidatable: false,
      lastUpdatedMs: 0,
    };

    const evaluated = HealthFactorEngine.evaluateObligation(obligation);

    expect(evaluated.healthFactor).toBeCloseTo(0.8888, 2);
    expect(evaluated.isLiquidatable).toBe(true);

    // Should find best liquidation opportunity
    const opportunity = HealthFactorEngine.findBestLiquidationOpportunity(evaluated, 0.50);
    expect(opportunity).not.toBeNull();
    if (opportunity) {
      // 50% close factor on 1800 USDC = 900 USDC repay
      expect(opportunity.debtSymbol).toBe('USDC');
      expect(opportunity.debtAmountToRepay).toBe(900_000_000n);
      expect(opportunity.debtRepayUsd).toBeCloseTo(900, 1);

      // SUI bonus is 5%, so seized collateral value = 900 * 1.05 = $945
      expect(opportunity.collateralReceiveUsd).toBeCloseTo(945, 1);
      // Expected gross profit = 945 - 900 = $45
      expect(opportunity.expectedGrossProfitUsd).toBeCloseTo(45, 1);
    }
  });

  it('should return infinity HF when debt is zero', () => {
    const obligation: ObligationState = {
      protocol: 'navi',
      obligationId: '0xNoDebt',
      ownerAddress: '0xNoDebt',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 500_000_000_000n,
          decimals: 9,
          valueUsd: 0,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [],
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      liquidationThresholdCollateralUsd: 0,
      healthFactor: 0,
      isLiquidatable: false,
      lastUpdatedMs: 0,
    };

    const evaluated = HealthFactorEngine.evaluateObligation(obligation);
    expect(evaluated.healthFactor).toBe(Infinity);
    expect(evaluated.isLiquidatable).toBe(false);
  });

  it('should scale down debt repayment amount when user collateral is the constraining factor', () => {
    // Borrower has 50 SUI collateral ($100 USD)
    // Borrower has 1000 USDC debt ($1000 USD)
    // 50% close factor would normally suggest repaying 500 USDC ($500)
    // BUT the borrower only has $100 worth of collateral!
    // SUI liquidation bonus is 5% -> $100 collateral can only cover $100 / 1.05 = $95.238 USDC of debt!
    // The engine must scale debtAmountToRepay down to ~95.23 USDC to prevent over-repayment losses!
    const constrainedObligation: ObligationState = {
      protocol: 'navi',
      obligationId: '0xConstrainedBorrower',
      ownerAddress: '0xConstrainedBorrower',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 50_000_000_000n, // 50 SUI = $100 USD
          decimals: 9,
          valueUsd: 100,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 1000_000_000n, // 1000 USDC
          decimals: 6,
          valueUsd: 1000,
        },
      ],
      totalCollateralUsd: 100,
      totalDebtUsd: 1000,
      liquidationThresholdCollateralUsd: 80,
      healthFactor: 0.08,
      isLiquidatable: true,
      lastUpdatedMs: 0,
    };

    const evaluated = HealthFactorEngine.evaluateObligation(constrainedObligation);
    expect(evaluated.isLiquidatable).toBe(true);

    const opp = HealthFactorEngine.findBestLiquidationOpportunity(evaluated, 0.50);
    expect(opp).not.toBeNull();
    if (opp) {
      // Must seize ALL available 50 SUI collateral
      expect(opp.collateralToReceive).toBe(50_000_000_000n);
      expect(opp.collateralReceiveUsd).toBeCloseTo(100.0, 1);

      // Repay amount must be scaled down to ~$95.23 (95_238_095 units), NOT 500 USDC!
      expect(opp.debtRepayUsd).toBeLessThan(100.0);
      expect(opp.debtRepayUsd).toBeCloseTo(95.23, 1);
      expect(opp.debtAmountToRepay).toBeLessThan(100_000_000n);
      // Expected gross profit must remain positive (~$4.76)
      expect(opp.expectedGrossProfitUsd).toBeGreaterThan(0);
      expect(opp.expectedGrossProfitUsd).toBeCloseTo(4.76, 1);
    }
  });
});
