import { SuiClientManager } from '../client/suiClient.js';

async function run() {
  const client = SuiClientManager.getInstance().getClient();
  const mod = await client.getNormalizedMoveModule({
    package: '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805',
    module: 'price',
  });
  console.log('Module functions:', Object.keys(mod.exposedFunctions));
  console.log('get_price function:', JSON.stringify(mod.exposedFunctions['get_price'], null, 2));
}

run().catch(console.error);
