import { rpcManager } from '../client/suiClient.js';
import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from '../config/index.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';
import { obligationRegistry } from '../engine/registry.js';
import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function checkLocks() {
  await scallopProtocol.initialize();
  scallopIndexer.onObligationUpdate((s) => obligationRegistry.upsertObligation(s));
  await scallopIndexer.discoverObligationsFromHistory();

  const obls = obligationRegistry.getAllObligations().filter(o => o.protocol === 'scallop');
  console.log(`Checking ${obls.length} Scallop obligations...`);

  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  const tx = new Transaction();
  for (const obl of obls) {
    tx.moveCall({
      target: `${pkgId}::obligation::liquidate_locked`,
      arguments: [tx.object(obl.obligationId)],
    });
  }

  const res = await rpcManager.executeWithFallback('devInspectTransactionBlock', (client) =>
    client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: CONFIG.operatorAddress,
    })
  );

  for (let i = 0; i < obls.length; i++) {
    const isLocked = res.results?.[i]?.returnValues?.[0]?.[0]?.[0] === 1;
    console.log(
      `Obligation: ${obls[i].obligationId.substring(0, 16)}... | HF: ${obls[i].healthFactor.toFixed(4)} | liquidate_locked: ${isLocked ? '🔒 LOCKED' : '🔓 UNLOCKED'}`
    );
  }
}

checkLocks().catch(console.error);
