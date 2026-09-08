import { describe, it, expect, beforeAll } from 'vitest';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { LiquidationOpportunity, ObligationState } from '../src/config/types.js';

describe('ZeroCapitalPtbBuilder', () => {
  beforeAll(async () => {
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

    await naviProtocol.initialize();
  });

  it('should construct a valid zero-capital PTB for NAVI liquidation', () => {
    const mockObligation: ObligationState = {
      protocol: 'navi',
      obligationId: '0x0000000000000000000000000000000000000000000000000000000000000abc',
      ownerAddress: '0x0000000000000000000000000000000000000000000000000000000000000abc',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 500_000_000_000n,
          decimals: 9,
          valueUsd: 1000,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 850_000_000n,
          decimals: 6,
          valueUsd: 850,
        },
      ],
      totalCollateralUsd: 1000,
      totalDebtUsd: 850,
      liquidationThresholdCollateralUsd: 800,
      healthFactor: 0.941,
      isLiquidatable: true,
      lastUpdatedMs: Date.now(),
    };

    const opportunity: LiquidationOpportunity = {
      protocol: 'navi',
      obligation: mockObligation,
      debtCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      debtSymbol: 'USDC',
      debtAmountToRepay: 400_000_000n, // Repay 400 USDC
      debtRepayUsd: 400,
      collateralCoinType: '0x2::sui::SUI',
      collateralSymbol: 'SUI',
      collateralToReceive: 210_000_000_000n, // Receive 210 SUI ($420)
      collateralReceiveUsd: 420,
      expectedGrossProfitUsd: 20,
      dex: 'cetus',
      liquidationBonus: 0.05,
    };

    const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opportunity);

    expect(built).toBeDefined();
    expect(built.tx).toBeDefined();
    expect(built.opportunity.protocol).toBe('navi');

    // Serialize PTB JSON representation to inspect chained Move calls
    const txData = built.tx.getData();
    expect(txData.commands.length).toBeGreaterThanOrEqual(4);

    // Verify presence of MoveCall, SplitCoins, and TransferObjects
    const commandKinds = txData.commands.map((c) => c.$kind);
    expect(commandKinds).toContain('MoveCall');
    expect(commandKinds).toContain('SplitCoins');
    expect(commandKinds).toContain('TransferObjects');
  });

  it('should construct a valid zero-capital PTB for Scallop liquidation', () => {
    const mockObligation: ObligationState = {
      protocol: 'scallop',
      obligationId: '0x0000000000000000000000000000000000000000000000000000000000000123',
      ownerAddress: '0x0000000000000000000000000000000000000000000000000000000000000123',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 500_000_000_000n,
          decimals: 9,
          valueUsd: 1000,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 850_000_000n,
          decimals: 6,
          valueUsd: 850,
        },
      ],
      totalCollateralUsd: 1000,
      totalDebtUsd: 850,
      liquidationThresholdCollateralUsd: 800,
      healthFactor: 0.941,
      isLiquidatable: true,
      lastUpdatedMs: Date.now(),
    };

    const opportunity: LiquidationOpportunity = {
      protocol: 'scallop',
      obligation: mockObligation,
      debtCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      debtSymbol: 'USDC',
      debtAmountToRepay: 400_000_000n,
      debtRepayUsd: 400,
      collateralCoinType: '0x2::sui::SUI',
      collateralSymbol: 'SUI',
      collateralToReceive: 210_000_000_000n,
      collateralReceiveUsd: 420,
      expectedGrossProfitUsd: 20,
      dex: 'deepbook',
      liquidationBonus: 0.05,
    };

    const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opportunity);
    expect(built).toBeDefined();
    const txData = built.tx.getData();
    expect(txData.commands.length).toBeGreaterThanOrEqual(4);
  });
});
