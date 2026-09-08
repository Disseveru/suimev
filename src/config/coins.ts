import { CoinMetadataConfig } from './types.js';

/**
 * Standard Sui Mainnet Token Metadata & Mapping
 */
export const COIN_CONFIGS: Record<string, CoinMetadataConfig> = {
  SUI: {
    symbol: 'SUI',
    name: 'Sui',
    decimals: 9,
    coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    pythPriceFeedId: '0x23d731513e78642a6b3076878b31a196142ae58914b4fb2c65a08332d72f96cf',
    naviPoolId: 0,
    scallopCoinName: 'sui',
    liquidationThreshold: 0.90,
    liquidationBonus: 0.05,
  },
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin (Native)',
    decimals: 6,
    coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    pythPriceFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    naviPoolId: 10,
    scallopCoinName: 'usdc',
    liquidationThreshold: 0.90,
    liquidationBonus: 0.05,
  },
  WUSDC: {
    symbol: 'WUSDC',
    name: 'USD Coin (Wormhole)',
    decimals: 6,
    coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
    pythPriceFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    naviPoolId: 1,
    scallopCoinName: 'wusdc',
    liquidationThreshold: 0.85,
    liquidationBonus: 0.05,
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD (Native)',
    decimals: 6,
    coinType: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
    pythPriceFeedId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    naviPoolId: 19,
    scallopCoinName: 'usdt',
    liquidationThreshold: 0.90,
    liquidationBonus: 0.05,
  },
  WUSDT: {
    symbol: 'WUSDT',
    name: 'Tether USD (Wormhole)',
    decimals: 6,
    coinType: '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN',
    pythPriceFeedId: '0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b',
    naviPoolId: 2,
    scallopCoinName: 'wusdt',
    liquidationThreshold: 0.90,
    liquidationBonus: 0.05,
  },
  WETH: {
    symbol: 'WETH',
    name: 'Wrapped Ether (Wormhole)',
    decimals: 8,
    coinType: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    pythPriceFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    naviPoolId: 3,
    scallopCoinName: 'weth',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    decimals: 8,
    coinType: '0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC',
    pythPriceFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    naviPoolId: 32,
    scallopCoinName: 'wbtc',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  CETUS: {
    symbol: 'CETUS',
    name: 'Cetus Token',
    decimals: 9,
    coinType: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    pythPriceFeedId: '0x629f8010839e94ff4d99c43d2db73b18568c07e0b57e75529a674391b1fb8d6a',
    naviPoolId: 4,
    scallopCoinName: 'cetus',
    liquidationThreshold: 0.70,
    liquidationBonus: 0.08,
  },
  NAVI: {
    symbol: 'NAVI',
    name: 'Navi Token',
    decimals: 9,
    coinType: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
    pythPriceFeedId: '0x32319c968f6a5cf97c3db2fb68971f1e031a0e104de01c1074e4cf4e22ec10ad',
    naviPoolId: 7,
    scallopCoinName: 'navx',
    liquidationThreshold: 0.70,
    liquidationBonus: 0.08,
  },
  SCA: {
    symbol: 'SCA',
    name: 'Scallop Token',
    decimals: 9,
    coinType: '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA',
    pythPriceFeedId: '0x53612d7658c148ae8e4fa3ec6ffeaec59d04132ab7432f94a4c58557ee6c7b39',
    scallopCoinName: 'sca',
    liquidationThreshold: 0.70,
    liquidationBonus: 0.08,
  },
  HASUI: {
    symbol: 'HASUI',
    name: 'Haedal Staked SUI',
    decimals: 9,
    coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    pythPriceFeedId: '0x438f22e84704b6b694b1a45050f28fb898687a7d18fe58e5f2b6045a8f081414',
    naviPoolId: 6,
    scallopCoinName: 'hasui',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  DEEP: {
    symbol: 'DEEP',
    name: 'DeepBook Token',
    decimals: 6,
    coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    pythPriceFeedId: '0x29bdd5248234e33bd93d3b81100b5fa32eaa5997843847e2c2cb16d7c6d9f7ff',
    naviPoolId: 15,
    scallopCoinName: 'deep',
    liquidationThreshold: 0.70,
    liquidationBonus: 0.08,
  },
  WAL: {
    symbol: 'WAL',
    name: 'Walrus Token',
    decimals: 9,
    coinType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
    pythPriceFeedId: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59',
    scallopCoinName: 'wal',
    liquidationThreshold: 0.70,
    liquidationBonus: 0.08,
  },
  USDY: {
    symbol: 'USDY',
    name: 'Ondo US Dollar Yield',
    decimals: 6,
    coinType: '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
    pythPriceFeedId: '0xe3d1723999820435ebab53003a542ff26847720692af92523eea613a9a28d500',
    scallopCoinName: 'usdy',
    liquidationThreshold: 0.85,
    liquidationBonus: 0.05,
  },
  USDSUI: {
    symbol: 'USDSUI',
    name: 'USD Sui',
    decimals: 6,
    coinType: '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
    pythPriceFeedId: '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1',
    scallopCoinName: 'usdsui',
    liquidationThreshold: 0.85,
    liquidationBonus: 0.05,
  },
  AFSUI: {
    symbol: 'AFSUI',
    name: 'Aftermath Staked SUI',
    decimals: 9,
    coinType: '0xf325ce1300e8dac124071d3152f5643a60190dac42454b4249a55787f0b83e0e::afsui::AFSUI',
    pythPriceFeedId: '0xf325ce1300e8dac124071d3152f5643a60190dac42454b4249a55787f0b83e0e',
    scallopCoinName: 'afsui',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  SCA_SUI: {
    symbol: 'SCA_SUI',
    name: 'Scallop Staked SUI',
    decimals: 9,
    coinType: '0xda07ecf4591a0c4f82be82ffab417b738cfb46fca04724948a332ea51dcbff89::sca_sui::SCA_SUI',
    pythPriceFeedId: '0xda07ecf4591a0c4f82be82ffab417b738cfb46fca04724948a332ea51dcbff89',
    scallopCoinName: 'scasui',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
};

/**
 * Normalized lookup helpers
 */
const COIN_BY_TYPE_MAP = new Map<string, CoinMetadataConfig>();
const COIN_BY_SYMBOL_MAP = new Map<string, CoinMetadataConfig>();
const COIN_BY_PYTH_ID_MAP = new Map<string, CoinMetadataConfig>();

export function normalizeStructTag(type: string): string {
  if (!type) return '';
  const trimmed = type.trim();
  // Standardize 0x prefix and lowercase
  const parts = trimmed.split('::');
  if (parts.length === 3) {
    let addr = parts[0].toLowerCase();
    if (!addr.startsWith('0x')) addr = '0x' + addr;
    try {
      const cleanHex = addr.slice(2).replace(/^0+/, '') || '0';
      return `0x${cleanHex}::${parts[1]}::${parts[2]}`;
    } catch {
      return `${addr}::${parts[1]}::${parts[2]}`;
    }
  }
  return trimmed.toLowerCase();
}

for (const config of Object.values(COIN_CONFIGS)) {
  const normType = normalizeStructTag(config.coinType);
  COIN_BY_TYPE_MAP.set(normType, config);
  // Also register un-stripped lowercase for direct matching
  COIN_BY_TYPE_MAP.set(config.coinType.toLowerCase(), config);
  COIN_BY_SYMBOL_MAP.set(config.symbol.toUpperCase(), config);
  COIN_BY_PYTH_ID_MAP.set(config.pythPriceFeedId.toLowerCase(), config);
}

export function getCoinConfigByType(coinType: string): CoinMetadataConfig | undefined {
  if (!coinType) return undefined;
  const exact = COIN_BY_TYPE_MAP.get(normalizeStructTag(coinType)) || COIN_BY_TYPE_MAP.get(coinType.toLowerCase());
  if (exact) return exact;

  // Structural fallback for variations of token wrappers (e.g. ::eth::ETH -> WETH, ::btc::BTC -> WBTC)
  const parts = coinType.split('::');
  if (parts.length === 3) {
    const structName = parts[2].toUpperCase();
    if (COIN_BY_SYMBOL_MAP.has(structName)) {
      return COIN_BY_SYMBOL_MAP.get(structName);
    }
    if (structName === 'ETH' && COIN_BY_SYMBOL_MAP.has('WETH')) return COIN_BY_SYMBOL_MAP.get('WETH');
    if (structName === 'BTC' && COIN_BY_SYMBOL_MAP.has('WBTC')) return COIN_BY_SYMBOL_MAP.get('WBTC');
    if (structName.includes('USDT') && COIN_BY_SYMBOL_MAP.has('USDT')) return COIN_BY_SYMBOL_MAP.get('USDT');
    if (structName.includes('USDC') && COIN_BY_SYMBOL_MAP.has('USDC')) return COIN_BY_SYMBOL_MAP.get('USDC');
    if (structName.includes('SUI') && COIN_BY_SYMBOL_MAP.has('SUI')) return COIN_BY_SYMBOL_MAP.get('SUI');
  }
  return undefined;
}

export function getCoinConfigBySymbol(symbol: string): CoinMetadataConfig | undefined {
  return COIN_BY_SYMBOL_MAP.get(symbol.toUpperCase());
}

export function getCoinConfigByPythId(pythId: string): CoinMetadataConfig | undefined {
  return COIN_BY_PYTH_ID_MAP.get(pythId.toLowerCase());
}

export function getAllMonitoredCoinTypes(): string[] {
  return Object.values(COIN_CONFIGS).map((c) => c.coinType);
}

export function getAllPythFeedIds(): string[] {
  return Object.values(COIN_CONFIGS).map((c) => c.pythPriceFeedId);
}
