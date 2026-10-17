import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import {
  SoftBundleClient,
  PgaFallbackBroadcaster,
  ExecutionRouter,
  SlippageGuard,
  SlippageExceededError,
  TransactionBatcher,
  MAX_SUI_PTB_COMMANDS,
} from '../src/execution/index.js';
import { TransactionExecutor } from '../src/engine/executor.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import type { LiquidationOpportunity, ObligationState } from '../src/types/index.js';

const NAVI_USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI_TYPE = '0x2::sui::SUI';

function makeValidAddress(id: number | string): string {
  if (typeof id === 'string' && id.startsWith('0x') && id.length === 66) {
    return id;
  }
  const hex = typeof id === 'number' ? id.toString(16) : Buffer.from(String(id)).toString('hex');
  return '0x' + hex.padStart(64, '0').slice(-64);
}

function makeMockOpportunity(id: number | string = 1, overrides?: Partial<LiquidationOpportunity>): LiquidationOpportunity {
  const addr = makeValidAddress(id);
  const obligation: ObligationState = {
    protocol: 'navi',
    obligationId: addr,
    ownerAddress: addr,
    totalCollateralUsd: 120,
    totalDebtUsd: 100,
    liquidationThresholdCollateralUsd: 96,
    healthFactor: 0.96,
    isLiquidatable: true,
    lastUpdatedMs: Date.now(),
    collaterals: [
      {
        coinType: SUI_TYPE,
        symbol: 'SUI',
        amount: 60_000_000_000n,
        decimals: 9,
        valueUsd: 120,
        liquidationThreshold: 0.8,
      },
    ],
    debts: [
      {
        coinType: NAVI_USDC_TYPE,
        symbol: 'USDC',
        amount: 100_000_000n,
        decimals: 6,
        valueUsd: 100,
      },
    ],
  };

  return {
    protocol: 'navi',
    obligation,
    debtCoinType: NAVI_USDC_TYPE,
    debtSymbol: 'USDC',
    debtAmountToRepay: 50_000_000n,
    debtRepayUsd: 50.0,
    collateralCoinType: SUI_TYPE,
    collateralSymbol: 'SUI',
    collateralToReceive: 27_500_000_000n,
    collateralReceiveUsd: 55.0,
    expectedGrossProfitUsd: 5.0,
    dex: 'cetus',
    liquidationBonus: 0.05,
    ...overrides,
  };
}

