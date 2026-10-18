import { describe, it, expect } from 'vitest';
import { MaxHeap } from '../src/utils/heap.js';
import { ObligationRegistry } from '../src/engine/registry.js';
import { ObligationState } from '../src/config/types.js';

function makeObligation(id: string, protocol: 'navi' | 'scallop', debtUsd: number, hf: number): ObligationState {
  return {
    protocol,
    obligationId: id,
    ownerAddress: id,
    collaterals: [{
      coinType: '0x2::sui::SUI',
      symbol: 'SUI',
      amount: 1_000_000_000n,
      decimals: 9,
      valueUsd: 1000,
      liquidationThreshold: 0.8,
    }],
    debts: [{
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      symbol: 'USDC',
      amount: 1_000_000n,
      decimals: 6,
      valueUsd: debtUsd,
    }],
    totalCollateralUsd: 1000,
    totalDebtUsd: debtUsd,
    liquidationThresholdCollateralUsd: 800,
    healthFactor: hf,
    isLiquidatable: hf < 1,
    lastUpdatedMs: Date.now(),
  };
}

describe('MaxHeap', () => {
  it('returns highest priority keys first', () => {
    const heap = new MaxHeap<string>();
    heap.push('low', 10);
    heap.push('high', 100);
    heap.push('mid', 50);

    expect(heap.peek()).toBe('high');
    expect(heap.popMax()).toBe('high');
    expect(heap.popMax()).toBe('mid');
    expect(heap.popMax()).toBe('low');
    expect(heap.popMax()).toBeUndefined();
  });

  it('removes stale entries and keeps heap consistent', () => {
    const heap = new MaxHeap<string>();
    heap.push('a', 5);
    heap.push('b', 10);
    heap.push('c', 7);

    heap.remove('b');
    expect(heap.size()).toBe(2);
    expect(heap.peek()).toBe('c');
    expect(heap.peekTopK(10)).toEqual(['c', 'a']);
  });
});

describe('ObligationRegistry priority ordering', () => {
  it('orders immediate targets by debt size without sorting the whole collection each time', () => {
    const registry = ObligationRegistry.getInstance();
    registry.clear();

    const low = makeObligation('low', 'navi', 10, 0.82);
    const mid = makeObligation('mid', 'scallop', 50, 0.93);
    const high = makeObligation('high', 'navi', 200, 0.75);

    registry.upsertObligation(low);
    registry.upsertObligation(mid);
    registry.upsertObligation(high);

    const top = registry.getImmediateTargets();
    expect(top.map((x) => x.obligationId)).toEqual(['high', 'mid', 'low']);
  });

  it('deduplicates obligations and preserves the highest priority entry', () => {
    const registry = ObligationRegistry.getInstance();
    registry.clear();

    registry.upsertObligation(makeObligation('dup', 'navi', 120, 0.6));
    registry.upsertObligation(makeObligation('dup', 'navi', 180, 0.55));

    const top = registry.getImmediateTargets();
    expect(top).toHaveLength(1);
    expect(top[0].totalDebtUsd).toBe(180);
    expect(top[0].healthFactor).toBe(0.55);
  });
});
