import { rpcManager } from '../client/suiClient.js';

async function checkPkg() {
  const pkgId = '0x002875153e09f8145ab63527bc85c00f2bd102e12f9573c47f8cdf1a1cb62934';
  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  console.log('Modules in package 0x00287515...:', Object.keys(pkgNorm));
  for (const [modName, mod] of Object.entries(pkgNorm)) {
    for (const [fnName, fn] of Object.entries(mod.exposedFunctions)) {
      if (fnName.includes('force_unstake') || fnName.includes('liquidat') || fnName.includes('unlock')) {
        console.log(`${modName}::${fnName}:`, JSON.stringify(fn.parameters));
      }
    }
  }
}

checkPkg().catch(console.error);
