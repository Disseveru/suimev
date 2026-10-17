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
import type { ObligationState, ProtocolType } from '../src/types/index.js';

const TEST_DB_DIR = path.resolve('./temp_adv_test_db');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'adv_test_persistence.db');

function cleanupAdvTestDb(): void {
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

describe('Adversarial Persistence & Concurrency Verification (Milestone 2 R1)', () => {
  beforeEach(() => {
    cleanupAdvTestDb();
  });

  afterEach(() => {
    cleanupAdvTestDb();
  });

  // =========================================================================
  // 1. MASSIVE BALANCES & NUMERIC PRECISION STRESS TEST
  // =========================================================================
  describe('Massive Balances & Precision Preservation', () => {
    const UINT64_MAX = 18446744073709551615n; // 2^64 - 1
    const UINT128_MAX = 340282366920938463463374607431768211455n; // 2^128 - 1
    const UINT256_MAX = 115792089237316195423570985008687907853269984665640564039457584007913129639935n; // 2^256 - 1
    const INT64_MAX = 9223372036854775807n; // Max signed 64-bit int
    const INT64_OVERFLOW = 9223372036854775808n; // 1 above SQLite signed 64-bit int max

    it('faithfully preserves max uint64, uint128, uint256, and zero balances across disk lifecycle', () => {
      const repo = new ObligationRepository(TEST_DB_PATH);

      const massiveState: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xscallop_massive_balances',
        ownerAddress: '0xowner_massive',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: UINT64_MAX,
            decimals: 9,
            valueUsd: 1e12,
            liquidationThreshold: 0.8,
          },
          {
            coinType: '0x5d4b::coin::COIN',
            symbol: 'USDC',
            amount: UINT128_MAX,
            decimals: 6,
            valueUsd: 1e15,
            liquidationThreshold: 0.85,
          },
          {
            coinType: '0x76b::deep::DEEP',
            symbol: 'DEEP',
            amount: UINT256_MAX,
            decimals: 6,
            valueUsd: 1e18,
            liquidationThreshold: 0.7,
          },
          {
            coinType: '0xzero::coin::ZERO',
            symbol: 'ZERO',
            amount: 0n,
            decimals: 9,
            valueUsd: 0.0,
            liquidationThreshold: 0.5,
          },
          {
            coinType: '0xint64::bound::INT64',
            symbol: 'INT64',
            amount: INT64_OVERFLOW,
            decimals: 9,
            valueUsd: 1e9,
            liquidationThreshold: 0.8,
          },
        ],
        debts: [
          {
            coinType: '0xc060::coin::COIN',
            symbol: 'USDT',
            amount: UINT64_MAX,
            decimals: 6,
            valueUsd: 1e12,
          },
          {
            coinType: '0xdebt256::coin::COIN',
            symbol: 'DEBT256',
            amount: UINT256_MAX,
            decimals: 6,
            valueUsd: 1e18,
          },
          {
            coinType: '0xzero::debt::ZERO',
            symbol: 'ZERO_DEBT',
            amount: 0n,
            decimals: 6,
            valueUsd: 0.0,
          },
        ],
        totalCollateralUsd: 1e18,
        totalDebtUsd: 1e18,
        liquidationThresholdCollateralUsd: 8e17,
        healthFactor: 0.8,
        isLiquidatable: true,
        lastUpdatedMs: 1728500000000,
      };

      repo.upsertState(massiveState);

      // Verify directly from the SQLite normalized tables (checking TEXT storage)
      const rawDb = repo.getRawDatabase();
      const colRows = rawDb.prepare('SELECT coin_type, amount FROM collaterals WHERE obligation_id = ?').all('scallop:0xscallop_massive_balances') as any[];
      expect(colRows).toHaveLength(5);

      const colAmounts = Object.fromEntries(colRows.map((r) => [r.coin_type, r.amount]));
      expect(colAmounts['0x2::sui::SUI']).toBe(UINT64_MAX.toString());
      expect(colAmounts['0x5d4b::coin::COIN']).toBe(UINT128_MAX.toString());
      expect(colAmounts['0x76b::deep::DEEP']).toBe(UINT256_MAX.toString());
      expect(colAmounts['0xzero::coin::ZERO']).toBe('0');
      expect(colAmounts['0xint64::bound::INT64']).toBe(INT64_OVERFLOW.toString());

      const debtRows = rawDb.prepare('SELECT coin_type, amount FROM debts WHERE obligation_id = ?').all('scallop:0xscallop_massive_balances') as any[];
      expect(debtRows).toHaveLength(3);
      const debtAmounts = Object.fromEntries(debtRows.map((r) => [r.coin_type, r.amount]));
      expect(debtAmounts['0xc060::coin::COIN']).toBe(UINT64_MAX.toString());
      expect(debtAmounts['0xdebt256::coin::COIN']).toBe(UINT256_MAX.toString());
      expect(debtAmounts['0xzero::debt::ZERO']).toBe('0');

      // Verify round-trip retrieval via getObligationState (checking BigInt type and precision)
      const retrieved = repo.getObligationState(massiveState.obligationId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.collaterals).toHaveLength(5);

      const retColMap = Object.fromEntries(retrieved!.collaterals.map((c) => [c.coinType, c.amount]));
      expect(retColMap['0x2::sui::SUI']).toBe(UINT64_MAX);
      expect(retColMap['0x5d4b::coin::COIN']).toBe(UINT128_MAX);
      expect(retColMap['0x76b::deep::DEEP']).toBe(UINT256_MAX);
      expect(retColMap['0xzero::coin::ZERO']).toBe(0n);
      expect(retColMap['0xint64::bound::INT64']).toBe(INT64_OVERFLOW);

      const retDebtMap = Object.fromEntries(retrieved!.debts.map((d) => [d.coinType, d.amount]));
      expect(retDebtMap['0xc060::coin::COIN']).toBe(UINT64_MAX);
      expect(retDebtMap['0xdebt256::coin::COIN']).toBe(UINT256_MAX);
      expect(retDebtMap['0xzero::debt::ZERO']).toBe(0n);

      // Verify reboot retrieval (close and re-open)
      repo.close();

      const repo2 = new ObligationRepository(TEST_DB_PATH);
      const rebooted = repo2.getObligationState(massiveState.obligationId);
      expect(rebooted?.collaterals[0].amount).toBe(UINT64_MAX);
      expect(rebooted?.collaterals[1].amount).toBe(UINT128_MAX);
      expect(rebooted?.collaterals[2].amount).toBe(UINT256_MAX);
      expect(rebooted?.collaterals[3].amount).toBe(0n);
      expect(rebooted?.collaterals[4].amount).toBe(INT64_OVERFLOW);

      repo2.close();
    });

    it('gracefully handles malformed or non-numeric balance JSON strings in recordToState', () => {
      const record = stateToRecord({
        protocol: 'scallop',
        obligationId: '0xmalformed_test',
        ownerAddress: '0xowner',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 10,
        totalDebtUsd: 10,
        liquidationThresholdCollateralUsd: 8,
        healthFactor: 1.0,
        isLiquidatable: false,
        lastUpdatedMs: 1000,
      });

      // Inject corrupt JSON into collateralsJson and debtsJson
      record.collateralsJson = '{ not-valid-json }';
      record.debtsJson = 'null';

      const state = recordToState(record);
      expect(state.collaterals).toEqual([]);
      expect(state.debts).toEqual([]);
    });
  });

  // =========================================================================
  // 2. SQL PARAMETER INJECTION RESISTANCE
  // =========================================================================
  describe('SQL Parameter Injection Resistance', () => {
    const SQL_INJECTION_PAYLOADS = [
      "'; DROP TABLE obligations; --",
      "' OR '1'='1",
      "' OR 1=1 --",
      "admin'--",
      "0x123'; DELETE FROM collaterals; --",
      "\" OR \"\"=\"",
      "' UNION SELECT * FROM sqlite_master WHERE ''='",
      "test\x00inject",
      "test\nUNION SELECT 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16--",
    ];

    it('resists SQL injection attacks across obligation IDs, owner addresses, and symbols', () => {
      const repo = new ObligationRepository(':memory:');
      const rawDb = repo.getRawDatabase();

      // Seed a legitimate obligation first
      const legitState: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xlegit_obligation_001',
        ownerAddress: '0xlegit_owner',
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
        lastUpdatedMs: 1000,
      };
      repo.upsertState(legitState);

      // Attempt injection via various fields
      for (const payload of SQL_INJECTION_PAYLOADS) {
        const injectedState: ObligationState = {
          protocol: 'navi',
          obligationId: `0xmal_${payload}`,
          ownerAddress: `0xowner_${payload}`,
          collaterals: [
            {
              coinType: `0xcoin_${payload}`,
              symbol: `SYM_${payload}`,
              amount: 500n,
              decimals: 9,
              valueUsd: 1.0,
              liquidationThreshold: 0.8,
            },
          ],
          debts: [
            {
              coinType: `0xdebt_${payload}`,
              symbol: `DEBT_${payload}`,
              amount: 250n,
              decimals: 6,
              valueUsd: 0.5,
            },
          ],
          totalCollateralUsd: 1.0,
          totalDebtUsd: 0.5,
          liquidationThresholdCollateralUsd: 0.8,
          healthFactor: 1.6,
          isLiquidatable: false,
          lastUpdatedMs: 2000,
        };

        // Upsert must succeed as literal data without executing injected SQL
        expect(() => repo.upsertState(injectedState)).not.toThrow();

        // Querying with injection payload as search key must NOT return arbitrary data
        const getResult = repo.getObligation(payload);
        expect(getResult).toBeNull();

        // But querying for the exact injected ID must return that exact entity
        const retrievedInjected = repo.getObligationState(`0xmal_${payload}`);
        expect(retrievedInjected).not.toBeNull();
        expect(retrievedInjected?.obligationId).toBe(`0xmal_${payload}`);
        expect(retrievedInjected?.ownerAddress).toBe(`0xowner_${payload}`);
        expect(retrievedInjected?.collaterals[0].symbol).toBe(`SYM_${payload}`);

        // Delete with injection string must NOT delete other rows
        expect(() => repo.deleteObligation(payload)).not.toThrow();
        expect(repo.getObligation('0xlegit_obligation_001')).not.toBeNull();
      }

      // Verify tables and legitimate data remain completely intact
      const tableCount = rawDb.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name IN ('obligations', 'collaterals', 'debts')").get() as { c: number };
      expect(tableCount.c).toBe(3);

      const legitRecord = repo.getObligation('0xlegit_obligation_001');
      expect(legitRecord).not.toBeNull();
      expect(legitRecord?.ownerAddress).toBe('0xlegit_owner');

      repo.close();
    });

    it('safely handles adversarial strings in query filter parameters', () => {
      const repo = new ObligationRepository(':memory:');

      // Attempt SQL injection in protocol filter
      for (const payload of SQL_INJECTION_PAYLOADS) {
        expect(() => {
          const results = repo.query({
            protocol: payload as ProtocolType,
          });
          expect(results).toHaveLength(0);
        }).not.toThrow();
      }

      repo.close();
    });
  });

  // =========================================================================
  // 3. TRANSACTION ROLLBACKS & ATOMICITY
  // =========================================================================
  describe('Transaction Rollbacks & Atomicity Under Faults', () => {
    it('rolls back all records in batch upsert when an unhandled error occurs mid-transaction', () => {
      const repo = new ObligationRepository(':memory:');
      const rawDb = repo.getRawDatabase();

      const batch: ObligationState[] = [
        {
          protocol: 'scallop',
          obligationId: '0xbatch_1',
          ownerAddress: '0xowner_1',
          collaterals: [],
          debts: [],
          totalCollateralUsd: 10,
          totalDebtUsd: 5,
          liquidationThresholdCollateralUsd: 8,
          healthFactor: 1.6,
          isLiquidatable: false,
          lastUpdatedMs: 1000,
        },
        {
          protocol: 'scallop',
          obligationId: '0xbatch_2',
          ownerAddress: '0xowner_2',
          collaterals: [],
          debts: [],
          totalCollateralUsd: 20,
          totalDebtUsd: 10,
          liquidationThresholdCollateralUsd: 16,
          healthFactor: 1.6,
          isLiquidatable: false,
          lastUpdatedMs: 1000,
        },
      ];

      // Commit initial batch
      repo.upsertStates(batch);
      expect(repo.getAllActiveObligations()).toHaveLength(2);

      // Attempt atomic batch with injected failure on 3rd item
      expect(() => {
        runInTransaction(rawDb, () => {
          const stmt = rawDb.prepare(`
            INSERT INTO obligations (
              id, protocol, borrower, obligation_id, health_factor,
              collateral_usd, debt_usd, updated_at, is_active, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          stmt.run('scallop:0xbatch_3', 'scallop', '0x3', '0xbatch_3', 1.0, 10, 5, 1000, 1, 1000);
          stmt.run('scallop:0xbatch_4', 'scallop', '0x4', '0xbatch_4', 1.0, 10, 5, 1000, 1, 1000);

          // Injected runtime fault
          throw new Error('Simulated atomic batch failure');
        });
      }).toThrow('Simulated atomic batch failure');

      // Crucial assertion: 0xbatch_3 and 0xbatch_4 must NOT exist, count must remain exactly 2
      expect(repo.getAllActiveObligations()).toHaveLength(2);
      expect(repo.getObligation('0xbatch_3')).toBeNull();
      expect(repo.getObligation('0xbatch_4')).toBeNull();

      // Database must remain healthy and allow subsequent operations immediately
      const newLegitState: ObligationState = {
        protocol: 'navi',
        obligationId: '0xbatch_recovery',
        ownerAddress: '0xrecovery',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 50,
        totalDebtUsd: 25,
        liquidationThresholdCollateralUsd: 40,
        healthFactor: 1.6,
        isLiquidatable: false,
        lastUpdatedMs: 1000,
      };
      expect(() => repo.upsertState(newLegitState)).not.toThrow();
      expect(repo.getAllActiveObligations()).toHaveLength(3);

      repo.close();
    });

    it('ensures relational atomicity: failure during collaterals insertion rolls back obligation header', () => {
      const repo = new ObligationRepository(':memory:');
      const rawDb = repo.getRawDatabase();

      expect(() => {
        runInTransaction(rawDb, () => {
          // 1. Insert header
          rawDb.prepare(`
            INSERT INTO obligations (
              id, protocol, borrower, obligation_id, health_factor,
              collateral_usd, debt_usd, updated_at, is_active, created_at
            ) VALUES ('scallop:0xfail_child', 'scallop', '0xowner', '0xfail_child', 1.0, 100, 50, 1000, 1, 1000)
          `).run();

          // 2. Insert valid collateral
          rawDb.prepare(`
            INSERT INTO collaterals (
              obligation_id, coin_type, symbol, amount, decimals, value_usd, liquidation_threshold, updated_at
            ) VALUES ('scallop:0xfail_child', '0x2::sui::SUI', 'SUI', '100', 9, 100, 0.8, 1000)
          `).run();

          // 3. Trigger constraint error (violating foreign key or null constraint or syntax)
          rawDb.prepare(`
            INSERT INTO collaterals (
              obligation_id, coin_type, symbol, amount, decimals, value_usd, liquidation_threshold, updated_at
            ) VALUES (NULL, '0x2::sui::SUI', 'SUI', '100', 9, 100, 0.8, 1000)
          `).run();
        });
      }).toThrow();

      // Header must be rolled back
      expect(repo.getObligation('0xfail_child')).toBeNull();
      const colCount = rawDb.prepare("SELECT count(*) as c FROM collaterals WHERE obligation_id = 'scallop:0xfail_child'").get() as { c: number };
      expect(colCount.c).toBe(0);

      repo.close();
    });
  });

  // =========================================================================
  // 4. RAPID SEQUENTIAL UPSERTS & CONCURRENCY
  // =========================================================================
  describe('Rapid Sequential Upserts & State Churn', () => {
    it('maintains absolute referential integrity across 200 rapid updates to the same obligation', () => {
      const repo = new ObligationRepository(':memory:');
      const targetId = '0xscallop_rapid_churn_target';
      const ITERATIONS = 200;

      for (let i = 0; i < ITERATIONS; i++) {
        // Vary collateral count between 1, 2, and 3 dynamically
        const colCount = (i % 3) + 1;
        const collaterals = [];
        for (let c = 0; c < colCount; c++) {
          collaterals.push({
            coinType: `0xcoin_type_${c}::token::COIN`,
            symbol: `TOK${c}`,
            amount: BigInt((i + 1) * (c + 1) * 1000000),
            decimals: 9,
            valueUsd: Number((i + 1) * 10),
            liquidationThreshold: 0.8,
          });
        }

        const state: ObligationState = {
          protocol: 'scallop',
          obligationId: targetId,
          ownerAddress: '0xowner_churn',
          collaterals,
          debts: [
            {
              coinType: '0xdebt::coin::COIN',
              symbol: 'DEBT',
              amount: BigInt((i + 1) * 500000),
              decimals: 6,
              valueUsd: Number((i + 1) * 5),
            },
          ],
          totalCollateralUsd: Number((i + 1) * 10 * colCount),
          totalDebtUsd: Number((i + 1) * 5),
          liquidationThresholdCollateralUsd: Number((i + 1) * 8 * colCount),
          healthFactor: Number((0.5 + (i % 10) * 0.1).toFixed(4)),
          isLiquidatable: (i % 2) === 0,
          lastUpdatedMs: 1728000000000 + i,
        };

        repo.upsertState(state);
      }

      const rawDb = repo.getRawDatabase();

      // 1. Obligations table must contain EXACTLY 1 row for this obligation
      const obCount = rawDb.prepare("SELECT count(*) as c FROM obligations WHERE obligation_id = ?").get(targetId) as { c: number };
      expect(obCount.c).toBe(1);

      // 2. Collaterals count must equal the FINAL iteration's collateral count (ITERATIONS - 1 = 199; 199 % 3 + 1 = 2)
      const expectedColCount = ((ITERATIONS - 1) % 3) + 1;
      const colCount = rawDb.prepare("SELECT count(*) as c FROM collaterals WHERE obligation_id = 'scallop:0xscallop_rapid_churn_target'").get() as { c: number };
      expect(colCount.c).toBe(expectedColCount);

      // 3. Debts count must be exactly 1
      const debtCount = rawDb.prepare("SELECT count(*) as c FROM debts WHERE obligation_id = 'scallop:0xscallop_rapid_churn_target'").get() as { c: number };
      expect(debtCount.c).toBe(1);

      // 4. Record values must match the 199th iteration
      const finalState = repo.getObligationState(targetId);
      expect(finalState).not.toBeNull();
      expect(finalState?.collaterals).toHaveLength(expectedColCount);
      expect(finalState?.lastUpdatedMs).toBe(1728000000000 + (ITERATIONS - 1));

      repo.close();
    });

    it('synchronizes ObligationRegistry in-memory state and SQLite database under rapid churn', () => {
      const repo = new ObligationRepository(TEST_DB_PATH);
      const registry = ObligationRegistry.createForTesting(repo);

      const targetId = '0xchurn_reg_target';

      // Rapidly toggle health factor across buckets:
      // i=0: HF=0.9 (<1.0 => immediate)
      // i=1: HF=1.02 (1.0..1.05 => hot)
      // i=2: HF=1.5 (>=1.05 => safe)
      const hfCycle = [0.9, 1.02, 1.5];

      for (let i = 0; i < 90; i++) {
        const hf = hfCycle[i % 3];
        const state: ObligationState = {
          protocol: 'navi',
          obligationId: targetId,
          ownerAddress: '0xowner_reg',
          collaterals: [
            {
              coinType: '0x2::sui::SUI',
              symbol: 'SUI',
              amount: 1000000000n,
              decimals: 9,
              valueUsd: 100,
              liquidationThreshold: 0.8,
            },
          ],
          debts: [
            {
              coinType: '0x5d4b::coin::COIN',
              symbol: 'USDC',
              amount: 50000000n,
              decimals: 6,
              valueUsd: 50,
            },
          ],
          totalCollateralUsd: 100,
          totalDebtUsd: 50,
          liquidationThresholdCollateralUsd: 80,
          healthFactor: hf,
          isLiquidatable: hf < 1.0,
          lastUpdatedMs: Date.now() + i,
        };

        registry.upsertObligation(state);
      }

      // Final iteration is i=89 -> 89 % 3 = 2 -> HF = 1.5 -> safeWatchlist!
      const counts = registry.getCounts();
      expect(counts.total).toBe(1);
      expect(counts.immediate).toBe(0);
      expect(counts.hot).toBe(0);
      expect(counts.safe).toBe(1);

      // Verify DB has the exact final state
      const dbState = repo.getObligationState(targetId);
      expect(dbState?.healthFactor).toBeCloseTo(1.5);
      expect(dbState?.isLiquidatable).toBe(false);

      repo.close();
    });

    it('handles interleaved multi-connection concurrent reads and writes in WAL mode', () => {
      // Create connection 1 (writer) and connection 2 (reader) against the same disk DB
      const writerRepo = new ObligationRepository(TEST_DB_PATH);
      const readerRepo = new ObligationRepository(TEST_DB_PATH);

      for (let i = 0; i < 50; i++) {
        const state: ObligationState = {
          protocol: 'scallop',
          obligationId: `0xinterleave_${i}`,
          ownerAddress: `0xowner_${i}`,
          collaterals: [
            {
              coinType: '0x2::sui::SUI',
              symbol: 'SUI',
              amount: BigInt(i * 1000),
              decimals: 9,
              valueUsd: i,
              liquidationThreshold: 0.8,
            },
          ],
          debts: [],
          totalCollateralUsd: i,
          totalDebtUsd: 0,
          liquidationThresholdCollateralUsd: i * 0.8,
          healthFactor: 999.0,
          isLiquidatable: false,
          lastUpdatedMs: Date.now(),
        };

        // Writer writes
        writerRepo.upsertState(state);

        // Reader reads immediately (WAL mode test)
        const readRecord = readerRepo.getObligationState(`0xinterleave_${i}`);
        expect(readRecord).not.toBeNull();
        expect(readRecord?.obligationId).toBe(`0xinterleave_${i}`);
      }

      expect(readerRepo.getAllActiveObligations()).toHaveLength(50);

      writerRepo.close();
      readerRepo.close();
    });
  });
});
