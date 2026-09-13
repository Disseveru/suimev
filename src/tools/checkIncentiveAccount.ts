import { SuiClientManager } from '../client/suiClient.js';

async function run() {
  const client = SuiClientManager.getInstance().getClient();
  const mod = await client.getNormalizedMoveModule({
    package: '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c',
    module: 'incentive_account',
  });
  console.log('Exposed functions:', Object.keys(mod.exposedFunctions));
  console.log('force_unstake_unhealthy:', JSON.stringify(mod.exposedFunctions['force_unstake_unhealthy'], null, 2));
}

run().catch(console.error);
