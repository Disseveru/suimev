import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { rpcManager } from '../client/suiClient.js';
import { SCALLOP_CONFIG } from '../config/constants.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';

async function scanScallop() {
  console.log('\n=== SCANNING SCALLOP PROTOCOL ===');
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return [];
  const query = await sdk.createScallopQuery();

  // Discover obligations from borrow events
  const oblIds = new Set<string>();
  let cursor: any = null;
  let pages = 0;
  const maxPages = 30; // 3,000 events

  while (pages < maxPages) {
    try {
      const res = await rpcManager.executeWithFallback('scallopBorrowEvents', client =>
        client.queryEvents({
          query: { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'borrow' } },
          cursor,
          limit: 100,
        })
      );
      pages++;
      if (res.data) {
        for (const ev of res.data) {
          const json = ev.parsedJson as any;
          const oblId = json?.obligation || json?.obligation_id;
          if (oblId && typeof oblId === 'string') oblIds.add(oblId);
        }
      }
      if (!res.hasNextPage || !res.nextCursor) break;
      cursor = res.nextCursor;
    } catch {
      break;
    }
  }

  console.log(`Discovered ${oblIds.size} unique Scallop obligations across ${pages} pages.`);
  const liquidatable: any[] = [];
  const idList = Array.from(oblIds);

  const BATCH_SIZE = 10;
  for (let i = 0; i < idList.length; i += BATCH_SIZE) {
    const batch = idList.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async id => {
        const acc = await query.getObligationAccountById(id);
        if (acc && acc.totalBorrowedValue > 1 && acc.totalDepositedValue > 0) {
          if (acc.totalRiskLevel >= 1.0 || acc.totalUnhealthyCollateralValue > 0) {
            return {
              id,
              riskLevel: acc.totalRiskLevel,
              debt: acc.totalBorrowedValue,
              collateral: acc.totalDepositedValue,
              unhealthyCollateral: acc.totalUnhealthyCollateralValue,
              debts: acc.debts,
              collaterals: acc.collaterals,
            };
          }
        }
        return null;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        liquidatable.push(r.value);
        console.log('🚨 FOUND LIQUIDATABLE SCALLOP OBLIGATION:', r.value);
      }
    }
    if ((i / BATCH_SIZE) % 10 === 0) {
      process.stdout.write(`Checked ${i}/${idList.length} obligations...\r`);
    }
  }

  console.log(`\nScallop scan complete. Total liquidatable: ${liquidatable.length}`);
  return liquidatable;
}

async function run() {
  await scanScallop();
}

run().catch(console.error);
