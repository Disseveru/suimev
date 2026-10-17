import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createDatabaseSync,
  runInTransaction,
  initSchema,
  ObligationRepository,
  stateToRecord,
  recordToState,
} from '../src/persistence/index.js';
import { ObligationRegistry } from '../src/engine/registry.js';
import type { ObligationState } from '../src/types/index.js';

const TEST_DB_DIR = path.resolve('./temp_test_db');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test_persistence.db');

function cleanupTestDb(): void {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    const wal = `${TEST_DB_PATH}-wal`;
    const shm = `${TEST_DB_PATH}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
    if (fs.existsSync(TEST_DB_DIR)) fs.rmdirSync(TEST_DB_DIR);
  } catch {
    // Ignore cleanup errors
  }
}

describe('Milestone 2: State Persistence Layer with SQLite (Requirement R1)', () => {
  beforeEach(() => {
    cleanupTestDb();
  });

  afterEach(() => {
    cleanupTestDb();
  });

  // 1. SQLite database initialization
  describe('Database Initialization & Pragmas', () => {
    it('initializes in-memory database with mandatory pragmas and schema tables', () => {
      const db = createDatabaseSync({
        dbPath: ':memory:',
        foreignKeys: true,
        busyTimeoutMs: 5000,
      });

      // Verify pragmas
      const fkResult = db.prepare('PRAGMA foreign_keys;').get() as { foreign_keys: number };
      expect(fkResult.foreign_keys).toBe(1);

      const timeoutResult = db.prepare('PRAGMA busy_timeout;').get() as { timeout: number };
      expect(timeoutResult.timeout).toBe(5000);

      // Verify schema tables exist
      initSchema(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('obligations');
      expect(tableNames).toContain('collaterals');
      expect(tableNames).toContain('debts');

      // Verify indices exist
      const indices = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index';")
        .all() as { name: string }[];
      const indexNames = indices.map((i) => i.name);

      expect(indexNames).toContain('idx_obligations_protocol');
      expect(indexNames).toContain('idx_obligations_hf');
      expect(indexNames).toContain('idx_obligations_is_active');
      expect(indexNames).toContain('idx_collaterals_obligation_id');
      expect(indexNames).toContain('idx_debts_obligation_id');

      db.close();
    });

    it('initializes disk-based database in WAL mode and creates parent directories', () => {
      expect(fs.existsSync(TEST_DB_DIR)).toBe(false);

      const db = createDatabaseSync({
        dbPath: TEST_DB_PATH,
        journalMode: 'WAL',
        busyTimeoutMs: 5000,
      });

      expect(fs.existsSync(TEST_DB_DIR)).toBe(true);
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

      const journalResult = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      expect(journalResult.journal_mode.toLowerCase()).toBe('wal');

      db.close();
    });
  });

  // 2. Storing mock obligations (Scallop, NAVI) with full collateral and debt details
  describe('Obligation Storage & Relational Detail Preservation', () => {
    it('stores and retrieves mock Scallop and NAVI obligations preserving BigInt balances', () => {
      const repo = new ObligationRepository(':memory:');

      const mockScallop: ObligationState = {
        protocol: 'scallop',
        obligationId: '0x33fee6c01c25a4925ca053df2c99f0cb9d0c5c4985595b6e8eee5b66ebedb277',
        ownerAddress: '0xscallop_borrower_addr_000000000000000000000000000000000000000001',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 150000000000n, // 150 SUI (9 decimals)
            decimals: 9,
            valueUsd: 300.0,
            liquidationThreshold: 0.8,
          },
          {
            coinType: '0x5d4b302506645c30f504a971382fb7702587f8406438099a527389130939bd60::coin::COIN',
            symbol: 'USDC',
            amount: 50000000n, // 50 USDC (6 decimals)
            decimals: 6,
            valueUsd: 50.0,
            liquidationThreshold: 0.85,
          },
        ],
        debts: [
          {
            coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
            symbol: 'USDT',
            amount: 280000000n, // 280 USDT (6 decimals)
            decimals: 6,
            valueUsd: 280.0,
          },
        ],
        totalCollateralUsd: 350.0,
        totalDebtUsd: 280.0,
        liquidationThresholdCollateralUsd: 282.5,
        healthFactor: 0.98, // Liquidatable!
        isLiquidatable: true,
        lastUpdatedMs: 1728000000000,
        scallopObligationKey: '0xnftkey_scallop_00000000000000000000000000000000000000000000000001',
        liquidateLocked: false,
      };

      const mockNavi: ObligationState = {
        protocol: 'navi',
        obligationId: '0xnavi_borrower_addr_0000000000000000000000000000000000000000000002',
        ownerAddress: '0xnavi_borrower_addr_0000000000000000000000000000000000000000000002',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 500000000000n, // 500 SUI
            decimals: 9,
            valueUsd: 1000.0,
            liquidationThreshold: 0.75,
          },
        ],
        debts: [
          {
            coinType: '0x5d4b302506645c30f504a971382fb7702587f8406438099a527389130939bd60::coin::COIN',
            symbol: 'USDC',
            amount: 700000000n, // 700 USDC
            decimals: 6,
            valueUsd: 700.0,
          },
        ],
        totalCollateralUsd: 1000.0,
        totalDebtUsd: 700.0,
        liquidationThresholdCollateralUsd: 750.0,
        healthFactor: 1.0714,
        isLiquidatable: false,
        lastUpdatedMs: 1728000001000,
        naviAccountCap: '0xcap_navi_0000000000000000000000000000000000000000000000000000000002',
      };

      repo.upsertState(mockScallop);
      repo.upsertState(mockNavi);

      // Verify retrieval by obligation ID
      const retrievedScallop = repo.getObligationState(mockScallop.obligationId);
      expect(retrievedScallop).not.toBeNull();
      expect(retrievedScallop?.protocol).toBe('scallop');
      expect(retrievedScallop?.obligationId).toBe(mockScallop.obligationId);
      expect(retrievedScallop?.ownerAddress).toBe(mockScallop.ownerAddress);
      expect(retrievedScallop?.healthFactor).toBeCloseTo(0.98);
      expect(retrievedScallop?.isLiquidatable).toBe(true);
      expect(retrievedScallop?.scallopObligationKey).toBe(mockScallop.scallopObligationKey);

      // Verify BigInt balances preserved exactly
      expect(retrievedScallop?.collaterals).toHaveLength(2);
      expect(retrievedScallop?.collaterals[0].amount).toBe(150000000000n);
      expect(typeof retrievedScallop?.collaterals[0].amount).toBe('bigint');
      expect(retrievedScallop?.collaterals[1].amount).toBe(50000000n);
      expect(retrievedScallop?.debts).toHaveLength(1);
      expect(retrievedScallop?.debts[0].amount).toBe(280000000n);
      expect(typeof retrievedScallop?.debts[0].amount).toBe('bigint');

      // Verify NAVI position
      const retrievedNavi = repo.getObligationState(mockNavi.obligationId);
      expect(retrievedNavi).not.toBeNull();
      expect(retrievedNavi?.protocol).toBe('navi');
      expect(retrievedNavi?.healthFactor).toBeCloseTo(1.0714);
      expect(retrievedNavi?.isLiquidatable).toBe(false);
      expect(retrievedNavi?.naviAccountCap).toBe(mockNavi.naviAccountCap);
      expect(retrievedNavi?.collaterals[0].amount).toBe(500000000000n);
      expect(retrievedNavi?.debts[0].amount).toBe(700000000n);

      // Verify normalized collaterals and debts rows in SQLite
      const rawDb = repo.getRawDatabase();
      const colRows = rawDb.prepare('SELECT * FROM collaterals;').all() as any[];
      expect(colRows).toHaveLength(3); // 2 Scallop + 1 NAVI
      expect(colRows.map((r) => r.symbol)).toContain('SUI');
      expect(colRows.map((r) => r.symbol)).toContain('USDC');

      const debtRows = rawDb.prepare('SELECT * FROM debts;').all() as any[];
      expect(debtRows).toHaveLength(2); // 1 Scallop + 1 NAVI
      expect(debtRows.map((r) => r.symbol)).toContain('USDT');
      expect(debtRows.map((r) => r.symbol)).toContain('USDC');

      repo.close();
    });

    it('enforces cascading delete when an obligation is removed', () => {
      const repo = new ObligationRepository(':memory:');
      const testObligation: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xdel_target_0001',
        ownerAddress: '0xdel_borrower_0001',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 1000000000n,
            decimals: 9,
            valueUsd: 2.0,
            liquidationThreshold: 0.8,
          },
        ],
        debts: [
          {
            coinType: '0x5d4b::coin::COIN',
            symbol: 'USDC',
            amount: 1000000n,
            decimals: 6,
            valueUsd: 1.0,
          },
        ],
        totalCollateralUsd: 2.0,
        totalDebtUsd: 1.0,
        liquidationThresholdCollateralUsd: 1.6,
        healthFactor: 1.6,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      repo.upsertState(testObligation);
      const rawDb = repo.getRawDatabase();

      expect(rawDb.prepare('SELECT count(*) as c FROM obligations;').get()).toEqual({ c: 1 });
      expect(rawDb.prepare('SELECT count(*) as c FROM collaterals;').get()).toEqual({ c: 1 });
      expect(rawDb.prepare('SELECT count(*) as c FROM debts;').get()).toEqual({ c: 1 });

      repo.deleteObligation(testObligation.obligationId);

      expect(rawDb.prepare('SELECT count(*) as c FROM obligations;').get()).toEqual({ c: 0 });
      expect(rawDb.prepare('SELECT count(*) as c FROM collaterals;').get()).toEqual({ c: 0 });
      expect(rawDb.prepare('SELECT count(*) as c FROM debts;').get()).toEqual({ c: 0 });

      repo.close();
    });
  });

  // 3. Retrieving across simulated process reboots
  describe('Simulated Process Reboot Survival', () => {
    it('persists state to disk and reloads identically across independent database lifecycle instances', () => {
      const mockPositions: ObligationState[] = [
        {
          protocol: 'scallop',
          obligationId: '0xscallop_reboot_test_1',
          ownerAddress: '0xscallop_owner_reboot_1',
          collaterals: [
            {
              coinType: '0x2::sui::SUI',
              symbol: 'SUI',
              amount: 888888888888n,
              decimals: 9,
              valueUsd: 1777.77,
              liquidationThreshold: 0.8,
            },
          ],
          debts: [
            {
              coinType: '0x5d4b::coin::COIN',
              symbol: 'USDC',
              amount: 1500000000n,
              decimals: 6,
              valueUsd: 1500.0,
            },
          ],
          totalCollateralUsd: 1777.77,
          totalDebtUsd: 1500.0,
          liquidationThresholdCollateralUsd: 1422.21,
          healthFactor: 0.948,
          isLiquidatable: true,
          lastUpdatedMs: 1728100000000,
          scallopObligationKey: '0xkey_reboot_1',
        },
        {
          protocol: 'navi',
          obligationId: '0xnavi_reboot_test_2',
          ownerAddress: '0xnavi_owner_reboot_2',
          collaterals: [
            {
              coinType: '0x2::sui::SUI',
              symbol: 'SUI',
              amount: 999999999999n,
              decimals: 9,
              valueUsd: 2000.0,
              liquidationThreshold: 0.75,
            },
          ],
          debts: [
            {
              coinType: '0xc060::coin::COIN',
              symbol: 'USDT',
              amount: 1000000000n,
              decimals: 6,
              valueUsd: 1000.0,
            },
          ],
          totalCollateralUsd: 2000.0,
          totalDebtUsd: 1000.0,
          liquidationThresholdCollateralUsd: 1500.0,
          healthFactor: 1.5,
          isLiquidatable: false,
          lastUpdatedMs: 1728100001000,
          naviAccountCap: '0xcap_reboot_2',
        },
      ];

      // --- PHASE 1: Process Instance 1 writes data ---
      const repo1 = new ObligationRepository(TEST_DB_PATH);
      repo1.upsertStates(mockPositions);

      const countBefore = repo1.getAllActiveObligations().length;
      expect(countBefore).toBe(2);

      // Simulate crash / graceful shutdown
      repo1.close();

      // --- PHASE 2: Process Instance 2 (Cold Boot Rebirth) ---
      const repo2 = new ObligationRepository(TEST_DB_PATH);
      const recoveredStates = repo2.getAllActiveStates();

      expect(recoveredStates).toHaveLength(2);

      // Scallop verification
      const recoveredScallop = repo2.getObligationState('0xscallop_reboot_test_1');
      expect(recoveredScallop).not.toBeNull();
      expect(recoveredScallop?.protocol).toBe('scallop');
      expect(recoveredScallop?.healthFactor).toBeCloseTo(0.948);
      expect(recoveredScallop?.isLiquidatable).toBe(true);
      expect(recoveredScallop?.scallopObligationKey).toBe('0xkey_reboot_1');
      expect(recoveredScallop?.collaterals[0].amount).toBe(888888888888n);
      expect(recoveredScallop?.debts[0].amount).toBe(1500000000n);

      // NAVI verification
      const recoveredNavi = repo2.getObligationState('0xnavi_reboot_test_2');
      expect(recoveredNavi).not.toBeNull();
      expect(recoveredNavi?.protocol).toBe('navi');
      expect(recoveredNavi?.healthFactor).toBeCloseTo(1.5);
      expect(recoveredNavi?.naviAccountCap).toBe('0xcap_reboot_2');
      expect(recoveredNavi?.collaterals[0].amount).toBe(999999999999n);
      expect(recoveredNavi?.debts[0].amount).toBe(1000000000n);

      repo2.close();
    });
  });

  // 4. ObligationRegistry boot rehydration and tracking continuity
  describe('ObligationRegistry Boot Rehydration & Tracking Continuity', () => {
    it('rehydrates registry priority buckets on boot from SQLite persistence', () => {
      // Seed SQLite database
      const diskRepo = new ObligationRepository(TEST_DB_PATH);

      const urgentScallop: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xscallop_urgent_1',
        ownerAddress: '0xowner_urgent',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 50000000000n,
            decimals: 9,
            valueUsd: 100.0,
            liquidationThreshold: 0.8,
          },
        ],
        debts: [
          {
            coinType: '0x5d4b::coin::COIN',
            symbol: 'USDC',
            amount: 90000000n,
            decimals: 6,
            valueUsd: 90.0,
          },
        ],
        totalCollateralUsd: 100.0,
        totalDebtUsd: 90.0,
        liquidationThresholdCollateralUsd: 80.0,
        healthFactor: 0.888, // < 1.0 => Immediate Target!
        isLiquidatable: true,
        lastUpdatedMs: Date.now(),
      };

      const borderlineNavi: ObligationState = {
        protocol: 'navi',
        obligationId: '0xnavi_borderline_2',
        ownerAddress: '0xowner_borderline',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 100000000000n,
            decimals: 9,
            valueUsd: 200.0,
            liquidationThreshold: 0.75,
          },
        ],
        debts: [
          {
            coinType: '0x5d4b::coin::COIN',
            symbol: 'USDC',
            amount: 145000000n,
            decimals: 6,
            valueUsd: 145.0,
          },
        ],
        totalCollateralUsd: 200.0,
        totalDebtUsd: 145.0,
        liquidationThresholdCollateralUsd: 150.0,
        healthFactor: 1.034, // 1.0 <= HF < 1.05 => Hot Watchlist!
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      const safeNavi: ObligationState = {
        protocol: 'navi',
        obligationId: '0xnavi_safe_3',
        ownerAddress: '0xowner_safe',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 200000000000n,
            decimals: 9,
            valueUsd: 400.0,
            liquidationThreshold: 0.75,
          },
        ],
        debts: [
          {
            coinType: '0x5d4b::coin::COIN',
            symbol: 'USDC',
            amount: 100000000n,
            decimals: 6,
            valueUsd: 100.0,
          },
        ],
        totalCollateralUsd: 400.0,
        totalDebtUsd: 100.0,
        liquidationThresholdCollateralUsd: 300.0,
        healthFactor: 3.0, // >= 1.05 => Safe Watchlist!
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      diskRepo.upsertStates([urgentScallop, borderlineNavi, safeNavi]);
      diskRepo.close();

      // Cold start registry: empty memory state
      const freshRegistry = ObligationRegistry.createForTesting();
      expect(freshRegistry.getCounts().total).toBe(0);

      // Rehydrate from disk persistence
      const persistentRepo = new ObligationRepository(TEST_DB_PATH);
      const rehydratedCount = freshRegistry.loadFromPersistence(persistentRepo);

      expect(rehydratedCount).toBe(3);

      const counts = freshRegistry.getCounts();
      expect(counts.total).toBe(3);
      expect(counts.immediate).toBe(1);
      expect(counts.hot).toBe(1);
      expect(counts.safe).toBe(1);

      // Verify specific obligations landed in correct buckets
      const immediateTargets = freshRegistry.getImmediateTargets();
      expect(immediateTargets).toHaveLength(1);
      expect(immediateTargets[0].obligationId).toBe('0xscallop_urgent_1');
      expect(immediateTargets[0].protocol).toBe('scallop');

      const hotWatchlist = freshRegistry.getHotWatchlist();
      expect(hotWatchlist).toHaveLength(1);
      expect(hotWatchlist[0].obligationId).toBe('0xnavi_borderline_2');

      const safeWatchlist = freshRegistry.getSafeWatchlist();
      expect(safeWatchlist).toHaveLength(1);
      expect(safeWatchlist[0].obligationId).toBe('0xnavi_safe_3');

      // Test tracking continuity: update state in registry and confirm SQLite is synchronized
      const updatedBorderline = {
        ...borderlineNavi,
        totalDebtUsd: 160.0,
        healthFactor: 0.9375, // Now breached HF < 1.0!
        isLiquidatable: true,
      };

      freshRegistry.upsertObligation(updatedBorderline);

      // Registry counts updated
      const updatedCounts = freshRegistry.getCounts();
      expect(updatedCounts.immediate).toBe(2);
      expect(updatedCounts.hot).toBe(0);

      // SQLite database updated synchronously
      const dbRecord = persistentRepo.getObligationState('0xnavi_borderline_2');
      expect(dbRecord?.healthFactor).toBeCloseTo(0.9375);
      expect(dbRecord?.isLiquidatable).toBe(true);

      // Test delete synchronization
      freshRegistry.deleteObligation('scallop', '0xscallop_urgent_1');
      expect(freshRegistry.getCounts().total).toBe(2);
      expect(persistentRepo.getObligation('0xscallop_urgent_1')).toBeNull();

      persistentRepo.close();
    });

    it('persists and rehydrates state using default ObligationRegistry instance without manual injection', () => {
      const prevEnv = process.env.SQLITE_DB_PATH;
      process.env.SQLITE_DB_PATH = TEST_DB_PATH;

      try {
        // Reset any existing singleton instance
        ObligationRegistry.resetInstance(true);

        // Instantiate default singleton without injecting any repository
        const liveRegistry = ObligationRegistry.getInstance();
        expect(liveRegistry.getRepository()).toBeDefined();

        const testObligation: ObligationState = {
          protocol: 'navi',
          obligationId: '0xdefault_wire_test',
          ownerAddress: '0xowner_wire_test',
          collaterals: [
            {
              coinType: '0x2::sui::SUI',
              symbol: 'SUI',
              amount: 1000000000n,
              decimals: 9,
              valueUsd: 50.0,
              liquidationThreshold: 0.8,
            },
          ],
          debts: [
            {
              coinType: '0x5d4b::coin::COIN',
              symbol: 'USDC',
              amount: 25000000n,
              decimals: 6,
              valueUsd: 25.0,
            },
          ],
          totalCollateralUsd: 50.0,
          totalDebtUsd: 25.0,
          liquidationThresholdCollateralUsd: 40.0,
          healthFactor: 1.6,
          isLiquidatable: false,
          lastUpdatedMs: Date.now(),
        };

        // Live write-through: upsertObligation automatically writes to SQLite via default repository
        liveRegistry.upsertObligation(testObligation);

        // Verify default repository stored the record
        const repo = liveRegistry.getRepository() as ObligationRepository;
        expect(repo).toBeDefined();
        const persisted = repo.getObligationState('0xdefault_wire_test');
        expect(persisted).not.toBeNull();
        expect(persisted?.obligationId).toBe('0xdefault_wire_test');
        expect(persisted?.totalDebtUsd).toBe(25.0);

        // Simulate process reboot: reset singleton and close db
        ObligationRegistry.resetInstance(true);

        // Boot a completely fresh registry instance with default wiring (no repository argument)
        const rebootRegistry = ObligationRegistry.getInstance();
        expect(rebootRegistry.getCounts().total).toBe(0);

        // Call boot rehydration with no repository argument
        const rehydratedCount = rebootRegistry.loadFromPersistence();
        expect(rehydratedCount).toBe(1);
        expect(rebootRegistry.getCounts().total).toBe(1);

        const loadedState = rebootRegistry.getAllObligations()[0];
        expect(loadedState.obligationId).toBe('0xdefault_wire_test');
        expect(loadedState.totalDebtUsd).toBe(25.0);
        expect(loadedState.healthFactor).toBeCloseTo(1.6);
        expect(loadedState.collaterals[0].amount).toBe(1000000000n);
        expect(loadedState.debts[0].amount).toBe(25000000n);

        // Verify live deletion writes through to SQLite as well
        rebootRegistry.deleteObligation('navi', '0xdefault_wire_test');
        expect(rebootRegistry.getCounts().total).toBe(0);
        const rebootRepo = rebootRegistry.getRepository() as ObligationRepository;
        expect(rebootRepo.getObligation('0xdefault_wire_test')).toBeNull();
      } finally {
        ObligationRegistry.resetInstance(true);
        if (prevEnv !== undefined) {
          process.env.SQLITE_DB_PATH = prevEnv;
        } else {
          delete process.env.SQLITE_DB_PATH;
        }
      }
    });
  });

  // 5. Query filtering and transaction rollback
  describe('Query Capabilities & Transaction Atomicity', () => {
    it('supports protocol and health factor filtering', () => {
      const repo = new ObligationRepository(':memory:');

      const states: ObligationState[] = [
        {
          protocol: 'scallop',
          obligationId: '0xscallop_1',
          ownerAddress: '0xowner_1',
          collaterals: [],
          debts: [{ coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 100n, decimals: 9, valueUsd: 10 }],
          totalCollateralUsd: 10,
          totalDebtUsd: 10,
          liquidationThresholdCollateralUsd: 8,
          healthFactor: 0.8,
          isLiquidatable: true,
          lastUpdatedMs: 1000,
        },
        {
          protocol: 'scallop',
          obligationId: '0xscallop_2',
          ownerAddress: '0xowner_2',
          collaterals: [],
          debts: [{ coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 50n, decimals: 9, valueUsd: 5 }],
          totalCollateralUsd: 10,
          totalDebtUsd: 5,
          liquidationThresholdCollateralUsd: 8,
          healthFactor: 1.6,
          isLiquidatable: false,
          lastUpdatedMs: 2000,
        },
        {
          protocol: 'navi',
          obligationId: '0xnavi_1',
          ownerAddress: '0xowner_3',
          collaterals: [],
          debts: [{ coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 200n, decimals: 9, valueUsd: 20 }],
          totalCollateralUsd: 20,
          totalDebtUsd: 20,
          liquidationThresholdCollateralUsd: 15,
          healthFactor: 0.75,
          isLiquidatable: true,
          lastUpdatedMs: 3000,
        },
      ];

      repo.upsertStates(states);

      // Filter by protocol
      const scallopOnly = repo.query({ protocol: 'scallop' });
      expect(scallopOnly).toHaveLength(2);

      const naviOnly = repo.query({ protocol: 'navi' });
      expect(naviOnly).toHaveLength(1);

      // Filter by liquidatable
      const liquidatableOnly = repo.query({ isLiquidatable: true });
      expect(liquidatableOnly).toHaveLength(2);

      // Filter by maxHealthFactor
      const hfUnderOne = repo.query({ maxHealthFactor: 1.0 });
      expect(hfUnderOne).toHaveLength(2);
      expect(hfUnderOne[0].healthFactor).toBeLessThanOrEqual(hfUnderOne[1].healthFactor); // Ordered ASC

      repo.close();
    });

    it('rolls back database modifications when a transaction throws an error', () => {
      const repo = new ObligationRepository(':memory:');
      const rawDb = repo.getRawDatabase();

      expect(() => {
        runInTransaction(rawDb, () => {
          rawDb
            .prepare(
              `INSERT INTO obligations (
              id, protocol, borrower, obligation_id, health_factor,
              collateral_usd, debt_usd, updated_at, is_active, created_at
            ) VALUES ('err_1', 'scallop', '0xb', '0xb', 1.0, 10, 10, 100, 1, 100)`
            )
            .run();

          // Intentional failure
          throw new Error('Simulation transaction failure');
        });
      }).toThrow('Simulation transaction failure');

      const count = rawDb.prepare('SELECT count(*) as c FROM obligations;').get() as { c: number };
      expect(count.c).toBe(0);

      repo.close();
    });
  });
});
