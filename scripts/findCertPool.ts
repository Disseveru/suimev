import { suiClient } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function main() {
  const cert = '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT';
  const sui = '0x2::sui::SUI';

  console.log('Querying Cetus pools for CERT (vSUI) / SUI...');
  let cursor: any = null;
  let total = 0;
  while (total < 1000) {
    const res = await suiClient.queryEvents({
      query: {
        MoveEventType: `${CETUS_CONFIG.clmmPoolPackageId}::factory::CreatePoolEvent`,
      },
      cursor,
      limit: 50,
    });
    for (const ev of res.data) {
      const p = ev.parsedJson as any;
      if (p.coin_type_a?.includes('cert::CERT') || p.coin_type_b?.includes('cert::CERT')) {
        console.log('Found Cetus CERT pool:', p);
      }
    }
    total += res.data.length;
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
  console.log(`Searched ${total} pools.`);
}

main().catch(console.error);
