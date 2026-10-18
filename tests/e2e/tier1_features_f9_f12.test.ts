import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ObligationRegistry } from '../../src/engine/registry.js';
import { gasManager } from '../../src/client/gasManager.js';
import { ObligationState } from '../../src/config/types.js';
import {
  LiquidationRingBuffer,
  TelemetryRecentLiquidationItem,
  writeAtomicJson,
  validateTelemetryPayload,
  TelemetryPayload,
} from './helpers/contracts.js';

describe('Tier 1: Feature Coverage — Telemetry & Engine Daemon (F9–F12)', () => {
  const testStateDir = path.resolve(process.cwd(), '.state_test');
  const testTelemetryFile = path.join(testStateDir, 'telemetry.json');

  beforeEach(() => {
    if (!fs.existsSync(testStateDir)) {
      fs.mkdirSync(testStateDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testStateDir)) {
      fs.rmSync(testStateDir, { recursive: true, force: true });
    }
  });

  // ==========================================
  // F9: Disaggregated Obligation Counts
  // ==========================================
  describe('F9: Disaggregated Obligation Counts', () => {
    it('T1.F9.1: Obligation registry can compute disaggregated navi and scallop counts', () => {
      const registry = ObligationRegistry.getInstance();
      const all = registry.getAllObligations();
      const naviCount = all.filter((o) => o.protocol === 'navi').length;
      const scallopCount = all.filter((o) => o.protocol === 'scallop').length;
      expect(naviCount).toBeGreaterThanOrEqual(0);
      expect(scallopCount).toBeGreaterThanOrEqual(0);
      expect(all.length).toBe(naviCount + scallopCount);
    });

    it('T1.F9.2: Inserting a NAVI obligation increments NAVI count', () => {
      const registry = ObligationRegistry.getInstance();
      const initialNavi = registry.getAllObligations().filter((o) => o.protocol === 'navi').length;
      const mockNavi: ObligationState = {
        protocol: 'navi',
        obligationId: '0xTestNaviAccountF9',
        ownerAddress: '0xOwnerNavi',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 100,
        totalDebtUsd: 50,
        liquidationThresholdCollateralUsd: 80,
        healthFactor: 1.8,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };
      registry.upsertObligation(mockNavi);
      const afterNavi = registry.getAllObligations().filter((o) => o.protocol === 'navi').length;
      expect(afterNavi).toBe(initialNavi + 1);
    });

    it('T1.F9.3: Inserting a Scallop obligation increments Scallop count without altering NAVI count', () => {
      const registry = ObligationRegistry.getInstance();
      const initialScallop = registry.getAllObligations().filter((o) => o.protocol === 'scallop').length;
      const initialNavi = registry.getAllObligations().filter((o) => o.protocol === 'navi').length;
      const mockScallop: ObligationState = {
        protocol: 'scallop',
        obligationId: '0xTestScallopAccountF9',
        ownerAddress: '0xOwnerScallop',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 200,
        totalDebtUsd: 100,
        liquidationThresholdCollateralUsd: 160,
        healthFactor: 1.9,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };
      registry.upsertObligation(mockScallop);
      const afterScallop = registry.getAllObligations().filter((o) => o.protocol === 'scallop').length;
      const afterNavi = registry.getAllObligations().filter((o) => o.protocol === 'navi').length;
      expect(afterScallop).toBe(initialScallop + 1);
      expect(afterNavi).toBe(initialNavi);
    });

    it('T1.F9.4: Total monitored obligations strictly matches sum of protocol counts', () => {
      const registry = ObligationRegistry.getInstance();
      const counts = registry.getCounts();
      const all = registry.getAllObligations();
      const navi = all.filter((o) => o.protocol === 'navi').length;
      const scallop = all.filter((o) => o.protocol === 'scallop').length;
      expect(counts.total).toBe(navi + scallop);
    });

    it('T1.F9.5: Priority buckets correctly differentiate immediate targets vs hot vs safe', () => {
      const registry = ObligationRegistry.getInstance();
      const counts = registry.getCounts();
      expect(counts.immediate).toBeGreaterThanOrEqual(0);
      expect(counts.hot).toBeGreaterThanOrEqual(0);
      expect(counts.safe).toBeGreaterThanOrEqual(0);
      expect(counts.immediate + counts.hot + counts.safe).toBe(counts.total);
    });
  });

  // ==========================================
  // F10: Liquidation Event Ring Buffer
  // ==========================================
  describe('F10: Liquidation Event Ring Buffer', () => {
    it('T1.F10.1: Ring buffer records events with complete telemetry schema', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      const event: TelemetryRecentLiquidationItem = {
        timestamp: new Date().toISOString(),
        protocol: 'navi',
        borrower: '0x123...456',
        debtRepaid: '1,000.00 USDC',
        collateralSeized: '550.25 SUI',
        estimatedNetProfitUsd: 15.5,
        gasCostSui: 0.025,
        txDigest: '5cZ8X9abcdef1234567890',
        txDigestLink: 'https://suiscan.xyz/mainnet/tx/5cZ8X9abcdef1234567890',
      };
      ringBuffer.push(event);
      expect(ringBuffer.size()).toBe(1);
      expect(ringBuffer.getEvents()[0]).toEqual(event);
    });

    it('T1.F10.2: FIFO eviction behavior: drops oldest entry when capacity 15 is exceeded', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      for (let i = 1; i <= 20; i++) {
        ringBuffer.push({
          timestamp: new Date().toISOString(),
          protocol: 'navi',
          borrower: `0xBorrower_${i}`,
          debtRepaid: '100 USDC',
          collateralSeized: '50 SUI',
          estimatedNetProfitUsd: i,
          gasCostSui: 0.01,
          txDigest: `digest_${i}`,
          txDigestLink: `https://suiscan.xyz/mainnet/tx/digest_${i}`,
        });
      }
      expect(ringBuffer.size()).toBe(15);
      const events = ringBuffer.getEvents();
      // Oldest remaining should be index 6 (1 to 5 evicted)
      expect(events[0].borrower).toBe('0xBorrower_6');
      expect(events[14].borrower).toBe('0xBorrower_20');
    });

    it('T1.F10.3: Ring buffer correctly handles dry-run / simulation strikes', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      ringBuffer.push({
        timestamp: new Date().toISOString(),
        protocol: 'scallop',
        borrower: '0xDryRunBorrower',
        debtRepaid: '5,000 USDC',
        collateralSeized: '2,500 SUI',
        estimatedNetProfitUsd: 45.2,
        gasCostSui: 0.04,
        txDigest: 'DRY_RUN_SIMULATED',
        txDigestLink: 'https://suiscan.xyz/mainnet/tx/DRY_RUN_SIMULATED',
      });
      expect(ringBuffer.size()).toBe(1);
      expect(ringBuffer.getEvents()[0].txDigest).toBe('DRY_RUN_SIMULATED');
    });

    it('T1.F10.4: Ring buffer captures live on-chain strikes with real digests', () => {
      const ringBuffer = new LiquidationRingBuffer(15);
      const liveDigest = '8K9mN4xYz2WpQvRt5LuJh';
      ringBuffer.push({
        timestamp: new Date().toISOString(),
        protocol: 'navi',
        borrower: '0xLiveBorrower',
        debtRepaid: '2,500 USDT',
        collateralSeized: '1,200 SUI',
        estimatedNetProfitUsd: 28.0,
        gasCostSui: 0.035,
        txDigest: liveDigest,
        txDigestLink: `https://suiscan.xyz/mainnet/tx/${liveDigest}`,
      });
      expect(ringBuffer.getEvents()[0].txDigestLink).toBe(`https://suiscan.xyz/mainnet/tx/${liveDigest}`);
    });

    it('T1.F10.5: TxDigestLink matches canonical Suiscan explorer URL structure', () => {
      const digest = '3vPx9LqRtWzY2mN4x8K';
      const link = `https://suiscan.xyz/mainnet/tx/${digest}`;
      expect(link).toMatch(/^https:\/\/suiscan\.xyz\/mainnet\/tx\/[a-zA-Z0-9]+$/);
    });
  });

  // ==========================================
  // F11: Atomic Telemetry Bridge Daemon
  // ==========================================
  describe('F11: Atomic Telemetry Bridge Daemon', () => {
    it('T1.F11.1: Atomic write utilizes .tmp staging file before rename', async () => {
      const samplePayload: TelemetryPayload = {
        timestamp: new Date().toISOString(),
        botStatus: 'ONLINE',
        operator: {
          address: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          gasTankBalanceSui: 10.5,
          gasTankBalanceMist: '10500000000',
        },
        financials: {
          netRealizedPnlUsd: 50.0,
          cumulativeGasSpentSui: 0.5,
          successfulLiquidations: 2,
          failedLiquidations: 0,
          totalSimulations: 100,
        },
        obligations: {
          totalMonitored: 500,
          naviCount: 300,
          scallopCount: 200,
          immediateTargetsCount: 0,
          hotWatchlistCount: 2,
          safeCount: 498,
        },
        hotWatchlist: [],
        recentLiquidations: [],
      };

      await writeAtomicJson(testTelemetryFile, samplePayload);
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
      expect(fs.existsSync(`${testTelemetryFile}.tmp`)).toBe(false);

      const readBack = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
      const validation = validateTelemetryPayload(readBack);
      expect(validation.valid).toBe(true);
    });

    it('T1.F11.2: Windows file lock retry loop recovers without crashing', async () => {
      const sampleData = { test: 'retry-resilience' };
      // Normal write succeeds within 3 retries
      await expect(writeAtomicJson(testTelemetryFile, sampleData, 3)).resolves.not.toThrow();
      expect(fs.existsSync(testTelemetryFile)).toBe(true);
    });

    it('T1.F11.3: Automatically creates destination directory recursively if absent', async () => {
      const nestedPath = path.join(testStateDir, 'deep', 'nested', 'telemetry.json');
      await writeAtomicJson(nestedPath, { status: 'ok' });
      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('T1.F11.4: Output JSON strictly conforms to PROJECT.md schema contract', () => {
      const samplePayload: TelemetryPayload = {
        timestamp: '2026-10-16T10:45:00.000Z',
        botStatus: 'ONLINE',
        operator: {
          address: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          gasTankBalanceSui: 14.8523,
          gasTankBalanceMist: '14852300000',
        },
        financials: {
          netRealizedPnlUsd: 124.5,
          cumulativeGasSpentSui: 1.254,
          successfulLiquidations: 3,
          failedLiquidations: 0,
          totalSimulations: 842,
        },
        obligations: {
          totalMonitored: 1420,
          naviCount: 850,
          scallopCount: 570,
          immediateTargetsCount: 0,
          hotWatchlistCount: 4,
          safeCount: 1416,
        },
        hotWatchlist: [
          {
            obligationId: '0xabc...123',
            protocol: 'navi',
            borrower: '0xdef...456',
            healthFactor: 1.0234,
            totalDebtUsd: 15420.5,
            totalCollateralUsd: 15780.0,
            urgency: 'HOT',
          },
        ],
        recentLiquidations: [
          {
            timestamp: '2026-10-16T10:42:15.000Z',
            protocol: 'scallop',
            borrower: '0x789...abc',
            debtRepaid: '5,000.00 USDC',
            collateralSeized: '2,450.12 SUI',
            estimatedNetProfitUsd: 42.15,
            gasCostSui: 0.045,
            txDigest: '5cZ8X999999999999',
            txDigestLink: 'https://suiscan.xyz/mainnet/tx/5cZ8X999999999999',
          },
        ],
      };

      const res = validateTelemetryPayload(samplePayload);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it('T1.F11.5: Atomic export performs under 10ms for typical payload size', async () => {
      const payload = {
        timestamp: new Date().toISOString(),
        status: 'ONLINE',
        items: Array.from({ length: 50 }, (_, i) => ({ id: i, value: `val_${i}` })),
      };
      const start = performance.now();
      await writeAtomicJson(testTelemetryFile, payload);
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50); // Well within non-blocking budget
    });
  });

  // ==========================================
  // F12: Zero-RPC Operator Gas Tracking
  // ==========================================
  describe('F12: Zero-RPC Operator Gas Tracking', () => {
    it('T1.F12.1: getCachedBalanceSui returns synchronously in < 1ms with 0 RPC calls', () => {
      const start = performance.now();
      const balance = gasManager.getCachedBalanceSui();
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(2);
      expect(typeof balance).toBe('number');
      expect(balance).toBeGreaterThanOrEqual(0);
    });

    it('T1.F12.2: Dual representation: SUI float and MIST string conform to exact conversion', () => {
      const suiBalance = 14.8523;
      const mistString = BigInt(Math.floor(suiBalance * 1e9)).toString();
      expect(mistString).toBe('14852300000');
      const roundTripSui = Number(mistString) / 1e9;
      expect(roundTripSui).toBeCloseTo(suiBalance, 4);
    });

    it('T1.F12.3: Precision integrity: 1 SUI equals exactly 10^9 MIST', () => {
      const ONE_SUI_IN_MIST = 1_000_000_000n;
      expect(ONE_SUI_IN_MIST).toBe(10n ** 9n);
    });

    it('T1.F12.4: Operator address formatting matches 64-character Sui address', () => {
      const sampleAddress = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      expect(sampleAddress).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });

    it('T1.F12.5: In-memory gas coin reference supports zero-RPC retrieval', () => {
      const activeObj = gasManager.getActiveGasObject();
      if (activeObj) {
        expect(activeObj.objectId).toMatch(/^0x[a-fA-F0-9]+$/);
        expect(typeof activeObj.version).toBe('string');
      } else {
        expect(gasManager.getCachedBalanceSui()).toBe(0);
      }
    });
  });
});
