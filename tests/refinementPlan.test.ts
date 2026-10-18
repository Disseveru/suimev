import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { PreFlightSimulator } from '../src/engine/simulator.js';
import { gasManager } from '../src/client/gasManager.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { grpcManager } from '../src/client/grpcClient.js';
import { Transaction } from '@mysten/sui/transactions';
import { LiquidationOpportunity, ObligationState } from '../src/config/types.js';

describe('Audit & Refinement Plan Implementation Verification', () => {
  beforeEach(() => {
    vi.spyOn(grpcManager, 'checkHealth').mockResolvedValue('test-chain');
    const publishTime = Math.floor(Date.now() / 1000);
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: '0x2::sui::SUI',
      price: 2.5,
      confidence: 0,
      exponent: -8,
      rawPrice: 250_000_000n,
      publishTime,
      lastUpdatedMs: Date.now(),
      isDefaultSeed: false,
    });
    priceCache.updatePrice({
      symbol: 'USDC',
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      price: 1,
      confidence: 0,
      exponent: -8,
      rawPrice: 100_000_000n,
      publishTime,
      lastUpdatedMs: Date.now(),
      isDefaultSeed: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. ZeroCapitalPtbBuilder lockCache Invalidation', () => {
    it('should correctly invalidate targeted obligation and all cached entries', () => {
      // Access lockCache via private property to seed test state
      const lockCache = (ZeroCapitalPtbBuilder as any).lockCache as Map<string, { isLocked: boolean; expiresMs: number }>;
      lockCache.set('0xObligationA', { isLocked: true, expiresMs: Date.now() + 10000 });
      lockCache.set('0xObligationB', { isLocked: true, expiresMs: Date.now() + 10000 });

      expect(ZeroCapitalPtbBuilder.getLockCacheSize()).toBeGreaterThanOrEqual(2);

      // Invalidate single obligation
      ZeroCapitalPtbBuilder.invalidateLockCache('0xObligationA');
      expect(lockCache.has('0xObligationA')).toBe(false);
      expect(lockCache.has('0xObligationB')).toBe(true);

      // Invalidate all
      ZeroCapitalPtbBuilder.invalidateLockCache();
      expect(ZeroCapitalPtbBuilder.getLockCacheSize()).toBe(0);
    });
  });

  describe('2. PreFlightSimulator Zero-Mock Dry-Run Invariants', () => {
    const mockOpportunity: LiquidationOpportunity = {
      protocol: 'navi',
      obligation: {
        protocol: 'navi',
        obligationId: '0x123',
        ownerAddress: '0x123',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 1000,
        totalDebtUsd: 800,
        liquidationThresholdCollateralUsd: 750,
        healthFactor: 0.9375,
        isLiquidatable: true,
        lastUpdatedMs: Date.now(),
      },
      debtCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      debtSymbol: 'USDC',
      debtAmountToRepay: 100_000_000n,
      debtRepayUsd: 100,
      collateralCoinType: '0x2::sui::SUI',
      collateralSymbol: 'SUI',
      collateralToReceive: 52_500_000_000n,
      collateralReceiveUsd: 105,
      expectedGrossProfitUsd: 5.0,
      dex: 'cetus',
      liquidationBonus: 0.05,
    };

    it('falls back to devInspect simulation without injecting dummy 0x0...01 gas object', async () => {
      // Invalidate gasManager to ensure activeGas is null
      gasManager.invalidate();

      const simulateSpy = vi.spyOn(PreFlightSimulator, 'simulate').mockResolvedValueOnce({
        success: true,
        opportunity: mockOpportunity,
        gasUsedSui: 0.002,
        gasCostUsd: 0.005,
        netProfitUsd: 4.995,
        netProfitSui: 1.998,
        isProfitable: true,
        simulationType: 'devInspect',
      });

      const tx = new Transaction();
      // tx has no gas payment set and cannot build standalone without gas object
      const result = await PreFlightSimulator.dryRun(tx, mockOpportunity);

      expect(simulateSpy).toHaveBeenCalledTimes(1);
      expect(result.simulationType).toBe('dryRun');
      expect(result.success).toBe(true);
    });

    it('uses active gas object when available in gasManager cache', async () => {
      const activeGas = {
        objectId: '0x' + '2'.repeat(64),
        version: '1',
        digest: '11111111111111111111111111111111',
      };
      vi.spyOn(gasManager, 'getActiveGasObject').mockReturnValue(activeGas);
      const simulateTransaction = vi.fn().mockResolvedValue({
        $kind: 'Transaction',
        Transaction: {
          status: { success: true, error: null },
          effects: {
            gasUsed: { computationCost: '1000', storageCost: '500', storageRebate: '500', nonRefundableStorageFee: '0' },
          },
        },
      });
      vi.spyOn(grpcManager, 'getClient').mockReturnValue({ simulateTransaction } as never);

      const tx = new Transaction();
      tx.setSender('0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d');
      tx.setGasBudget(100_000_000n);

      const result = await PreFlightSimulator.dryRun(tx, mockOpportunity);
      expect(simulateTransaction).toHaveBeenCalledOnce();
      expect(result.simulationType).toBe('dryRun');
      expect(result.success).toBe(true);
    });

    it('falls back to devInspect when PTB byte building fails despite an active gas object', async () => {
      vi.spyOn(gasManager, 'getActiveGasObject').mockReturnValue({
        objectId: '0x' + '2'.repeat(64),
        version: '1',
        digest: '11111111111111111111111111111111',
      });
      vi.spyOn(Transaction.prototype, 'build').mockRejectedValue(new Error('PTB build failed'));
      const simulateSpy = vi.spyOn(PreFlightSimulator, 'simulate').mockResolvedValueOnce({
        success: true,
        opportunity: mockOpportunity,
        gasUsedSui: 0.002,
        gasCostUsd: 0.005,
        netProfitUsd: 4.995,
        netProfitSui: 1.998,
        isProfitable: true,
        simulationType: 'devInspect',
      });
      const grpcClientSpy = vi.spyOn(grpcManager, 'getClient');

      const result = await PreFlightSimulator.dryRun(new Transaction(), mockOpportunity);

      expect(simulateSpy).toHaveBeenCalledTimes(1);
      expect(grpcClientSpy).not.toHaveBeenCalled();
      expect(result.simulationType).toBe('dryRun');
      expect(result.success).toBe(true);
    });
  });

  describe('3. GasManager Reconciliation & Error Recovery', () => {
    it('accurately identifies gas object errors and ignores normal execution errors', () => {
      expect(gasManager.isGasObjectError('InvalidGasObject: object not found')).toBe(true);
      expect(gasManager.isGasObjectError('ObjectVersionUnavailableForConsumption: version mismatch')).toBe(true);
      expect(gasManager.isGasObjectError(new Error('GasObjectNotOwnedByAddress'))).toBe(true);
      expect(gasManager.isGasObjectError('ObjectNotFound: 0x9876')).toBe(true);
      expect(gasManager.isGasObjectError('MoveAbort(0x123::lending, 2)')).toBe(false);
      expect(gasManager.isGasObjectError(null)).toBe(false);
    });

    it('handleGasError invalidates cached gas coin and queries fresh state', async () => {
      const refreshSpy = vi.spyOn(gasManager, 'refreshGasCoins').mockResolvedValueOnce(null);
      gasManager.updateFromExecutionEffects({
        gasObject: {
          reference: {
            objectId: '0xStaleCoin',
            version: 1,
            digest: 'OldDigest',
          },
        },
      });

      await gasManager.handleGasError(new Error('InvalidGasObject'));
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(gasManager.getActiveGasObject()).toBeNull();
    });

    it('background reconciliation starts and stops without error', () => {
      gasManager.startBackgroundReconciliation(60_000);
      expect(() => gasManager.stopBackgroundReconciliation()).not.toThrow();
    });
  });

  describe('4. PriceCache Stale Cold-Start Seed Guard', () => {
    it('marks cold-start seed defaults as isDefaultSeed and unverified', () => {
      const suiPrice = priceCache.getPriceBySymbol('SUI');
      expect(suiPrice).toBeDefined();

      // Check with a fresh dummy struct that only has seed default
      const isDefault = priceCache.isPriceDefaultSeed('0x2::sui::SUI');
      // If SUI was updated by earlier test suites, check against a pure seed symbol like IKA or BLUB
      const blubPrice = priceCache.getPriceBySymbol('BLUB');
      expect(blubPrice?.isDefaultSeed).toBe(true);
      expect(priceCache.isPriceFresh(blubPrice!.coinType)).toBe(false);
    });

    it('considers real Pyth update as verified and fresh', () => {
      const TEST_COIN = '0xTestCoin::test::TEST';
      priceCache.updatePrice({
        symbol: 'TEST_FRESH',
        coinType: TEST_COIN,
        price: 10.0,
        confidence: 0,
        exponent: -8,
        rawPrice: 1000000000n,
        publishTime: Math.floor(Date.now() / 1000),
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      });

      expect(priceCache.isPriceFresh(TEST_COIN, 60_000)).toBe(true);
      expect(priceCache.isPriceDefaultSeed(TEST_COIN)).toBe(false);
    });

    it('rejects prices that are older than maxAgeMs', () => {
      const TEST_EXPIRED = '0xExpired::test::EXP';
      priceCache.updatePrice({
        symbol: 'TEST_EXP',
        coinType: TEST_EXPIRED,
        price: 5.0,
        confidence: 0,
        exponent: -8,
        rawPrice: 500000000n,
        publishTime: Math.floor((Date.now() - 100_000) / 1000),
        lastUpdatedMs: Date.now() - 100_000, // 100 seconds old
        isDefaultSeed: false,
      });

      expect(priceCache.isPriceFresh(TEST_EXPIRED, 60_000)).toBe(false);
    });

    it('rejects a stale source timestamp even when the response was just received', () => {
      const coinType = '0xStaleSource::test::STALE';
      priceCache.updatePrice({
        symbol: 'TEST_STALE_SOURCE',
        coinType,
        price: 5.0,
        confidence: 0,
        exponent: -8,
        rawPrice: 500000000n,
        publishTime: Math.floor((Date.now() - 30_000) / 1000),
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      });

      expect(priceCache.isPriceFresh(coinType, 10_000)).toBe(false);
    });

    it('rejects future-dated Pyth data and prevents older updates from replacing newer prices', () => {
      const coinType = '0xTimestampOrder::test::PRICE';
      const nowSeconds = Math.floor(Date.now() / 1000);
      priceCache.updatePrice({
        symbol: 'TEST_TIMESTAMP_ORDER',
        coinType,
        price: 10,
        confidence: 0,
        exponent: -8,
        rawPrice: 1000000000n,
        publishTime: nowSeconds,
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      });

      priceCache.updatePrice({
        symbol: 'TEST_TIMESTAMP_ORDER',
        coinType,
        price: 99,
        confidence: 0,
        exponent: -8,
        rawPrice: 9900000000n,
        publishTime: nowSeconds + 10,
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      });
      expect(priceCache.getPriceByCoinType(coinType)?.price).toBe(10);
      expect(priceCache.isPriceFresh(coinType)).toBe(true);

      priceCache.updatePrice({
        symbol: 'TEST_TIMESTAMP_ORDER',
        coinType,
        price: 1,
        confidence: 0,
        exponent: -8,
        rawPrice: 100000000n,
        publishTime: nowSeconds - 1,
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      });
      expect(priceCache.getPriceByCoinType(coinType)?.price).toBe(10);
    });
  });

  describe('5. LiquidationSearcher Bounded Concurrency Queue', () => {
    it('executes concurrent opportunities within limit and does not drop burst arrivals', async () => {
      const { LiquidationSearcher } = await import('../src/engine/searcher.js');
      const { obligationRegistry } = await import('../src/engine/registry.js');
      const testSearcher = new LiquidationSearcher();

      // Seed 5 liquidatable obligations
      for (let i = 1; i <= 5; i++) {
        const obl: ObligationState = {
          protocol: 'navi',
          obligationId: `0xBurstObligation${i}`,
          ownerAddress: `0xBurstOwner${i}`,
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
              amount: 950_000_000n,
              decimals: 6,
              valueUsd: 950,
            },
          ],
          totalCollateralUsd: 1000,
          totalDebtUsd: 950,
          liquidationThresholdCollateralUsd: 800,
          healthFactor: 0.842,
          isLiquidatable: true,
          lastUpdatedMs: Date.now(),
        };
        obligationRegistry.upsertObligation(obl);
      }

      // Ensure SUI and USDC prices are fresh and verified
      priceCache.updatePrice({
        symbol: 'SUI',
        coinType: '0x2::sui::SUI',
        price: 2.0,
        confidence: 0,
        exponent: -8,
        rawPrice: 200_000_000n,
        publishTime: Math.floor(Date.now() / 1000),
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      });
      priceCache.updatePrice({
        symbol: 'USDC',
        coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
        price: 1.0,
        confidence: 0,
        exponent: -8,
        rawPrice: 100_000_000n,
        publishTime: Math.floor(Date.now() / 1000),
        lastUpdatedMs: Date.now(),
        isDefaultSeed: false,
      });

      let maxConcurrentObserved = 0;
      let totalExecuted = 0;

      vi.spyOn(testSearcher, 'executeLiquidationPipeline').mockImplementation(async () => {
        const currentRunning = (testSearcher as any).activePipelineCount as number;
        if (currentRunning > maxConcurrentObserved) {
          maxConcurrentObserved = currentRunning;
        }
        totalExecuted++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return true;
      });

      await testSearcher.processImmediateTargets();

      // Wait briefly for queue to drain
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(maxConcurrentObserved).toBeLessThanOrEqual(3);
      expect(totalExecuted).toBe(5);
      testSearcher.stop();
    });
  });
});
