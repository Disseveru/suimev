import { suiClient } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function main() {
  const buck = '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK';
  const usdc = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

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
      if (p.coin_type_a?.includes('buck::BUCK') || p.coin_type_b?.includes('buck::BUCK')) {
        console.log('Found Cetus BUCK pool:', p);
      }
    }
    total += res.data.length;
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
}

main().catch(console.error);
