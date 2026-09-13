import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const mod = await client.getNormalizedMoveModule({
    package: '0xcac8cfce94faf15ecbfe12eb5160d512e383d4c25403179515c654f5975fffb9',
    module: 'rule'
  });
  console.log('custom oracle rule functions:', Object.keys(mod.exposedFunctions));
  console.log('set_price_as_primary:', JSON.stringify(mod.exposedFunctions.set_price_as_primary, null, 2));
}

main().catch(console.error);
