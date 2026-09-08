import { rpcManager } from '../client/suiClient.js';

async function checkLiquidateLocked() {
  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  for (const [modName, mod] of Object.entries(pkgNorm)) {
    for (const [fnName, fn] of Object.entries(mod.exposedFunctions)) {
      if (fnName.includes('liquidate')) {
        console.log(`Function: ${modName}::${fnName}`);
        console.log(`Parameters:`, JSON.stringify(fn.parameters));
      }
    }
  }
}

checkLiquidateLocked().catch(console.error);
