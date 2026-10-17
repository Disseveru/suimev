import { describe, it, expect } from 'vitest';
import { getCoinConfigByType, COIN_CONFIGS, getAllPythFeedIds } from '../src/config/coins.js';

describe('Coin Type Mismatch & Config Lookup Resolution', () => {
  const PRIMARY_TYPES = {
    AUSD: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2abda22b25c3bd51b65e76::ausd::AUSD',
    NS: '0x5145494a5f5100e64540b1a052d5bf52327702d8471b425cb43e67db57936ac0::ns::NS',
    BLUB: '0xfa7ac3951fdca92c5200d468d31a365eb03b2be9936fde615e69f0c1274ad3a0::BLUB::BLUB',
    FUD: '0x76cb819b01abed502bee8a702b4c2d5f5074744637f812d9047f60effa637742::fud::FUD',
  };

  const ALIAS_TYPES = {
    AUSD: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2abda49b5c802863f6d38e::ausd::AUSD',
    NS: '0x5145494a5f5100e64540b0aa69f194e9504863642a4336a5ea23821e5faab34b::ns::NS',
    BLUB: '0xfa7ff699e97e1825438810deea99f38f3cb7502c971514b3d716437af364b9e9::blub::BLUB',
    FUD: '0x76cb819b01abed502bee8a702b4c2d5f5074744637f812d9047f60effa637742::fud::FUD',
  };

  it('should correctly resolve primary coin configs for AUSD, NS, BLUB, and FUD', () => {
    for (const [symbol, coinType] of Object.entries(PRIMARY_TYPES)) {
      const cfg = getCoinConfigByType(coinType);
      expect(cfg).toBeDefined();
      expect(cfg?.symbol).toBe(symbol);
    }
  });

  it('should correctly resolve alias coin configs for legacy indexer compatibility (AUSD, NS, BLUB, FUD)', () => {
    for (const [symbol, aliasCoinType] of Object.entries(ALIAS_TYPES)) {
      const cfg = getCoinConfigByType(aliasCoinType);
      expect(cfg).toBeDefined();
      expect(cfg?.symbol).toBe(symbol);
    }
  });

  it('should verify WAL pythPriceFeedId length constraint and empty string setting', () => {
    const walCfg = COIN_CONFIGS.WAL;
    expect(walCfg).toBeDefined();
    expect(walCfg.pythPriceFeedId).toBe('');
    
    // Ensure all exported Pyth feed IDs are valid 66-character hex strings (0x + 64 hex chars)
    const allFeeds = getAllPythFeedIds();
    expect(allFeeds.includes('')).toBe(false);
    for (const feedId of allFeeds) {
      expect(feedId).toMatch(/^0x[a-fA-F0-9]{64}$/);
    }
  });
});
