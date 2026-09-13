import { SuiClientManager } from '../client/suiClient.js';
import { NAVI_CONFIG } from '../config/constants.js';

async function run() {
  const client = SuiClientManager.getInstance().getClient();
  const mod = await client.getNormalizedMoveModule({
    package: NAVI_CONFIG.packageId,
    module: 'incentive_v3',
  });
  console.log('liquidation_v2 parameters:', JSON.stringify(mod.exposedFunctions['liquidation_v2']?.parameters, null, 2));
}

run().catch(console.error);
