import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  LiquidationRingBuffer,
  telemetryBridge,
  TelemetryBridge,
  writeAtomicJson,
} from '../src/engine/telemetryBridge.js';
import { TransactionExecutor } from '../src/engine/executor.js';
import { obligationRegistry } from '../src/engine/registry.js';
import { gasManager } from '../src/client/gasManager.js';
import { searcher } from '../src/engine/searcher.js';
import { TelemetryRecentLiquidationItem, ObligationState } from '../src/config/types.js';
import { validateTelemetryPayload } from './e2e/helpers/contracts.js';

describe('Adversarial Stress Test: Ring Buffer & Engine Latency (Challenger M2-2)', () => {
  const testStateDir = path.resolve(process.cwd(), '.state_adv_test');
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
      try {
        fs.rmSync(testStateDir, { recursive: true, force: true });
      } catch {
        /* Windows lock cleanup ignore */
      }
    }
  });

  // =========================================================================
  // 1. 100 Rapid Liquidation Events Pushed to 15-Item Ring Buffer
  // =========================================================================
  describe('1. Ring Buffer 100-Event Overflow & FIFO Retention', () => {
    it('retains exactly the 15 newest items and evicts the oldest 85 after 100 rapid pushes', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      expect(ringBuffer.size()).toBe(0);

      for (let i = 1; i <= 100; i++) {
        ringBuffer.push({
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          protocol: i % 2 === 0 ? 'scallop' : 'navi',
          borrower: `0xBorrower_${String(i).padStart(3, '0')}`,
          debtRepaid: `${i * 100} USDC`,
          collateralSeized: `${i * 50} SUI`,
          netProfitUsd: i * 2.5,
          gasCostSui: 0.005,
          txDigest: `digest_${i}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/digest_${i}`,
        });
      }

      expect(ringBuffer.size()).toBe(15);
      const events = ringBuffer.getEvents();
      expect(events).toHaveLength(15);

      // Oldest retained must be event 86
      expect(events[0].borrower).toBe('0xBorrower_086');
      expect(events[0].txDigest).toBe('digest_86');

      // Newest retained must be event 100
      expect(events[14].borrower).toBe('0xBorrower_100');
      expect(events[14].txDigest).toBe('digest_100');

      // Strict chronological sequence from 86 to 100
      for (let j = 0; j < 15; j++) {
        const expectedIndex = j + 86;
        expect(events[j].borrower).toBe(`0xBorrower_${String(expectedIndex).padStart(3, '0')}`);
        expect(events[j].txDigest).toBe(`digest_${expectedIndex}`);
      }
    });

    it('handles 100 rapid concurrent bursts via TelemetryBridge without buffer overrun', async () => {
      telemetryBridge.clearRingBuffer();

      const burstPromises = Array.from({ length: 100 }, (_, i) => {
        const idx = i + 1;
        const item: TelemetryRecentLiquidationItem = {
          timestamp: new Date().toISOString(),
          protocol: idx % 2 === 0 ? 'navi' : 'scallop',
          borrower: `0xBurstBorrower_${idx}`,
          debtRepaid: `${idx * 10} USDC`,
          collateralSeized: `${idx * 5} SUI`,
          netProfitUsd: idx * 1.5,
          gasCostSui: 0.004,
          txDigest: `burst_digest_${idx}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/burst_digest_${idx}`,
        };
        return Promise.resolve().then(() => telemetryBridge.recordLiquidation(item));
      });

      await Promise.all(burstPromises);

      const recent = telemetryBridge.getRecentLiquidations();
      expect(recent.length).toBe(15);
    });

    it('provides defensive copying: mutating getEvents() does not corrupt internal buffer', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      ringBuffer.push({
        timestamp: new Date().toISOString(),
        protocol: 'navi',
        borrower: '0xOriginal',
        debtRepaid: '100 USDC',
        collateralSeized: '50 SUI',
        netProfitUsd: 10,
        gasCostSui: 0.005,
        txDigest: 'orig_1',
        txDigestLink: 'https://suiscan.xyz/mainnet/tx/orig_1',
      });

      const copy = ringBuffer.getEvents();
      copy.length = 0; // Empty the copy

      expect(ringBuffer.size()).toBe(1);
      expect(ringBuffer.getEvents()[0].borrower).toBe('0xOriginal');
    });

    it('supports clear() and clean re-filling', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      for (let i = 0; i < 15; i++) {
        ringBuffer.push({
          timestamp: new Date().toISOString(),
          protocol: 'navi',
          borrower: `0xPre_${i}`,
          debtRepaid: '10 USDC',
          collateralSeized: '5 SUI',
          netProfitUsd: 1,
          gasCostSui: 0.001,
          txDigest: `pre_${i}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/pre_${i}`,
        });
      }
      expect(ringBuffer.size()).toBe(15);
      ringBuffer.clear();
      expect(ringBuffer.size()).toBe(0);
      expect(ringBuffer.getEvents()).toHaveLength(0);

      // Re-populate with 3 items
      for (let i = 0; i < 3; i++) {
        ringBuffer.push({
          timestamp: new Date().toISOString(),
          protocol: 'scallop',
          borrower: `0xPost_${i}`,
          debtRepaid: '20 USDC',
          collateralSeized: '10 SUI',
          netProfitUsd: 2,
          gasCostSui: 0.001,
          txDigest: `post_${i}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/post_${i}`,
        });
      }
      expect(ringBuffer.size()).toBe(3);
    });
  });

  // =========================================================================
  // 2. Event Formatting Under Edge Cases
  // =========================================================================
  describe('2. Event Formatting Under Adversarial Edge Cases', () => {
    it('formats 0, 1 MIST, u64::MAX, astro BigInt, negative amount, and unknown symbols in formatCoinAmount', () => {
      // 0 amount
      expect(TransactionExecutor.formatCoinAmount(0n, 'USDC')).toBe('0.00 USDC');
      expect(TransactionExecutor.formatCoinAmount(0n, 'SUI')).toBe('0.00 SUI');

      // 1 discrete subunit (1 micro-USDC = 10^-6 USDC formats with full precision)
      const usdcSubunit = TransactionExecutor.formatCoinAmount(1n, 'USDC');
      expect(usdcSubunit).toBe('0.000001 USDC');

      // 1 MIST (10^-9 SUI) truncates to '0.00 SUI' due to maximumFractionDigits: 6
      const mistOut = TransactionExecutor.formatCoinAmount(1n, 'SUI');
      expect(mistOut).toBe('0.00 SUI');

      // 1 micro-SUI (1,000 MIST = 10^-6 SUI) formats with 6 decimals
      const microSui = TransactionExecutor.formatCoinAmount(1_000n, 'SUI');
      expect(microSui).toBe('0.000001 SUI');

      // Move u64::MAX (18_446_744_073_709_551_615n)
      const maxMove = TransactionExecutor.formatCoinAmount(18_446_744_073_709_551_615n, 'SUI');
      expect(maxMove).toContain('18,446,744,073');
      expect(maxMove.endsWith('SUI')).toBe(true);

      // Negative amount
      expect(TransactionExecutor.formatCoinAmount(-5_000_000n, 'USDC')).toBe('-5.00 USDC');

      // Unknown symbol defaults decimals to 9 gracefully without throwing
      const unknownOut = TransactionExecutor.formatCoinAmount(1_000_000_000n, 'NON_EXISTENT_COIN');
      expect(unknownOut).toBe('1.00 NON_EXISTENT_COIN');
    });

    it('safely serializes 0, negative, fractional, and massive profit values in telemetry payload', () => {
      const testProfits = [0.0, -125.75, 0.0005, 999_999_999.50];

      for (const profit of testProfits) {
        telemetryBridge.clearRingBuffer();
        telemetryBridge.recordLiquidation({
          timestamp: new Date().toISOString(),
          protocol: 'navi',
          borrower: '0xProfitTester',
          debtRepaid: '1,000.00 USDC',
          collateralSeized: '500.00 SUI',
          netProfitUsd: profit,
          gasCostSui: 0.005,
          txDigest: `profit_digest_${profit}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/profit_digest_${profit}`,
        });

        const payload = telemetryBridge.generatePayload();
        expect(payload.recentLiquidations[0].netProfitUsd).toBe(profit);

        const jsonStr = JSON.stringify(payload);
        const parsed = JSON.parse(jsonStr);
        expect(parsed.recentLiquidations[0].netProfitUsd).toBe(profit);
      }
    });

    it('validates digest format and catches empty or malformed digests via schema validator', () => {
      const emptyDigestItem: TelemetryRecentLiquidationItem = {
        timestamp: new Date().toISOString(),
        protocol: 'scallop',
        borrower: '0xNoDigestBorrower',
        debtRepaid: '500.00 USDC',
        collateralSeized: '250.00 SUI',
        netProfitUsd: 20.0,
        gasCostSui: 0.004,
        txDigest: '',
        txDigestLink: '',
      };

      telemetryBridge.clearRingBuffer();
      telemetryBridge.recordLiquidation(emptyDigestItem);
      const invalidPayload = telemetryBridge.generatePayload();
      const validationEmpty = validateTelemetryPayload(invalidPayload);
      expect(validationEmpty.valid).toBe(false);
      expect(validationEmpty.errors.some((e) => e.includes('Invalid recent liquidation item tx link'))).toBe(true);

      // Now with valid Suiscan link
      const validDigest = 'B7sK4YmQ2pL8xZ3wN9r5T1v6X0a4C8e2G6i0K2m4O6';
      telemetryBridge.clearRingBuffer();
      telemetryBridge.recordLiquidation({
        ...emptyDigestItem,
        txDigest: validDigest,
        txDigestLink: `https://suiscan.xyz/mainnet/tx/${validDigest}`,
      });
      const validPayload = telemetryBridge.generatePayload();
      const validationValid = validateTelemetryPayload(validPayload);
      expect(validationValid.valid).toBe(true);
    });
  });

  // =========================================================================
  // 3. Benchmark Latency (< 5ms so searcher execution is unaffected)
  // =========================================================================
  describe('3. Engine Latency Benchmarks (< 5ms Target)', () => {
    it('generatePayload() executes in < 5ms across 1,000 iterations (baseline)', () => {
      const ITERATIONS = 1000;
      const latencies: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const t0 = performance.now();
        telemetryBridge.generatePayload();
        const t1 = performance.now();
        latencies.push(t1 - t0);
      }

      latencies.sort((a, b) => a - b);
      const p99 = latencies[Math.floor(ITERATIONS * 0.99)];
      const avg = latencies.reduce((a, b) => a + b, 0) / ITERATIONS;

      expect(p99).toBeLessThan(5.0);
      expect(avg).toBeLessThan(1.0);
    });

    it('generatePayload() executes in < 5ms under stress load with 2,500 registered obligations', () => {
      // Seed registry with 2,500 accounts
      for (let i = 1; i <= 2500; i++) {
        const isHot = i % 25 === 0;
        obligationRegistry.upsertObligation({
          protocol: i % 2 === 0 ? 'navi' : 'scallop',
          obligationId: `0xStressAccount_${i}`,
          ownerAddress: `0xOwner_${i}`,
          collaterals: [],
          debts: [],
          totalCollateralUsd: isHot ? 10200 : 20000,
          totalDebtUsd: isHot ? 10000 : 5000,
          liquidationThresholdCollateralUsd: 15000,
          healthFactor: isHot ? 1.02 : 1.75,
          isLiquidatable: false,
          lastUpdatedMs: Date.now(),
        });
      }

      const ITERATIONS = 200;
      const latencies: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const t0 = performance.now();
        telemetryBridge.generatePayload();
        const t1 = performance.now();
        latencies.push(t1 - t0);
      }

      latencies.sort((a, b) => a - b);
      const p99 = latencies[Math.floor(ITERATIONS * 0.99)];
      const avg = latencies.reduce((a, b) => a + b, 0) / ITERATIONS;

      expect(p99).toBeLessThan(5.0);
    });

    it('exportSnapshot() synchronous caller blocking time is < 5ms', async () => {
      const ITERATIONS = 100;
      const syncDurations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const t0 = performance.now();
        const p = telemetryBridge.exportSnapshot();
        const t1 = performance.now();
        syncDurations.push(t1 - t0);
        await p;
      }

      syncDurations.sort((a, b) => a - b);
      const p99 = syncDurations[Math.floor(ITERATIONS * 0.99)];
      const avg = syncDurations.reduce((a, b) => a + b, 0) / ITERATIONS;

      expect(p99).toBeLessThan(5.0);
      expect(avg).toBeLessThan(1.0);
    });

    it('exportSnapshot() async disk write + rename completes in < 5ms average duration', async () => {
      const ITERATIONS = 50;
      const asyncDurations: number[] = [];

      for (let i = 0; i < ITERATIONS; i++) {
        const t0 = performance.now();
        await telemetryBridge.exportSnapshot();
        const t1 = performance.now();
        asyncDurations.push(t1 - t0);
      }

      asyncDurations.sort((a, b) => a - b);
      const p50 = asyncDurations[Math.floor(ITERATIONS * 0.5)];
      const avg = asyncDurations.reduce((a, b) => a + b, 0) / ITERATIONS;

      expect(p50).toBeLessThan(5.0);
      expect(avg).toBeLessThan(5.0);
    });

    it('write coalescing maintains event loop lag < 5ms under 50 concurrent export requests', async () => {
      let eventLoopDelay = 0;
      const lagMeasure = new Promise<void>((resolve) => {
        const t0 = performance.now();
        setImmediate(() => {
          eventLoopDelay = performance.now() - t0;
          resolve();
        });
      });

      const burst = Array.from({ length: 50 }, () => telemetryBridge.exportSnapshot());
      await Promise.all([...burst, lagMeasure]);

      expect(eventLoopDelay).toBeLessThan(5.0);
    });
  });
});
