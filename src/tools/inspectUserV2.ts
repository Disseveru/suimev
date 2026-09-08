import { rpcManager } from '../client/suiClient.js';

async function checkUserV2() {
  const pkgId = '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c';
  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  const userMod = pkgNorm['user'];
  console.log('force_unstake_unhealthy_v3 parameters:');
  console.log(JSON.stringify(userMod.exposedFunctions['force_unstake_unhealthy_v3'], null, 2));
}

checkUserV2().catch(console.error);
