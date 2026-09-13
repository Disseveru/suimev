import { describe, it, expect } from 'vitest';
import { EvmHealthFactorEngine, EvmObligationState } from '../src/oracles/healthFactor.js';
import { EvmTxBuilder } from '../src/engine/txBuilder.js';

describe('EVM Health Factor & Opportunity Engine', () => {
  it('should accurately calculate health factor and detect liquidation state', () => {
    const obl: EvmObligationState = {
      borrower: '0x1111111111111111111111111111111111111111',
      collaterals: [
        {
          asset: '0x0000000000000000000000000000000000000002',
          symbol: 'SEI',
          decimals: 18,
          amount: 1000n * 10n ** 18n, // 1000 SEI * $0.40 = $400 USD
          priceUsd: 0.40,
          valueUsd: 0,
          liquidationThreshold: 0.80, // $320 max borrow
        },
      ],
      debts: [
        {
          asset: '0x0000000000000000000000000000000000000003',
          symbol: 'USDC',
          decimals: 6,
          amount: 350n * 10n ** 6n, // 350 USDC = $350 debt
          priceUsd: 1.00,
          valueUsd: 0,
        },
      ],
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      liquidationThresholdCollateralUsd: 0,
      healthFactor: 1.0,
      isLiquidatable: false,
    };

    EvmHealthFactorEngine.evaluateObligation(obl);
    // HF = $320 / $350 = ~0.914
    expect(obl.healthFactor).toBeLessThan(1.0);
    expect(obl.isLiquidatable).toBe(true);

    const opp = EvmHealthFactorEngine.findBestOpportunity(obl, 0.50, 0.05);
    expect(opp).not.toBeNull();
    // 50% close factor on 350 USDC = 175 USDC to repay
    expect(opp?.debtAmountToRepay).toBe(175n * 10n ** 6n);
    expect(opp?.expectedGrossProfitUsd).toBeGreaterThan(0);
  });

  it('should scale down debt repayment when collateral is the constraining factor', () => {
    const obl: EvmObligationState = {
      borrower: '0x2222222222222222222222222222222222222222',
      collaterals: [
        {
          asset: '0x0000000000000000000000000000000000000002',
          symbol: 'SEI',
          decimals: 18,
          amount: 100n * 10n ** 18n, // Only 100 SEI ($40 USD)
          priceUsd: 0.40,
          valueUsd: 0,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          asset: '0x0000000000000000000000000000000000000003',
          symbol: 'USDC',
          decimals: 6,
          amount: 1000n * 10n ** 6n, // $1000 USDC debt (50% close factor would be $500, but user only has $40 col!)
          priceUsd: 1.00,
          valueUsd: 0,
        },
      ],
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      liquidationThresholdCollateralUsd: 0,
      healthFactor: 1.0,
      isLiquidatable: false,
    };

    EvmHealthFactorEngine.evaluateObligation(obl);
    const opp = EvmHealthFactorEngine.findBestOpportunity(obl, 0.50, 0.05);

    expect(opp).not.toBeNull();
    // Repayment should be scaled down so it does NOT exceed available collateral value
    expect(opp?.debtRepayUsd).toBeLessThan(40);
    expect(opp?.collateralToReceive).toBe(100n * 10n ** 18n); // Seizes all 100 SEI
  });

  it('should encode FlashLiquidator calldata correctly', () => {
    const opp = {
      borrower: '0x1111111111111111111111111111111111111111' as `0x${string}`,
      debtAsset: '0x3333333333333333333333333333333333333333' as `0x${string}`,
      debtSymbol: 'USDC',
      collateralAsset: '0x4444444444444444444444444444444444444444' as `0x${string}`,
      collateralSymbol: 'WETH',
      debtAmountToRepay: 500n * 10n ** 6n,
      collateralToReceive: 2n * 10n ** 17n,
      debtRepayUsd: 500,
      collateralReceiveUsd: 525,
      expectedGrossProfitUsd: 25,
      estimatedGasCostUsd: 0.005,
      netProfitUsd: 24.995,
    };

    const call = EvmTxBuilder.buildLiquidationCalldata(opp, '0x5555555555555555555555555555555555555555');
    expect(call.data).toBeDefined();
    expect(call.data.startsWith('0x')).toBe(true);
  });
});
