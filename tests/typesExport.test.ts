import { describe, it, expect } from 'vitest';
import * as canonicalTypes from '../src/types/index.js';
import * as legacyConfigTypes from '../src/config/types.js';

describe('Type System & Canonical Exports (R3)', () => {
  it('should re-export identical types and members between src/types and src/config/types', () => {
    // Both modules should exist and export their respective interfaces
    expect(canonicalTypes).toBeDefined();
    expect(legacyConfigTypes).toBeDefined();

    // Verify key export mappings exist in canonical barrel
    const canonicalKeys = Object.keys(canonicalTypes);
    const legacyKeys = Object.keys(legacyConfigTypes);

    expect(canonicalKeys).toEqual(legacyKeys);
  });

  it('should validate shape and runtime properties of obligation record types', () => {
    const mockObligation: canonicalTypes.ObligationState = {
      protocol: 'scallop',
      obligationId: '0x123',
      ownerAddress: '0xabc',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 1000000000n,
          decimals: 9,
          valueUsd: 2.5,
          liquidationThreshold: 0.8,
        },
      ],
      debts: [
        {
          coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
          symbol: 'USDC',
          amount: 1000000n,
          decimals: 6,
          valueUsd: 1.0,
        },
      ],
      totalCollateralUsd: 2.5,
      totalDebtUsd: 1.0,
      liquidationThresholdCollateralUsd: 2.0,
      healthFactor: 2.0,
      isLiquidatable: false,
      lastUpdatedMs: Date.now(),
    };

    expect(mockObligation.protocol).toBe('scallop');
    expect(mockObligation.healthFactor).toBeGreaterThan(1.0);
    expect(mockObligation.collaterals[0].amount).toBe(1000000000n);
  });

  it('should validate liquidation opportunity and simulation result structures', () => {
    const mockOpportunity: canonicalTypes.LiquidationOpportunity = {
      protocol: 'navi',
      obligation: {
        protocol: 'navi',
        obligationId: '0x1111222233334444555566667777888899990000',
        ownerAddress: '0x2222333344445555666677778888999900001111',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 100,
        totalDebtUsd: 120,
        liquidationThresholdCollateralUsd: 80,
        healthFactor: 0.67,
        isLiquidatable: true,
        lastUpdatedMs: Date.now(),
      },
      debtCoinType: '0x2::sui::SUI',
      debtSymbol: 'SUI',
      debtAmountToRepay: 500000000n,
      debtRepayUsd: 1.25,
      collateralCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      collateralSymbol: 'USDC',
      collateralToReceive: 1350000n,
      collateralReceiveUsd: 1.35,
      expectedGrossProfitUsd: 0.1,
      dex: 'cetus',
      liquidationBonus: 0.05,
    };

    const mockSim: canonicalTypes.SimulationResult = {
      success: true,
      opportunity: mockOpportunity,
      gasUsedSui: 0.005,
      gasCostUsd: 0.0125,
      netProfitUsd: 0.0875,
      netProfitSui: 0.035,
      isProfitable: true,
    };

    expect(mockSim.isProfitable).toBe(true);
    expect(mockSim.netProfitUsd).toBeCloseTo(0.0875);
  });

  it('should validate canonical NaviPoolInfo typing across canonical and legacy modules', () => {
    const canonicalPool: canonicalTypes.NaviPoolInfo = {
      id: 0,
      coinType: '0x2::sui::SUI',
      symbol: 'SUI',
      poolContract: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5',
      reserveBalance: 1000000000n,
      borrowFeeBps: 0,
      supplyApy: 0.05,
      borrowApy: 0.08,
      flashloanEnabled: true,
      liquidationBonus: 0.10,
      liquidationRatio: 0.35,
      liquidationThreshold: 0.80,
      oracleId: 0,
    };

    const legacyPool: legacyConfigTypes.NaviPoolInfo = canonicalPool;
    expect(legacyPool.id).toBe(0);
    expect(legacyPool.poolContract).toBe(canonicalPool.poolContract);
    expect(legacyPool.coinType).toBe('0x2::sui::SUI');
  });
});
