import { SuiClientManager } from '../client/suiClient.js';

async function search() {
  const client = SuiClientManager.getInstance().getClient();
  const obj = await client.getObject({
    id: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
    options: { showContent: true }
  });
  console.log('GlobalConfig:', JSON.stringify(obj, null, 2));
}

search().catch(console.error);
