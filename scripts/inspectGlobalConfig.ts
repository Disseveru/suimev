import { suiClient } from '../src/client/suiClient.js';

async function run() {
  const obj = await suiClient.getObject({
    id: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
    options: { showContent: true },
  });
  console.log(JSON.stringify(obj.data?.content, null, 2));
}

run().catch(console.error);
