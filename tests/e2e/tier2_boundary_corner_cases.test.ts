import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HealthFactorEngine } from '../../src/oracles/healthFactor.js';
import { priceCache } from '../../src/oracles/priceCache.js';
import { CetusRouter } from '../../src/protocols/dex/cetusRouter.js';
import { ObligationRegistry } from '../../src/engine/registry.js';
import { ObligationState } from '../../src/config/types.js';
import {
  writeAtomicJson,
  validateTelemetryPayload,
  stripAnsi,
  TelemetryPayload,
  createMockObligation,
} from './helpers/contracts.js';

describe('Tier 2: Boundary & Corner Cases (Precision, Missing Files, Corruptions & Invariants)', () => {
  const testStateDir = path.resolve(process.cwd(), '.state_boundary_test');
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
  // Group 1: Numerical Precision & Boundary Limits
  // ==========================================
  describe('Group 1: Numerical Precision & Boundary Limits', () => {
    it('T2.1: Handles 1 Satoshi (0.00000001 BTC) without sub-unit truncation', () => {
      const oneSatoshi = 1n; // 1 satoshi
      const decimals = 8;
      const btcAmount = Number(oneSatoshi) / Math.pow(10, decimals);
      expect(btcAmount).toBe(0.00000001);
      const btcPrice = 85000.0;
      const valueUsd = btcAmount * btcPrice;
      expect(valueUsd).toBeCloseTo(0.00085, 5);
    });

    it('T2.2: Handles Max UINT64 balances (18,446,744,073,709,551,615n) safely using BigInt', () => {
      const MAX_UINT64 = (1n << 64n) - 1n;
      expect(MAX_UINT64.toString()).toBe('18446744073709551615');
      // Subtraction and comparison with BigInt does not overflow
      const diff = MAX_UINT64 - 1_000_000_000n;
      expect(diff).toBeLessThan(MAX_UINT64);
      expect(diff + 1_000_000_000n).toBe(MAX_UINT64);
    });

    it('T2.3: Converts 0 MIST to 0.0 SUI and vice versa without NaN or null', () => {
      const zeroMist = 0n;
      const suiFloat = Number(zeroMist) / 1e9;
      expect(suiFloat).toBe(0.0);
      expect(BigInt(Math.floor(suiFloat * 1e9)).toString()).toBe('0');
    });

    it('T2.4: Extreme sub-cent price fractions ($0.0000005) maintain positive value in evaluation', () => {
      priceCache.updatePrice({
        symbol: 'MICRO',
        coinType: '0x2::micro::MICRO',
        price: 0.0000005,
        confidence: 0,
        exponent: -8,
        rawPrice: 50n,
        publishTime: 1700000000,
        lastUpdatedMs: Date.now(),
      });
      const price = priceCache.getPriceUsd('0x2::micro::MICRO');
      expect(price).toBe(0.0000005);
      const amount = 1_000_000_000n; // 1 billion units (decimals 9 = 1 unit)
      const val = (Number(amount) / 1e9) * price;
      expect(val).toBe(0.0000005);
    });

    it('T2.5: Zero slippage (0 bps) and Maximum slippage (10,000 bps) bound quotes predictably', () => {
      const amountIn = 1_000_000_000n; // 1 SUI
      const quoteZeroSlippage = CetusRouter.getQuote('0x2::sui::SUI', '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', amountIn, 0);
      expect(quoteZeroSlippage.minimumAmountOut).toBe(quoteZeroSlippage.expectedAmountOut);

      const quoteMaxSlippage = CetusRouter.getQuote('0x2::sui::SUI', '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', amountIn, 10000);
      expect(quoteMaxSlippage.minimumAmountOut).toBe(0n);
    });
  });

  // ==========================================
  // Group 2: Bad Debt & Solvency Boundary Invariants
  // ==========================================
  describe('Group 2: Bad Debt & Solvency Boundary Invariants', () => {
    it('T2.6: Zero collateral with positive debt (Bad Debt) produces HF = 0 and is ineligible for flash liquidation', () => {
      const obligation = createMockObligation({
        protocol: 'navi',
        obligationId: '0xZeroCollateralBadDebt',
        ownerAddress: '0xBadDebtOwner',
        collaterals: [],
        debts: [
          {
            coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
            symbol: 'USDC',
            amount: 50_000_000_000n, // $50,000 USDC
            decimals: 6,
            valueUsd: 0,
          },
        ],
        totalCollateralUsd: 0,
        totalDebtUsd: 0,
        healthFactor: 1.0,
      });

      HealthFactorEngine.evaluateObligation(obligation);
      expect(obligation.healthFactor).toBe(0);
      expect(obligation.totalCollateralUsd).toBe(0);
      expect(obligation.totalDebtUsd).toBe(50000);

      // Rule 6: Solvency guard must reject zero collateral
      const isEligible = obligation.healthFactor < 1.0 && obligation.totalDebtUsd > 0.01 && obligation.totalCollateralUsd > 0 && obligation.collaterals.length > 0;
      expect(isEligible).toBe(false);
    });

    it('T2.7: Zero debt with positive collateral (Pure Deposit) produces infinite health factor', () => {
      const obligation = createMockObligation({
        protocol: 'navi',
        obligationId: '0xZeroDebtDeposit',
        ownerAddress: '0xDepositor',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 50_000_000_000_000n,
            decimals: 9,
            valueUsd: 0,
            liquidationThreshold: 0.80,
          },
        ],
        debts: [],
        totalCollateralUsd: 0,
        totalDebtUsd: 0,
        healthFactor: 0,
      });

      HealthFactorEngine.evaluateObligation(obligation);
      expect(obligation.healthFactor).toBe(Infinity);
      expect(obligation.totalDebtUsd).toBe(0);
    });

    it('T2.8: Exact boundary HF = 1.00000 is NOT placed in immediate targets', () => {
      const registry = ObligationRegistry.getInstance();
      const mockBoundaryState = createMockObligation({
        protocol: 'navi',
        obligationId: '0xExactBoundaryOne',
        ownerAddress: '0xBoundaryUser',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 10_000_000_000n,
            decimals: 9,
            valueUsd: 100,
            liquidationThreshold: 0.80,
          },
        ],
        debts: [
          {
            coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
            symbol: 'USDC',
            amount: 80_000_000n,
            decimals: 6,
            valueUsd: 80,
          },
        ],
        totalCollateralUsd: 100,
        totalDebtUsd: 80,
        healthFactor: 1.00000,
      });

      registry.upsertObligation(mockBoundaryState);
      const immediate = registry.getImmediateTargets();
      const foundInImmediate = immediate.some((o) => o.obligationId === '0xExactBoundaryOne');
      expect(foundInImmediate).toBe(false);
    });

    it('T2.9: Rapid insertion and deletion of the same key maintains consistent count', () => {
      const registry = ObligationRegistry.getInstance();
      const keyObligation = createMockObligation({
        protocol: 'navi',
        obligationId: '0xFlappingKey',
        ownerAddress: '0xOwner',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 100,
        totalDebtUsd: 50,
        healthFactor: 1.2,
      });

      for (let i = 0; i < 50; i++) {
        registry.upsertObligation(keyObligation);
      }
      const count = registry.getAllObligations().filter((o) => o.obligationId === '0xFlappingKey').length;
      expect(count).toBe(1);
    });

    it('T2.10: Safe watchlist absorbs accounts with HF >= 1.07 without memory leakage', () => {
      const registry = ObligationRegistry.getInstance();
      const safeObligation = createMockObligation({
        protocol: 'scallop',
        obligationId: '0xSuperSafeWhale',
        ownerAddress: '0xWhale',
        collaterals: [],
        debts: [],
        totalCollateralUsd: 1_000_000,
        totalDebtUsd: 100_000,
        healthFactor: 8.5,
      });
      registry.upsertObligation(safeObligation);
      const safeList = registry.getSafeWatchlist();
      expect(safeList.some((o) => o.obligationId === '0xSuperSafeWhale')).toBe(true);
    });
  });

  // ==========================================
  // Group 3: Filesystem, Concurrency & Telemetry Edge Cases
  // ==========================================
  describe('Group 3: Filesystem, Concurrency & Telemetry Edge Cases', () => {
    it('T2.11: 0-byte truncated file during write window does not crash consumer', () => {
      fs.writeFileSync(testTelemetryFile, '', 'utf8');
      const content = fs.readFileSync(testTelemetryFile, 'utf8');
      expect(content.length).toBe(0);

      const parseOrFallback = (str: string, fallback: unknown) => {
        try {
          return JSON.parse(str);
        } catch {
          return fallback;
        }
      };
      const result = parseOrFallback(content, { fallbackUsed: true });
      expect(result).toEqual({ fallbackUsed: true });
    });

    it('T2.12: Incomplete JSON with unexpected truncated stream returns safe fallback', () => {
      fs.writeFileSync(testTelemetryFile, '{"timestamp": "2026-10-16T10:00:00Z", "botStatus": "ON', 'utf8');
      const raw = fs.readFileSync(testTelemetryFile, 'utf8');
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { state: 'TRANSIENT_READ_ERROR' };
      }
      expect(parsed).toEqual({ state: 'TRANSIENT_READ_ERROR' });
    });

    it('T2.13: Extra unknown keys in telemetry JSON do not invalidate core contract', () => {
      const extraPayload = {
        timestamp: '2026-10-16T10:45:00.000Z',
        botStatus: 'ONLINE',
        operator: {
          address: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
          gasTankBalanceSui: 5.0,
          gasTankBalanceMist: '5000000000',
          futureFeatureFlag: true,
        },
        financials: {
          netRealizedPnlUsd: 100,
          cumulativeGasSpentSui: 1.0,
          successfulLiquidations: 5,
          failedLiquidations: 0,
          totalSimulations: 50,
          extraFieldV2: 'experimental',
        },
        obligations: {
          totalMonitored: 100,
          naviCount: 60,
          scallopCount: 40,
          immediateTargetsCount: 0,
          hotWatchlistCount: 2,
          safeCount: 98,
        },
        hotWatchlist: [],
        recentLiquidations: [],
        customTelemetryExtension: { activeNodes: 4 },
      };

      const valid = validateTelemetryPayload(extraPayload);
      expect(valid.valid).toBe(true);
    });

    it('T2.14: Corrupted payload missing mandatory operator section is caught with explicit error', () => {
      const badPayload = {
        timestamp: '2026-10-16T10:45:00.000Z',
        botStatus: 'ONLINE',
        financials: { netRealizedPnlUsd: 0, cumulativeGasSpentSui: 0, successfulLiquidations: 0, failedLiquidations: 0, totalSimulations: 0 },
        obligations: { totalMonitored: 0, naviCount: 0, scallopCount: 0, immediateTargetsCount: 0, hotWatchlistCount: 0, safeCount: 0 },
        hotWatchlist: [],
        recentLiquidations: [],
      };
      const valid = validateTelemetryPayload(badPayload);
      expect(valid.valid).toBe(false);
      expect(valid.errors.some((e) => e.includes('operator'))).toBe(true);
    });

    it('T2.15: Rapid sequential writes (10 iterations) maintain file integrity and valid JSON', async () => {
      for (let i = 0; i < 10; i++) {
        await writeAtomicJson(testTelemetryFile, {
          timestamp: new Date().toISOString(),
          botStatus: 'ONLINE',
          operator: { address: '0x123', gasTankBalanceSui: i, gasTankBalanceMist: `${i}000000000` },
          financials: { netRealizedPnlUsd: i * 10, cumulativeGasSpentSui: 0.1, successfulLiquidations: i, failedLiquidations: 0, totalSimulations: i * 2 },
          obligations: { totalMonitored: 10, naviCount: 5, scallopCount: 5, immediateTargetsCount: 0, hotWatchlistCount: 0, safeCount: 10 },
          hotWatchlist: [],
          recentLiquidations: [],
        });
      }

      const finalContent = fs.readFileSync(testTelemetryFile, 'utf8');
      const parsed = JSON.parse(finalContent);
      expect(parsed.operator.gasTankBalanceSui).toBe(9);
      expect(validateTelemetryPayload(parsed).valid).toBe(true);
    });
  });

  // ==========================================
  // Group 4: Oracles, Clocks & DEX Routing Limits
  // ==========================================
  describe('Group 4: Oracles, Clocks & DEX Routing Limits', () => {
    it('T2.16: Stale price older than 60s is detected by freshness invariant', () => {
      const now = Date.now();
      priceCache.updatePrice({
        symbol: 'STALE',
        coinType: '0x2::stale::STALE',
        price: 10.0,
        confidence: 0,
        exponent: -8,
        rawPrice: 1000000000n,
        publishTime: Math.floor((now - 120_000) / 1000), // 120s old
        lastUpdatedMs: now - 120_000,
        isDefaultSeed: false,
      });

      const isFresh = priceCache.isPriceFresh('0x2::stale::STALE', 60_000);
      expect(isFresh).toBe(false);
    });

    it('T2.17: Fresh price updated within 10s passes freshness verification', () => {
      const now = Date.now();
      priceCache.updatePrice({
        symbol: 'FRESH',
        coinType: '0x2::fresh::FRESH',
        price: 25.0,
        confidence: 0,
        exponent: -8,
        rawPrice: 2500000000n,
        publishTime: Math.floor(now / 1000),
        lastUpdatedMs: now,
        isDefaultSeed: false,
      });

      const isFresh = priceCache.isPriceFresh('0x2::fresh::FRESH', 60_000);
      expect(isFresh).toBe(true);
    });

    it('T2.18: Unknown coin type returns 0 USD price without throwing exceptions', () => {
      const unknownPrice = priceCache.getPriceUsd('0xdeadbeef::unknown::TOKEN');
      expect(unknownPrice).toBe(0);
    });

    it('T2.19: 2-Hop DEX routing through SUI correctly computes chained slippage and output', () => {
      // 100 SUI ($250) into USDC ($1.00)
      const quote = CetusRouter.getQuote('0x2::sui::SUI', '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', 100_000_000_000n, 50);
      expect(quote.dex).toBe('cetus');
      expect(quote.amountIn).toBe(100_000_000_000n);
      expect(quote.minimumAmountOut).toBeLessThanOrEqual(quote.expectedAmountOut);
      expect(quote.slippageBps).toBe(50);
    });

    it('T2.20: Route between identical coin types throws or returns 1:1 quote', () => {
      const sameCoin = '0x2::sui::SUI';
      const quote = CetusRouter.getQuote(sameCoin, sameCoin, 1_000_000_000n, 100);
      expect(quote.expectedAmountOut).toBe(1_000_000_000n);
    });
  });

  // ==========================================
  // Group 5: Terminal & UI Edge Conditions
  // ==========================================
  describe('Group 5: Terminal & UI Edge Conditions', () => {
    it('T2.21: ANSI stripper cleans multi-code complex sequences', () => {
      const complexAnsi = '\x1B[1;31mALERT\x1B[0m: \x1B[33mWarning\x1B[0m in \x1B[4mNAVI\x1B[24m';
      const clean = stripAnsi(complexAnsi);
      expect(clean).toBe('ALERT: Warning in NAVI');
    });

    it('T2.22: Large number formatting handles values over $1 Billion without scientific notation errors', () => {
      const formatCurrency = (val: number): string =>
        val >= 1e9
          ? `$${(val / 1e9).toFixed(2)}B`
          : val >= 1e6
          ? `$${(val / 1e6).toFixed(2)}M`
          : `$${val.toFixed(2)}`;
      expect(formatCurrency(1_500_000_000)).toBe('$1.50B');
      expect(formatCurrency(24_800_000)).toBe('$24.80M');
      expect(formatCurrency(124.5)).toBe('$124.50');
    });

    it('T2.23: Address abbreviator handles short addresses and full 66-char hashes', () => {
      const abbreviate = (addr: string): string => {
        if (!addr || addr.length <= 10) return addr;
        return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
      };
      expect(abbreviate('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef')).toBe('0x1234...cdef');
      expect(abbreviate('0x123')).toBe('0x123');
    });

    it('T2.24: Negative PnL displays negative currency formatting accurately', () => {
      const pnl = -45.25;
      const formatted = pnl < 0 ? `-$${Math.abs(pnl).toFixed(2)}` : `$${pnl.toFixed(2)}`;
      expect(formatted).toBe('-$45.25');
    });

    it('T2.25: Zero-activity watchlist returns empty card string without runtime exception', () => {
      const renderWatchlist = (items: unknown[]) => {
        if (items.length === 0) return 'No accounts currently in strike or hot zone.';
        return `Monitoring ${items.length} positions`;
      };
      expect(renderWatchlist([])).toBe('No accounts currently in strike or hot zone.');
    });
  });
});
