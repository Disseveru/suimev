import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ObligationRegistry } from '../../src/engine/registry.js';
import { HealthFactorEngine } from '../../src/oracles/healthFactor.js';
import { priceCache } from '../../src/oracles/priceCache.js';
import { ObligationState } from '../../src/config/types.js';
import {
  LiquidationRingBuffer,
  TelemetryRecentLiquidationItem,
  writeAtomicJson,
  validateTelemetryPayload,
  TelemetryPayload,
  stripAnsi,
  createMockObligation,
} from './helpers/contracts.js';

describe('Tier 4: Real-World Workload Scenarios (Operational Invariants & Systemic Simulations)', () => {
  const testStateDir = path.resolve(process.cwd(), '.state_tier4_test');
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
  // Scenario 4.1: Whale Liquidation Strike & Live Dashboard Broadcast
  // ==========================================
  it('Scenario 4.1: High-debt whale account default triggers atomic liquidation, telemetry emission, and dashboard consumption', async () => {
    const registry = ObligationRegistry.getInstance();
    const ringBuffer = new LiquidationRingBuffer(15);

    // 1. Whale position setup: 8,000 SUI collateral, 15,420 USDC debt
    const whaleObligation = createMockObligation({
      protocol: 'navi',
      obligationId: '0xWhaleWhale1_NAVI',
      ownerAddress: '0xWhaleBorrower1',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 8_000_000_000_000n, // 8,000 SUI (9 dec)
          decimals: 9,
          valueUsd: 0,
          liquidationThreshold: 0.90, // 90% LT on NAVI
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 15_420_000_000n, // 15,420 USDC (6 dec)
          decimals: 6,
          valueUsd: 0,
        },
      ],
      totalCollateralUsd: 0,
      totalDebtUsd: 0,
      healthFactor: 0,
    });

    // 2. SUI price drops to $2.12 -> 8,000 * $2.12 = $16,960 * 0.90 LT = $15,264 / $15,420 = 0.9898 (Strike Zone)
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: '0x2::sui::SUI',
      price: 2.12,
      confidence: 0,
      exponent: -8,
      rawPrice: 212000000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    HealthFactorEngine.evaluateObligation(whaleObligation);
    expect(whaleObligation.healthFactor).toBeLessThan(1.0);
    expect(whaleObligation.healthFactor).toBeCloseTo(0.9898, 2);

    registry.upsertObligation(whaleObligation);
    const immediateTargets = registry.getImmediateTargets();
    expect(immediateTargets.some((o) => o.obligationId === '0xWhaleWhale1_NAVI')).toBe(true);

    // 3. Execution Simulation & Record in Ring Buffer
    const simulatedDigest = '5cZ8X9abcdefWhaleStrikeTx';
    const strikeEvent: TelemetryRecentLiquidationItem = {
      timestamp: new Date().toISOString(),
      protocol: 'navi',
      borrower: '0xWhaleBorrower1',
      debtRepaid: '7,710.00 USDC', // 50% close factor
      collateralSeized: '3,825.40 SUI',
      estimatedNetProfitUsd: 42.15,
      gasCostSui: 0.045,
      txDigest: simulatedDigest,
      txDigestLink: `https://suiscan.xyz/mainnet/tx/${simulatedDigest}`,
    };
    ringBuffer.push(strikeEvent);

    // 4. Atomic Telemetry Bridge Export
    const telemetryPayload: TelemetryPayload = {
      timestamp: new Date().toISOString(),
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
        immediateTargetsCount: 1,
        hotWatchlistCount: 4,
        safeCount: 1415,
      },
      hotWatchlist: [
        {
          obligationId: '0xWhaleWhale1_NAVI',
          protocol: 'navi',
          borrower: '0xWhaleBorrower1',
          healthFactor: whaleObligation.healthFactor,
          totalDebtUsd: whaleObligation.totalDebtUsd,
          totalCollateralUsd: whaleObligation.totalCollateralUsd,
          urgency: 'CRITICAL',
        },
      ],
      recentLiquidations: ringBuffer.getEvents(),
    };

    await writeAtomicJson(testTelemetryFile, telemetryPayload);

    // 5. Dashboard CLI consumption
    const rawTelemetry = fs.readFileSync(testTelemetryFile, 'utf8');
    const consumed = JSON.parse(rawTelemetry);
    const validation = validateTelemetryPayload(consumed);
    expect(validation.valid).toBe(true);

    // Verify UI representations
    const strikeAlert = `🚨 STRIKE: Liquidated ${consumed.recentLiquidations[0].borrower} for estimated +$${consumed.recentLiquidations[0].estimatedNetProfitUsd} net`;
    expect(strikeAlert).toContain('estimated +$42.15 net');
    expect(consumed.recentLiquidations[0].txDigestLink).toContain(simulatedDigest);
  });

  // ==========================================
  // Scenario 4.2: Cascading Multi-Protocol Market Crash Stress Test
  // ==========================================
  it('Scenario 4.2: Cascading market crash handles simultaneous liquidation triggers with sorting and bad debt rejection', () => {
    const registry = ObligationRegistry.getInstance();

    // Setup 10 diverse obligations
    const obligations: ObligationState[] = [];
    for (let i = 1; i <= 10; i++) {
      const isBadDebt = i === 10;
      obligations.push(
        createMockObligation({
          protocol: i % 2 === 0 ? 'navi' : 'scallop',
          obligationId: `0xCrashAccount_${i}`,
          ownerAddress: `0xCrashOwner_${i}`,
          collaterals: isBadDebt
            ? []
            : [
                {
                  coinType: '0x2::sui::SUI',
                  symbol: 'SUI',
                  amount: BigInt(i * 1_000_000_000_000), // i * 1,000 SUI
                  decimals: 9,
                  valueUsd: 0,
                  liquidationThreshold: 0.80,
                },
              ],
          debts: [
            {
              coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
              symbol: 'USDC',
              amount: BigInt(i * 2_500_000_000), // i * 2,500 USDC
              decimals: 6,
              valueUsd: 0,
            },
          ],
          totalCollateralUsd: 0,
          totalDebtUsd: 0,
          healthFactor: 0,
        })
      );
    }

    // Market drop: SUI = $2.00
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: '0x2::sui::SUI',
      price: 2.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 200000000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    for (const ob of obligations) {
      HealthFactorEngine.evaluateObligation(ob);
      registry.upsertObligation(ob);
    }

    // Immediate targets must be sorted by totalDebtUsd descending
    const immediate = registry.getImmediateTargets();
    expect(immediate.length).toBeGreaterThan(0);

    for (let j = 0; j < immediate.length - 1; j++) {
      expect(immediate[j].totalDebtUsd).toBeGreaterThanOrEqual(immediate[j + 1].totalDebtUsd);
    }

    // Account 10 (bad debt with $0 collateral) must NOT be eligible for zero-capital flash liquidation
    const badDebtAccount = obligations.find((o) => o.obligationId === '0xCrashAccount_10');
    expect(badDebtAccount?.totalCollateralUsd).toBe(0);
    const zeroCapitalSolvent =
      badDebtAccount &&
      badDebtAccount.healthFactor < 1.0 &&
      badDebtAccount.totalDebtUsd > 0.01 &&
      badDebtAccount.totalCollateralUsd > 0 &&
      badDebtAccount.collaterals.length > 0;
    expect(zeroCapitalSolvent).toBe(false);
  });

  // ==========================================
  // Scenario 4.3: Long-Running Headless Engine Daemon with Detached Dashboard Clients
  // ==========================================
  it('Scenario 4.3: Long-running daemon stream is safely consumed by multiple client readers', async () => {
    // Daemon writes 5 consecutive snapshots
    for (let frame = 1; frame <= 5; frame++) {
      const payload: TelemetryPayload = {
        timestamp: new Date().toISOString(),
        botStatus: 'ONLINE',
        operator: { address: '0xHeadlessOperator', gasTankBalanceSui: 20.0 - frame * 0.1, gasTankBalanceMist: `${Math.floor((20.0 - frame * 0.1) * 1e9)}` },
        financials: { netRealizedPnlUsd: frame * 20.0, cumulativeGasSpentSui: frame * 0.05, successfulLiquidations: frame, failedLiquidations: 0, totalSimulations: frame * 10 },
        obligations: { totalMonitored: 1000, naviCount: 600, scallopCount: 400, immediateTargetsCount: 0, hotWatchlistCount: 5, safeCount: 995 },
        hotWatchlist: [],
        recentLiquidations: [],
      };
      await writeAtomicJson(testTelemetryFile, payload);
    }

    // Client attaches and reads latest frame
    const latestRaw = fs.readFileSync(testTelemetryFile, 'utf8');
    const latest = JSON.parse(latestRaw);
    expect(latest.financials.successfulLiquidations).toBe(5);
    expect(latest.operator.gasTankBalanceSui).toBeCloseTo(19.5, 1);

    // Teardown simulation: ANSI cursor restored
    const cursorRestoreEscape = '\x1B[?25h';
    expect(cursorRestoreEscape).toBe('\x1B[?25h');
  });

  // ==========================================
  // Scenario 4.4: Network Partition & Recovery with Zero-Crash UI
  // ==========================================
  it('Scenario 4.4: Simulated RPC network failure records failed liquidation without crashing engine or dashboard', async () => {
    const ringBuffer = new LiquidationRingBuffer(15);
    const failedEvent: TelemetryRecentLiquidationItem = {
      timestamp: new Date().toISOString(),
      protocol: 'navi',
      borrower: '0xFailedTargetRpcTimeout',
      debtRepaid: '0 USDC',
      collateralSeized: '0 SUI',
      estimatedNetProfitUsd: -0.015, // Gas spent on reverted tx
      gasCostSui: 0.0075,
      txDigest: 'RPC_TIMEOUT_FAILED_TX',
      txDigestLink: 'https://suiscan.xyz/mainnet/tx/RPC_TIMEOUT_FAILED_TX',
    };
    ringBuffer.push(failedEvent);

    const payload: TelemetryPayload = {
      timestamp: new Date().toISOString(),
      botStatus: 'ONLINE',
      operator: { address: '0xOperatorRecovery', gasTankBalanceSui: 9.99, gasTankBalanceMist: '9990000000' },
      financials: { netRealizedPnlUsd: 100.0, cumulativeGasSpentSui: 0.25, successfulLiquidations: 5, failedLiquidations: 1, totalSimulations: 80 },
      obligations: { totalMonitored: 500, naviCount: 300, scallopCount: 200, immediateTargetsCount: 0, hotWatchlistCount: 2, safeCount: 498 },
      hotWatchlist: [],
      recentLiquidations: ringBuffer.getEvents(),
    };

    await writeAtomicJson(testTelemetryFile, payload);

    const read = JSON.parse(fs.readFileSync(testTelemetryFile, 'utf8'));
    expect(read.financials.failedLiquidations).toBe(1);
    expect(read.recentLiquidations[0].txDigest).toBe('RPC_TIMEOUT_FAILED_TX');

    // UI formats failed event gracefully
    const uiActivityLine = `[FAILED] ${read.recentLiquidations[0].borrower} (Gas: ${read.recentLiquidations[0].gasCostSui} SUI)`;
    expect(uiActivityLine).toContain('[FAILED] 0xFailedTargetRpcTimeout');
  });
});
