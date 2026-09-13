import { suiClient } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function run() {
  const fn = await suiClient.getNormalizedMoveFunction({
    package: CETUS_CONFIG.clmmPoolPackageId,
    module: 'factory',
    function: 'pool_id',
  });
  console.log('pool_id:', JSON.stringify(fn, null, 2));
}

run().catch(console.error);
