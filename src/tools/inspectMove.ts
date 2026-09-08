import { rpcManager } from '../client/suiClient.js';

async function inspectPackage() {
  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  console.log(`Inspecting package: ${pkgId}`);
  const pkg = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  const liquidateMod = pkg['liquidate'];
  if (liquidateMod) {
    console.log('Liquidate module functions:');
    for (const [name, fn] of Object.entries(liquidateMod.exposedFunctions)) {
      console.log(`- ${name}:`, JSON.stringify(fn));
    }
  } else {
    console.log('Available modules:', Object.keys(pkg));
  }
}

inspectPackage().catch(console.error);
