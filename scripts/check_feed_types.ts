import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const res = await fetch('https://sui.apis.scallop.io/addresses/695fcdc084f790c04eb068dc');
  const data = await res.json();
  const coins = data.mainnet.core.coins;

  const whaleCoins = ['sbeth', 'usdy', 'wal', 'sca', 'deep', 'usdc', 'sui', 'fdusd', 'sbusdt'];
  for (const name of whaleCoins) {
    const c = coins[name];
    console.log(`Coin: ${name}`);
    console.log('  oracle:', JSON.stringify(c?.oracle));
    const feedObjId = c?.oracle?.pyth?.feedObject;
    if (feedObjId) {
      const obj = await client.getObject({ id: feedObjId, options: { showType: true } });
      console.log('  feedObject on-chain type:', obj.data?.type);
    }
  }
}

main().catch(console.error);
