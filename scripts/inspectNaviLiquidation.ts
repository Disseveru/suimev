import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG } from '../src/config/constants.js';

async function main() {
  const mod = await suiClient.getNormalizedMoveFunction({
    package: NAVI_CONFIG.packageId,
    module: 'incentive_v3',
    function: 'liquidation_v2',
  });
  console.log('NAVI liquidation_v2 return types:');
  console.log(JSON.stringify(mod.return, null, 2));
}

main().catch(console.error);
