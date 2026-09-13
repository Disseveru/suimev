import { SuiClientManager } from '../client/suiClient.js';

async function run() {
  const client = SuiClientManager.getInstance().getClient();
  const oblId = '0xf30c0a48e931cb597ce498c2fbbeafa6ae2c385090c819c2d98c703622bb464c';
  const obj = await client.getObject({
    id: oblId,
    options: { showContent: true }
  });
  console.log('Obligation fields:', JSON.stringify((obj.data?.content as any)?.fields, null, 2));
}

run().catch(console.error);
