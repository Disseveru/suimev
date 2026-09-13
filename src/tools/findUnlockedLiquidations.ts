import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { rpcManager } from '../client/suiClient.js';
import { SCALLOP_CONFIG } from '../config/constants.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import { PreFlightSimulator } from '../engine/simulator.js';

async function main() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();

  console.log('Discovering Scallop obligations from borrow events...');
  const oblIds = new Set<string>();
  let cursor: any = null;
  let pages = 0;

  while (pages < 25) {
    const res = await rpcManager.executeWithFallback('events', c =>
      c.queryEvents({
        query: { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'borrow' } },
        cursor,
        limit: 100,
      })
    );
    pages++;
    for (const ev of res.data) {
      const id = (ev.parsedJson as any)?.obligation || (ev.parsedJson as any)?.obligation_id;
      if (id) oblIds.add(id);
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
  console.log(`Discovered ${oblIds.size} obligations.`);

  // Query on-chain objects in batches of 50 via multiGetObjects
  const idArray = Array.from(oblIds);
  const client = rpcManager.getClient();

  console.log('Fetching obligation objects in bulk via multiGetObjects...');
  const unlockedCandidates: string[] = [];

  for (let i = 0; i < idArray.length; i += 50) {
    const batch = idArray.slice(i, i + 50);
    const objs = await client.multiGetObjects({
      ids: batch,
      options: { showContent: true }
    });

    for (const obj of objs) {
      if (!obj.data) continue;
      const fields = (obj.data.content as any)?.fields;
      if (!fields) continue;

      const id = obj.data.objectId;
      const isLocked = Boolean(fields.liquidate_locked);
      const debtsSize = Number(fields.debts?.fields?.table?.fields?.size || 0);
      const colSize = Number(fields.collaterals?.fields?.table?.fields?.size || 0);

      if (debtsSize > 0 && colSize > 0) {
        if (!isLocked) {
          unlockedCandidates.push(id);
          console.log(`Found unlocked active obligation: ${id} (debts: ${debtsSize}, cols: ${colSize})`);
        }
      }
    }
  }

  console.log(`\nTotal active unlocked obligations found: ${unlockedCandidates.length}`);

  // Now evaluate each unlocked candidate
  for (const oblId of unlockedCandidates) {
    try {
      const acc = await query.getObligationAccountById(oblId);
      if (acc && acc.totalBorrowedValue > 0.05 && acc.totalDepositedValue > 0) {
        console.log(`Obligation ${oblId}: Debt=$${acc.totalBorrowedValue.toFixed(2)}, Col=$${acc.totalDepositedValue.toFixed(2)}, Risk=${acc.totalRiskLevel.toFixed(4)}, Unhealthy=${acc.totalUnhealthyCollateralValue}`);
        if (acc.totalRiskLevel >= 1.0 || acc.totalUnhealthyCollateralValue > 0) {
          console.log(`🚨 LIQUIDATABLE UNLOCKED OBLIGATION DETECTED: ${oblId}!`);
        }
      }
    } catch {
      // skip
    }
  }
}

main().catch(console.error);
