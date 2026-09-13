import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const tx = await client.getTransactionBlock({
    digest: 'HzQWQDd861QcpymscTcrD1SMH2WUAo2XdfwVw2SHhAWs',
    options: { showInput: true, showEffects: true }
  });
  console.log('Commands:');
  const userMod = await client.getNormalizedMoveModule({
    package: '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c',
    module: 'user'
  });
  console.log('0x7492 user functions:', Object.keys(userMod.exposedFunctions));
  console.log('force_unstake_unhealthy_v2:', JSON.stringify(userMod.exposedFunctions.force_unstake_unhealthy_v2, null, 2));
  console.log('force_unstake_unhealthy_v3:', JSON.stringify(userMod.exposedFunctions.force_unstake_unhealthy_v3, null, 2));
}

main().catch(console.error);
