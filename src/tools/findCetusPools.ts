import { rpcManager } from '../client/suiClient.js';
import { CETUS_CONFIG } from '../config/constants.js';

async function findCetusPools() {
  console.log('Querying Cetus CreatePoolEvent...');
  const res = await rpcManager.executeWithFallback('cetusCreatePool', (c) =>
    c.queryEvents({
      query: {
        MoveEventType: `${CETUS_CONFIG.clmmPoolPackageId}::factory::CreatePoolEvent`,
      },
      limit: 100,
    })
  );

  console.log(`Found ${res.data.length} Cetus pools created recently:`);
  for (const ev of res.data) {
    const json = ev.parsedJson as any;
    console.log(`Pool: ${json?.pool_id} | ${json?.coin_type_a} / ${json?.coin_type_b}`);
  }
}

findCetusPools().catch(console.error);
