import { suiClient } from '../src/client/suiClient.js';
import { CONFIG } from '../src/config/index.js';

async function main() {
  const address = CONFIG.operatorAddress;
  console.log('Querying all historical transactions for operator:', address);
  let cursor: string | null = null;
  let pageIndex = 1;
  let totalProcessed = 0;
  const successfulLiquidations: any[] = [];

  do {
    const page: any = await suiClient.queryTransactionBlocks({
      filter: { FromAddress: address },
      options: {
        showEffects: true,
        showEvents: true,
      },
      cursor,
      limit: 50,
    });

    for (const tx of page.data) {
      totalProcessed++;
      const isSuccess = tx.effects?.status?.status === 'success';
      const events = tx.events || [];
      const liqEvent = events.find((e: any) =>
        e.type.toLowerCase().includes('liquidation')
      );

      if (liqEvent && isSuccess) {
        successfulLiquidations.push({
          digest: tx.digest,
          gasUsedMist: BigInt(tx.effects?.gasUsed?.computationCost || 0) + BigInt(tx.effects?.gasUsed?.storageCost || 0) - BigInt(tx.effects?.gasUsed?.storageRebate || 0),
          eventType: liqEvent.type,
          eventData: liqEvent.parsedJson,
        });
      }
    }

    cursor = page.hasNextPage ? page.nextCursor : null;
    pageIndex++;
  } while (cursor);

  console.log(`\n======================================================`);
  console.log(`Total Transactions Scanned: ${totalProcessed}`);
  console.log(`Total Confirmed Liquidations Landed: ${successfulLiquidations.length}`);
  console.log(`======================================================\n`);

  for (const [idx, liq] of successfulLiquidations.entries()) {
    console.log(`[Liquidation #${idx + 1}]`);
    console.log(`  Digest: ${liq.digest}`);
    console.log(`  Suiscan Link: https://suiscan.xyz/mainnet/tx/${liq.digest}`);
    console.log(`  Net Gas (MIST): ${liq.gasUsedMist}`);
    console.log(`  Event Type: ${liq.eventType}`);
    console.log(`  Details:`, JSON.stringify(liq.eventData, null, 2));
  }
}

main().catch(console.error);
