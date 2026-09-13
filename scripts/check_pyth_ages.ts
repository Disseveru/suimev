import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const res = await fetch('https://sui.apis.scallop.io/addresses/695fcdc084f790c04eb068dc');
  const data = await res.json();
  const coins = data.mainnet.core.coins;

  const whaleCoins = ['sbeth', 'usdy', 'wal', 'deep', 'usdc', 'sui', 'fdusd', 'sbusdt', 'sca'];
  const nowSec = Math.floor(Date.now() / 1000);
  console.log(`Current local time (seconds): ${nowSec}`);

  for (const name of whaleCoins) {
    const c = coins[name];
    const feedObjId = c?.oracle?.pyth?.feedObject;
    if (feedObjId) {
      const obj = await client.getObject({ id: feedObjId, options: { showContent: true } });
      const fields = (obj.data?.content as any)?.fields;
      const ts = fields?.price_info?.fields?.price_feed?.fields?.price?.fields?.timestamp;
      const ageSec = ts ? nowSec - Number(ts) : null;
      console.log(`${name.padEnd(8)} (obj ${feedObjId.slice(0, 10)}...): timestamp=${ts}, age=${ageSec}s ago`);
    } else {
      console.log(`${name.padEnd(8)}: No pyth feed object (custom or switchboard)`);
    }
  }
}

main().catch(console.error);
