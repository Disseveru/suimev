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
import {
  TelemetryPayload,
  TelemetryRecentLiquidationItem,
  ObligationState,
} from '../src/config/types.js';
import { validateTelemetryPayload, createMockObligation } from './e2e/helpers/contracts.js';

describe('Adversarial Stress Test: Atomic Telemetry State Bridge (Milestone M2)', () => {
  const testStateDir = path.resolve(process.cwd(), '.state_adversarial_m2_1');
  const testTelemetryFile = path.join(testStateDir, 'telemetry.json');

  beforeEach(() => {
    if (!fs.existsSync(testStateDir)) {
      fs.mkdirSync(testStateDir, { recursive: true });
    }
    telemetryBridge.setStateFilePath(testTelemetryFile);
    telemetryBridge.clearRingBuffer();
    obligationRegistry.clear();
  });

  afterEach(() => {
    telemetryBridge.stop();
    telemetryBridge.clearRingBuffer();
    telemetryBridge.setStateFilePath(path.resolve(process.cwd(), '.state', 'telemetry.json'));
    obligationRegistry.clear();
    if (fs.existsSync(testStateDir)) {
      try {
        fs.rmSync(testStateDir, { recursive: true, force: true });
      } catch {
        /* Windows lock cleanup ignore */
      }
    }
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. High-Concurrency: 50 Concurrent Readers Reading During Active Writes
  // =========================================================================
  describe('1. High-Concurrency: 50 Concurrent Readers During Active Writes', () => {
    it('ADVERSARIAL: survives 50 concurrent readers performing 1,000 total reads without 0-byte reads or parse errors while writes are in flight', async () => {
      // Seed initial state
      await telemetryBridge.exportSnapshot();
      expect(fs.existsSync(testTelemetryFile)).toBe(true);

      const numReaders = 50;
      const readsPerReader = 20; // 50 * 20 = 1,000 reads
      const numWrites = 25;

      let readerSuccessCount = 0;
      let readerParseErrors = 0;
      let readerSchemaErrors = 0;
      let readerZeroByteErrors = 0;
      const capturedPayloads: TelemetryPayload[] = [];

      // Flag to coordinate writers and readers
      let writersActive = true;

      // Start 25 sequential rapid writes with evolving data
      const writerPromise = (async () => {
        for (let i = 0; i < numWrites; i++) {
          // Push unique liquidation event to vary the payload
          telemetryBridge.recordLiquidation({
            timestamp: new Date().toISOString(),
            protocol: i % 2 === 0 ? 'navi' : 'scallop',
            borrower: `0xBorrower_Write_${i}`,
            debtRepaid: `${(i + 1) * 100} USDC`,
            collateralSeized: `${(i + 1) * 50} SUI`,
            netProfitUsd: (i + 1) * 3.5,
            gasCostSui: 0.02,
            txDigest: `digest_write_${i}`,
            txDigestLink: `https://suiscan.xyz/mainnet/tx/digest_write_${i}`,
          });

          await telemetryBridge.exportSnapshot();
          // Micro-pause to interleave with readers
          await new Promise((r) => setTimeout(r, 2));
        }
        writersActive = false;
      })();

      // Start 50 concurrent readers
      const readerPromises = Array.from({ length: numReaders }, async (_, readerId) => {
        for (let j = 0; j < readsPerReader; j++) {
          try {
            const raw = await fs.promises.readFile(testTelemetryFile, 'utf8');

            if (raw.length === 0) {
              readerZeroByteErrors++;
              continue;
            }

            let parsed: TelemetryPayload;
            try {
              parsed = JSON.parse(raw);
            } catch (err) {
              readerParseErrors++;
              continue;
            }

            const validation = validateTelemetryPayload(parsed);
            if (!validation.valid) {
              readerSchemaErrors++;
              continue;
            }

            readerSuccessCount++;
            if (readerId === 0 && j % 5 === 0) {
              capturedPayloads.push(parsed);
            }
          } catch (readErr: any) {
            // If file was temporarily inaccessible due to OS lock, record error
            readerParseErrors++;
          }

          // Small jitter
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
        }
      });

      // Await writer and all readers
      await Promise.all([writerPromise, ...readerPromises]);

      // Assertions
      expect(readerZeroByteErrors, 'Readers encountered 0-byte truncated reads due to direct-write fallback').toBe(0);
      expect(readerParseErrors, 'Readers encountered syntax parse errors from partial reads').toBe(0);
      expect(readerSchemaErrors, 'Readers encountered schema validation errors').toBe(0);
      expect(readerSuccessCount).toBe(numReaders * readsPerReader);
      expect(capturedPayloads.length).toBeGreaterThan(0);

      // Verify that final file contains valid payload
      const finalRaw = fs.readFileSync(testTelemetryFile, 'utf8');
      const finalParsed: TelemetryPayload = JSON.parse(finalRaw);
      expect(validateTelemetryPayload(finalParsed).valid).toBe(true);
      expect(finalParsed.recentLiquidations.length).toBe(15); // Ring buffer cap
    });
  });

  // =========================================================================
  // 2. Partial Read / Byte Truncation Guard
  // =========================================================================
  describe('2. Partial Read / Byte Truncation Guard', () => {
    it('ADVERSARIAL: guarantees readers never observe incomplete JSON or truncated bytes during heavy payload churn', async () => {
      // Seed 200 obligations to generate a heavy payload (~30KB+)
      for (let i = 0; i < 200; i++) {
        obligationRegistry.upsertObligation(
          createMockObligation({
            protocol: i % 2 === 0 ? 'navi' : 'scallop',
            obligationId: `0xHeavyObligation_${i}`,
            ownerAddress: `0xHeavyOwner_${i}`,
            healthFactor: 1.01 + (i % 4) * 0.01, // 1.01 to 1.04 (all in hot watchlist)
            totalDebtUsd: 1000 + i * 50,
            totalCollateralUsd: 1050 + i * 55,
          })
        );
      }

      await telemetryBridge.exportSnapshot();

      const initialSize = fs.statSync(testTelemetryFile).size;
      expect(initialSize).toBeGreaterThan(15000); // Verify it's a substantial payload

      const totalReaderAttempts = 500;
      let corruptReads = 0;
      let validReads = 0;

      // Launch writer cycling between large payload and small payload
      let keepWriting = true;
      const writerTask = (async () => {
        let cycle = 0;
        while (keepWriting) {
          cycle++;
          if (cycle % 2 === 0) {
            // Heavy payload
            telemetryBridge.setStatus('ONLINE');
          } else {
            // State change
            telemetryBridge.setStatus('PAUSED');
          }
          await telemetryBridge.exportSnapshot();
          await new Promise((r) => setTimeout(r, 1));
        }
      })();

      // 25 readers reading in tight loops
      const readers = Array.from({ length: 25 }, async () => {
        for (let k = 0; k < 20; k++) {
          try {
            const raw = await fs.promises.readFile(testTelemetryFile, 'utf8');
            // Check for truncation: must start with '{' and end with '}\n' or '}'
            const trimmed = raw.trim();
            if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
              corruptReads++;
              console.log(`[CORRUPT READ DETECTED] length=${raw.length}, preview="${raw.slice(0, 50)}...${raw.slice(-50)}"`);
              continue;
            }

            const parsed = JSON.parse(raw);
            if (!parsed.timestamp || !parsed.obligations || !Array.isArray(parsed.hotWatchlist)) {
              corruptReads++;
              console.log(`[SCHEMA INCOMPLETE READ] keys=${Object.keys(parsed)}`);
              continue;
            }

            validReads++;
          } catch (err: any) {
            corruptReads++;
            console.log(`[PARSE EXCEPTION ON READ] ${err.message}`);
          }
          await new Promise((r) => setTimeout(r, 2));
        }
      });

      try {
        await Promise.all(readers);
      } finally {
        keepWriting = false;
        await writerTask;
      }

      expect(corruptReads, 'Readers observed truncated or 0-byte corrupt reads during heavy payload churn').toBe(0);
      expect(validReads).toBe(totalReaderAttempts);
    });
  });

  // =========================================================================
  // 3. Transient File Locking Simulation & 3-Attempt Retry Recovery
  // =========================================================================
  describe('3. Transient File Locking Simulation & 3-Attempt Retry Recovery', () => {
    it('recovers seamlessly when rename encounters 1 transient EBUSY error on attempt 1', async () => {
      let attempts = 0;
      const realRename = fs.promises.rename;

      vi.spyOn(fs.promises, 'rename').mockImplementation(async (src, dest) => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('Resource busy or locked') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        }
        return realRename(src, dest);
      });

      const payload = { test: 'transient_ebusy_1' };
      await writeAtomicJson(testTelemetryFile, payload, 3);

      expect(attempts).toBe(2);
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      const tmpFiles1 = fs.readdirSync(testStateDir).filter((f) => f.includes('.tmp'));
      expect(tmpFiles1).toHaveLength(0);

      const saved = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      expect(saved.test).toBe('transient_ebusy_1');
    });

    it('recovers seamlessly when rename encounters 2 transient EPERM errors (succeeds on attempt 3)', async () => {
      let attempts = 0;
      const realRename = fs.promises.rename;

      vi.spyOn(fs.promises, 'rename').mockImplementation(async (src, dest) => {
        attempts++;
        if (attempts <= 2) {
          const err = new Error('Operation not permitted') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        }
        return realRename(src, dest);
      });

      const payload = { test: 'transient_eperm_2' };
      await writeAtomicJson(testTelemetryFile, payload, 3);

      expect(attempts).toBe(3);
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      const tmpFiles2 = fs.readdirSync(testStateDir).filter((f) => f.includes('.tmp'));
      expect(tmpFiles2).toHaveLength(0);

      const saved = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      expect(saved.test).toBe('transient_eperm_2');
    });

    it('handles mixed transient errors: EBUSY on attempt 1, EPERM on attempt 2, success on attempt 3', async () => {
      let attempts = 0;
      const realRename = fs.promises.rename;

      vi.spyOn(fs.promises, 'rename').mockImplementation(async (src, dest) => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('EBUSY locked') as NodeJS.ErrnoException;
          err.code = 'EBUSY';
          throw err;
        }
        if (attempts === 2) {
          const err = new Error('EPERM denied') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        }
        return realRename(src, dest);
      });

      const payload = { test: 'mixed_transient_recovery' };
      await writeAtomicJson(testTelemetryFile, payload, 3);

      expect(attempts).toBe(3);
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      const tmpFiles3 = fs.readdirSync(testStateDir).filter((f) => f.includes('.tmp'));
      expect(tmpFiles3).toHaveLength(0);

      const saved = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      expect(saved.test).toBe('mixed_transient_recovery');
    });

    it('safely ignores update and preserves existing file if rename is persistently locked after 3 attempts', async () => {
      let attempts = 0;
      await fs.promises.writeFile(testTelemetryFile, JSON.stringify({ test: 'initial-intact' }), 'utf8');

      vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
        attempts++;
        const err = new Error('Persistent lock EBUSY') as NodeJS.ErrnoException;
        err.code = 'EBUSY';
        throw err;
      });

      const payload = { test: 'fallback_after_exhaustion' };
      await writeAtomicJson(testTelemetryFile, payload, 3);

      expect(attempts).toBe(3);
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      // Temp file should be cleaned up
      const tmpFiles4 = fs.readdirSync(testStateDir).filter((f) => f.includes('.tmp'));
      expect(tmpFiles4).toHaveLength(0);

      const saved = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      expect(saved.test).toBe('initial-intact');
    });

    it('re-throws unhandled non-lock error codes (e.g. ENOSPC) immediately without retrying', async () => {
      let attempts = 0;

      vi.spyOn(fs.promises, 'rename').mockImplementation(async () => {
        attempts++;
        const err = new Error('No space left on device') as NodeJS.ErrnoException;
        err.code = 'ENOSPC';
        throw err;
      });

      await expect(
        writeAtomicJson(testTelemetryFile, { test: 'enospc' }, 3)
      ).rejects.toThrow('No space left on device');

      expect(attempts).toBe(1); // Fails fast without retries
    });
  });

  // =========================================================================
  // 4. Writer Race Condition & Concurrency Serialization Guard
  // =========================================================================
  describe('4. Writer Race Condition & Concurrency Serialization Guard', () => {
    it('serializes 50 simultaneous exportSnapshot() calls without collisions or unhandled rejections', async () => {
      telemetryBridge.clearRingBuffer();

      // Launch 50 simultaneous exportSnapshot calls
      const writes = Array.from({ length: 50 }, (_, i) => {
        telemetryBridge.recordLiquidation({
          timestamp: new Date().toISOString(),
          protocol: 'navi',
          borrower: `0xConcurrentBorrower_${i}`,
          debtRepaid: '100 USDC',
          collateralSeized: '50 SUI',
          netProfitUsd: 1.0,
          gasCostSui: 0.01,
          txDigest: `digest_${i}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/digest_${i}`,
        });
        return telemetryBridge.exportSnapshot();
      });

      // All 50 calls should resolve without error
      await expect(Promise.all(writes)).resolves.not.toThrow();

      // Allow setImmediate pending write to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      const raw = fs.readFileSync(testTelemetryFile, 'utf8');
      const parsed: TelemetryPayload = JSON.parse(raw);
      expect(validateTelemetryPayload(parsed).valid).toBe(true);
      expect(parsed.recentLiquidations.length).toBe(15);
    });
  });

  // =========================================================================
  // 5. Payload Integrity Under Extreme Boundary Values
  // =========================================================================
  describe('5. Payload Integrity Under Extreme Boundary Values', () => {
    it('maintains strict schema and JSON validity under extreme financial and obligation numbers', async () => {
      // Mock extreme gas balance
      vi.spyOn(gasManager, 'getCachedBalanceSui').mockReturnValue(999999999.123456789);

      // Mock searcher with negative PnL and high simulation count
      if (searcher) {
        (searcher as any).stats = {
          cumulativeNetProfitUsd: -4250.75,
          cumulativeGasSpentSui: 125.8765,
          successfulLiquidations: 0,
          failedLiquidations: 12,
          totalSimulations: 9999999,
        };
      }

      // Populate extreme obligations: 0 debt, tiny debt, huge collateral
      obligationRegistry.upsertObligation(
        createMockObligation({
          protocol: 'navi',
          obligationId: '0xBoundary_1',
          ownerAddress: '0xOwner_1',
          healthFactor: 1.0001,
          totalDebtUsd: 0.02,
          totalCollateralUsd: 0.03,
        })
      );

      obligationRegistry.upsertObligation(
        createMockObligation({
          protocol: 'scallop',
          obligationId: '0xBoundary_2',
          ownerAddress: '0xOwner_2',
          healthFactor: 1.0499,
          totalDebtUsd: 50000000.0,
          totalCollateralUsd: 52000000.0,
        })
      );

      await telemetryBridge.exportSnapshot();

      const raw = fs.readFileSync(testTelemetryFile, 'utf8');
      const parsed: TelemetryPayload = JSON.parse(raw);

      const validation = validateTelemetryPayload(parsed);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      expect(parsed.operator.gasTankBalanceSui).toBe(999999999.123456789);
      expect(parsed.operator.gasTankBalanceMist).toBe(BigInt(Math.floor(999999999.123456789 * 1e9)).toString());
      expect(parsed.financials.netRealizedPnlUsd).toBe(-4250.75);
      expect(parsed.financials.totalSimulations).toBe(9999999);
      expect(parsed.hotWatchlist).toHaveLength(2);

      // Test zero balance
      vi.spyOn(gasManager, 'getCachedBalanceSui').mockReturnValue(0);
      await telemetryBridge.exportSnapshot();

      const rawZero = fs.readFileSync(testTelemetryFile, 'utf8');
      const parsedZero: TelemetryPayload = JSON.parse(rawZero);
      expect(parsedZero.operator.gasTankBalanceSui).toBe(0);
      expect(parsedZero.operator.gasTankBalanceMist).toBe('0');
      expect(validateTelemetryPayload(parsedZero).valid).toBe(true);
    });

    it('enforces exact urgency classification: CRITICAL for HF < 1.02 and HOT for 1.02 <= HF < 1.05', async () => {
      obligationRegistry.upsertObligation(
        createMockObligation({
          protocol: 'navi',
          obligationId: '0xCritical_1',
          ownerAddress: '0xBorrower_Crit',
          healthFactor: 1.0199,
          totalDebtUsd: 1000,
          totalCollateralUsd: 1010,
        })
      );

      obligationRegistry.upsertObligation(
        createMockObligation({
          protocol: 'scallop',
          obligationId: '0xHot_1',
          ownerAddress: '0xBorrower_Hot',
          healthFactor: 1.0200,
          totalDebtUsd: 2000,
          totalCollateralUsd: 2050,
        })
      );

      obligationRegistry.upsertObligation(
        createMockObligation({
          protocol: 'scallop',
          obligationId: '0xHot_2',
          ownerAddress: '0xBorrower_Hot2',
          healthFactor: 1.0499,
          totalDebtUsd: 3000,
          totalCollateralUsd: 3150,
        })
      );

      await telemetryBridge.exportSnapshot();

      const raw = fs.readFileSync(testTelemetryFile, 'utf8');
      const parsed: TelemetryPayload = JSON.parse(raw);

      const critItem = parsed.hotWatchlist.find((i) => i.obligationId === '0xCritical_1');
      const hotItem1 = parsed.hotWatchlist.find((i) => i.obligationId === '0xHot_1');
      const hotItem2 = parsed.hotWatchlist.find((i) => i.obligationId === '0xHot_2');

      expect(critItem?.urgency).toBe('CRITICAL');
      expect(hotItem1?.urgency).toBe('HOT');
      expect(hotItem2?.urgency).toBe('HOT');
    });
  });

  // =========================================================================
  // 6. Ring Buffer Stress & FIFO Boundary
  // =========================================================================
  describe('6. Ring Buffer Stress & FIFO Boundary', () => {
    it('handles 100 rapid sequential pushes and guarantees strictly 15 items in FIFO order', () => {
      const ringBuffer = new LiquidationRingBuffer(15);

      for (let i = 1; i <= 100; i++) {
        ringBuffer.push({
          timestamp: new Date().toISOString(),
          protocol: 'navi',
          borrower: `0xBorrower_${i}`,
          debtRepaid: `${i} USDC`,
          collateralSeized: `${i} SUI`,
          netProfitUsd: i,
          gasCostSui: 0.01,
          txDigest: `digest_${i}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/digest_${i}`,
        });
      }

      expect(ringBuffer.size()).toBe(15);
      const events = ringBuffer.getEvents();
      expect(events[0].borrower).toBe('0xBorrower_86');
      expect(events[14].borrower).toBe('0xBorrower_100');
    });
  });

  // =========================================================================
  // 7. Daemon Lifecycle Stress
  // =========================================================================
  describe('7. Daemon Lifecycle Stress', () => {
    it('handles rapid start/stop toggles without leaking intervals or throwing', async () => {
      for (let i = 0; i < 10; i++) {
        telemetryBridge.start(50);
        telemetryBridge.stop();
      }
      // Final start
      telemetryBridge.start(50);
      await new Promise((r) => setTimeout(r, 100));
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      telemetryBridge.stop();
    });
  });
});
