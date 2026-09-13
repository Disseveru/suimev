import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const mod = await client.getNormalizedMoveModule({
    package: '0x71fddacc6ecf164bd8f6c081092beeef20945c5da2c74e0b9f3e1d3c7003fadd',
    module: 'rule'
  });
  console.log('rule functions:', Object.keys(mod.exposedFunctions));
  console.log('set_price_as_primary:', JSON.stringify(mod.exposedFunctions.set_price_as_primary, null, 2));
}

main().catch(console.error);
