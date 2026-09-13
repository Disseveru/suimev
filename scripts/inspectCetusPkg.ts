import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const pkg = await suiClient.getNormalizedMoveModulesByPackage({
    package: '0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3',
  });
  console.log('Modules in 0x25ebb...:');
  console.log(Object.keys(pkg));
  const obj = await suiClient.getObject({
    id: '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab',
    options: { showType: true, showContent: true },
  });
  console.log('Object 0x51e88... type:', obj.data?.type);
}

main().catch(console.error);
