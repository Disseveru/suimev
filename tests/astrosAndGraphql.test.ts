import { describe, it, expect } from 'vitest';
import { normalizeStructTag } from '../src/config/coins.js';
import { AstrosRouter } from '../src/protocols/dex/astrosRouter.js';
import { telemetry } from '../src/engine/telemetry.js';
import { suiGraphQL } from '../src/client/graphqlClient.js';

describe('Astros Router, GraphQL Service & Canonical Normalization Tests', () => {
  it('normalizes short and long Sui struct tags canonically', () => {
    const shortTag = '0x2::sui::SUI';
    const longTag = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
    const normShort = normalizeStructTag(shortTag);
    const normLong = normalizeStructTag(longTag);

    expect(normShort).toBe(normLong);
    expect(normShort).toContain('0000000000000000000000000000000000000000000000000000000000000002::sui::SUI');
  });

  it('computes Astros Router fallback quote accurately', () => {
    const suiType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
    const usdcType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
    const amountIn = 1_000_000_000n; // 1 SUI

    const quote = AstrosRouter.getQuote(suiType, usdcType, amountIn, 50);

    expect(quote.dex).toBe('astros');
    expect(quote.amountIn).toBe(amountIn);
    expect(quote.expectedAmountOut).toBeGreaterThan(0n);
    expect(quote.minimumAmountOut).toBeLessThanOrEqual(quote.expectedAmountOut);
  });

  it('records execution and revert prevention telemetry', () => {
    telemetry.recordRevertPrevented('Test Revert Prevention Guard', { hf: 1.05 });
    
    telemetry.recordExecution({
      opportunityId: '0xTestObligation',
      protocol: 'navi',
      debtSymbol: 'USDC',
      collateralSymbol: 'SUI',
      expectedGrossProfitUsd: 12.50,
      realizedProfitUsd: 12.45,
      gasCostSui: 0.003,
      success: true,
      digest: '5TestDigest11111111111111111111111111111111111',
      timestampMs: Date.now(),
      latencies: {
        evalDurationMs: 2,
        ptbBuildDurationMs: 5,
        simulationDurationMs: 15,
        broadcastDurationMs: 45,
        totalCycleDurationMs: 67,
      },
    });

    const summary = telemetry.getSummary();
    expect(summary.attempted).toBeGreaterThan(0);
    expect(summary.succeeded).toBeGreaterThan(0);
    expect(summary.revertsPrevented).toBeGreaterThan(0);
    expect(summary.totalProfitUsd).toBeGreaterThanOrEqual(12.45);
  });

  it('does not count estimated gross profit as realized PnL', () => {
    const profitBefore = telemetry.getSummary().totalProfitUsd;

    telemetry.recordExecution({
      opportunityId: '0xEstimatedObligation',
      protocol: 'navi',
      debtSymbol: 'USDC',
      collateralSymbol: 'SUI',
      expectedGrossProfitUsd: 100,
      gasCostSui: 0.003,
      success: true,
      digest: '5EstimatedDigest111111111111111111111111111111',
      timestampMs: Date.now(),
      latencies: {
        evalDurationMs: 2,
        ptbBuildDurationMs: 5,
        simulationDurationMs: 15,
        broadcastDurationMs: 45,
        totalCycleDurationMs: 67,
      },
    });

    expect(telemetry.getSummary().totalProfitUsd).toBe(profitBefore);
  });

  it('verifies GraphQL client endpoint configuration', () => {
    expect(suiGraphQL.getEndpointUrl()).toContain('graphql');
    expect(typeof suiGraphQL.isEndpointHealthy()).toBe('boolean');
  });
});
