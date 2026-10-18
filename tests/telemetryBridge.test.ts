import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  TelemetryBridge,
  telemetryBridge,
  LiquidationRingBuffer,
  writeAtomicJson,
} from '../src/engine/telemetryBridge.js';
import { obligationRegistry } from '../src/engine/registry.js';
import { gasManager } from '../src/client/gasManager.js';
import { searcher } from '../src/engine/searcher.js';
import { TransactionExecutor } from '../src/engine/executor.js';
import {
  ObligationState,
  TelemetryPayload,
  TelemetryRecentLiquidationItem,
} from '../src/config/types.js';
import { validateTelemetryPayload } from './e2e/helpers/contracts.js';

describe('Engine Telemetry State Bridge (Requirement R2 / Milestone 2)', () => {
  const testStateDir = path.resolve(process.cwd(), '.state_unit_test');
  const testTelemetryFile = path.join(testStateDir, 'telemetry.json');

  beforeEach(() => {
    if (!fs.existsSync(testStateDir)) {
      fs.mkdirSync(testStateDir, { recursive: true });
    }
    telemetryBridge.setStateFilePath(testTelemetryFile);
    telemetryBridge.clearRingBuffer();
  });

  afterEach(() => {
    telemetryBridge.stop();
    telemetryBridge.setStateFilePath(path.resolve(process.cwd(), '.state', 'telemetry.json'));
    if (fs.existsSync(testStateDir)) {
      fs.rmSync(testStateDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  // ========================================================
  // 1. Schema Compliance & Project Contract Validation
  // ========================================================
  describe('Schema Compliance & PROJECT.md Contract Validation', () => {
    it('generates a payload matching PROJECT.md § Interface Contracts strictly', async () => {
      const payload = telemetryBridge.generatePayload();
      expect(payload).toBeDefined();
      expect(typeof payload.timestamp).toBe('string');
      expect(['ONLINE', 'PAUSED', 'ERROR']).toContain(payload.botStatus);

      // Operator section
      expect(payload.operator.address).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(typeof payload.operator.gasTankBalanceSui).toBe('number');
      expect(payload.operator.gasTankBalanceSui).toBeGreaterThanOrEqual(0);
      expect(typeof payload.operator.gasTankBalanceMist).toBe('string');

      // Financials section
      expect(payload.financials.netRealizedPnlUsd).toBeNull();
      expect(typeof payload.financials.cumulativeGasSpentSui).toBe('number');
      expect(typeof payload.financials.successfulLiquidations).toBe('number');
      expect(typeof payload.financials.failedLiquidations).toBe('number');
      expect(typeof payload.financials.totalSimulations).toBe('number');

      // Obligations section
      expect(typeof payload.obligations.totalMonitored).toBe('number');
      expect(typeof payload.obligations.naviCount).toBe('number');
      expect(typeof payload.obligations.scallopCount).toBe('number');
      expect(typeof payload.obligations.immediateTargetsCount).toBe('number');
      expect(typeof payload.obligations.hotWatchlistCount).toBe('number');
      expect(typeof payload.obligations.safeCount).toBe('number');

      // Arrays
      expect(Array.isArray(payload.hotWatchlist)).toBe(true);
      expect(Array.isArray(payload.recentLiquidations)).toBe(true);

      // Authoritative validation contract
      const validation = validateTelemetryPayload(payload);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('exports a snapshot to disk that parses cleanly as valid JSON', async () => {
      await telemetryBridge.exportSnapshot();
      expect(fs.existsSync(testTelemetryFile)).toBe(true);

      const raw = fs.readFileSync(testTelemetryFile, 'utf8');
      const parsed: TelemetryPayload = JSON.parse(raw);
      const validation = validateTelemetryPayload(parsed);
      expect(validation.valid).toBe(true);
      expect(parsed.operator.address).toBeDefined();
      expect(parsed.obligations.totalMonitored).toBeGreaterThanOrEqual(0);
    });

    it('supports explicitly setting botStatus to ONLINE, PAUSED, or ERROR', async () => {
      telemetryBridge.setStatus('PAUSED');
      let payload = telemetryBridge.generatePayload();
      expect(payload.botStatus).toBe('PAUSED');

      telemetryBridge.setStatus('ERROR');
      payload = telemetryBridge.generatePayload();
      expect(payload.botStatus).toBe('ERROR');

      telemetryBridge.setStatus('ONLINE');
      payload = telemetryBridge.generatePayload();
      expect(payload.botStatus).toBe('ONLINE');

      telemetryBridge.setStatus(null); // Reset
    });
  });

  // ========================================================
  // 2. Atomic File Writing & Windows Lock Resilience
  // ========================================================
  describe('Atomic File Writing & Windows Lock Resilience', () => {
    it('uses a .tmp file staging mechanism and removes .tmp upon completion', async () => {
      const data = { test: 'atomic-verify', timestamp: new Date().toISOString() };
      const tmpFile = `${testTelemetryFile}.tmp`;

      await writeAtomicJson(testTelemetryFile, data);

      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      expect(fs.existsSync(tmpFile)).toBe(false);
      const remainingTmpFiles = fs.readdirSync(testStateDir).filter((f) => f.includes('.tmp'));
      expect(remainingTmpFiles).toHaveLength(0);

      const content = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      expect(content.test).toBe('atomic-verify');
    });

    it('creates missing directories recursively if destination does not exist', async () => {
      const deepPath = path.join(testStateDir, 'nested', 'subfolder', 'telemetry.json');
      await writeAtomicJson(deepPath, { nested: true });

      expect(fs.existsSync(deepPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(deepPath, 'utf8'));
      expect(content.nested).toBe(true);
    });

    it('recovers from transient EBUSY errors on rename via retry loop', async () => {
      let renameCalls = 0;
      const originalRename = fs.promises.rename;

      // Simulate EBUSY on first two attempts, succeeding on the 3rd
      vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
        renameCalls++;
        if (renameCalls <= 2) {
          const err = new Error('Resource busy or locked') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        }
        return originalRename(oldPath, newPath);
      });

      await writeAtomicJson(testTelemetryFile, { test: 'retry-ebusy-success' }, 3);

      expect(renameCalls).toBe(3);
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      expect(content.test).toBe('retry-ebusy-success');
    });

    it('recovers from transient EPERM errors on rename via retry loop', async () => {
      let renameCalls = 0;
      const originalRename = fs.promises.rename;

      // Simulate EPERM on first attempt, succeeding on the 2nd
      vi.spyOn(fs.promises, 'rename').mockImplementation(async (oldPath, newPath) => {
        renameCalls++;
        if (renameCalls === 1) {
          const err = new Error('Operation not permitted') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        }
        return originalRename(oldPath, newPath);
      });

      await writeAtomicJson(testTelemetryFile, { test: 'retry-eperm-success' }, 3);

      expect(renameCalls).toBe(2);
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      expect(content.test).toBe('retry-eperm-success');
    });

    it('safely preserves existing file and cleans up temp file if rename persistently fails with EBUSY', async () => {
      // Seed existing valid state
      await fs.promises.writeFile(testTelemetryFile, JSON.stringify({ test: 'initial-intact' }), 'utf8');

      vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
        const err = new Error('Resource busy permanent') as NodeJS.ErrnoException;
        err.code = 'EBUSY';
        throw err;
      });

      await writeAtomicJson(testTelemetryFile, { test: 'never-overwritten' }, 3);

      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      // Must preserve the existing valid snapshot without truncation
      expect(content.test).toBe('initial-intact');
      const remainingTmpFiles = fs.readdirSync(testStateDir).filter((f) => f.includes('.tmp'));
      expect(remainingTmpFiles).toHaveLength(0);
    });

    it('re-throws non-locking unexpected filesystem errors', async () => {
      vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
        const err = new Error('Disk read-only') as NodeJS.ErrnoException;
        err.code = 'EROFS';
        throw err;
      });

      await expect(writeAtomicJson(testTelemetryFile, { test: 'fail' })).rejects.toThrow('Disk read-only');
    });
  });

  // ========================================================
  // 3. 15-Item FIFO Liquidation Event Ring Buffer
  // ========================================================
  describe('15-Item FIFO Liquidation Event Ring Buffer', () => {
    it('records liquidation events and caps buffer at exactly 15 items', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      expect(ringBuffer.size()).toBe(0);

      for (let i = 1; i <= 20; i++) {
        ringBuffer.push({
          timestamp: new Date().toISOString(),
          protocol: i % 2 === 0 ? 'scallop' : 'navi',
          borrower: `0xBorrower_${i}`,
          debtRepaid: `${i * 100} USDC`,
          collateralSeized: `${i * 50} SUI`,
          estimatedNetProfitUsd: i * 5,
          gasCostSui: 0.01,
          txDigest: `digest_${i}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/digest_${i}`,
        });
      }

      expect(ringBuffer.size()).toBe(15);
      const events = ringBuffer.getEvents();
      // First 5 items (1 to 5) must have been evicted in FIFO order
      expect(events[0].borrower).toBe('0xBorrower_6');
      expect(events[14].borrower).toBe('0xBorrower_20');
    });

    it('formats coin amounts into human-readable strings with token symbol', () => {
      // 5,000 USDC (6 decimals: 5_000_000_000)
      const usdcFormatted = TransactionExecutor.formatCoinAmount(5_000_000_000n, 'USDC');
      expect(usdcFormatted).toBe('5,000.00 USDC');

      // 2,450.12 SUI (9 decimals: 2_450_120_000_000)
      const suiFormatted = TransactionExecutor.formatCoinAmount(2_450_120_000_000n, 'SUI');
      expect(suiFormatted).toBe('2,450.12 SUI');
    });

    it('records dry-run and live liquidations via TransactionExecutor into TelemetryBridge', () => {
      const mockEvent: TelemetryRecentLiquidationItem = {
        timestamp: new Date().toISOString(),
        protocol: 'navi',
        borrower: '0xTestBorrower',
        debtRepaid: '1,000.00 USDC',
        collateralSeized: '500.00 SUI',
        estimatedNetProfitUsd: 25.5,
        gasCostSui: 0.005,
        txDigest: 'DRY_RUN_ABC123',
        txDigestLink: 'https://suiscan.xyz/mainnet/tx/DRY_RUN_ABC123',
      };

      TransactionExecutor.recordLiquidation(mockEvent);

      const recent = TransactionExecutor.getRecentLiquidations();
      expect(recent).toHaveLength(1);
      expect(recent[0].txDigest).toBe('DRY_RUN_ABC123');
      expect(recent[0].txDigestLink).toBe('https://suiscan.xyz/mainnet/tx/DRY_RUN_ABC123');
    });

    it('clears ring buffer when requested', () => {
      telemetryBridge.recordLiquidation({
        timestamp: new Date().toISOString(),
        protocol: 'navi',
        borrower: '0xTestBorrower',
        debtRepaid: '100 USDC',
        collateralSeized: '50 SUI',
        estimatedNetProfitUsd: 10,
        gasCostSui: 0.01,
        txDigest: 'digest_1',
        txDigestLink: 'https://suiscan.xyz/mainnet/tx/digest_1',
      });
      expect(telemetryBridge.getRecentLiquidations()).toHaveLength(1);
      telemetryBridge.clearRingBuffer();
      expect(telemetryBridge.getRecentLiquidations()).toHaveLength(0);
    });
  });

  // ========================================================
  // 4. Registry Disaggregated Counts & Hot Watchlist Filtering
  // ========================================================
  describe('Registry Disaggregated Counts & Hot Watchlist Filtering', () => {
    it('returns disaggregated counts for navi and scallop along with immediate, hot, and safe', () => {
      const counts = obligationRegistry.getCounts();
      expect(counts).toHaveProperty('total');
      expect(counts).toHaveProperty('navi');
      expect(counts).toHaveProperty('scallop');
      expect(counts).toHaveProperty('immediate');
      expect(counts).toHaveProperty('hot');
      expect(counts).toHaveProperty('safe');

      expect(counts.total).toBe(counts.navi + counts.scallop);
      expect(counts.total).toBe(counts.immediate + counts.hot + counts.safe);
    });

    it('filters obligations with 1.00 <= HF < 1.05 in getHotWatchlistAccounts', () => {
      // Insert test obligations across various health factors
      const targetHot1: ObligationState = {
        protocol: 'navi',
        obligationId: '0xHotAccount1_R2',
        ownerAddress: '0xOwner1',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 10500,
        totalDebtUsd: 10000,
        liquidationThresholdCollateralUsd: 10200,
        healthFactor: 1.0200, // 1.00 <= HF < 1.05 -> HOT
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      const targetHot2: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xHotAccount2_R2',
        ownerAddress: '0xOwner2',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 10100,
        totalDebtUsd: 10000,
        liquidationThresholdCollateralUsd: 10050,
        healthFactor: 1.0050, // 1.00 <= HF < 1.02 -> CRITICAL
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      const targetSafe: ObligationState = {
        protocol: 'navi',
        obligationId: '0xSafeAccount_R2',
        ownerAddress: '0xOwner3',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 20000,
        totalDebtUsd: 10000,
        liquidationThresholdCollateralUsd: 18000,
        healthFactor: 1.8000, // Safe (>= 1.05)
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      obligationRegistry.upsertObligation(targetHot1);
      obligationRegistry.upsertObligation(targetHot2);
      obligationRegistry.upsertObligation(targetSafe);

      const hotAccounts = obligationRegistry.getHotWatchlistAccounts(1.00, 1.05);
      const hotIds = hotAccounts.map((a) => a.obligationId);

      expect(hotIds).toContain('0xHotAccount1_R2');
      expect(hotIds).toContain('0xHotAccount2_R2');
      expect(hotIds).not.toContain('0xSafeAccount_R2');

      // Verify payload translation
      const payload = telemetryBridge.generatePayload();
      const inPayload = payload.hotWatchlist.find((h) => h.obligationId === '0xHotAccount2_R2');
      expect(inPayload).toBeDefined();
      expect(inPayload?.urgency).toBe('CRITICAL'); // HF < 1.02 is CRITICAL

      const inPayload2 = payload.hotWatchlist.find((h) => h.obligationId === '0xHotAccount1_R2');
      expect(inPayload2).toBeDefined();
      expect(inPayload2?.urgency).toBe('HOT'); // 1.02 <= HF < 1.05 is HOT
    });
  });

  // ========================================================
  // 5. Decoupled Daemon Lifecycle & Immediate Reflex
  // ========================================================
  describe('Decoupled Daemon Lifecycle & Immediate Reflex', () => {
    it('starts unref daemon loop and stops cleanly without leaving active handles', async () => {
      telemetryBridge.start(50);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(fs.existsSync(testTelemetryFile)).toBe(true);

      // Calling start again is idempotent
      telemetryBridge.start(50);

      telemetryBridge.stop();
      // Calling stop again is idempotent
      telemetryBridge.stop();
    });

    it('triggers immediate exportSnapshot upon recording a liquidation event', async () => {
      const exportSpy = vi.spyOn(telemetryBridge, 'exportSnapshot');

      telemetryBridge.recordLiquidation({
        timestamp: new Date().toISOString(),
        protocol: 'navi',
        borrower: '0xImmediateReflexBorrower',
        debtRepaid: '500 USDC',
        collateralSeized: '250 SUI',
        estimatedNetProfitUsd: 15.0,
        gasCostSui: 0.01,
        txDigest: '0xDigestReflex',
        txDigestLink: 'https://suiscan.xyz/mainnet/tx/0xDigestReflex',
      });

      expect(exportSpy).toHaveBeenCalled();
    });

    it('searcher exposes recent liquidations matching telemetry bridge', () => {
      telemetryBridge.recordLiquidation({
        timestamp: new Date().toISOString(),
        protocol: 'scallop',
        borrower: '0xSearcherBorrower',
        debtRepaid: '2,000 USDC',
        collateralSeized: '1,000 SUI',
        estimatedNetProfitUsd: 35.0,
        gasCostSui: 0.02,
        txDigest: '0xDigestSearcher',
        txDigestLink: 'https://suiscan.xyz/mainnet/tx/0xDigestSearcher',
      });

      const searcherRecent = searcher.getRecentLiquidations();
      expect(searcherRecent).toHaveLength(1);
      expect(searcherRecent[0].borrower).toBe('0xSearcherBorrower');
    });
  });
});
