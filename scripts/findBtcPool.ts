import { rpcManager } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function run() {
  const res = await rpcManager.executeWithFallback('queryCetusPools', (client) =>
    client.queryEvents({
      query: {
        MoveEventType: `${CETUS_CONFIG.clmmPoolPackageId}::factory::CreatePoolEvent`,
      },
      limit: 50,
    })
  );

  for (const ev of res.data) {
    const json = ev.parsedJson as any;
    const a = json?.coin_type_a || '';
    const b = json?.coin_type_b || '';
    if (a.includes('btc') || b.includes('btc') || a.includes('BTC') || b.includes('BTC')) {
      console.log('BTC coin type:', a, b, 'pool:', json.pool_id);
    }
  }
}

run().catch(console.error);
