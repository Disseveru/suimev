import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { ensureCetusCompat } from '../src/client/cetusCompat.js';

ensureCetusCompat();

const USDY = '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY';
const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDT = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT';
const WBTC_SCALLOP = '0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC';
const BTC_WORMHOLE = '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC';
const SCA = '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA';
const WAL = '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL';

async function run() {
  const sdk = initCetusSDK({ network: 'mainnet' });

  const pairs = [
    { name: 'USDY_USDC', a: USDY, b: USDC },
    { name: 'USDY_SUI', a: USDY, b: SUI },
    { name: 'WBTC_USDC', a: WBTC_SCALLOP, b: USDC },
    { name: 'BTC_USDC', a: BTC_WORMHOLE, b: USDC },
    { name: 'BTC_SUI', a: BTC_WORMHOLE, b: SUI },
    { name: 'BTC_USDT', a: BTC_WORMHOLE, b: USDT },
    { name: 'SCA_SUI', a: SCA, b: SUI },
    { name: 'SCA_USDC', a: SCA, b: USDC },
    { name: 'WAL_USDC', a: WAL, b: USDC },
    { name: 'WAL_SUI', a: WAL, b: SUI },
  ];

  for (const p of pairs) {
    try {
      const pools = await sdk.Pool.getPoolByCoins([p.a, p.b]);
      if (pools && pools.length > 0) {
        console.log(`\n=== Found ${pools.length} pool(s) for ${p.name} ===`);
        for (const pool of pools) {
          console.log(`  Pool ID: ${pool.poolAddress}`);
          console.log(`  CoinA: ${pool.coinTypeA}`);
          console.log(`  CoinB: ${pool.coinTypeB}`);
          console.log(`  Liquidity: ${pool.liquidity}`);
        }
      } else {
        console.log(`No pools found for ${p.name}`);
      }
    } catch (err: any) {
      console.log(`Error checking ${p.name}: ${err.message}`);
    }
  }
}

run().catch(console.error);
