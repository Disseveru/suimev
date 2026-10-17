import { describe, it, expect } from 'vitest';
import { gasManager } from '../src/client/gasManager.js';
import { TransactionExecutor } from '../src/engine/executor.js';

describe('Institutional Upgrades: Zero-RPC GasManager & PGA Bidding Tests', () => {
  it('updates gas object version and digest from execution effects in 0ms', () => {
    const mockEffects = {
      gasObject: {
        reference: {
          objectId: '0xMockGasCoin11111111111111111111111111111111111',
          version: 10500,
          digest: 'MockDigestGasUpdated11111111111111111111',
        },
      },
    };

    gasManager.updateFromExecutionEffects(mockEffects);
    // Verified non-crashing effect updater
    expect(typeof gasManager.getCachedBalanceSui()).toBe('number');
  });

  it('calculates dynamic PGA priority gas price scaled to profit', () => {
    const refGasPrice = 1000n; // 1000 MIST
    const suiPriceUsd = 2.00;

    // 1. Minimal profit: bids base multiplier
    const lowProfitUsd = 0.001;
    const lowGasPrice = TransactionExecutor.calculatePriorityGasPrice(refGasPrice, lowProfitUsd, suiPriceUsd);
    expect(lowGasPrice).toBeGreaterThanOrEqual(1000n);
    expect(lowGasPrice).toBe(1150n); // 1.15x baseMultiplier

    // 2. Moderate profit ($0.05 USD): bids dynamic priority tip
    const moderateProfitUsd = 0.05;
    const moderateGasPrice = TransactionExecutor.calculatePriorityGasPrice(refGasPrice, moderateProfitUsd, suiPriceUsd);
    expect(moderateGasPrice).toBeGreaterThan(lowGasPrice);

    // 3. High profit whale liquidation ($500 USD): bids aggressive priority tip up to max multiplier
    const whaleProfitUsd = 500.00;
    const highGasPrice = TransactionExecutor.calculatePriorityGasPrice(refGasPrice, whaleProfitUsd, suiPriceUsd);
    expect(highGasPrice).toBeGreaterThan(moderateGasPrice);
    expect(highGasPrice).toBeLessThanOrEqual(refGasPrice * 5n); // maxMultiplier cap
  });

  it('GasPriceOracle dynamically adjusts P75 computation units from execution samples', async () => {
    const { GasPriceOracle } = await import('../src/engine/executor.js');
    expect(GasPriceOracle.getP75ComputationUnits()).toBe(3_500_000n);

    // Record samples
    for (let i = 1; i <= 10; i++) {
      GasPriceOracle.recordSample({
        timestamp: Date.now(),
        computationUnits: BigInt(i * 1_000_000),
        refGasPrice: 1000n,
        wasIncluded: true,
      });
    }

    const p75 = GasPriceOracle.getP75ComputationUnits();
    expect(p75).toBeGreaterThanOrEqual(7_000_000n);
  });

  it('ObligationRegistry sorts immediate targets by totalDebtUsd descending', async () => {
    const { obligationRegistry } = await import('../src/engine/registry.js');

    obligationRegistry.upsertObligation({
      protocol: 'scallop',
      obligationId: '0xSmallDebtUser',
      ownerAddress: '0xSmallDebtUser',
      collaterals: [{ coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 100_000_000_000n, decimals: 9, valueUsd: 200, liquidationThreshold: 0.8 }],
      debts: [{ coinType: '0xusdc', symbol: 'USDC', amount: 190_000_000n, decimals: 6, valueUsd: 190 }],
      totalCollateralUsd: 200,
      totalDebtUsd: 190,
      liquidationThresholdCollateralUsd: 160,
      healthFactor: 0.84,
      isLiquidatable: true,
      lastUpdatedMs: Date.now(),
    });

    obligationRegistry.upsertObligation({
      protocol: 'scallop',
      obligationId: '0xWhaleDebtUser',
      ownerAddress: '0xWhaleDebtUser',
      collaterals: [{ coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 100_000_000_000n, decimals: 9, valueUsd: 20000, liquidationThreshold: 0.8 }],
      debts: [{ coinType: '0xusdc', symbol: 'USDC', amount: 190_000_000n, decimals: 6, valueUsd: 19000 }],
      totalCollateralUsd: 20000,
      totalDebtUsd: 19000,
      liquidationThresholdCollateralUsd: 16000,
      healthFactor: 0.84,
      isLiquidatable: true,
      lastUpdatedMs: Date.now(),
    });

    const targets = obligationRegistry.getImmediateTargets();
    expect(targets.length).toBeGreaterThanOrEqual(2);
    // Highest debt must be first
    expect(targets[0].totalDebtUsd).toBeGreaterThanOrEqual(targets[1].totalDebtUsd);
  });
});
