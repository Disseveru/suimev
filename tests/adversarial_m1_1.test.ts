import { describe, it, expect, beforeAll } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import {
  COIN_CONFIGS,
  getCoinConfigBySymbol,
  getCoinConfigByType,
  getCoinConfigByPythId,
  getAllMonitoredCoinTypes,
  getAllPythFeedIds,
  normalizeStructTag,
} from '../src/config/coins.js';
import { CetusRouter, CANONICAL_CETUS_POOLS } from '../src/protocols/dex/cetusRouter.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { ObligationState, LiquidationOpportunity } from '../src/config/types.js';

describe('Adversarial Stress Test Suite — Challenger M1-1', () => {
  const SUI_TYPE = COIN_CONFIGS.SUI.coinType;
  const USDC_TYPE = COIN_CONFIGS.USDC.coinType;
  const AUSD_TYPE = COIN_CONFIGS.AUSD.coinType;
  const LBTC_TYPE = COIN_CONFIGS.LBTC.coinType;
  const NS_TYPE = COIN_CONFIGS.NS.coinType;
  const AFSUI_TYPE = COIN_CONFIGS.AFSUI.coinType;
  const SCA_TYPE = COIN_CONFIGS.SCA.coinType;

  // Maximum Move u64 value: 18,446,744,073,709,551,615
  const U64_MAX = 18_446_744_073_709_551_615n;

  beforeAll(async () => {
    // Populate realistic mock price cache entries for all target tokens
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: SUI_TYPE,
      price: 2.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 200_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'USDC',
      coinType: USDC_TYPE,
      price: 1.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 100_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'AUSD',
      coinType: AUSD_TYPE,
      price: 1.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 100_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'LBTC',
      coinType: LBTC_TYPE,
      price: 85000.0,
      confidence: 0,
      exponent: -8,
      rawPrice: 85000_00000000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'NS',
      coinType: NS_TYPE,
      price: 0.35,
      confidence: 0,
      exponent: -8,
      rawPrice: 35_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'AFSUI',
      coinType: AFSUI_TYPE,
      price: 2.12,
      confidence: 0,
      exponent: -8,
      rawPrice: 212_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'SCA',
      coinType: SCA_TYPE,
      price: 0.45,
      confidence: 0,
      exponent: -8,
      rawPrice: 45_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    await naviProtocol.initialize();
  });

  describe('1. Boundary Condition Amounts (0, 1 MIST, 10^9 tokens, u64::MAX)', () => {
    const testPairs = [
      { name: 'USDC -> AUSD (6 dec -> 6 dec direct)', from: USDC_TYPE, to: AUSD_TYPE },
      { name: 'SUI -> LBTC (9 dec -> 8 dec direct)', from: SUI_TYPE, to: LBTC_TYPE },
      { name: 'SUI -> NS (9 dec -> 6 dec direct)', from: SUI_TYPE, to: NS_TYPE },
      { name: 'SUI -> afSUI (9 dec -> 9 dec direct)', from: SUI_TYPE, to: AFSUI_TYPE },
      { name: 'SUI -> SCA (9 dec -> 9 dec direct)', from: SUI_TYPE, to: SCA_TYPE },
      { name: 'LBTC -> SUI (8 dec -> 9 dec reverse)', from: LBTC_TYPE, to: SUI_TYPE },
      { name: 'NS -> SUI (6 dec -> 9 dec reverse)', from: NS_TYPE, to: SUI_TYPE },
      { name: 'AUSD -> USDC (6 dec -> 6 dec reverse)', from: AUSD_TYPE, to: USDC_TYPE },
      { name: 'USDC -> LBTC (6 dec -> 8 dec 2-hop)', from: USDC_TYPE, to: LBTC_TYPE },
    ];

    it('should handle zero input amount (0n) without throwing or producing NaN', () => {
      for (const pair of testPairs) {
        const quote = CetusRouter.getQuote(pair.from, pair.to, 0n);
        expect(quote).toBeDefined();
        expect(quote.amountIn).toBe(0n);
        expect(quote.expectedAmountOut).toBe(0n);
        expect(quote.minimumAmountOut).toBe(0n);
        expect(Number.isNaN(quote.priceImpactPct)).toBe(false);
        expect(Number.isFinite(quote.priceImpactPct)).toBe(true);
      }
    });

    it('should handle smallest discrete unit (1 raw MIST/subunit) safely', () => {
      for (const pair of testPairs) {
        const quote = CetusRouter.getQuote(pair.from, pair.to, 1n);
        expect(quote).toBeDefined();
        expect(quote.amountIn).toBe(1n);
        expect(typeof quote.expectedAmountOut).toBe('bigint');
        expect(typeof quote.minimumAmountOut).toBe('bigint');
        expect(quote.expectedAmountOut >= 0n).toBe(true);
        expect(quote.minimumAmountOut >= 0n).toBe(true);
        expect(quote.minimumAmountOut <= quote.expectedAmountOut).toBe(true);
        expect(Number.isNaN(Number(quote.expectedAmountOut))).toBe(false);
      }
    });

    it('should handle 10^9 tokens across 6, 8, and 9 decimal assets without integer overflow or NaN', () => {
      const largeAmounts: Record<string, bigint> = {
        [USDC_TYPE]: 1_000_000_000n * 1_000_000n, // 10^9 tokens with 6 decimals = 10^15
        [AUSD_TYPE]: 1_000_000_000n * 1_000_000n, // 10^9 tokens with 6 decimals = 10^15
        [NS_TYPE]: 1_000_000_000n * 1_000_000n,   // 10^9 tokens with 6 decimals = 10^15
        [LBTC_TYPE]: 1_000_000_000n * 100_000_000n, // 10^9 tokens with 8 decimals = 10^17
        [SUI_TYPE]: 1_000_000_000n * 1_000_000_000n, // 10^9 tokens with 9 decimals = 10^18
      };

      for (const pair of testPairs) {
        const amountIn = largeAmounts[pair.from] ?? (1_000_000_000n * 1_000_000_000n);
        const quote = CetusRouter.getQuote(pair.from, pair.to, amountIn);
        expect(quote).toBeDefined();
        expect(quote.amountIn).toBe(amountIn);
        expect(quote.expectedAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut <= quote.expectedAmountOut).toBe(true);
        expect(Number.isNaN(Number(quote.expectedAmountOut))).toBe(false);
      }
    });

    it('should handle maximum Sui Move u64 value (u64::MAX) safely without throwing or NaN', () => {
      for (const pair of testPairs) {
        const quote = CetusRouter.getQuote(pair.from, pair.to, U64_MAX);
        expect(quote).toBeDefined();
        expect(quote.amountIn).toBe(U64_MAX);
        expect(quote.expectedAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut <= quote.expectedAmountOut).toBe(true);
        expect(Number.isNaN(Number(quote.expectedAmountOut))).toBe(false);
      }
    });

    it('should preserve fractional precision across decimal conversions (6 <-> 8 <-> 9)', () => {
      // 100 SUI (9 dec) -> LBTC (8 dec, price $85,000 / $2.00 = 42,500 SUI per LBTC)
      // 100 SUI = $200. $200 / $85,000 = 0.00235294 LBTC = 235,294 satoshis (8 dec)
      const suiAmount = 100n * 1_000_000_000n;
      const quoteSuiToLbtc = CetusRouter.getQuote(SUI_TYPE, LBTC_TYPE, suiAmount);
      expect(quoteSuiToLbtc.expectedAmountOut).toBe(235294n);
      expect(quoteSuiToLbtc.minimumAmountOut).toBe(232941n); // with 1% slippage

      // 1 LBTC (8 dec, $85,000) -> SUI (9 dec, $2.00) => 42,500 SUI = 42,500 * 10^9 = 42_500_000_000_000 raw units
      const lbtcAmount = 1n * 100_000_000n;
      const quoteLbtcToSui = CetusRouter.getQuote(LBTC_TYPE, SUI_TYPE, lbtcAmount);
      expect(quoteLbtcToSui.expectedAmountOut).toBe(42500000000000n);

      // 100 USDC (6 dec, $100) -> AUSD (6 dec, $100) => 100 AUSD = 100_000_000 raw units
      const usdcAmount = 100n * 1_000_000n;
      const quoteUsdcToAusd = CetusRouter.getQuote(USDC_TYPE, AUSD_TYPE, usdcAmount);
      expect(quoteUsdcToAusd.expectedAmountOut).toBe(100000000n);

      // 100 SUI (9 dec, $200) -> NS (6 dec, $0.35) => 200 / 0.35 = ~571.428571 NS = 571428571 raw units
      const quoteSuiToNs = CetusRouter.getQuote(SUI_TYPE, NS_TYPE, suiAmount);
      expect(quoteSuiToNs.expectedAmountOut).toBe(571428571n);
    });
  });

  describe('2. Malformed & Non-Existent Coin Types', () => {
    const invalidNonSplittable = [
      '',
      '   ',
      '0x0',
      'not_a_valid_struct_tag',
      '0x2::sui', // missing struct name
      '<script>alert(1)</script>',
      'DROP TABLE coins; --',
      ';;::;;',
    ];

    it('getCoinConfigByType should return undefined for invalid, non-splittable inputs', () => {
      for (const input of invalidNonSplittable) {
        expect(() => getCoinConfigByType(input)).not.toThrow();
        const res = getCoinConfigByType(input);
        expect(res).toBeUndefined();
      }
    });

    it('getCoinConfigByType should handle null/undefined safely when forced via cast', () => {
      expect(() => getCoinConfigByType(null as unknown as string)).not.toThrow();
      expect(getCoinConfigByType(null as unknown as string)).toBeUndefined();
      expect(() => getCoinConfigByType(undefined as unknown as string)).not.toThrow();
      expect(getCoinConfigByType(undefined as unknown as string)).toBeUndefined();
    });

    it('getCoinConfigBySymbol should return undefined for non-existent symbols', () => {
      const invalidSymbols = ['', 'NON_EXISTENT', '12345', 'SUI_XYZ_123', 'UNKNOWN', '🚀', '$$$'];
      for (const sym of invalidSymbols) {
        expect(() => getCoinConfigBySymbol(sym)).not.toThrow();
        expect(getCoinConfigBySymbol(sym)).toBeUndefined();
      }
    });

    it('normalizeStructTag should handle malformed strings gracefully without unhandled exceptions', () => {
      for (const input of [...invalidNonSplittable, '0x123::foo::BAR']) {
        expect(() => normalizeStructTag(input)).not.toThrow();
        const norm = normalizeStructTag(input);
        expect(typeof norm).toBe('string');
      }
    });

    it('CetusRouter.hasPool should return false without throwing when passed non-existent coin types', () => {
      for (const input of invalidNonSplittable) {
        expect(() => CetusRouter.hasPool(input, SUI_TYPE)).not.toThrow();
        expect(CetusRouter.hasPool(input, SUI_TYPE)).toBe(false);
        expect(() => CetusRouter.hasPool(SUI_TYPE, input)).not.toThrow();
        expect(CetusRouter.hasPool(SUI_TYPE, input)).toBe(false);
        expect(() => CetusRouter.hasPool(input, input)).not.toThrow();
        expect(CetusRouter.hasPool(input, input)).toBe(false);
      }
    });

    it('CetusRouter.getQuote should throw a clean, descriptive Error (not TypeError or NaN) for unrouted pairs', () => {
      const fakeCoin = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef::fake::FAKE';
      expect(() => CetusRouter.getQuote(fakeCoin, SUI_TYPE, 1000n)).toThrowError(
        /No Cetus liquidity pool or route found/
      );
      expect(() => CetusRouter.getQuote(SUI_TYPE, fakeCoin, 1000n)).toThrowError(
        /No Cetus liquidity pool or route found/
      );
      expect(() => CetusRouter.getQuote(fakeCoin, fakeCoin, 1000n)).toThrowError(
        /No Cetus liquidity pool or route found/
      );
    });

    it('EMPIRICAL CHALLENGE: Detects structural suffix/substring collision vulnerability in getCoinConfigByType', () => {
      // In src/config/coins.ts, lines 427-429:
      // if (structName.includes('USDT')) return COIN_BY_SYMBOL_MAP.get('USDT');
      // if (structName.includes('USDC')) return COIN_BY_SYMBOL_MAP.get('USDC');
      // if (structName.includes('SUI')) return COIN_BY_SYMBOL_MAP.get('SUI');
      // This means a spoofed coin from an attacker address like:
      const fakeSuiType = '0xbad0000000000000000000000000000000000000000000000000000000000bad::fake::ATTACK_SUI';
      const fakeUsdcType = '0xbad0000000000000000000000000000000000000000000000000000000000bad::fake::SCAM_USDC';
      const fakeUsdtType = '0xbad0000000000000000000000000000000000000000000000000000000000bad::fake::MALICIOUS_USDT';

      const resolvedSui = getCoinConfigByType(fakeSuiType);
      const resolvedUsdc = getCoinConfigByType(fakeUsdcType);
      const resolvedUsdt = getCoinConfigByType(fakeUsdtType);

      // We document this behavioral observation:
      // Because coins.ts uses .includes('SUI'), it aggressively matches any 3-part type whose struct name contains 'SUI'
      expect(resolvedSui?.symbol).toBe('SUI');
      expect(resolvedUsdc?.symbol).toBe('USDC');
      expect(resolvedUsdt?.symbol).toBe('USDT');
    });
  });

  describe('3. Routing Verification Across New Coin Pairs', () => {
    const requiredPairs = [
      { name: 'USDC -> AUSD', from: USDC_TYPE, to: AUSD_TYPE, poolId: '0x0fea99ed9c65068638963a81587c3b8cafb71dc38c545319f008f7e9feb2b5f8' },
      { name: 'AUSD -> USDC', from: AUSD_TYPE, to: USDC_TYPE, poolId: '0x0fea99ed9c65068638963a81587c3b8cafb71dc38c545319f008f7e9feb2b5f8' },
      { name: 'SUI -> LBTC', from: SUI_TYPE, to: LBTC_TYPE, poolId: '0x2fc6ee9183d0f1ca0d2dded02c416be6f4671bb82db55c26ce12b536812a4b8e' },
      { name: 'LBTC -> SUI', from: LBTC_TYPE, to: SUI_TYPE, poolId: '0x2fc6ee9183d0f1ca0d2dded02c416be6f4671bb82db55c26ce12b536812a4b8e' },
      { name: 'SUI -> NS', from: SUI_TYPE, to: NS_TYPE, poolId: '0x763f63cbada3a932c46972c6c6dcf1abd8a9a73331908a1d7ef24c2232d85520' },
      { name: 'NS -> SUI', from: NS_TYPE, to: SUI_TYPE, poolId: '0x763f63cbada3a932c46972c6c6dcf1abd8a9a73331908a1d7ef24c2232d85520' },
      { name: 'SUI -> afSUI', from: SUI_TYPE, to: AFSUI_TYPE, poolId: '0xa528b26eae41bcfca488a9feaa3dca614b2a1d9b9b5c78c256918ced051d4c50' },
      { name: 'afSUI -> SUI', from: AFSUI_TYPE, to: SUI_TYPE, poolId: '0xa528b26eae41bcfca488a9feaa3dca614b2a1d9b9b5c78c256918ced051d4c50' },
      { name: 'SUI -> SCA', from: SUI_TYPE, to: SCA_TYPE, poolId: '0x9661cca01a5b9b3536883568fa967a2943e237de11a97976795f5adb293892e9' },
      { name: 'SCA -> SUI', from: SCA_TYPE, to: SUI_TYPE, poolId: '0x9661cca01a5b9b3536883568fa967a2943e237de11a97976795f5adb293892e9' },
    ];

    it('should verify hasPool returns true for all direct target pairs', () => {
      for (const pair of requiredPairs) {
        expect(CetusRouter.hasPool(pair.from, pair.to)).toBe(true);
      }
    });

    it('should compute valid SwapQuote for all required pairs with accurate poolId', () => {
      for (const pair of requiredPairs) {
        const quote = CetusRouter.getQuote(pair.from, pair.to, 10_000_000_000n, 100);
        expect(quote.poolId).toBe(pair.poolId);
        expect(quote.dex).toBe('cetus');
        expect(quote.expectedAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut <= quote.expectedAmountOut).toBe(true);
        expect(Number.isNaN(quote.priceImpactPct)).toBe(false);
      }
    });

    it('should support 2-hop routing via SUI or USDC for cross-pairs with new tokens', () => {
      const multiHopPairs = [
        { from: USDC_TYPE, to: LBTC_TYPE, expectedHop: '2-hop-via-sui' },
        { from: LBTC_TYPE, to: USDC_TYPE, expectedHop: '2-hop-via-sui' },
        { from: USDC_TYPE, to: NS_TYPE, expectedHop: '2-hop-via-sui' },
        { from: NS_TYPE, to: USDC_TYPE, expectedHop: '2-hop-via-sui' },
        { from: USDC_TYPE, to: AFSUI_TYPE, expectedHop: '2-hop-via-sui' },
        { from: AFSUI_TYPE, to: USDC_TYPE, expectedHop: '2-hop-via-sui' },
        { from: AUSD_TYPE, to: LBTC_TYPE, expectedHop: '2-hop-via-sui' },
        { from: AUSD_TYPE, to: NS_TYPE, expectedHop: '2-hop-via-sui' },
      ];

      for (const pair of multiHopPairs) {
        expect(CetusRouter.hasPool(pair.from, pair.to)).toBe(true);
        const quote = CetusRouter.getQuote(pair.from, pair.to, 1_000_000_000n, 100);
        expect(quote.poolId).toBe(pair.expectedHop);
        expect(quote.expectedAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut > 0n).toBe(true);
        expect(quote.minimumAmountOut <= quote.expectedAmountOut).toBe(true);
      }
    });

    it('should successfully append atomic swap Move calls to Transaction block for both direct and 2-hop', () => {
      for (const pair of requiredPairs) {
        const tx = new Transaction();
        const quote = CetusRouter.getQuote(pair.from, pair.to, 1_000_000_000n, 100);
        const [dummyCoin] = tx.splitCoins(tx.gas, [1_000_000_000n]);

        expect(() => {
          CetusRouter.addSwap(tx, quote, dummyCoin);
        }).not.toThrow();

        // Ensure commands were actually appended to tx
        expect(tx.getData().commands.length).toBeGreaterThan(1);
      }

      // Test 2-hop PTB Move calls
      const txHop = new Transaction();
      const quoteHop = CetusRouter.getQuote(USDC_TYPE, LBTC_TYPE, 100_000_000n, 100);
      const [dummyHopCoin] = txHop.splitCoins(txHop.gas, [100_000_000n]);
      expect(() => {
        CetusRouter.addSwap(txHop, quoteHop, dummyHopCoin);
      }).not.toThrow();
      expect(txHop.getData().commands.length).toBeGreaterThan(3);
    });
  });

  describe('4. Slippage Tolerance Boundary Invariants', () => {
    it('should handle 0 bps slippage (minimumAmountOut == expectedAmountOut)', () => {
      const quote = CetusRouter.getQuote(SUI_TYPE, LBTC_TYPE, 10_000_000_000n, 0);
      expect(quote.minimumAmountOut).toBe(quote.expectedAmountOut);
      expect(quote.slippageBps).toBe(0);
    });

    it('should handle 10,000 bps slippage (100% slippage -> minimumAmountOut == 0n)', () => {
      const quote = CetusRouter.getQuote(SUI_TYPE, LBTC_TYPE, 10_000_000_000n, 10000);
      expect(quote.minimumAmountOut).toBe(0n);
      expect(quote.expectedAmountOut > 0n).toBe(true);
    });

    it('EMPIRICAL CHALLENGE: Slippage > 10,000 bps produces negative minimumAmountOut due to unclamped subtraction', () => {
      // In src/protocols/dex/cetusRouter.ts:
      // const slippageFactor = 10000n - BigInt(slippageBps);
      // const minimumAmountOut = (expectedAmountOut * slippageFactor) / 10000n;
      // If slippageBps = 15000, slippageFactor = -5000n, producing a negative BigInt:
      const quote = CetusRouter.getQuote(SUI_TYPE, LBTC_TYPE, 10_000_000_000n, 15000);
      expect(quote.minimumAmountOut < 0n).toBe(true);
      // This is an important edge finding: slippageBps > 10,000 must be guarded if user-supplied.
    });
  });

  describe('5. Health Factor Calculation & Bad Debt Guard (Rule 6) for New Assets', () => {
    it('should evaluate obligation and identify liquidation opportunity when health factor < 1.0 for new assets', () => {
      // User with LBTC collateral ($85,000) and USDC debt ($75,000)
      // Liquidation threshold for LBTC is 0.80 -> LT Collateral = $68,000 < $75,000 Debt -> HF = 68000 / 75000 = 0.9067
      const rawObligation: ObligationState = {
        protocol: 'navi',
        obligationId: '0x1111111111111111111111111111111111111111111111111111111111111111',
        ownerAddress: '0x2222222222222222222222222222222222222222222222222222222222222222',
        collaterals: [
          {
            coinType: LBTC_TYPE,
            symbol: 'LBTC',
            amount: 100_000_000n, // 1.0 LBTC (8 decimals) = $85,000
            decimals: 8,
            valueUsd: 85000.0,
            liquidationThreshold: 0.80,
          },
        ],
        debts: [
          {
            coinType: USDC_TYPE,
            symbol: 'USDC',
            amount: 75000_000_000n, // 75,000 USDC (6 decimals) = $75,000
            decimals: 6,
            valueUsd: 75000.0,
          },
        ],
        totalCollateralUsd: 0,
        totalDebtUsd: 0,
        liquidationThresholdCollateralUsd: 0,
        healthFactor: 0,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      const obligation = HealthFactorEngine.evaluateObligation(rawObligation);
      expect(obligation.isLiquidatable).toBe(true);
      expect(obligation.healthFactor).toBeCloseTo(68000.0 / 75000.0, 4);

      const opp = HealthFactorEngine.findBestLiquidationOpportunity(obligation);
      expect(opp).not.toBeNull();
      expect(opp?.debtCoinType).toBe(USDC_TYPE);
      expect(opp?.collateralCoinType).toBe(LBTC_TYPE);
      expect(opp?.debtAmountToRepay! > 0n).toBe(true);
      expect(opp?.collateralToReceive! > 0n).toBe(true);
      expect(opp?.expectedGrossProfitUsd! > 0).toBe(true);
      expect(Number.isNaN(opp?.expectedGrossProfitUsd)).toBe(false);
    });

    it('should reject bad debt positions ($0 collateral) per Rule 6 Zero-Capital Solvency Guard', () => {
      const badDebtObligation: ObligationState = {
        protocol: 'navi',
        obligationId: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        ownerAddress: '0x0000000000000000000000000000000000000000000000000000000000000000',
        collaterals: [],
        debts: [
          {
            coinType: AUSD_TYPE,
            symbol: 'AUSD',
            amount: 50_000_000_000n, // 50,000 AUSD
            decimals: 6,
            valueUsd: 50000.0,
          },
        ],
        totalCollateralUsd: 0,
        totalDebtUsd: 50000.0,
        liquidationThresholdCollateralUsd: 0,
        healthFactor: 0,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      const evaluated = HealthFactorEngine.evaluateObligation(badDebtObligation);
      expect(evaluated.isLiquidatable).toBe(false);

      const opp = HealthFactorEngine.findBestLiquidationOpportunity(evaluated);
      expect(opp).toBeNull();
    });

    it('should build zero-capital liquidation PTB for new assets without throwing or precision error', () => {
      const rawObligation: ObligationState = {
        protocol: 'navi',
        obligationId: '0x3333333333333333333333333333333333333333333333333333333333333333',
        ownerAddress: '0x4444444444444444444444444444444444444444444444444444444444444444',
        collaterals: [
          {
            coinType: SUI_TYPE,
            symbol: 'SUI',
            amount: 50_000_000_000_000n, // 50,000 SUI @ $2.00 = $100,000
            decimals: 9,
            valueUsd: 100000.0,
            liquidationThreshold: 0.80,
          },
        ],
        debts: [
          {
            coinType: AUSD_TYPE,
            symbol: 'AUSD',
            amount: 85_000_000_000n, // 85,000 AUSD @ $1.00 = $85,000
            decimals: 6,
            valueUsd: 85000.0,
          },
        ],
        totalCollateralUsd: 0,
        totalDebtUsd: 0,
        liquidationThresholdCollateralUsd: 0,
        healthFactor: 0,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      const obligation = HealthFactorEngine.evaluateObligation(rawObligation);
      expect(obligation.isLiquidatable).toBe(true);

      const opp = HealthFactorEngine.findBestLiquidationOpportunity(obligation);
      expect(opp).not.toBeNull();

      const ptbResult = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp!);
      expect(ptbResult).toBeDefined();
      expect(ptbResult.tx).toBeInstanceOf(Transaction);
      expect(ptbResult.tx.getData().commands.length).toBeGreaterThan(0);
      expect(ptbResult.expectedProfitDebtUnits > 0n).toBe(true);
      expect(Number.isNaN(Number(ptbResult.expectedProfitDebtUnits))).toBe(false);
    });
  });
});
