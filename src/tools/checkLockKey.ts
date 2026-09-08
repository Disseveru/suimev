import { rpcManager } from '../client/suiClient.js';
import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from '../config/index.js';

async function checkLockKey() {
  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  const targetId = '0x31d948e46ab270e0a19b3e98869c50608aea41933fd1c2aa74c4ac23baccab41';

  const tx = new Transaction();
  tx.moveCall({
    target: `${pkgId}::obligation::lock_key`,
    arguments: [tx.object(targetId)],
  });

  const res = await rpcManager.executeWithFallback('devInspectTransactionBlock', (client) =>
    client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: CONFIG.operatorAddress,
    })
  );

  console.log('lock_key result:', JSON.stringify(res.results?.[0]?.returnValues));
}

checkLockKey().catch(console.error);
