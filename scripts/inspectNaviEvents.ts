import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG } from '../src/config/constants.js';

async function main() {
  const pkg = await suiClient.getNormalizedMoveModulesByPackage({
    package: NAVI_CONFIG.packageId,
  });
  console.log('Modules in NAVI package:', Object.keys(pkg));
  if (pkg.event) {
    console.log('Event structs:', Object.keys(pkg.event.structs));
  }
}

main().catch(console.error);
