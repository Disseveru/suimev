import { rpcManager } from '../client/suiClient.js';

async function main() {
  const pkg = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({
      package: '0xae9c208cf58fd5ba36737c9ee5dcfa7f152d0fb5a5a99eebb7c881ebc2fe59e0'
    })
  );
  console.log('Modules in 0xae9c208c:', Object.keys(pkg));
  if (pkg['router']) {
    console.log('Router swap params:', JSON.stringify(pkg['router'].exposedFunctions['swap'], null, 2));
  }
}

main().catch(console.error);
