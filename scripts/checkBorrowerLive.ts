import chalk from 'chalk';
import { suiClient } from '../src/client/suiClient.js';

import { CONFIG } from '../src/config/index.js';

async function main() {
  console.log('Querying transactions for operator:', CONFIG.operatorAddress);
  const txs = await suiClient.queryTransactionBlocks({
    filter: { FromAddress: CONFIG.operatorAddress },
    options: { showEffects: true, showEvents: true, showBalanceChanges: true },
    limit: 10,
    order: 'descending'
  });
  console.log('Total txs found:', txs.data.length);
  for (const tx of txs.data) {
    console.log('----------------------------------------------------');
    console.log('Digest:', tx.digest);
    console.log('Status:', tx.effects?.status?.status, tx.effects?.status?.error || '');
    console.log('Epoch:', tx.effects?.executedEpoch);
    console.log('Gas used (computation):', tx.effects?.gasUsed?.computationCost);
    console.log('Gas rebate:', tx.effects?.gasUsed?.storageRebate);
    console.log('Events:', tx.events?.map((e: any) => e.type));
    console.log('BalanceChanges:', JSON.stringify(tx.balanceChanges, null, 2));
  }
}

main().catch(console.error);
