import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Transaction } from '@mysten/sui/transactions';
import {
  createDatabaseSync,
  initSchema,
  ObligationRepository,
  stateToRecord,
  recordToState,
} from '../src/persistence/index.js';
import { ObligationRegistry } from '../src/engine/registry.js';
import {
  SoftBundleClient,
  PgaFallbackBroadcaster,
  ExecutionRouter,
  SlippageGuard,
  SlippageExceededError,
  TransactionBatcher,
  MAX_SUI_PTB_COMMANDS,
} from '../src/execution/index.js';
import { GasPriceCalibrator, gasPriceCalibrator } from '../src/security/index.js';
import { TransactionExecutor } from '../src/engine/executor.js';
import * as canonicalTypes from '../src/types/index.js';
import type {
  ObligationState,
  LiquidationOpportunity,
  ExecutionPlan,
  SoftBundlePayload,
} from '../src/types/index.js';

const M5_TEST_DB_DIR = path.resolve('./temp_challenger_m5_db');
const M5_TEST_DB_PATH = path.join(M5_TEST_DB_DIR, 'challenger_m5.db');

function cleanupM5TestDb(): void {
  try {
    if (fs.existsSync(M5_TEST_DB_PATH)) fs.unlinkSync(M5_TEST_DB_PATH);
    const wal = `${M5_TEST_DB_PATH}-wal`;
    const shm = `${M5_TEST_DB_PATH}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
    if (fs.existsSync(M5_TEST_DB_DIR)) fs.rmdirSync(M5_TEST_DB_DIR);
  } catch {
    // Ignore cleanup errors
  }
}

function makeAddress(id: number | string): string {
  if (typeof id === 'string' && id.startsWith('0x') && id.length === 66) {
    return id;
  }
  const hex = typeof id === 'number' ? id.toString(16) : Buffer.from(String(id)).toString('hex');
  return '0x' + hex.padStart(64, '0').slice(-64);
}

function makeOpportunity(id: number | string, overrides?: Partial<LiquidationOpportunity>): LiquidationOpportunity {
  const addr = makeAddress(id);
  const obligation: ObligationState = {
    protocol: 'navi',
    obligationId: addr,
    ownerAddress: addr,
    totalCollateralUsd: 150,
    totalDebtUsd: 100,
    liquidationThresholdCollateralUsd: 120,
    healthFactor: 0.95,
    isLiquidatable: true,
    lastUpdatedMs: Date.now(),
    collaterals: [
      {
        coinType: '0x2::sui::SUI',
        symbol: 'SUI',
        amount: 60_000_000_000n,
        decimals: 9,
        valueUsd: 150,
        liquidationThreshold: 0.8,
      },
    ],
    debts: [
      {
        coinType: '0x5d4b::coin::COIN',
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
    debtCoinType: '0x5d4b::coin::COIN',
    debtSymbol: 'USDC',
    debtAmountToRepay: 50_000_000n,
    debtRepayUsd: 50.0,
    collateralCoinType: '0x2::sui::SUI',
    collateralSymbol: 'SUI',
    collateralToReceive: 24_000_000_000n,
    collateralReceiveUsd: 60.0,
    expectedGrossProfitUsd: 10.0,
    dex: 'deepbook',
    liquidationBonus: 0.05,
    ...overrides,
  };
}

describe('Challenger M5: Comprehensive Adversarial Acceptance Verification', () => {
  beforeEach(() => {
    cleanupM5TestDb();
  });

  afterEach(() => {
    cleanupM5TestDb();
  });

  // =========================================================================
  // CRITERION 1: SQLite Database Initialization, Mock Storage & Reboot Retrieval
  // =========================================================================
  describe('Criterion 1: SQLite Persistence & Reboot Retrieval', () => {
    it('initializes SQLite with WAL pragma and verifies full schema DDL', () => {
      const db = createDatabaseSync({
        dbPath: M5_TEST_DB_PATH,
        journalMode: 'WAL',
        foreignKeys: true,
        busyTimeoutMs: 5000,
      });

      const fk = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      expect(fk.foreign_keys).toBe(1);

      const journal = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      expect(journal.journal_mode.toLowerCase()).toBe('wal');

      initSchema(db);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain('obligations');
      expect(names).toContain('collaterals');
      expect(names).toContain('debts');

      db.close();
    });

    it('stores mock Scallop and NAVI obligations preserving BigInts, metadata, and handles crash reboot', () => {
      const scallopObl: ObligationState = {
        protocol: 'scallop',
        obligationId: makeAddress('scallop_crash_test_1'),
        ownerAddress: makeAddress('scallop_owner_1'),
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 18446744073709551615n, // max uint64 boundary
            decimals: 9,
            valueUsd: 46116860184.27,
            liquidationThreshold: 0.8,
          },
        ],
        debts: [
          {
            coinType: '0x5d4b::coin::COIN',
            symbol: 'USDC',
            amount: 50000000000000n,
            decimals: 6,
            valueUsd: 50000000.0,
          },
        ],
        totalCollateralUsd: 46116860184.27,
        totalDebtUsd: 50000000.0,
        liquidationThresholdCollateralUsd: 36893488147.41,
        healthFactor: 0.92,
        isLiquidatable: true,
        lastUpdatedMs: 1729000000000,
        scallopObligationKey: '0xscallop_nft_key_xyz',
      };

      const naviObl: ObligationState = {
        protocol: 'navi',
        obligationId: makeAddress('navi_crash_test_2'),
        ownerAddress: makeAddress('navi_owner_2'),
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 500_000_000_000n,
            decimals: 9,
            valueUsd: 1250.0,
            liquidationThreshold: 0.75,
          },
        ],
        debts: [
          {
            coinType: '0x5d4b::coin::COIN',
            symbol: 'USDC',
            amount: 800_000_000n,
            decimals: 6,
            valueUsd: 800.0,
          },
        ],
        totalCollateralUsd: 1250.0,
        totalDebtUsd: 800.0,
        liquidationThresholdCollateralUsd: 937.5,
        healthFactor: 1.1718,
        isLiquidatable: false,
        lastUpdatedMs: 1729000001000,
        naviAccountCap: '0xnavi_cap_object_123',
      };

      // 1. Initial process writes to disk
      const repo1 = new ObligationRepository(M5_TEST_DB_PATH);
      repo1.upsertState(scallopObl);
      repo1.upsertState(naviObl);
      expect(repo1.getAllActiveObligations()).toHaveLength(2);

      // Simulate crash shutdown
      repo1.close();

      // 2. Cold process reboot recovers identical state
      const repo2 = new ObligationRepository(M5_TEST_DB_PATH);
      const recoveredScallop = repo2.getObligationState(scallopObl.obligationId);
      expect(recoveredScallop).not.toBeNull();
      expect(recoveredScallop?.protocol).toBe('scallop');
      expect(recoveredScallop?.healthFactor).toBeCloseTo(0.92);
      expect(recoveredScallop?.isLiquidatable).toBe(true);
      expect(recoveredScallop?.scallopObligationKey).toBe('0xscallop_nft_key_xyz');
      expect(recoveredScallop?.collaterals[0].amount).toBe(18446744073709551615n);
      expect(recoveredScallop?.debts[0].amount).toBe(50000000000000n);

      const recoveredNavi = repo2.getObligationState(naviObl.obligationId);
      expect(recoveredNavi).not.toBeNull();
      expect(recoveredNavi?.protocol).toBe('navi');
      expect(recoveredNavi?.healthFactor).toBeCloseTo(1.1718);
      expect(recoveredNavi?.naviAccountCap).toBe('0xnavi_cap_object_123');
      expect(recoveredNavi?.collaterals[0].amount).toBe(500_000_000_000n);
      expect(recoveredNavi?.debts[0].amount).toBe(800_000_000n);

      // 3. Test registry boot rehydration into proper priority buckets
      const freshRegistry = ObligationRegistry.createForTesting(repo2);
      const rehydratedCount = freshRegistry.loadFromPersistence();
      expect(rehydratedCount).toBe(2);

      const immediate = freshRegistry.getImmediateTargets();
      expect(immediate).toHaveLength(1);
      expect(immediate[0].obligationId).toBe(scallopObl.obligationId);

      const safe = freshRegistry.getSafeWatchlist();
      expect(safe).toHaveLength(1);
      expect(safe[0].obligationId).toBe(naviObl.obligationId);

      repo2.close();
    });
  });

  // =========================================================================
  // CRITERION 2: Soft Bundles vs PGA Routing, Failover, Slippage & Batch Limits
  // =========================================================================
  describe('Criterion 2: Execution Architecture, Routing & Failovers', () => {
    it('verifies explicit separation of SoftBundleClient and PgaFallbackBroadcaster', () => {
      const softClient = new SoftBundleClient();
      const pgaBroadcaster = new PgaFallbackBroadcaster();
      const router = new ExecutionRouter(softClient, pgaBroadcaster);

      expect(router.getSoftBundleClient()).toBe(softClient);
      expect(router.getPgaFallback()).toBe(pgaBroadcaster);

      // Verify SoftBundle packaging creates valid base64 payload
      const payload = softClient.packageBundle(['dGVzdF90eF9ieXRlcw=='], {
        bundleId: 'm5_test_bundle',
        tipAmountMist: 50_000_000n,
      });
      expect(payload.bundleId).toBe('m5_test_bundle');
      expect(payload.transactions).toEqual(['dGVzdF90eF9ieXRlcw==']);
      expect(payload.tipAmountMist).toBe(50_000_000n);
    });

    it('fails over to PGA fallback on sequencer timeout (AbortError)', async () => {
      // Mock fetch that hangs or throws AbortError
      const mockTimeoutFetch = vi.fn().mockImplementation(async () => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      });

      const softClient = new SoftBundleClient({ timeoutMs: 50 }, mockTimeoutFetch as any);
      const pgaBroadcaster = new PgaFallbackBroadcaster();
      const router = new ExecutionRouter(softClient, pgaBroadcaster);

      const tx = new Transaction();
      const opp = makeOpportunity(1);

      // Set gas price calibrator mock to permit
      vi.spyOn(gasPriceCalibrator, 'evaluateProfitabilityAtP95').mockResolvedValue({
        isProfitable: true,
        grossProfitUsd: 10,
        estimatedSwapFeeUsd: 0.1,
        p95GasCostUsd: 1.0,
        calibratedNetProfitUsd: 8.9,
        p95GasPrice: 1500n,
        thresholdUsd: 5.0,
      });

      const result = await router.broadcast(tx, opp);

      expect(mockTimeoutFetch).toHaveBeenCalled();
      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('success');
      expect(result.digest).toBeDefined();
      expect(typeof result.digest).toBe('string');
      expect(result.digest.length).toBeGreaterThan(0);
    });

    it('fails over to PGA fallback on sequencer HTTP 500 error', async () => {
      const mock500Fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Sequencer Consensus Node Unavailable',
      });

      const softClient = new SoftBundleClient({}, mock500Fetch as any);
      const pgaBroadcaster = new PgaFallbackBroadcaster();
      const router = new ExecutionRouter(softClient, pgaBroadcaster);

      const tx = new Transaction();
      const opp = makeOpportunity(2);

      vi.spyOn(gasPriceCalibrator, 'evaluateProfitabilityAtP95').mockResolvedValue({
        isProfitable: true,
        grossProfitUsd: 10,
        estimatedSwapFeeUsd: 0.1,
        p95GasCostUsd: 1.0,
        calibratedNetProfitUsd: 8.9,
        p95GasPrice: 1500n,
        thresholdUsd: 5.0,
      });

      const result = await router.broadcast(tx, opp);

      expect(mock500Fetch).toHaveBeenCalled();
      expect(result.strategyUsed).toBe('pga_fallback');
      expect(result.status).toBe('success');
      expect(result.digest).toBeDefined();
      expect(typeof result.digest).toBe('string');
      expect(result.digest.length).toBeGreaterThan(0);
    });

    it('enforces slippage protection and throws SlippageExceededError', () => {
      // 1% max slippage (100 bps)
      const expected = 1_000_000n;
      const minOut = SlippageGuard.calculateMinimumAmountOut(expected, 100);
      expect(minOut).toBe(990_000n);

      // Exact boundary passes
      const validBoundary = SlippageGuard.validateSlippage(expected, 990_000n, 100);
      expect(validBoundary.isValid).toBe(true);

      // Breach by 1 unit fails
      const breach = SlippageGuard.validateSlippage(expected, 989_999n, 100);
      expect(breach.isValid).toBe(false);
      expect(breach.reason).toContain('Actual output 989999 is below minimum 990000');

      // Price divergence check
      const spotDivergence = SlippageGuard.validatePriceDivergence(2.50, 2.60, 200); // ~385 bps > 200 bps
      expect(spotDivergence.isValid).toBe(false);

      // Enforce throws
      expect(() => {
        SlippageGuard.enforce({
          expectedAmountOut: expected,
          actualAmountOut: 989_999n,
          maxSlippageBps: 100,
        });
      }).toThrow(SlippageExceededError);
    });

    it('enforces Move command batch limits in TransactionBatcher', () => {
      const batcher = new TransactionBatcher({ maxCommands: MAX_SUI_PTB_COMMANDS });
      expect(MAX_SUI_PTB_COMMANDS).toBe(1000);

      // Can batch checks
      expect(batcher.canBatch(900, 20)).toBe(true);
      expect(batcher.canBatch(990, 20)).toBe(false);

      // Gas estimation scaling
      expect(batcher.estimateGasBudget(1)).toBe(27_000_000n);
      expect(batcher.estimateGasBudget(5)).toBe(75_000_000n);
    });
  });

  // =========================================================================
  // CRITERION 3: Clean TypeScript Compilation & Canonical Type Extraction
  // =========================================================================
  describe('Criterion 3: Type Safety & src/types/ Canonical Contracts', () => {
    it('verifies all expected core interfaces exist in src/types/index.ts', () => {
      // Persistence interfaces
      expect(canonicalTypes).toBeDefined();

      // Ensure key interface shapes are exported and valid
      const dummyRepo: canonicalTypes.IObligationRepository = {
        initialize: () => {},
        upsertObligation: () => {},
        getObligation: () => null,
        getAllActiveObligations: () => [],
        deleteObligation: () => {},
        close: () => {},
      };
      expect(dummyRepo).toBeDefined();

      const dummyExecutionService: canonicalTypes.IExecutionService = {
        execute: async () => ({} as any),
        executeSoftBundle: async () => ({} as any),
        executePgaFallback: async () => ({} as any),
      };
      expect(dummyExecutionService).toBeDefined();

      const dummyCalibrator: canonicalTypes.IGasPriceCalibrator = {
        getP95GasPrice: async () => 1000n,
        isProfitableAtP95: async () => true,
      };
      expect(dummyCalibrator).toBeDefined();
    });
  });

  // =========================================================================
  // CRITERION 4: Complete Removal of Bloat Directories
  // =========================================================================
  describe('Criterion 4: Bloat Directories Removal', () => {
    it('verifies evm-mev/, my-app/, and .venv/ directories do not exist', () => {
      const root = path.resolve('.');
      const evmMevPath = path.join(root, 'evm-mev');
      const myAppPath = path.join(root, 'my-app');
      const venvPath = path.join(root, '.venv');
      const scallopSdkPath = path.join(root, 'sui-scallop-sdk');

      expect(fs.existsSync(evmMevPath)).toBe(false);
      expect(fs.existsSync(myAppPath)).toBe(false);
      expect(fs.existsSync(venvPath)).toBe(false);
      expect(fs.existsSync(scallopSdkPath)).toBe(false);
    });
  });

  // =========================================================================
  // CRITERION 5: Pre-Broadcast Profitability Check Against 95th-Percentile Gas Price
  // =========================================================================
  describe('Criterion 5: Pre-Broadcast 95th-Percentile Gas Price Profitability Calculation', () => {
    it('calibrates 95th-percentile gas price from rolling samples and rejects unprofitable opportunities', async () => {
      const calibrator = new GasPriceCalibrator({ defaultGasUnits: 15_000_000n });
      calibrator.clearSamples();

      // Feed rolling gas price samples (1,000 to 10,000 MIST)
      calibrator.recordGasPriceSamples([1000n, 1200n, 1500n, 2000n, 5000n, 10000n]);
      const p95 = await calibrator.getP95GasPrice();
      expect(p95).toBeGreaterThanOrEqual(5000n);

      // Gas cost at P95: 15M units * 10,000 MIST / 1000 = 150,000,000 MIST = 0.15 SUI
      // At $2.50 / SUI -> $0.375 gas cost
      const costUsd = calibrator.estimateGasCostUsd(15_000_000n, 10_000n, 2.5);
      expect(costUsd).toBeCloseTo(0.375);

      // Case A: High Profit Opportunity ($20.00 gross) -> PROFITABLE
      const profitableOpp = makeOpportunity(10, {
        expectedGrossProfitUsd: 20.0,
        collateralReceiveUsd: 100.0,
      });

      const checkProfitable = await calibrator.evaluateProfitabilityAtP95(profitableOpp, {
        suiPriceUsd: 2.5,
        minProfitUsd: 5.0,
        p95GasPrice: p95,
      });
      expect(checkProfitable.isProfitable).toBe(true);
      expect(checkProfitable.calibratedNetProfitUsd).toBeGreaterThan(5.0);
      expect(checkProfitable.reason).toBeUndefined();

      // Case B: Marginal Opportunity ($5.20 gross profit, $0.30 swap fee, $0.375 P95 gas cost -> $4.525 net < $5.00 min threshold) -> UNPROFITABLE
      const unprofitableOpp = makeOpportunity(11, {
        expectedGrossProfitUsd: 5.20,
        collateralReceiveUsd: 100.0,
      });

      const checkUnprofitable = await calibrator.evaluateProfitabilityAtP95(unprofitableOpp, {
        suiPriceUsd: 2.5,
        minProfitUsd: 5.0,
        p95GasPrice: p95,
      });
      expect(checkUnprofitable.isProfitable).toBe(false);
      expect(checkUnprofitable.reason).toContain('Opportunity unprofitable under P95 congestion');
    });

    it('ExecutionRouter explicitly aborts broadcast when opportunity fails P95 check before sequencer or PGA is called', async () => {
      const mockSoftFetch = vi.fn();
      const softClient = new SoftBundleClient({}, mockSoftFetch as any);
      const pgaBroadcaster = new PgaFallbackBroadcaster();
      const pgaSpy = vi.spyOn(pgaBroadcaster, 'broadcast');

      const router = new ExecutionRouter(softClient, pgaBroadcaster);
      const tx = new Transaction();

      // Setup an opportunity that is unprofitable at P95
      const opp = makeOpportunity(99, {
        expectedGrossProfitUsd: 1.0, // Only $1 gross profit
      });

      // Calibrator evaluates to unprofitable
      vi.spyOn(gasPriceCalibrator, 'evaluateProfitabilityAtP95').mockResolvedValue({
        isProfitable: false,
        grossProfitUsd: 1.0,
        estimatedSwapFeeUsd: 0.3,
        p95GasCostUsd: 2.5,
        calibratedNetProfitUsd: -1.8,
        p95GasPrice: 2000n,
        thresholdUsd: 5.0,
        reason: 'Calibrated net profit -$1.80 is below threshold $5.00',
      });

      const broadcastResult = await router.broadcast(tx, opp);

      // Verify immediate rejection
      expect(broadcastResult.status).toBe('failure');
      expect(broadcastResult.digest).toBe('REJECTED_P95_UNPROFITABLE');
      expect(broadcastResult.error).toContain('Calibrated net profit -$1.80 is below threshold $5.00');

      // Neither soft bundle nor PGA broadcaster was ever called
      expect(mockSoftFetch).not.toHaveBeenCalled();
      expect(pgaSpy).not.toHaveBeenCalled();
    });

    it('TransactionExecutor throws when opportunity fails P95 gas price check', async () => {
      const tx = new Transaction();
      const opp = makeOpportunity(100, {
        expectedGrossProfitUsd: 2.0,
      });

      vi.spyOn(gasPriceCalibrator, 'evaluateProfitabilityAtP95').mockResolvedValue({
        isProfitable: false,
        grossProfitUsd: 2.0,
        estimatedSwapFeeUsd: 0.1,
        p95GasCostUsd: 2.5,
        calibratedNetProfitUsd: -0.6,
        p95GasPrice: 2000n,
        thresholdUsd: 5.0,
        reason: 'Unprofitable under P95 congestion',
      });

      await expect(TransactionExecutor.execute(tx, opp, 10.0)).rejects.toThrow(
        /Pre-broadcast P95 Gas Calibration violation/
      );
    });
  });
});
