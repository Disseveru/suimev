import { suiClient } from '../src/client/suiClient.js';
import { SCALLOP_CONFIG } from '../src/config/constants.js';

async function main() {
  console.log('Querying Scallop protocol package:', SCALLOP_CONFIG.protocolPkg);
  
  // Query all events for borrow
  let cursor = null;
  let totalBorrows = 0;
  const obligationsWithBorrow = new Set<string>();

  for (let page = 0; page < 30; page++) {
    const res = await suiClient.queryEvents({
      query: { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'borrow' } },
      cursor,
      limit: 100,
    });
    totalBorrows += res.data.length;
    for (const ev of res.data) {
      const json = ev.parsedJson as any;
      if (json?.obligation) obligationsWithBorrow.add(json.obligation);
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }

  console.log(`Scanned ${totalBorrows} Scallop borrow events. Unique obligations with borrows: ${obligationsWithBorrow.size}`);
}

main().catch(console.error);