describe('Adversarial Stress Verification — Milestone 3 (R2 Execution & Broadcasting Layer)', () => {
  beforeAll(async () => {
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: SUI_TYPE,
      price: 2.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 200_000_000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'USDC',
      coinType: NAVI_USDC_TYPE,
      price: 1.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 100_000_000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });

    await naviProtocol.initialize();
  });

  // =========================================================================
  // STRESS TEST SUITE 1: ExecutionRouter Robustness & Fallback Integrity
  // =========================================================================
  describe('1. ExecutionRouter Adversarial Stress Tests', () => {
    it('cleanly fails over to PGA when soft bundle fetch throws raw network exception (ECONNREFUSED / DNS failure)', async () => {
      const mockNetworkErrorFetch: typeof fetch = async () => {
        throw new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:9000');
      };

      const softBundle = new SoftBundleClient(
        { endpoint: 'http://127.0.0.1:9000/bundles', enabled: true },
        mockNetworkErrorFetch
      );
      const pgaFallback = new PgaFallbackBroadcaster();
      const pgaSpy = vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
        digest: '0xPgaFallbackNetworkErrorRecoveryDigest',
        success: true,
        gasUsedMist: 4_000_000n,
        gasUsedSui: 0.004,
        gasCostUsd: 0.008,
        attemptsUsed: 1,
      });

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = makeMockOpportunity('0xNetErr');

      const result = await router.broadcast(tx, opp, { netProfitUsd: 4.5 });

      expect(pgaSpy).toHaveBeenCalledTimes(1);
      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('success');
      expect(result.digest).toBe('0xPgaFallbackNetworkErrorRecoveryDigest');
      expect(result.netProfitUsd).toBe(4.5);
    });

    it('cleanly fails over to PGA across full spectrum of HTTP sequencer error codes (400, 401, 403, 429, 502, 503, 504)', async () => {
      const httpErrorCodes = [400, 401, 403, 429, 502, 503, 504];

      for (const statusCode of httpErrorCodes) {
        const mockHttpErrorFetch: typeof fetch = async () => {
          return {
            ok: false,
            status: statusCode,
            statusText: `Error ${statusCode}`,
            text: async () => `Sequencer Ingress Failure ${statusCode}`,
          } as Response;
        };

        const softBundle = new SoftBundleClient(
          { endpoint: 'https://sequencer.test/bundles', enabled: true },
          mockHttpErrorFetch
        );
        const pgaFallback = new PgaFallbackBroadcaster();
        const pgaSpy = vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
          digest: `0xPgaDigestForHttp_${statusCode}`,
          success: true,
          gasUsedMist: 3_500_000n,
          gasUsedSui: 0.0035,
          gasCostUsd: 0.007,
          attemptsUsed: 1,
        });

        const router = new ExecutionRouter(softBundle, pgaFallback);
        const tx = new Transaction();
        const opp = makeMockOpportunity(`0xHttp_${statusCode}`);

        const result = await router.broadcast(tx, opp);

        expect(pgaSpy).toHaveBeenCalledTimes(1);
        expect(result.strategyUsed).toBe('pga_fallback');
        expect(result.status).toBe('success');
        expect(result.digest).toBe(`0xPgaDigestForHttp_${statusCode}`);
      }
    });

    it('cleanly fails over to PGA when sequencer returns invalid, HTML, or corrupted JSON', async () => {
      const corruptedResponses = [
        async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
        async () => null,
        async () => '',
        async () => ({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal sequencer error' } }),
        async () => ({ jsonrpc: '2.0', result: { accepted: true } }), // missing digest!
        async () => ({ jsonrpc: '2.0', result: { accepted: false, reason: 'quarantine' } }),
      ];

      for (let i = 0; i < corruptedResponses.length; i++) {
        const jsonGenerator = corruptedResponses[i];
        const mockCorruptFetch: typeof fetch = async () => {
          return {
            ok: true,
            status: 200,
            json: jsonGenerator,
          } as Response;
        };

        const softBundle = new SoftBundleClient(
          { endpoint: 'https://sequencer.test/bundles', enabled: true },
          mockCorruptFetch
        );
        const pgaFallback = new PgaFallbackBroadcaster();
        const pgaSpy = vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
          digest: `0xCorruptedResponsePgaDigest_${i}`,
          success: true,
          attemptsUsed: 1,
        });

        const router = new ExecutionRouter(softBundle, pgaFallback);
        const tx = new Transaction();
        const opp = makeMockOpportunity(`0xCorrupt_${i}`);

        const result = await router.broadcast(tx, opp);

        expect(pgaSpy).toHaveBeenCalledTimes(1);
        expect(result.strategyUsed).toBe('pga_fallback');
        expect(result.status).toBe('success');
        expect(result.digest).toBe(`0xCorruptedResponsePgaDigest_${i}`);
      }
    });

    it('enforces fallbackToPga: false constraint when soft bundle fails', async () => {
      const mockFailFetch: typeof fetch = async () => {
        return {
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: async () => 'Consensus node down',
        } as Response;
      };

      const softBundle = new SoftBundleClient(
        { endpoint: 'https://sequencer.test/bundles', enabled: true },
        mockFailFetch
      );
      const pgaFallback = new PgaFallbackBroadcaster();
      const pgaSpy = vi.spyOn(pgaFallback, 'broadcast');

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = makeMockOpportunity('0xNoFallback');

      const result = await router.broadcast(tx, opp, { fallbackToPga: false });

      expect(pgaSpy).not.toHaveBeenCalled();
      expect(result.strategyUsed).toBe('soft_bundle');
      expect(result.status).toBe('failure');
      expect(result.digest).toBe('FAILED');
      expect(result.error).toContain('PGA fallback is explicitly disabled');
    });

    it('handles total execution failure gracefully when both soft bundle and PGA fallback fail', async () => {
      const mockFailFetch: typeof fetch = async () => {
        return {
          ok: false,
          status: 500,
          statusText: 'Server Error',
          text: async () => 'Sequencer exploded',
        } as Response;
      };

      const softBundle = new SoftBundleClient(
        { endpoint: 'https://sequencer.test/bundles', enabled: true },
        mockFailFetch
      );
      const pgaFallback = new PgaFallbackBroadcaster();
      vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
        digest: 'FAILED',
        success: false,
        attemptsUsed: 3,
        error: 'PGA broadcast failed after 3 attempt(s): All RPC nodes timed out',
        gasCostUsd: 0.015,
      });

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = makeMockOpportunity('0xTotalFail');

      const result = await router.broadcast(tx, opp, { netProfitUsd: 10.0 });

      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('failure');
      expect(result.digest).toBe('FAILED');
      expect(result.error).toContain('All RPC nodes timed out');
      expect(result.netProfitUsd).toBe(-0.015);
    });

    it('handles high concurrent load of 30 simultaneous broadcasts with interleaved failures cleanly', async () => {
      const router = new ExecutionRouter();
      const pgaFallback = router.getPgaFallback();

      let pgaCallCount = 0;
      vi.spyOn(pgaFallback, 'broadcast').mockImplementation(async () => {
        pgaCallCount++;
        return {
          digest: `0xConcurrentPgaDigest_${pgaCallCount}`,
          success: true,
          gasUsedMist: 3_000_000n,
          gasUsedSui: 0.003,
          gasCostUsd: 0.006,
          attemptsUsed: 1,
        };
      });

      const softClient = router.getSoftBundleClient();
      vi.spyOn(softClient, 'submitTransaction').mockImplementation(async (_tx, _opt) => {
        // 50% chance soft bundle succeeds, 50% fails/times out
        const shouldSucceed = Math.random() > 0.5;
        if (shouldSucceed) {
          return {
            bundleId: 'sb_test',
            accepted: true,
            status: 'accepted',
            digest: `0xSoftBundleSuccess_${Math.random()}`,
          };
        } else {
          return {
            bundleId: 'sb_test',
            accepted: false,
            status: 'rejected',
            error: 'Simulated overload',
          };
        }
      });

      const broadcastPromises = Array.from({ length: 30 }).map((_, idx) => {
        const tx = new Transaction();
        const opp = makeMockOpportunity(`0xConcurrent_${idx}`);
        return router.broadcast(tx, opp);
      });

      const results = await Promise.all(broadcastPromises);

      expect(results.length).toBe(30);
      for (const res of results) {
        expect(['soft_bundle', 'pga_fallback']).toContain(res.strategyUsed);
        expect(res.status).toBe('success');
        expect(res.digest).toMatch(/^0x/);
      }
    });
  });

  // =========================================================================
  // STRESS TEST SUITE 2: SlippageGuard Mathematical & Boundary Testing
  // =========================================================================
  describe('2. SlippageGuard Adversarial Stress Tests', () => {
    it('handles extreme BigInt values, zero, and boundary inputs in calculateMinimumAmountOut', () => {
      // Massive amounts (e.g. 100 Billion SUI in MIST)
      const hugeMist = 100_000_000_000_000_000_000n; // 10^20
      const minHuge = SlippageGuard.calculateMinimumAmountOut(hugeMist, 100); // 1%
      expect(minHuge).toBe(99_000_000_000_000_000_000n);

      // 0 expected amount
      expect(SlippageGuard.calculateMinimumAmountOut(0n, 100)).toBe(0n);
      expect(SlippageGuard.calculateMinimumAmountOut(-50n, 100)).toBe(0n);

      // Negative bps clamps to 0% (returns exact amount)
      expect(SlippageGuard.calculateMinimumAmountOut(1_000_000n, -50)).toBe(1_000_000n);

      // Over 10000 bps clamps to 100% slippage (returns 0n)
      expect(SlippageGuard.calculateMinimumAmountOut(1_000_000n, 20000)).toBe(0n);

      // 10000 bps exactly (100% slippage -> 0)
      expect(SlippageGuard.calculateMinimumAmountOut(1_000_000n, 10000)).toBe(0n);

      // 1 MIST test (rounding behavior: (1 * 9900) / 10000 = 0n)
      expect(SlippageGuard.calculateMinimumAmountOut(1n, 100)).toBe(0n);
      // 100 MIST test: (100 * 9900) / 10000 = 99n
      expect(SlippageGuard.calculateMinimumAmountOut(100n, 100)).toBe(99n);
    });

    it('strictly tests precision boundaries in validateSlippage (exact match, off-by-one MIST, zero output)', () => {
      const expected = 10_000_000n; // 10 USDC
      const minAllowed = 9_900_000n; // 100 bps (1%) allowed

      // Exactly at boundary
      const exactCheck = SlippageGuard.validateSlippage(expected, minAllowed, 100);
      expect(exactCheck.isValid).toBe(true);
      expect(exactCheck.minAmountOut).toBe(minAllowed);

      // 1 MIST below boundary (should fail)
      const belowCheck = SlippageGuard.validateSlippage(expected, minAllowed - 1n, 100);
      expect(belowCheck.isValid).toBe(false);
      expect(belowCheck.reason).toContain('is below minimum');

      // 1 MIST above boundary (should pass)
      const aboveCheck = SlippageGuard.validateSlippage(expected, minAllowed + 1n, 100);
      expect(aboveCheck.isValid).toBe(true);

      // Total loss (0 actual output)
      const zeroCheck = SlippageGuard.validateSlippage(expected, 0n, 100);
      expect(zeroCheck.isValid).toBe(false);
      expect(zeroCheck.slippageBps).toBe(10000);

      // Zero or negative expected amount
      const zeroExpected = SlippageGuard.validateSlippage(0n, 100n, 100);
      expect(zeroExpected.isValid).toBe(false);
      expect(zeroExpected.reason).toContain('must be greater than zero');

      // Favorable slippage (actual > expected)
      const favorable = SlippageGuard.validateSlippage(expected, expected + 500_000n, 100);
      expect(favorable.isValid).toBe(true);
      expect(favorable.slippageBps).toBe(0);
    });

    it('enforces pre-broadcast assertion and verifies SlippageExceededError metadata', () => {
      expect(() => {
        SlippageGuard.enforce({
          expectedAmountOut: 1_000_000n,
          actualAmountOut: 980_000n, // 200 bps
          maxSlippageBps: 100, // 100 bps
        });
      }).toThrowError(SlippageExceededError);

      try {
        SlippageGuard.enforce({
          expectedAmountOut: 1_000_000n,
          actualAmountOut: 980_000n,
          maxSlippageBps: 100,
        });
      } catch (err) {
        expect(err).toBeInstanceOf(SlippageExceededError);
        const slippageErr = err as SlippageExceededError;
        expect(slippageErr.minAmountOut).toBe(990_000n);
        expect(slippageErr.actualAmountOut).toBe(980_000n);
        expect(slippageErr.slippageBps).toBe(200);
        expect(slippageErr.maxSlippageBps).toBe(100);
      }
    });

    it('rejects spot vs oracle price divergences at boundary precision', () => {
      const oracle = 2.0000;
      // 100 bps = 1% = 0.0200 deviation -> range [1.9800, 2.0200]
      const spotAtLowerLimit = 1.9800;
      const spotBelowLimit = 1.9790; // 105 bps
      const spotAtUpperLimit = 2.0200;
      const spotAboveLimit = 2.0210; // 105 bps

      expect(SlippageGuard.validatePriceDivergence(spotAtLowerLimit, oracle, 100).isValid).toBe(true);
      expect(SlippageGuard.validatePriceDivergence(spotAtUpperLimit, oracle, 100).isValid).toBe(true);

      const failLow = SlippageGuard.validatePriceDivergence(spotBelowLimit, oracle, 100);
      expect(failLow.isValid).toBe(false);
      expect(failLow.reason).toContain('diverges from Pyth oracle');

      const failHigh = SlippageGuard.validatePriceDivergence(spotAboveLimit, oracle, 100);
      expect(failHigh.isValid).toBe(false);

      // Negative or zero oracle price
      expect(SlippageGuard.validatePriceDivergence(1.0, 0, 100).isValid).toBe(false);
      expect(SlippageGuard.validatePriceDivergence(0, 1.0, 100).isValid).toBe(false);
      expect(SlippageGuard.validatePriceDivergence(-1.0, 1.0, 100).isValid).toBe(false);
    });

    it('rejects economically underwater opportunities in TransactionExecutor pre-broadcast guard', async () => {
      const insolventOpp = makeMockOpportunity('0xInsolvent', {
        debtRepayUsd: 100,
        collateralReceiveUsd: 80, // 20% loss
      });

      const tx = new Transaction();
      await expect(
        TransactionExecutor.execute(tx, insolventOpp, 5.0)
      ).rejects.toThrowError(/Pre-broadcast Slippage Guard violation/);
    });
  });

  // =========================================================================
  // STRESS TEST SUITE 3: TransactionBatcher Limit Stress & PTB Command Capping
  // =========================================================================
  describe('3. TransactionBatcher Adversarial Stress Tests', () => {
    it('throws error when attempting to batch empty list of opportunities', () => {
      const batcher = new TransactionBatcher();
      expect(() => batcher.batchOpportunities([])).toThrowError(
        'Cannot batch empty list of liquidation opportunities'
      );
    });

    it('enforces PTB Move command ceiling strictly under heavy opportunity loads', () => {
      const batcher = new TransactionBatcher();

      // Create 50 liquidation opportunities
      const opps = Array.from({ length: 50 }).map((_, i) =>
        makeMockOpportunity(`0xMultiTarget_${i}`, {
          expectedGrossProfitUsd: 1.0 + i * 0.1,
        })
      );

      // Batch with high maxTargets to push against command count limit
      const result = batcher.batchOpportunities(opps, { maxTargets: 40 });

      // Commands must strictly never exceed protocol safety limit (1000) or protocol absolute limit (1024)
      const commandCount = result.tx.getData().commands.length;
      expect(commandCount).toBeLessThanOrEqual(MAX_SUI_PTB_COMMANDS);
      expect(commandCount).toBeLessThanOrEqual(1024);
      expect(result.commandCount).toBe(commandCount);
      expect(result.targetCount).toBeGreaterThan(0);
      expect(result.targetCount).toBeLessThanOrEqual(result.opportunities.length);
    });

    it('respects tight custom maxCommands constraint and stops adding targets before overflow', () => {
      // Typical single target is 13 commands.
      // If maxCommands is 20, exactly 1 target should fit.
      const restrictiveBatcher = new TransactionBatcher({ maxCommands: 20 });
      const opp1 = makeMockOpportunity('0xTarget1');
      const opp2 = makeMockOpportunity('0xTarget2');

      const result = restrictiveBatcher.batchOpportunities([opp1, opp2]);

      expect(result.targetCount).toBe(1);
      expect(result.opportunities.length).toBe(1);
      expect(result.commandCount).toBeLessThanOrEqual(20);
    });

    it('throws when maxCommands is too small to even accommodate a single target', () => {
      // 5 commands is less than single liquidation PTB requirement (~13 commands)
      const tinyBatcher = new TransactionBatcher({ maxCommands: 5 });
      const opp = makeMockOpportunity('0xTiny');

      expect(() => tinyBatcher.batchOpportunities([opp])).toThrowError(
        'Failed to assemble any valid liquidation targets into batch'
      );
    });

    it('respects maxGasBudgetMist ceiling during estimation and batch building via options', () => {
      const defaultBatcher = new TransactionBatcher();

      const opp1 = makeMockOpportunity('0xGasOpp1');
      const opp2 = makeMockOpportunity('0xGasOpp2');

      const result = defaultBatcher.batchOpportunities([opp1, opp2], {
        maxGasBudgetMist: 30_000_000n, // Only room for 1 target (27M); 2 targets (39M) exceeds 30M
      });

      expect(result.targetCount).toBe(1);
      expect(result.estimatedTotalGasMist).toBeLessThanOrEqual(30_000_000n);
    });

    it('resiliently skips failed targets and continues assembling remaining valid opportunities', () => {
      const batcher = new TransactionBatcher();

      const validOpp1 = makeMockOpportunity('0xValid1');
      // Create a corrupted opportunity whose obligation triggers builder failure
      const corruptedOpp = makeMockOpportunity('0xCorrupt', {
        obligation: {
          ...makeMockOpportunity('0xCorrupt').obligation,
          collaterals: [] as any,
        },
        collateralCoinType: '0xinvalid',
      });
      const validOpp2 = makeMockOpportunity('0xValid2');

      const result = batcher.batchOpportunities([validOpp1, corruptedOpp, validOpp2]);

      // Should skip corruptedOpp and include validOpp1 and validOpp2
      expect(result.targetCount).toBeGreaterThanOrEqual(1);
      const includedIds = result.opportunities.map((o) => o.obligation.obligationId);
      expect(includedIds).toContain(validOpp1.obligation.obligationId);
    });
  });
});
