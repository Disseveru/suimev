import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  createDatabaseSync,
  DatabaseManager,
  initSchema,
  ObligationRepository,
  stateToRecord,
  recordToState,
} from '../src/persistence/index.js';
import { ObligationRegistry } from '../src/engine/registry.js';
import type { ObligationState } from '../src/types/index.js';

const ADVERSARIAL_DB_DIR = path.resolve('./temp_adversarial_db');
const ADVERSARIAL_DB_PATH = path.join(ADVERSARIAL_DB_DIR, 'adversarial_recovery.db');

function cleanupAdversarialDb(): void {
  try {
    if (fs.existsSync(ADVERSARIAL_DB_PATH)) fs.unlinkSync(ADVERSARIAL_DB_PATH);
    const wal = `${ADVERSARIAL_DB_PATH}-wal`;
    const shm = `${ADVERSARIAL_DB_PATH}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
    if (fs.existsSync(ADVERSARIAL_DB_DIR)) fs.rmdirSync(ADVERSARIAL_DB_DIR);
  } catch {
    // Ignore cleanup errors
  }
}

describe('Adversarial Reboot Recovery & Edge Cases (Requirement R1)', () => {
  beforeEach(() => {
    cleanupAdversarialDb();
  });

  afterEach(() => {
    cleanupAdversarialDb();
  });

  // =========================================================================
  // TEST SUITE 1: 100% Active Obligation Rehydration Across Process Reboots
  // =========================================================================
  describe('High-Volume Multi-Protocol Reboot Rehydration (100% Data Preservation)', () => {
    it('restores 100% of Scallop and NAVI active obligations across cold restart with zero data/precision loss', () => {
      const TOTAL_SCALLOP = 75;
      const TOTAL_NAVI = 75;
      const TOTAL_EXPECTED = TOTAL_SCALLOP + TOTAL_NAVI;

      const generatedStates: ObligationState[] = [];

      // Generate realistic Scallop obligations with large BigInt balances
      for (let i = 0; i < TOTAL_SCALLOP; i++) {
        const isLiquidatable = i % 5 === 0;
        const hf = isLiquidatable ? 0.85 + (i % 10) * 0.01 : 1.02 + (i % 20) * 0.05;
        const bigAmountCol = 1000000000000000000n + BigInt(i) * 50000000000000n; // > 10^18 (extreme precision)
        const bigAmountDebt = 500000000000000000n + BigInt(i) * 20000000000000n;

        generatedStates.push({
          protocol: 'scallop',
          obligationId: `0xscallop_obl_${i.toString().padStart(6, '0')}`,
          ownerAddress: `0xscallop_owner_${i.toString().padStart(6, '0')}`,
          collaterals: [
            {
              coinType: '0x2::sui::SUI',
              symbol: 'SUI',
              amount: bigAmountCol,
              decimals: 9,
              valueUsd: 2500.5 + i * 10,
              liquidationThreshold: 0.8,
            },
            {
              coinType: '0x5d4b302506645c30f504a971382fb7702587f8406438099a527389130939bd60::coin::COIN',
              symbol: 'USDC',
              amount: 10000000000n + BigInt(i) * 1000000n,
              decimals: 6,
              valueUsd: 10000.0,
              liquidationThreshold: 0.85,
            },
          ],
          debts: [
            {
              coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
              symbol: 'USDT',
              amount: bigAmountDebt,
              decimals: 6,
              valueUsd: 1500.0 + i * 5,
            },
          ],
          totalCollateralUsd: 12500.5 + i * 10,
          totalDebtUsd: 1500.0 + i * 5,
          liquidationThresholdCollateralUsd: 10500.0,
          healthFactor: hf,
          isLiquidatable,
          lastUpdatedMs: 1728000000000 + i * 1000,
          scallopObligationKey: `0xkey_scallop_nft_${i.toString().padStart(6, '0')}`,
          liquidateLocked: i % 10 === 0,
        });
      }

      // Generate realistic NAVI obligations
      for (let i = 0; i < TOTAL_NAVI; i++) {
        const isLiquidatable = i % 4 === 0;
        const hf = isLiquidatable ? 0.90 + (i % 8) * 0.01 : 1.01 + (i % 15) * 0.03;
        const bigAmountCol = 25000000000000000000n + BigInt(i) * 100000000000000n; // 2.5 * 10^19
        const bigAmountDebt = 12000000000000000000n + BigInt(i) * 50000000000000n;

        generatedStates.push({
          protocol: 'navi',
          obligationId: `0xnavi_obl_${i.toString().padStart(6, '0')}`,
          ownerAddress: `0xnavi_owner_${i.toString().padStart(6, '0')}`,
          collaterals: [
            {
              coinType: '0x2::sui::SUI',
              symbol: 'SUI',
              amount: bigAmountCol,
              decimals: 9,
              valueUsd: 5000.0 + i * 20,
              liquidationThreshold: 0.75,
            },
          ],
          debts: [
            {
              coinType: '0x5d4b302506645c30f504a971382fb7702587f8406438099a527389130939bd60::coin::COIN',
              symbol: 'USDC',
              amount: bigAmountDebt,
              decimals: 6,
              valueUsd: 3000.0 + i * 10,
            },
          ],
          totalCollateralUsd: 5000.0 + i * 20,
          totalDebtUsd: 3000.0 + i * 10,
          liquidationThresholdCollateralUsd: 3750.0,
          healthFactor: hf,
          isLiquidatable,
          lastUpdatedMs: 1728100000000 + i * 1000,
          naviAccountCap: `0xcap_navi_nft_${i.toString().padStart(6, '0')}`,
        });
      }

      // --- PHASE 1: Write all 150 obligations to SQLite on disk ---
      const repoPhase1 = new ObligationRepository(ADVERSARIAL_DB_PATH);
      repoPhase1.upsertStates(generatedStates);

      const writtenCount = repoPhase1.getAllActiveObligations().length;
      expect(writtenCount).toBe(TOTAL_EXPECTED);

      // Simulate full process termination / crash / power loss
      repoPhase1.close();

      // --- PHASE 2: Reboot Rehydration in fresh process / registry ---
      const rebootRepo = new ObligationRepository(ADVERSARIAL_DB_PATH);
      const registry = ObligationRegistry.createForTesting();

      expect(registry.getCounts().total).toBe(0);

      const rehydratedCount = registry.loadFromPersistence(rebootRepo);
      expect(rehydratedCount).toBe(TOTAL_EXPECTED);

      const counts = registry.getCounts();
      expect(counts.total).toBe(TOTAL_EXPECTED);

      // --- PHASE 3: Assert 100% Exact Restoration & Zero Data Loss ---
      for (const original of generatedStates) {
        const restored = rebootRepo.getObligationState(original.obligationId);
        expect(restored, `Obligation ${original.obligationId} must exist after reboot`).not.toBeNull();

        // Exact scalar matches
        expect(restored!.protocol).toBe(original.protocol);
        expect(restored!.obligationId).toBe(original.obligationId);
        expect(restored!.ownerAddress).toBe(original.ownerAddress);
        expect(restored!.totalCollateralUsd).toBeCloseTo(original.totalCollateralUsd, 4);
        expect(restored!.totalDebtUsd).toBeCloseTo(original.totalDebtUsd, 4);
        expect(restored!.healthFactor).toBeCloseTo(original.healthFactor, 4);
        expect(restored!.isLiquidatable).toBe(original.isLiquidatable);
        expect(restored!.lastUpdatedMs).toBe(original.lastUpdatedMs);

        // Protocol-specific metadata matches
        if (original.protocol === 'scallop') {
          expect(restored!.scallopObligationKey).toBe(original.scallopObligationKey);
          expect(restored!.liquidateLocked).toBe(original.liquidateLocked);
        } else {
          expect(restored!.naviAccountCap).toBe(original.naviAccountCap);
        }

        // Exact collateral preservation (BigInt amount checks!)
        expect(restored!.collaterals).toHaveLength(original.collaterals.length);
        for (let c = 0; c < original.collaterals.length; c++) {
          const origCol = original.collaterals[c];
          const restCol = restored!.collaterals[c];
          expect(restCol.coinType).toBe(origCol.coinType);
          expect(restCol.symbol).toBe(origCol.symbol);
          expect(restCol.amount).toBe(origCol.amount); // Exact BigInt equality
          expect(typeof restCol.amount).toBe('bigint');
          expect(restCol.decimals).toBe(origCol.decimals);
          expect(restCol.valueUsd).toBeCloseTo(origCol.valueUsd, 4);
          expect(restCol.liquidationThreshold).toBeCloseTo(origCol.liquidationThreshold, 4);
        }

        // Exact debt preservation (BigInt amount checks!)
        expect(restored!.debts).toHaveLength(original.debts.length);
        for (let d = 0; d < original.debts.length; d++) {
          const origDebt = original.debts[d];
          const restDebt = restored!.debts[d];
          expect(restDebt.coinType).toBe(origDebt.coinType);
          expect(restDebt.symbol).toBe(origDebt.symbol);
          expect(restDebt.amount).toBe(origDebt.amount); // Exact BigInt equality
          expect(typeof restDebt.amount).toBe('bigint');
          expect(restDebt.decimals).toBe(origDebt.decimals);
          expect(restDebt.valueUsd).toBeCloseTo(origDebt.valueUsd, 4);
        }
      }

      // Priority bucket integrity: ensure immediate targets, hot watchlist, safe watchlist sum to total
      expect(counts.immediate + counts.hot + counts.safe).toBe(TOTAL_EXPECTED);

      rebootRepo.close();
    });
  });

  // =========================================================================
  // TEST SUITE 2: Empty Database on First Boot Edge Case
  // =========================================================================
  describe('Empty Database on First Boot Edge Case', () => {
    it('initializes cleanly from empty file path and handles cold boot with zero obligations without throwing', () => {
      // Ensure target directory and file do not exist
      expect(fs.existsSync(ADVERSARIAL_DB_DIR)).toBe(false);

      const repo = new ObligationRepository(ADVERSARIAL_DB_PATH);

      // Verify DB file was created
      expect(fs.existsSync(ADVERSARIAL_DB_PATH)).toBe(true);

      // Verify empty queries
      const activeObligations = repo.getAllActiveObligations();
      expect(activeObligations).toHaveLength(0);

      const activeStates = repo.getAllActiveStates();
      expect(activeStates).toHaveLength(0);

      const nonExistent = repo.getObligation('0xnon_existent_id');
      expect(nonExistent).toBeNull();

      // Cold boot registry against empty database
      const registry = ObligationRegistry.createForTesting();
      const loaded = registry.loadFromPersistence(repo);
      expect(loaded).toBe(0);

      const counts = registry.getCounts();
      expect(counts.total).toBe(0);
      expect(counts.immediate).toBe(0);
      expect(counts.hot).toBe(0);
      expect(counts.safe).toBe(0);

      // Verify that subsequent upserts work immediately after empty first boot
      const firstObligation: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xfirst_after_boot',
        ownerAddress: '0xfirst_borrower',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 100,
        totalDebtUsd: 50,
        liquidationThresholdCollateralUsd: 80,
        healthFactor: 1.6,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      registry.upsertObligation(firstObligation);
      expect(registry.getCounts().total).toBe(1);
      expect(registry.getCounts().safe).toBe(1);

      const queried = repo.getObligationState('0xfirst_after_boot');
      expect(queried).not.toBeNull();
      expect(queried?.obligationId).toBe('0xfirst_after_boot');

      repo.close();
    });
  });

  // =========================================================================
  // TEST SUITE 3: Partially Corrupted Rows Edge Cases
  // =========================================================================
  describe('Partially Corrupted Database Rows Resilience', () => {
    it('safely recovers and skips/defaults corrupted JSON, malformed BigInts, and broken metadata without throwing', () => {
      const repo = new ObligationRepository(ADVERSARIAL_DB_PATH);
      const rawDb = repo.getRawDatabase();

      // 1. Insert a normal valid obligation
      const validObligation: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xvalid_001',
        ownerAddress: '0xowner_valid',
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
        lastUpdatedMs: 1728000000000,
      };
      repo.upsertState(validObligation);

      // 2. Corrupted Row A: collaterals_json has invalid JSON syntax
      rawDb
        .prepare(`
          INSERT INTO obligations (
            id, protocol, borrower, obligation_id, health_factor,
            collateral_usd, debt_usd, updated_at, is_active,
            owner_address, lt_collateral_usd, is_liquidatable,
            collaterals_json, debts_json, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          'scallop:0xcorrupt_json_a',
          'scallop',
          '0xborrower_corrupt_a',
          '0xcorrupt_json_a',
          1.2,
          100.0,
          50.0,
          1728000001000,
          1,
          '0xborrower_corrupt_a',
          80.0,
          0,
          '{"invalid_json: unclosed bracket', // Malformed JSON
          '[]',
          '{}',
          Date.now()
        );

      // 3. Corrupted Row B: debts_json has non-numeric BigInt value
      rawDb
        .prepare(`
          INSERT INTO obligations (
            id, protocol, borrower, obligation_id, health_factor,
            collateral_usd, debt_usd, updated_at, is_active,
            owner_address, lt_collateral_usd, is_liquidatable,
            collaterals_json, debts_json, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          'navi:0xcorrupt_bigint_b',
          'navi',
          '0xborrower_corrupt_b',
          '0xcorrupt_bigint_b',
          0.95,
          200.0,
          150.0,
          1728000002000,
          1,
          '0xborrower_corrupt_b',
          160.0,
          1,
          '[]',
          JSON.stringify([{ coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 'ILLEGAL_NOT_A_BIGINT' }]),
          null,
          Date.now()
        );

      // 4. Corrupted Row C: metadata_json has corrupted syntax
      rawDb
        .prepare(`
          INSERT INTO obligations (
            id, protocol, borrower, obligation_id, health_factor,
            collateral_usd, debt_usd, updated_at, is_active,
            owner_address, lt_collateral_usd, is_liquidatable,
            collaterals_json, debts_json, metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          'scallop:0xcorrupt_meta_c',
          'scallop',
          '0xborrower_corrupt_c',
          '0xcorrupt_meta_c',
          0.85,
          50.0,
          45.0,
          1728000003000,
          1,
          '0xborrower_corrupt_c',
          40.0,
          1,
          '[]',
          '[]',
          '<<<broken metadata>>>',
          Date.now()
        );

      // Execution: Rehydrate via registry without crashing!
      const registry = ObligationRegistry.createForTesting();
      let loadedCount = 0;
      expect(() => {
        loadedCount = registry.loadFromPersistence(repo);
      }).not.toThrow();

      expect(loadedCount).toBe(4);

      // Verify the valid obligation is intact
      const validLoaded = registry.getAllObligations().find((o) => o.obligationId === '0xvalid_001');
      expect(validLoaded).toBeDefined();
      expect(validLoaded?.collaterals).toHaveLength(1);
      expect(validLoaded?.collaterals[0].amount).toBe(1000000000n);

      // Verify Corrupted Row A handled gracefully with empty collaterals fallback
      const corruptA = registry.getAllObligations().find((o) => o.obligationId === '0xcorrupt_json_a');
      expect(corruptA).toBeDefined();
      expect(corruptA?.collaterals).toEqual([]); // Graceful fallback
      expect(corruptA?.healthFactor).toBeCloseTo(1.2);

      // Verify Corrupted Row B handled gracefully with empty debts fallback
      const corruptB = registry.getAllObligations().find((o) => o.obligationId === '0xcorrupt_bigint_b');
      expect(corruptB).toBeDefined();
      expect(corruptB?.debts).toEqual([]); // Graceful fallback from failed BigInt conversion
      expect(corruptB?.healthFactor).toBeCloseTo(0.95);

      // Verify Corrupted Row C handled gracefully with empty metadata fallback
      const corruptC = registry.getAllObligations().find((o) => o.obligationId === '0xcorrupt_meta_c');
      expect(corruptC).toBeDefined();
      expect(corruptC?.scallopObligationKey).toBeUndefined();
      expect(corruptC?.liquidationThresholdCollateralUsd).toBe(0);

      repo.close();
    });
  });

  // =========================================================================
  // TEST SUITE 4: Network Disconnection & Idempotent Reloading
  // =========================================================================
  describe('Network Disconnection, Reconnection, & Idempotent Reloading', () => {
    it('handles simulated network drops, offline updates, and repeated loadFromPersistence() idempotently', () => {
      const repo = new ObligationRepository(ADVERSARIAL_DB_PATH);
      const registry = ObligationRegistry.createForTesting(repo);

      const initialStates: ObligationState[] = [
        {
          protocol: 'scallop',
          obligationId: '0xnetwork_scallop_1',
          ownerAddress: '0xowner_1',
          collaterals: [],
          debts: [],
          totalCollateralUsd: 100,
          totalDebtUsd: 90,
          liquidationThresholdCollateralUsd: 80,
          healthFactor: 1.02, // Hot Watchlist
          isLiquidatable: false,
          lastUpdatedMs: 1000,
        },
        {
          protocol: 'navi',
          obligationId: '0xnetwork_navi_2',
          ownerAddress: '0xowner_2',
          collaterals: [],
          debts: [],
          totalCollateralUsd: 500,
          totalDebtUsd: 100,
          liquidationThresholdCollateralUsd: 400,
          healthFactor: 4.0, // Safe Watchlist
          isLiquidatable: false,
          lastUpdatedMs: 1000,
        },
      ];

      // Initial populate
      for (const st of initialStates) {
        registry.upsertObligation(st);
      }

      expect(registry.getCounts().total).toBe(2);
      expect(registry.getCounts().hot).toBe(1);
      expect(registry.getCounts().safe).toBe(1);

      // --- SIMULATE NETWORK DROP ---
      // Bot is disconnected from WebSocket/RPC. While disconnected, external syncer or local DB receives updates.
      // 1. Scallop obligation drops health factor to 0.92 (< 1.0 -> should become Immediate Target)
      // 2. A new NAVI obligation is discovered offline
      repo.upsertState({
        protocol: 'scallop',
        obligationId: '0xnetwork_scallop_1',
        ownerAddress: '0xowner_1',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 90,
        totalDebtUsd: 90,
        liquidationThresholdCollateralUsd: 72,
        healthFactor: 0.92, // Now Immediate Target!
        isLiquidatable: true,
        lastUpdatedMs: 2000,
      });

      repo.upsertState({
        protocol: 'navi',
        obligationId: '0xnetwork_navi_3_offline',
        ownerAddress: '0xowner_3',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 300,
        totalDebtUsd: 280,
        liquidationThresholdCollateralUsd: 240,
        healthFactor: 0.85, // Immediate Target!
        isLiquidatable: true,
        lastUpdatedMs: 2000,
      });

      // --- SIMULATE RECONNECTION ---
      // Bot reconnects and calls loadFromPersistence() to resync state from disk
      const reconnectedCount = registry.loadFromPersistence(repo);
      expect(reconnectedCount).toBe(3);

      const reconnectedCounts = registry.getCounts();
      expect(reconnectedCounts.total).toBe(3);
      expect(reconnectedCounts.immediate).toBe(2); // scallop_1 and navi_3
      expect(reconnectedCounts.hot).toBe(0);       // scallop_1 moved from hot to immediate!
      expect(reconnectedCounts.safe).toBe(1);      // navi_2

      // Verify that the updated health factor for scallop_1 is reflected in memory
      const immediateList = registry.getImmediateTargets();
      const updatedScallop = immediateList.find((o) => o.obligationId === '0xnetwork_scallop_1');
      expect(updatedScallop).toBeDefined();
      expect(updatedScallop?.healthFactor).toBeCloseTo(0.92);
      expect(updatedScallop?.isLiquidatable).toBe(true);

      // --- IDEMPOTENCY CHECK ---
      // Repeated loadFromPersistence() should NOT double-count or inflate registry maps
      registry.loadFromPersistence(repo);
      registry.loadFromPersistence(repo);

      const idempotentCounts = registry.getCounts();
      expect(idempotentCounts.total).toBe(3);
      expect(idempotentCounts.immediate).toBe(2);
      expect(idempotentCounts.hot).toBe(0);
      expect(idempotentCounts.safe).toBe(1);

      repo.close();
    });
  });

  // =========================================================================
  // TEST SUITE 5: Case-Insensitivity & ID Formats across Scallop & NAVI
  // =========================================================================
  describe('Case Insensitivity & Identifier Formats', () => {
    it('retrieves obligations using lower-case, upper-case, or prefixed composite keys', () => {
      const repo = new ObligationRepository(':memory:');

      const mockObligation: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xAbCdEf123456',
        ownerAddress: '0xBoRrOwEr',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 100,
        totalDebtUsd: 50,
        liquidationThresholdCollateralUsd: 80,
        healthFactor: 1.6,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      repo.upsertState(mockObligation);

      // Query by exact original ID
      const exact = repo.getObligationState('0xAbCdEf123456');
      expect(exact).not.toBeNull();
      expect(exact?.obligationId).toBe('0xAbCdEf123456');

      // Query by composite key (lowercase)
      const byComposite = repo.getObligationState('scallop:0xabcdef123456');
      expect(byComposite).not.toBeNull();
      expect(byComposite?.obligationId).toBe('0xAbCdEf123456');

      repo.close();
    });
  });

  // =========================================================================
  // TEST SUITE 6: DatabaseManager Lifecycle & Resilient Reconnection
  // =========================================================================
  describe('DatabaseManager Lifecycle & Connection Management', () => {
    it('manages connection lifecycle, closes safely, and reconnects transparently on demand', () => {
      const manager = new DatabaseManager({
        dbPath: ADVERSARIAL_DB_PATH,
        journalMode: 'WAL',
        busyTimeoutMs: 5000,
      });

      expect(manager.isConnected()).toBe(false);

      const db1 = manager.getDatabase();
      expect(manager.isConnected()).toBe(true);

      // Run a quick query
      initSchema(db1);
      const res = db1.prepare('SELECT count(*) as count FROM obligations;').get() as { count: number };
      expect(res.count).toBe(0);

      // Close connection
      manager.close();
      expect(manager.isConnected()).toBe(false);

      // Multiple closes should be completely idempotent and safe
      expect(() => manager.close()).not.toThrow();

      // Transparent reconnect on next getDatabase()
      const db2 = manager.getDatabase();
      expect(manager.isConnected()).toBe(true);
      const res2 = db2.prepare('SELECT count(*) as count FROM obligations;').get() as { count: number };
      expect(res2.count).toBe(0);

      manager.close();
    });
  });
});
