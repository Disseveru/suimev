import { afterEach, describe, it, expect, vi } from 'vitest';
import { PreFlightSimulator } from '../src/engine/simulator.js';
import { rpcManager } from '../src/client/suiClient.js';
import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, ObligationState } from '../src/config/types.js';

describe('PreFlightSimulator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockObligation: ObligationState = {
    protocol: 'navi',
    obligationId: '0x123',
    ownerAddress: '0x123',
    collaterals: [],
    debts: [],
    totalCollateralUsd: 1000,
    totalDebtUsd: 900,
    liquidationThresholdCollateralUsd: 800,
    healthFactor: 0.888,
    isLiquidatable: true,
    lastUpdatedMs: Date.now(),
  };

  const mockOpportunity: LiquidationOpportunity = {
    protocol: 'navi',
    obligation: mockObligation,
    debtCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    debtSymbol: 'USDC',
    debtAmountToRepay: 100_000_000n,
    debtRepayUsd: 100,
    collateralCoinType: '0x2::sui::SUI',
    collateralSymbol: 'SUI',
    collateralToReceive: 52_500_000_000n,
    collateralReceiveUsd: 105,
    expectedGrossProfitUsd: 5.0, // $5.00 gross profit
    dex: 'cetus',
    liquidationBonus: 0.05,
  };

  it('should approve profitable liquidation when net profit exceeds threshold', async () => {
    // Mock devInspectTransactionBlock success response
    vi.spyOn(rpcManager, 'executeWithFallback').mockResolvedValueOnce({
      effects: {
        status: { status: 'success' },
        gasUsed: {
          computationCost: '2000000', // 0.002 SUI (~$0.005)
          storageCost: '1000000',
          storageRebate: '1000000',
        },
      },
    } as any);

    const tx = new Transaction();
    const result = await PreFlightSimulator.simulate(tx, mockOpportunity);

    expect(result.success).toBe(true);
    expect(result.isProfitable).toBe(true);
    expect(result.netProfitUsd).toBeGreaterThan(2.0); // MIN_PROFIT_USD is $2.0
  });

  it('should reject liquidation when transaction status reverts on-chain', async () => {
    vi.spyOn(rpcManager, 'executeWithFallback').mockResolvedValueOnce({
      effects: {
        status: { status: 'failure', error: 'MoveAbort(0x...::lending, 1001)' },
      },
    } as any);

    const tx = new Transaction();
    const result = await PreFlightSimulator.simulate(tx, mockOpportunity);

    expect(result.success).toBe(false);
    expect(result.isProfitable).toBe(false);
    expect(result.errorMessage).toContain('MoveAbort');
  });

  it('should keep one-shot RPC mocks isolated across consecutive simulations', async () => {
    const executeWithFallback = vi
      .spyOn(rpcManager, 'executeWithFallback')
      .mockResolvedValueOnce({
        effects: {
          status: { status: 'failure', error: 'First simulation reverted' },
        },
      } as any)
      .mockResolvedValueOnce({
        effects: {
          status: { status: 'success' },
          gasUsed: {
            computationCost: '0',
            storageCost: '0',
            storageRebate: '0',
          },
        },
      } as any);

    const firstResult = await PreFlightSimulator.simulate(new Transaction(), mockOpportunity);
    const secondResult = await PreFlightSimulator.simulate(new Transaction(), mockOpportunity);

    expect(executeWithFallback).toHaveBeenCalledTimes(2);
    expect(firstResult).toMatchObject({
      success: false,
      isProfitable: false,
      errorMessage: 'First simulation reverted',
    });
    expect(secondResult).toMatchObject({
      success: true,
      isProfitable: true,
    });
    expect(secondResult).not.toHaveProperty('errorMessage');
  });

  it.each([
    { rejection: new Error('RPC request timed out'), expectedMessage: 'RPC request timed out' },
    { rejection: 'transport disconnected', expectedMessage: 'transport disconnected' },
  ])(
    'should normalize rejected RPC values into failed simulation results ($expectedMessage)',
    async ({ rejection, expectedMessage }) => {
      vi.spyOn(rpcManager, 'executeWithFallback').mockRejectedValueOnce(rejection);

      const result = await PreFlightSimulator.simulate(new Transaction(), mockOpportunity);

      expect(result).toMatchObject({
        success: false,
        opportunity: mockOpportunity,
        gasUsedSui: 0,
        gasCostUsd: 0,
        netProfitUsd: 0,
        netProfitSui: 0,
        isProfitable: false,
        errorMessage: expectedMessage,
        simulationType: 'devInspect',
      });
    }
  );

  it('should reject liquidation when gas cost outweighs gross profit', async () => {
    // High gas fee simulating network congestion: 3 SUI gas fee (~$7.50 USD) > $5.00 profit
    vi.spyOn(rpcManager, 'executeWithFallback').mockResolvedValueOnce({
      effects: {
        status: { status: 'success' },
        gasUsed: {
          computationCost: '10000000000', // 10 SUI (> $5.00 profit)
          storageCost: '0',
          storageRebate: '0',
        },
      },
    } as any);

    const tx = new Transaction();
    const result = await PreFlightSimulator.simulate(tx, mockOpportunity);

    expect(result.success).toBe(true);
    expect(result.isProfitable).toBe(false); // Net profit is negative!
    expect(result.netProfitUsd).toBeLessThan(0);
  });
});
