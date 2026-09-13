import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  // Pyth state is 0x03719fae774ddab3cfcaa53bbc046f0cbe21410019b6280811bf3f9f4b05839d or 0x1f9310238ee9298fb703c3419030b35b22bb1cc37113e3bb5007c99aec79e5b8
  const regObj = await client.getObject({
    id: '0xdf5a879c4a572c7a143839c019ca114eaaf696426b6c95a052b865c06f12e279',
    options: { showContent: true }
  });
  console.log('PythRegistry fields:', JSON.stringify(regObj.data?.content, null, 2));
}

main().catch(console.error);
