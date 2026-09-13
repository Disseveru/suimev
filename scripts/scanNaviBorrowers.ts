import chalk from 'chalk';
import { suiClient } from '../src/client/suiClient.js';
import { getHealthFactor, getLendingPositions } from '@naviprotocol/lending';

async function main() {
  console.log(chalk.cyan('Querying NAVI BorrowEvent history...'));
  const borrowerSet = new Set<string>();
  let cursor: any = null;
  let pages = 0;
  const MAX_PAGES = 30; // 3000 events

  while (pages < MAX_PAGES) {
    try {
      const res = await suiClient.queryEvents({
        query: {
          MoveEventType: '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb::event::BorrowEvent',
        },
        cursor,
        limit: 100,
      });
      pages++;
      for (const ev of res.data) {
        const json = ev.parsedJson as any;
        const borrower = json?.borrower || json?.sender;
        if (borrower && typeof borrower === 'string' && borrower.startsWith('0x')) {
          borrowerSet.add(borrower);
        }
      }
      if (!res.hasNextPage || !res.nextCursor) break;
      cursor = res.nextCursor;
    } catch (e: any) {
      console.log('Error querying borrow events:', e.message);
      break;
    }
  }

  const borrowers = Array.from(borrowerSet);
  console.log(chalk.green(`Discovered ${borrowers.length} unique NAVI active borrowers across ${pages} pages.`));

  const undercollateralized: any[] = [];

  // Batch query health factors with concurrency 15
  const BATCH_SIZE = 15;
  for (let i = 0; i < borrowers.length; i += BATCH_SIZE) {
    const batch = borrowers.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (addr) => {
      try {
        const hf = await getHealthFactor(addr, { client: suiClient as any });
        if (hf < 1.0) {
          console.log(chalk.bold.red(`\n🚨 FOUND REAL UNDERCOLLATERALIZED NAVI BORROWER: ${addr} | HF: ${hf.toFixed(4)}`));
          try {
            const positions = await getLendingPositions(addr, { client: suiClient as any });
            console.log('   Positions:', JSON.stringify(positions, null, 2));
            undercollateralized.push({ addr, hf, positions });
          } catch (err: any) {
            console.log('   Could not fetch positions:', err.message);
          }
        }
      } catch (err) {}
    }));
    process.stdout.write(`Checked ${Math.min(i + BATCH_SIZE, borrowers.length)}/${borrowers.length} borrowers\r`);
  }

  console.log(chalk.bold.green(`\n\nScan complete! Found ${undercollateralized.length} truly undercollateralized NAVI borrowers.`));
}

main().catch(console.error);
