import { rpcManager } from '../client/suiClient.js';

async function checkBorrowIncentive() {
  const pkgId = '0x045811c127a4063d78683ea61fa987b9252a798b0d3ae9e927e25adcbe5549e2';
  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  console.log('Modules in borrowIncentive:', Object.keys(pkgNorm));
  for (const [modName, mod] of Object.entries(pkgNorm)) {
    for (const [fnName, fn] of Object.entries(mod.exposedFunctions)) {
      if (fnName.includes('liquidat') || fnName.includes('unlock') || fnName.includes('unstake')) {
        console.log(`${modName}::${fnName}:`, JSON.stringify(fn.parameters));
      }
    }
  }
}

checkBorrowIncentive().catch(console.error);
