import { rpcManager } from '../client/suiClient.js';
import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from '../config/index.js';

async function findError() {
  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  const errorMod = pkgNorm['error'];
  const fnNames = Object.keys(errorMod.exposedFunctions);

  const tx = new Transaction();
  for (const fn of fnNames) {
    tx.moveCall({
      target: `${pkgId}::error::${fn}`,
      arguments: [],
    });
  }

  const res = await rpcManager.executeWithFallback('devInspectTransactionBlock', (client) =>
    client.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: CONFIG.operatorAddress,
    })
  );

  if (res.results) {
    for (let i = 0; i < fnNames.length; i++) {
      const valBytes = res.results[i]?.returnValues?.[0]?.[0];
      if (valBytes) {
        // decode u64 little-endian
        const buf = Buffer.from(valBytes);
        const code = Number(buf.readBigUInt64LE(0));
        if (code === 1025 || (code > 1020 && code < 1030)) {
          console.log(`🎯 MATCH! ${fnNames[i]} -> ${code}`);
        }
      }
    }
  }
}

findError().catch(console.error);
