import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const obj = await client.getObject({
    id: '0x52e60fbe72782c8c9161ab7a3c45cf77b29ed256edefca1577b2c94b03570e70',
    options: { showContent: true }
  });
  console.log('custom oracle registry:', JSON.stringify(obj.data?.content, null, 2));
}

main().catch(console.error);
