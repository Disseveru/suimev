import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const fields = await client.getDynamicFields({
    parentId: '0xf5d0a43dcc96aa33cbe48d86155ede120377d25863389a75634364a5c8e054a7',
    limit: 50
  });
  console.log('Prices table keys:');
  for (const f of fields.data) {
    console.log(JSON.stringify(f.name));
  }
}

main().catch(console.error);
