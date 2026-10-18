import { describe, it, expect, vi } from 'vitest';
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
import { ON_CHAIN_PYTH_OBJECTS } from '../src/oracles/pythService.js';
import { priceCache } from '../src/oracles/priceCache.js';

describe('Coin Coverage Modernization & Expansion (Requirement R1)', () => {
  const TARGET_COINS = [
    'AUSD',
    'LBTC',
    'NS',
    'AFSUI',
    'HASUI',
    'NAVX',
    'SCA',
    'DEEP',
    'CETUS',
  ] as const;

  const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  describe('1. Coin Metadata & Symbol Alias Resolution', () => {
    it('should resolve all 9 target coins via getCoinConfigBySymbol case-insensitively', () => {
      for (const symbol of TARGET_COINS) {
        const configUpper = getCoinConfigBySymbol(symbol);
        const configLower = getCoinConfigBySymbol(symbol.toLowerCase());
        expect(configUpper).toBeDefined();
        expect(configLower).toBeDefined();
        expect(configUpper).toBe(configLower);
        expect(configUpper?.coinType).toBeTruthy();
        expect(configUpper?.decimals).toBeGreaterThan(0);
      }
    });

    it('should resolve NAVX symbol alias to NAVI/NAVX configuration', () => {
      const navxConfig = getCoinConfigBySymbol('NAVX');
      const naviConfig = getCoinConfigBySymbol('NAVI');
      expect(navxConfig).toBeDefined();
      expect(naviConfig).toBeDefined();
      expect(navxConfig?.coinType).toBe(naviConfig?.coinType);
      expect(navxConfig?.decimals).toBe(9);
      expect(navxConfig?.naviPoolId).toBe(7);
    });

    it('should resolve afSUI and haSUI casing aliases', () => {
      const afsuiUpper = getCoinConfigBySymbol('AFSUI');
      const afsuiMixed = getCoinConfigBySymbol('afSUI');
      expect(afsuiUpper).toBeDefined();
      expect(afsuiMixed).toBe(afsuiUpper);

      const hasuiUpper = getCoinConfigBySymbol('HASUI');
      const hasuiMixed = getCoinConfigBySymbol('haSUI');
      expect(hasuiUpper).toBeDefined();
      expect(hasuiMixed).toBe(hasuiUpper);
    });

    it('should resolve each target coin by exact and normalized struct tags via getCoinConfigByType', () => {
      for (const symbol of TARGET_COINS) {
        const cfg = getCoinConfigBySymbol(symbol)!;
        expect(cfg).toBeDefined();

        const byExactType = getCoinConfigByType(cfg.coinType);
        expect(byExactType).toBeDefined();
        expect(byExactType?.coinType).toBe(cfg.coinType);

        const byNormalizedType = getCoinConfigByType(normalizeStructTag(cfg.coinType));
        expect(byNormalizedType).toBeDefined();
        expect(byNormalizedType?.coinType).toBe(cfg.coinType);

        const byLowerType = getCoinConfigByType(cfg.coinType.toLowerCase());
        expect(byLowerType).toBeDefined();
      }
    });

    it('should assert verified on-chain decimals for all 9 coins', () => {
      expect(getCoinConfigBySymbol('AUSD')?.decimals).toBe(6);
      expect(getCoinConfigBySymbol('LBTC')?.decimals).toBe(8);
      expect(getCoinConfigBySymbol('NS')?.decimals).toBe(6);
      expect(getCoinConfigBySymbol('AFSUI')?.decimals).toBe(9);
      expect(getCoinConfigBySymbol('HASUI')?.decimals).toBe(9);
      expect(getCoinConfigBySymbol('NAVX')?.decimals).toBe(9);
      expect(getCoinConfigBySymbol('SCA')?.decimals).toBe(9);
      expect(getCoinConfigBySymbol('DEEP')?.decimals).toBe(6);
      expect(getCoinConfigBySymbol('CETUS')?.decimals).toBe(9);
    });

    it('should assert verified NAVI reserve pool IDs for supported coins', () => {
      expect(getCoinConfigBySymbol('AUSD')?.naviPoolId).toBe(9);
      expect(getCoinConfigBySymbol('LBTC')?.naviPoolId).toBe(23);
      expect(getCoinConfigBySymbol('NS')?.naviPoolId).toBe(13);
      expect(getCoinConfigBySymbol('HASUI')?.naviPoolId).toBe(6);
      expect(getCoinConfigBySymbol('NAVX')?.naviPoolId).toBe(7);
      expect(getCoinConfigBySymbol('DEEP')?.naviPoolId).toBe(15);
      expect(getCoinConfigBySymbol('CETUS')?.naviPoolId).toBe(4);
    });

    it('should assert verified canonical coinType strings', () => {
      expect(getCoinConfigBySymbol('AUSD')?.coinType).toBe(
        '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD'
      );
      expect(getCoinConfigBySymbol('LBTC')?.coinType).toBe(
        '0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC'
      );
      expect(getCoinConfigBySymbol('NS')?.coinType).toBe(
        '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS'
      );
      expect(getCoinConfigBySymbol('AFSUI')?.coinType).toBe(
        '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI'
      );
    });

    it('should return unique coin types and pyth feed IDs from registry aggregators', () => {
      const allTypes = getAllMonitoredCoinTypes();
      const allFeeds = getAllPythFeedIds();

      expect(new Set(allTypes).size).toBe(allTypes.length);
      expect(new Set(allFeeds).size).toBe(allFeeds.length);
      expect(allTypes).toContain(getCoinConfigBySymbol('AUSD')!.coinType);
      expect(allTypes).toContain(getCoinConfigBySymbol('LBTC')!.coinType);
      expect(allTypes).toContain(getCoinConfigBySymbol('NS')!.coinType);
      expect(allTypes).toContain(getCoinConfigBySymbol('AFSUI')!.coinType);
    });
  });

  describe('2. Pyth Oracles & On-Chain PriceInfo Objects', () => {
    it('should have verified Pyth feed IDs for AUSD, LBTC, NS, and afSUI', () => {
      expect(getCoinConfigBySymbol('AUSD')?.pythPriceFeedId).toBe(
        '0xd9912df360b5b7f21a122f15bdd5e27f62ce5e72bd316c291f7c86620e07fb2a'
      );
      expect(getCoinConfigBySymbol('LBTC')?.pythPriceFeedId).toBe(
        '0x8f257aab6e7698bb92b15511915e593d6f8eae914452f781874754b03d0c612b'
      );
      expect(getCoinConfigBySymbol('NS')?.pythPriceFeedId).toBe(
        '0xbb5ff26e47a3a6cc7ec2fce1db996c2a145300edc5acaabe43bf9ff7c5dd5d32'
      );
      expect(getCoinConfigBySymbol('AFSUI')?.pythPriceFeedId).toBe(
        '0x974a4829f908c76ceb05bfee180f95f445122d465a64a6b302c1a9251b7e19fc'
      );
    });

    it('should have verified ON_CHAIN_PYTH_OBJECTS entries for AUSD, LBTC, NS, and NAVI/NAVX', () => {
      expect(ON_CHAIN_PYTH_OBJECTS.AUSD).toEqual({
        objectId: '0xfaec36b7b45f96ed1b949ed45758dfa73d071f48509e550eec41ad3cfa00d1bd',
        symbols: ['AUSD'],
      });
      expect(ON_CHAIN_PYTH_OBJECTS.LBTC).toEqual({
        objectId: '0x9eaebfc21b14ea517575097e7787fe73ab92113525d7ad9acce983a2ae2570dc',
        symbols: ['LBTC'],
      });
      expect(ON_CHAIN_PYTH_OBJECTS.NS).toEqual({
        objectId: '0xea0d962a2b2cb35bbc262514ea6cfed02fdb3d5bedb193ca0d50bfefc98abebc',
        symbols: ['NS'],
      });
      expect(ON_CHAIN_PYTH_OBJECTS.NAVI.symbols).toContain('NAVX');
    });

    it('should resolve coin configs by Pyth feed ID and by on-chain object ID', () => {
      // Feed IDs
      expect(getCoinConfigByPythId('0xd9912df360b5b7f21a122f15bdd5e27f62ce5e72bd316c291f7c86620e07fb2a')?.symbol).toBe('AUSD');
      expect(getCoinConfigByPythId('0x8f257aab6e7698bb92b15511915e593d6f8eae914452f781874754b03d0c612b')?.symbol).toBe('LBTC');
      expect(getCoinConfigByPythId('0xbb5ff26e47a3a6cc7ec2fce1db996c2a145300edc5acaabe43bf9ff7c5dd5d32')?.symbol).toBe('NS');

      // Object IDs
      expect(getCoinConfigByPythId('0xfaec36b7b45f96ed1b949ed45758dfa73d071f48509e550eec41ad3cfa00d1bd')?.symbol).toBe('AUSD');
      expect(getCoinConfigByPythId('0x9eaebfc21b14ea517575097e7787fe73ab92113525d7ad9acce983a2ae2570dc')?.symbol).toBe('LBTC');
      expect(getCoinConfigByPythId('0xea0d962a2b2cb35bbc262514ea6cfed02fdb3d5bedb193ca0d50bfefc98abebc')?.symbol).toBe('NS');
    });

    it('should seed LBTC baseline price and resolve all 9 tokens in priceCache', () => {
      const lbtcPrice = priceCache.getPriceBySymbol('LBTC');
      expect(lbtcPrice).toBeDefined();
      expect(lbtcPrice!.price).toBeGreaterThan(50000);

      for (const symbol of TARGET_COINS) {
        const cfg = getCoinConfigBySymbol(symbol)!;
        const usdPrice = priceCache.getPriceUsd(cfg.coinType);
        expect(usdPrice).toBeGreaterThan(0);
      }
    });

    it('should dynamically update afSUI price when SUI price changes via redemption rate', () => {
      const publishTime = Math.floor(Date.now() / 1000);
      // Update SUI to $2.00
      priceCache.updatePriceForSymbol('SUI', '200000000', -8, publishTime);

      const suiPrice = priceCache.getPriceBySymbol('SUI')!.price;
      expect(suiPrice).toBeCloseTo(2.0, 2);

      const afsuiCfg = getCoinConfigBySymbol('AFSUI')!;
      const afsuiUsd = priceCache.getPriceUsd(afsuiCfg.coinType);
      // afSUI ~ 1.05 * SUI = 2.10
      expect(afsuiUsd).toBeCloseTo(2.10, 1);

      // Now simulate a Pyth update for afSUI redemption rate (e.g. 1.062)
      priceCache.updateFromPyth(afsuiCfg.pythPriceFeedId, '106200000', -8, publishTime + 1);
      const updatedAfSui = priceCache.getPriceUsd(afsuiCfg.coinType);
      // 2.0 * 1.062 = 2.124
      expect(updatedAfSui).toBeCloseTo(2.124, 2);
    });
  });

  describe('3. Cetus CLMM Pools & Atomic Routing', () => {
    it('should have verified live pools registered in CANONICAL_CETUS_POOLS', () => {
      expect(CANONICAL_CETUS_POOLS['USDC_AUSD']).toBeDefined();
      expect(CANONICAL_CETUS_POOLS['USDC_AUSD'].poolId).toBe(
        '0x0fea99ed9c65068638963a81587c3b8cafb71dc38c545319f008f7e9feb2b5f8'
      );

      expect(CANONICAL_CETUS_POOLS['LBTC_SUI']).toBeDefined();
      expect(CANONICAL_CETUS_POOLS['LBTC_SUI'].poolId).toBe(
        '0x2fc6ee9183d0f1ca0d2dded02c416be6f4671bb82db55c26ce12b536812a4b8e'
      );

      expect(CANONICAL_CETUS_POOLS['NS_SUI']).toBeDefined();
      expect(CANONICAL_CETUS_POOLS['NS_SUI'].poolId).toBe(
        '0x763f63cbada3a932c46972c6c6dcf1abd8a9a73331908a1d7ef24c2232d85520'
      );

      expect(CANONICAL_CETUS_POOLS['AFSUI_SUI']).toBeDefined();
      expect(CANONICAL_CETUS_POOLS['AFSUI_SUI'].poolId).toBe(
        '0xa528b26eae41bcfca488a9feaa3dca614b2a1d9b9b5c78c256918ced051d4c50'
      );

      expect(CANONICAL_CETUS_POOLS['SCA_SUI']).toBeDefined();
      expect(CANONICAL_CETUS_POOLS['SCA_SUI'].poolId).toBe(
        '0x9661cca01a5b9b3536883568fa967a2943e237de11a97976795f5adb293892e9'
      );
    });

    it('should find routes for all 9 target tokens to either SUI or USDC', () => {
      for (const symbol of TARGET_COINS) {
        const cfg = getCoinConfigBySymbol(symbol)!;
        const canRouteToSui = CetusRouter.hasPool(cfg.coinType, SUI_TYPE);
        const canRouteToUsdc = CetusRouter.hasPool(cfg.coinType, USDC_TYPE);
        expect(canRouteToSui || canRouteToUsdc).toBe(true);
      }
    });

    it('should compute valid quotations with slippage protection for new assets', () => {
      // 1. AUSD -> USDC (6 decimals -> 6 decimals, both ~$1.00)
      const ausdCfg = getCoinConfigBySymbol('AUSD')!;
      const ausdQuote = CetusRouter.getQuote(ausdCfg.coinType, USDC_TYPE, 100_000_000n, 100);
      expect(ausdQuote.dex).toBe('cetus');
      expect(ausdQuote.expectedAmountOut).toBeGreaterThan(0n);
      expect(ausdQuote.minimumAmountOut).toBeLessThanOrEqual(ausdQuote.expectedAmountOut);

      // 2. LBTC -> SUI (8 decimals -> 9 decimals)
      const lbtcCfg = getCoinConfigBySymbol('LBTC')!;
      // 0.01 LBTC
      const lbtcQuote = CetusRouter.getQuote(lbtcCfg.coinType, SUI_TYPE, 1_000_000n, 100);
      expect(lbtcQuote.dex).toBe('cetus');
      expect(lbtcQuote.expectedAmountOut).toBeGreaterThan(0n);

      // 3. NS -> SUI (6 decimals -> 9 decimals)
      const nsCfg = getCoinConfigBySymbol('NS')!;
      const nsQuote = CetusRouter.getQuote(nsCfg.coinType, SUI_TYPE, 10_000_000n, 100);
      expect(nsQuote.dex).toBe('cetus');
      expect(nsQuote.expectedAmountOut).toBeGreaterThan(0n);

      // 4. afSUI -> SUI (9 decimals -> 9 decimals)
      const afsuiCfg = getCoinConfigBySymbol('AFSUI')!;
      const afsuiQuote = CetusRouter.getQuote(afsuiCfg.coinType, SUI_TYPE, 1_000_000_000n, 100);
      expect(afsuiQuote.dex).toBe('cetus');
      expect(afsuiQuote.expectedAmountOut).toBeGreaterThan(0n);
    });

    it('should construct PTB Move calls for direct and 2-hop swaps of new tokens', () => {
      const tx = new Transaction();
      const mockInputCoin = tx.object('0x1111111111111111111111111111111111111111111111111111111111111111');

      const lbtcCfg = getCoinConfigBySymbol('LBTC')!;
      const quote = CetusRouter.getQuote(lbtcCfg.coinType, SUI_TYPE, 1_000_000n, 100);
      const outCoin = CetusRouter.addSwap(tx, quote, mockInputCoin);

      expect(outCoin).toBeDefined();
      const commands = tx.getData().commands;
      const moveCalls = commands.filter((c: any) => c.$kind === 'MoveCall');
      expect(moveCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('should successfully execute syncDynamicPools without throwing or breaking registry', async () => {
      const initialPoolCount = CANONICAL_CETUS_POOLS ? Object.keys(CANONICAL_CETUS_POOLS).length : 0;
      expect(initialPoolCount).toBeGreaterThan(0);

      // syncDynamicPools should not throw even if network is restricted or fails
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { pools: [] } }),
      } as Response);
      try {
        const result = await CetusRouter.syncDynamicPools();
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
