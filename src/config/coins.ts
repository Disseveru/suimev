import { normalizeStructTag as mystenNormalizeStructTag } from '@mysten/sui/utils';
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
  SBETH: {
    symbol: 'sbETH',
    name: 'ETH (Sui Bridge)',
    decimals: 8,
    coinType: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
    pythPriceFeedId: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    scallopCoinName: 'sbeth',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  SOL: {
    symbol: 'SOL',
    name: 'Wrapped SOL (Wormhole)',
    decimals: 8,
    coinType: '0xb7844e289a8410e50fb3ca48d69eb9cf29e27d223ef90353fe1bd8e27ff8f3f8::coin::COIN',
    pythPriceFeedId: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
    scallopCoinName: 'wsol',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  FDUSD: {
    symbol: 'FDUSD',
    name: 'First Digital USD',
    decimals: 6,
    coinType: '0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD',
    pythPriceFeedId: '0x425a812df08e9eb376aa5db944d56d95856eb28114fef6d2fc57a22026fa8087',
    scallopCoinName: 'fdusd',
    liquidationThreshold: 0.90,
    liquidationBonus: 0.05,
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped Bitcoin',
    decimals: 8,
    coinType: '0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC',
    pythPriceFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    naviPoolId: 8,
    scallopCoinName: 'wbtc',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  WWBTC: {
    symbol: 'WBTC',
    name: 'Wrapped BTC (Wormhole)',
    decimals: 8,
    coinType: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    pythPriceFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    scallopCoinName: 'wbtc',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  SBWBTC: {
    symbol: 'sbWBTC',
    name: 'Wrapped Bitcoin (Sui Bridge)',
    decimals: 8,
    coinType: '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC',
    pythPriceFeedId: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    scallopCoinName: 'sbwbtc',
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
    pythPriceFeedId: '',
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
    // No verified Pyth price feed for USDSUI — poll-excluded; treat as $1 stablecoin via cache seed
    pythPriceFeedId: '',
    scallopCoinName: 'usdsui',
    liquidationThreshold: 0.85,
    liquidationBonus: 0.05,
  },
  CERT: {
    symbol: 'vSUI',
    name: 'Volo Staked SUI',
    decimals: 9,
    coinType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    pythPriceFeedId: '0x438f22e84704b6b694b1a45050f28fb898687a7d18fe58e5f2b6045a8f081414',
    naviPoolId: 5,
    scallopCoinName: '',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  AFSUI: {
    symbol: 'AFSUI',
    name: 'Aftermath Staked SUI',
    decimals: 9,
    coinType: '0xf325ce1300e8dac124071d3152f5643a60190dac42454b4249a55787f0b83e0e::afsui::AFSUI',
    // No verified Pyth price feed for AFSUI — poll-excluded; price proxied via SUI price × exchange rate
    pythPriceFeedId: '',
    scallopCoinName: 'afsui',
    liquidationThreshold: 0.80,
    liquidationBonus: 0.05,
  },
  BUCK: {
    symbol: 'BUCK',
    name: 'Bucket USD',
    decimals: 9,
    coinType: '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK',
    pythPriceFeedId: '0x15addb7250489721752834b6b158019ab27dfbc6e17424ef244837492c286a59',
    naviPoolId: 14,
    scallopCoinName: 'buck',
    liquidationThreshold: 0.90,
    liquidationBonus: 0.05,
  },
  AUSD: {
    symbol: 'AUSD',
    name: 'Agora USD',
    decimals: 6,
    coinType: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2abda22b25c3bd51b65e76::ausd::AUSD',
    pythPriceFeedId: '0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a',
    naviPoolId: 21,
    scallopCoinName: 'ausd',
    liquidationThreshold: 0.90,
    liquidationBonus: 0.05,
  },
  NS: {
    symbol: 'NS',
    name: 'SuiNS Token',
    decimals: 6,
    coinType: '0x5145494a5f5100e64540b1a052d5bf52327702d8471b425cb43e67db57936ac0::ns::NS',
    pythPriceFeedId: '0x29bdd5248234e33bd93d3b81100b5fa32eaa5997843847e2c2cb16d7c6d9f7ff',
    naviPoolId: 17,
    scallopCoinName: 'ns',
    liquidationThreshold: 0.70,
    liquidationBonus: 0.08,
  },
  SSUI: {
    symbol: 'sSUI',
    name: 'Spring Staked SUI',
    decimals: 9,
    coinType: '0x83556891f4a0f233ce7b05eae7d4c844f1190730da695a366492323972224102::spring_sui::SPRING_SUI',
    pythPriceFeedId: '',
    naviPoolId: 22,
    scallopCoinName: 'ssui',
    liquidationThreshold: 0.85,
    liquidationBonus: 0.05,
  },
  BLUB: {
    symbol: 'BLUB',
    name: 'Blub Token',
    decimals: 2,
    coinType: '0xfa7ac3951fdca92c5200d468d31a365eb03b2be9936fde615e69f0c1274ad3a0::BLUB::BLUB',
    pythPriceFeedId: '',
    naviPoolId: 25,
    scallopCoinName: 'blub',
    liquidationThreshold: 0.60,
    liquidationBonus: 0.10,
  },
  FUD: {
    symbol: 'FUD',
    name: 'Fud the Pug',
    decimals: 5,
    coinType: '0x76cb819b01abed502bee8a702b4c2d5f5074744637f812d9047f60effa637742::fud::FUD',
    pythPriceFeedId: '',
    naviPoolId: 26,
    scallopCoinName: 'fud',
    liquidationThreshold: 0.60,
    liquidationBonus: 0.10,
  },
  IKA: {
    symbol: 'IKA',
    name: 'Ika Token',
    decimals: 9,
    coinType: '0x6d9e44ea883f395642d4a667ec36cb488661ea242b58dcf4db9e31d42a6ff79a::ika::IKA',
    pythPriceFeedId: '',
    naviPoolId: 27,
    scallopCoinName: 'ika',
    liquidationThreshold: 0.65,
    liquidationBonus: 0.08,
  },
  SCA_SUI: {
    symbol: 'SCA_SUI',
    name: 'Scallop Staked SUI',
    decimals: 9,
    coinType: '0xda07ecf4591a0c4f82be82ffab417b738cfb46fca04724948a332ea51dcbff89::sca_sui::SCA_SUI',
    // No verified Pyth price feed for SCA_SUI — poll-excluded; price proxied via SUI price
    pythPriceFeedId: '',
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

const normalizedTagCache = new Map<string, string>();

/**
 * Canonical struct tag normalizer using @mysten/sui/utils standard
 */
export function normalizeStructTag(type: string): string {
  if (!type) return '';
  const cached = normalizedTagCache.get(type);
  if (cached !== undefined) return cached;

  let result: string;
  try {
    result = mystenNormalizeStructTag(type.trim());
  } catch {
    result = type.trim().toLowerCase();
  }
  normalizedTagCache.set(type, result);
  return result;
}

for (const config of Object.values(COIN_CONFIGS)) {
  const normType = normalizeStructTag(config.coinType);
  COIN_BY_TYPE_MAP.set(normType, config);
  // Also register raw lowercase and short address variants for instant resolution
  COIN_BY_TYPE_MAP.set(config.coinType.toLowerCase(), config);
  if (config.coinType.includes('0000000000000000000000000000000000000000000000000000000000000002::sui::SUI')) {
    COIN_BY_TYPE_MAP.set('0x2::sui::sui', config);
    COIN_BY_TYPE_MAP.set('0x2::sui::SUI', config);
  }
  COIN_BY_SYMBOL_MAP.set(config.symbol.toUpperCase(), config);
  // Only register Pyth ID if it's a valid non-empty feed ID
  if (config.pythPriceFeedId) {
    COIN_BY_PYTH_ID_MAP.set(config.pythPriceFeedId.toLowerCase(), config);
  }
}

// Dual-registration alias mappings for old addresses (AUSD, NS, BLUB, FUD) to preserve backwards compatibility with indexers
const COIN_ALIASES: Record<string, string> = {
  '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2abda49b5c802863f6d38e::ausd::AUSD': 'AUSD',
  '0x5145494a5f5100e64540b0aa69f194e9504863642a4336a5ea23821e5faab34b::ns::NS': 'NS',
  '0xfa7ff699e97e1825438810deea99f38f3cb7502c971514b3d716437af364b9e9::blub::BLUB': 'BLUB',
  '0x76cb819b01abed502bee8a702b4c2d5f5074744637f812d9047f60effa637742::fud::FUD': 'FUD',
};

for (const [oldType, symbol] of Object.entries(COIN_ALIASES)) {
  const config = COIN_CONFIGS[symbol];
  if (config) {
    COIN_BY_TYPE_MAP.set(normalizeStructTag(oldType), config);
    COIN_BY_TYPE_MAP.set(oldType.toLowerCase(), config);
  }
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
  return Object.values(COIN_CONFIGS)
    .map((c) => c.pythPriceFeedId)
    .filter(Boolean);
}
