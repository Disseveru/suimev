import { rpcManager } from '../client/suiClient.js';
import { CETUS_CONFIG } from '../config/constants.js';

async function findVsuiPool() {
  let hasNext = true;
  let cursor = null;
  const vsuiType = '0x549e8b69270def3cafaf13141f315201853d90895d96706e61266b66838a3d45::vsui::VSUI';
  const suiType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

  console.log('Searching Cetus CreatePool events for vSUI, BUCK, AUSD, NS, sSUI, BLUB, FUD, IKA...');
  for (let i = 0; i < 20; i++) {
    const res = await rpcManager.executeWithFallback('cetusCreatePool', (c) =>
      c.queryEvents({
        query: {
          MoveEventType: `${CETUS_CONFIG.clmmPoolPackageId}::factory::CreatePoolEvent`,
        },
        cursor,
        limit: 100,
      })
    );
    for (const ev of res.data) {
      const j = ev.parsedJson as any;
      const coinA = (j?.coin_type_a || '').toLowerCase();
      const coinB = (j?.coin_type_b || '').toLowerCase();
      if (
        coinA.includes('cert') || coinB.includes('cert') ||
        coinA.includes('549e8b69270def') || coinB.includes('549e8b69270def') ||
        coinA.includes('vsui') || coinB.includes('vsui')
      ) {
        console.log(`FOUND VOLO VSUI / CERT POOL: ${j?.pool_id} | ${j?.coin_type_a} / ${j?.coin_type_b}`);
      }
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
}
findVsuiPool().catch(console.error);
