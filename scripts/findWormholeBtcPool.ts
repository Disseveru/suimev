import { suiClient } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function main() {
  let hasNext = true;
  let cursor: any = null;
  let totalChecked = 0;
  const targetBtc = '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC';

  while (hasNext && totalChecked < 1000) {
    const res = await suiClient.queryEvents({
      query: {
        MoveEventType: `${CETUS_CONFIG.clmmPoolPackageId}::factory::CreatePoolEvent`,
      },
      cursor,
      limit: 50,
    });

    for (const ev of res.data) {
      const p = ev.parsedJson as any;
      if (p.coin_type_a?.includes('btc::BTC') || p.coin_type_b?.includes('btc::BTC') ||
          p.coin_type_a?.includes('aafb102dd') || p.coin_type_b?.includes('aafb102dd')) {
        console.log('Found Cetus Pool:', p);
      }
    }

    totalChecked += res.data.length;
    hasNext = res.hasNextPage;
    cursor = res.nextCursor;
    if (!res.data.length) break;
  }
  console.log(`Checked ${totalChecked} Cetus pools.`);
}

main().catch(console.error);
