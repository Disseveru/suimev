import { rpcManager } from '../client/suiClient.js';

async function checkObligationModule() {
  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  const oblMod = pkgNorm['obligation'];
  console.log('liquidate_locked:', JSON.stringify(oblMod.exposedFunctions['liquidate_locked'], null, 2));

  for (const fn of Object.keys(oblMod.exposedFunctions)) {
    if (fn.includes('lock')) {
      console.log(`Obligation lock function: ${fn}:`, JSON.stringify(oblMod.exposedFunctions[fn]));
    }
  }
}

checkObligationModule().catch(console.error);
