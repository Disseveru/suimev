import { suiClient as client } from '../src/client/suiClient.js';
import { ON_CHAIN_PYTH_OBJECTS } from '../src/oracles/pythService.js';

async function verifyPyth() {
  for (const [symbol, info] of Object.entries(ON_CHAIN_PYTH_OBJECTS)) {
    const obj = await client.getObject({ id: info.objectId, options: { showContent: true } });
    if (obj.data) {
      console.log(`[PASS] Pyth ${symbol}: ${info.objectId} type: ${obj.data.type}`);
    } else {
      console.log(`[FAIL] Pyth ${symbol}: ${info.objectId} error: ${JSON.stringify(obj.error)}`);
    }
  }
}
verifyPyth();
