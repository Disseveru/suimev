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
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { priceCache } from '../src/oracles/priceCache.js';
import type {
  LiquidationOpportunity,
  ObligationState,
} from '../src/types/index.js';

const NAVI_USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI_TYPE = '0x2::sui::SUI';
const MOCK_BORROWER_1 = '0x0000000000000000000000000000000000000000000000000000000000000111';
const MOCK_BORROWER_2 = '0x0000000000000000000000000000000000000000000000000000000000000222';
const MOCK_BORROWER_3 = '0x0000000000000000000000000000000000000000000000000000000000000333';

function createMockOpportunity(overrides?: Partial<LiquidationOpportunity>): LiquidationOpportunity {
  const obligation: ObligationState = {
    protocol: 'navi',
    obligationId: MOCK_BORROWER_1,
    ownerAddress: MOCK_BORROWER_1,
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

describe('Milestone 3: Execution & Broadcasting Layer (Requirement R2)', () => {
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

  describe('1. Explicit Architecture Separation: Soft Bundles vs PGA Fallback', () => {
    it('verifies explicit architectural separation of Soft Bundle and PGA Fallback modules', () => {
      const softBundle = new SoftBundleClient();
      const pgaFallback = new PgaFallbackBroadcaster();

      // Soft Bundle has dedicated sequencer configuration and payload packaging
      expect(typeof softBundle.submitBundle).toBe('function');
      expect(typeof softBundle.packageBundle).toBe('function');
      expect(typeof softBundle.parseReceipt).toBe('function');
      expect(softBundle.getConfig().endpoint).toBeDefined();

      // PGA Fallback has dedicated gas auction calculation, gas stepping, and broadcast race
      expect(typeof pgaFallback.broadcast).toBe('function');
      expect(typeof pgaFallback.calculatePriorityGasPrice).toBe('function');
      expect(typeof pgaFallback.getReferenceGasPrice).toBe('function');

      // ExecutionRouter cleanly orchestrates both distinct strategies
      const router = new ExecutionRouter(softBundle, pgaFallback);
      expect(router.getSoftBundleClient()).toBe(softBundle);
      expect(router.getPgaFallback()).toBe(pgaFallback);
    });

    it('verifies Soft Bundle client builds direct sequencer headers and JSON-RPC payload', async () => {
      let capturedUrl = '';
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: any = null;

      const mockFetch: typeof fetch = async (url, init) => {
        capturedUrl = url.toString();
        capturedHeaders = init?.headers as Record<string, string>;
        capturedBody = JSON.parse(init?.body as string);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: {
              bundleId: capturedBody.params.bundleId,
              accepted: true,
              status: 'accepted',
              digest: '0xMockSequencerReceiptDigest999',
            },
          }),
        } as Response;
      };

      const client = new SoftBundleClient(
        {
          endpoint: 'https://sequencer.sui-validator.io/v1/bundles',
          authToken: 'test_sequencer_key_123',
          timeoutMs: 500,
          enabled: true,
        },
        mockFetch
      );

      const payload = client.packageBundle(['dGVzdF90eF9ieXRlcw=='], {
        bundleId: 'sb_test_bundle_1',
        auctionBidMist: 5_000_000n,
        tipAmountMist: 10_000_000n,
        targetCheckpoint: 12345,
      });

      const receipt = await client.submitBundle(payload);

      expect(capturedUrl).toBe('https://sequencer.sui-validator.io/v1/bundles');
      expect(capturedHeaders['x-sui-bundle-id']).toBe('sb_test_bundle_1');
      expect(capturedHeaders['x-sui-execution-route']).toBe('soft-bundle');
      expect(capturedHeaders['x-sui-priority-fee']).toBe('5000000');
      expect(capturedHeaders['x-sui-tip-amount']).toBe('10000000');
      expect(capturedHeaders['Authorization']).toBe('Bearer test_sequencer_key_123');
      expect(capturedBody.method).toBe('sui_submitSoftBundle');
      expect(capturedBody.params.bundleId).toBe('sb_test_bundle_1');

      expect(receipt.accepted).toBe(true);
      expect(receipt.status).toBe('accepted');
      expect(receipt.digest).toBe('0xMockSequencerReceiptDigest999');
    });
  });

  describe('2. Primary Route Success: Soft Bundle Sequencer Broadcast', () => {
    it('successfully routes via primary Soft Bundle strategy when sequencer accepts', async () => {
      const mockFetch: typeof fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            result: {
              accepted: true,
              status: 'accepted',
              digest: '0xSoftBundleWinningDigestAlpha',
            },
          }),
        } as Response;
      };

      const softBundle = new SoftBundleClient(
        {
          endpoint: 'https://sequencer.sui-validator.io/bundles',
          timeoutMs: 300,
          enabled: true,
        },
        mockFetch
      );

      const pgaFallback = new PgaFallbackBroadcaster();
      const pgaSpy = vi.spyOn(pgaFallback, 'broadcast');

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = createMockOpportunity();

      const result = await router.broadcast(tx, opp, {
        netProfitUsd: 4.85,
      });

      // Primary strategy succeeded
      expect(result.strategyUsed).toBe('soft_bundle');
      expect(result.status).toBe('success');
      expect(result.digest).toBe('0xSoftBundleWinningDigestAlpha');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.netProfitUsd).toBe(4.85);

      // PGA fallback was NOT called because soft bundle succeeded
      expect(pgaSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Seamless PGA Fallback Routing upon Sequencer Failure', () => {
    it('automatically switches to PGA fallback when sequencer returns HTTP 500 error', async () => {
      const mockErrorFetch: typeof fetch = async () => {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Sequencer ingress overloaded',
        } as Response;
      };

      const softBundle = new SoftBundleClient(
        {
          endpoint: 'https://sequencer.sui-validator.io/bundles',
          timeoutMs: 250,
          enabled: true,
        },
        mockErrorFetch
      );

      const pgaFallback = new PgaFallbackBroadcaster();
      vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
        digest: '0xPgaFallbackConsensusDigestBeta',
        success: true,
        gasUsedMist: 4_500_000n,
        gasUsedSui: 0.0045,
        gasCostUsd: 0.009,
        attemptsUsed: 1,
      });

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = createMockOpportunity();

      const result = await router.broadcast(tx, opp, {
        netProfitUsd: 4.50,
      });

      // Explicit failover to secondary strategy
      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('success');
      expect(result.digest).toBe('0xPgaFallbackConsensusDigestBeta');
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.gasUsedSui).toBe(0.0045);
    });

    it('automatically switches to PGA fallback when sequencer times out', async () => {
      const mockHangingFetch: typeof fetch = async (_url, init) => {
        return new Promise((resolve, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              const abortErr = new Error('The operation was aborted due to timeout');
              abortErr.name = 'AbortError';
              reject(abortErr);
            });
          }
        });
      };

      const softBundle = new SoftBundleClient(
        {
          endpoint: 'https://sequencer.sui-validator.io/bundles',
          timeoutMs: 50,
          enabled: true,
        },
        mockHangingFetch
      );

      const pgaFallback = new PgaFallbackBroadcaster();
      vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
        digest: '0xPgaFallbackAfterTimeoutDigestGamma',
        success: true,
        gasUsedMist: 3_800_000n,
        gasUsedSui: 0.0038,
        gasCostUsd: 0.0076,
        attemptsUsed: 1,
      });

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = createMockOpportunity();

      const result = await router.broadcast(tx, opp, {
        netProfitUsd: 3.90,
      });

      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('success');
      expect(result.digest).toBe('0xPgaFallbackAfterTimeoutDigestGamma');
      expect(result.latencyMs).toBeGreaterThanOrEqual(40);
    });

    it('automatically switches to PGA fallback when sequencer explicitly rejects bundle', async () => {
      const mockRejectFetch: typeof fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jsonrpc: '2.0',
            result: {
              accepted: false,
              status: 'rejected',
              error: 'BUNDLE_QUEUE_FULL: Block quota reached for epoch 520',
            },
          }),
        } as Response;
      };

      const softBundle = new SoftBundleClient(
        { endpoint: 'https://sequencer.sui.io', enabled: true },
        mockRejectFetch
      );

      const pgaFallback = new PgaFallbackBroadcaster();
      vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
        digest: '0xPgaFallbackAfterRejectionDigestDelta',
        success: true,
        attemptsUsed: 2,
      });

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = createMockOpportunity();

      const result = await router.broadcast(tx, opp);

      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('success');
      expect(result.digest).toBe('0xPgaFallbackAfterRejectionDigestDelta');
    });

    it('routes directly to PGA fallback when Soft Bundles are explicitly disabled', async () => {
      const softBundle = new SoftBundleClient({ enabled: false });
      const pgaFallback = new PgaFallbackBroadcaster();
      vi.spyOn(pgaFallback, 'broadcast').mockResolvedValueOnce({
        digest: '0xDirectPgaDigestEpsilon',
        success: true,
        attemptsUsed: 1,
      });

      const router = new ExecutionRouter(softBundle, pgaFallback);
      const tx = new Transaction();
      const opp = createMockOpportunity();

      const result = await router.broadcast(tx, opp, { enableSoftBundle: false });

      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('success');
      expect(result.digest).toBe('0xDirectPgaDigestEpsilon');
    });
  });

  describe('4. Slippage Guard Engine & Pre-Broadcast Protection', () => {
    it('calculates minimum amount out accurately across slippage basis points', () => {
      const expected = 1_000_000_000n; // 1 SUI (1e9 MIST)

      // 100 bps (1%) slippage -> 990,000,000
      expect(SlippageGuard.calculateMinimumAmountOut(expected, 100)).toBe(990_000_000n);

      // 50 bps (0.5%) slippage -> 995,000,000
      expect(SlippageGuard.calculateMinimumAmountOut(expected, 50)).toBe(995_000_000n);

      // 200 bps (2%) slippage -> 980,000,000
      expect(SlippageGuard.calculateMinimumAmountOut(expected, 200)).toBe(980_000_000n);

      // 0 bps (0%) slippage -> 1,000,000,000
      expect(SlippageGuard.calculateMinimumAmountOut(expected, 0)).toBe(1_000_000_000n);
    });

    it('accepts trades within allowed slippage bps and rejects trades violating max slippage bps', () => {
      const expected = 10_000_000n; // 10 USDC

      // Actual = 9.95 USDC (50 bps slippage <= 100 bps allowed) -> valid
      const validCheck = SlippageGuard.validateSlippage(expected, 9_950_000n, 100);
      expect(validCheck.isValid).toBe(true);
      expect(validCheck.slippageBps).toBe(50);

      // Actual = 9.80 USDC (200 bps slippage > 100 bps allowed) -> invalid
      const invalidCheck = SlippageGuard.validateSlippage(expected, 9_800_000n, 100);
      expect(invalidCheck.isValid).toBe(false);
      expect(invalidCheck.slippageBps).toBe(200);
      expect(invalidCheck.minAmountOut).toBe(9_900_000n);
      expect(invalidCheck.reason).toContain('Actual output 9800000 is below minimum 9900000');
    });

    it('rejects spot prices diverging significantly from Pyth benchmark', () => {
      const oraclePrice = 2.50; // Pyth SUI price: $2.50
      const spotPriceClose = 2.49; // $2.49 -> 40 bps divergence
      const spotPriceDivergent = 2.30; // $2.30 -> 800 bps divergence

      const okDivergence = SlippageGuard.validatePriceDivergence(spotPriceClose, oraclePrice, 100);
      expect(okDivergence.isValid).toBe(true);
      expect(okDivergence.slippageBps).toBe(40);

      const badDivergence = SlippageGuard.validatePriceDivergence(spotPriceDivergent, oraclePrice, 100);
      expect(badDivergence.isValid).toBe(false);
      expect(badDivergence.slippageBps).toBe(800);
      expect(badDivergence.reason).toContain('DEX spot price');
    });

    it('enforce() throws SlippageExceededError when slippage boundary is breached', () => {
      expect(() => {
        SlippageGuard.enforce({
          expectedAmountOut: 1_000_000n,
          actualAmountOut: 900_000n, // 10% slippage (1000 bps)
          maxSlippageBps: 100, // 1% allowed
        });
      }).toThrowError(SlippageExceededError);

      expect(() => {
        SlippageGuard.enforce({
          expectedAmountOut: 1_000_000n,
          actualAmountOut: 995_000n, // 0.5% slippage (50 bps)
          maxSlippageBps: 100,
        });
      }).not.toThrow();
    });

    it('validates financial solvency of liquidation opportunity before broadcasting', () => {
      const profitableOpp = createMockOpportunity({
        debtRepayUsd: 100,
        collateralReceiveUsd: 108,
      });
      expect(SlippageGuard.validateOpportunity(profitableOpp, 100).isValid).toBe(true);

      const underwaterOpp = createMockOpportunity({
        debtRepayUsd: 100,
        collateralReceiveUsd: 95, // Loss: receiving less collateral than debt repay
      });
      const insolventCheck = SlippageGuard.validateOpportunity(underwaterOpp, 100);
      expect(insolventCheck.isValid).toBe(false);
      expect(insolventCheck.reason).toContain('Collateral received ($95.00) is less than debt repay requirement ($100.00)');
    });
  });

  describe('5. Multi-Obligation PTB Batching Engine', () => {
    it('batches multiple liquidation opportunities into an atomic PTB respecting constraints', () => {
      const batcher = new TransactionBatcher();

      const opp1 = createMockOpportunity({
        obligation: {
          ...createMockOpportunity().obligation,
          obligationId: MOCK_BORROWER_1,
          ownerAddress: MOCK_BORROWER_1,
        },
        debtAmountToRepay: 25_000_000n,
        expectedGrossProfitUsd: 2.50,
      });

      const opp2 = createMockOpportunity({
        obligation: {
          ...createMockOpportunity().obligation,
          obligationId: MOCK_BORROWER_2,
          ownerAddress: MOCK_BORROWER_2,
        },
        debtAmountToRepay: 35_000_000n,
        expectedGrossProfitUsd: 3.50,
      });

      const batchResult = batcher.batchOpportunities([opp1, opp2]);

      expect(batchResult.targetCount).toBe(2);
      expect(batchResult.opportunities.length).toBe(2);
      expect(batchResult.commandCount).toBeGreaterThan(0);
      expect(batchResult.estimatedTotalGasMist).toBeGreaterThan(0n);
      expect(batchResult.tx).toBeInstanceOf(Transaction);

      // Verify commands inside the transaction block include both targets
      const commands = batchResult.tx.getData().commands;
      expect(commands.length).toBe(batchResult.commandCount);
      expect(commands.length).toBeLessThanOrEqual(MAX_SUI_PTB_COMMANDS);
    });

    it('enforces command count ceiling and stops adding targets before limit breach', () => {
      // First, build a batch with opp1 to see how many commands it uses
      const opp1 = createMockOpportunity({
        obligation: {
          ...createMockOpportunity().obligation,
          obligationId: MOCK_BORROWER_1,
          ownerAddress: MOCK_BORROWER_1,
        },
      });
      const opp2 = createMockOpportunity({
        obligation: {
          ...createMockOpportunity().obligation,
          obligationId: MOCK_BORROWER_2,
          ownerAddress: MOCK_BORROWER_2,
        },
      });

      const normalBatcher = new TransactionBatcher();
      const singleBatch = normalBatcher.batchOpportunities([opp1]);
      const singleCommandCount = singleBatch.commandCount;

      // Now create a batcher whose maxCommands only fits 1 target
      const restrictiveBatcher = new TransactionBatcher({
        maxCommands: singleCommandCount + 5, // Not enough room for a second target (~10-15 commands)
      });

      const result = restrictiveBatcher.batchOpportunities([opp1, opp2]);

      // Should include only 1 and safely stop before exceeding maxCommands
      expect(result.targetCount).toBe(1);
      expect(result.opportunities[0].obligation.obligationId).toBe(opp1.obligation.obligationId);
    });

    it('correctly partitions and groups multiple opportunities by debt coin', () => {
      const batcher = new TransactionBatcher();

      const usdcOpp1 = createMockOpportunity({ debtCoinType: NAVI_USDC_TYPE });
      const usdcOpp2 = createMockOpportunity({ debtCoinType: NAVI_USDC_TYPE });
      const suiOpp1 = createMockOpportunity({ debtCoinType: SUI_TYPE });

      const groups = batcher.groupOpportunitiesByDebt([usdcOpp1, usdcOpp2, suiOpp1]);

      expect(groups.size).toBe(2);
      expect(groups.get(NAVI_USDC_TYPE)?.length).toBe(2);
      expect(groups.get(SUI_TYPE)?.length).toBe(1);
    });
  });

  describe('6. PGA Gas Stepping & Auction Mechanics', () => {
    it('applies gas stepping escalation monotonically on retried PGA attempts', () => {
      const pga = new PgaFallbackBroadcaster();
      const refGasPrice = 1000n;
      const profitUsd = 0.02; // Small profit to stay below 5x max ceiling
      const suiPriceUsd = 2.0;

      const attempt1Gas = pga.calculatePriorityGasPrice(refGasPrice, profitUsd, suiPriceUsd, 1);
      const attempt2Gas = pga.calculatePriorityGasPrice(refGasPrice, profitUsd, suiPriceUsd, 2);
      const attempt3Gas = pga.calculatePriorityGasPrice(refGasPrice, profitUsd, suiPriceUsd, 3);

      expect(attempt2Gas).toBeGreaterThan(attempt1Gas);
      expect(attempt3Gas).toBeGreaterThan(attempt2Gas);

      // Clamped within max multiplier (e.g. 5x = 5000 MIST)
      expect(attempt3Gas).toBeLessThanOrEqual(refGasPrice * 5n);
    });
  });
});
