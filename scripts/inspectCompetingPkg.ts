import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const pkg = await suiClient.getNormalizedMoveModulesByPackage({
    package: '0x5013fd3a206dade2ff34758ffa0f7223d2b406fc97e8623a90759db7e2a2625e',
  });
  console.log('Modules in 0x5013fd3a...:');
  console.log(Object.keys(pkg));
  ['nc', 'npu', 'pu'].forEach(mod => {
    if (pkg[mod]) {
      console.log(`Functions in ${mod}:`, JSON.stringify(pkg[mod].exposedFunctions, null, 2));
    }
  });
}

main().catch(console.error);
