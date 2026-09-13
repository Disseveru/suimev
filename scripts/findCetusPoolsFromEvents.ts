import { rpcManager } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function run() {
  console.log('Querying Cetus CreatePoolEvent for USDY, WBTC, SCA...');
  let cursor: any = null;
  const targetSymbols = ['usdy', '0x960b531667', 'sca', 'wbtc', '0x0041f9', '0xaafb10', 'usdsui'];

  for (let page = 0; page < 30; page++) {
    const res = await rpcManager.executeWithFallback('queryCetusPools', (client) =>
      client.queryEvents({
        query: {
          MoveEventType: `${CETUS_CONFIG.clmmPoolPackageId}::factory::CreatePoolEvent`,
        },
        cursor,
        limit: 50,
      })
    );

    if (res.data) {
      for (const ev of res.data) {
        const json = ev.parsedJson as any;
        if (!json) continue;
        const coinA = json.coin_type_a || '';
        const coinB = json.coin_type_b || '';
        const poolId = json.pool_id;
        const tickSpacing = json.tick_spacing;

        const isMatch = targetSymbols.some(s => coinA.toLowerCase().includes(s) || coinB.toLowerCase().includes(s));
        if (isMatch) {
          console.log(`Matched: ${coinA} | ${coinB} | Pool: ${poolId} | Tick: ${tickSpacing}`);
        }
      }
    }

    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
}

run().catch(console.error);
