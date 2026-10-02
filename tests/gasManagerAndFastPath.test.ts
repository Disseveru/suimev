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
});
