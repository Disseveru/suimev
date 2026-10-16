import { SuiClientManager } from '../client/suiClient.js';

async function findPools() {
  const client = SuiClientManager.getInstance().getClient();
  const WUSDC = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN';
  const WUSDT = '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN';

  // Search events from Cetus pool creation
  const events = await client.queryEvents({
    query: {
      MoveEventType: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::factory::CreatePoolEvent'
    },
    limit: 100
  });
  console.log('Total pool created events found:', events.data.length);
  for (const e of events.data) {
    const json = e.parsedJson as any;
    const a = json.coin_type_a || '';
    const b = json.coin_type_b || '';
    if (a.includes('5d4b3025') || b.includes('5d4b3025') || a.includes('c0600061') || b.includes('c0600061')) {
      console.log('MATCHED CETUS POOL:', json.pool_id, 'A:', a, 'B:', b);
    }
  }
}

findPools().catch(console.error);
