import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const tableId = '0x0ffe5411ce8662a92e4b0729611593fbc52da9ea93be91a2fafff0492aeba8db';
  const fields = await client.getDynamicFields({
    parentId: tableId,
    limit: 50
  });
  console.log(`Found ${fields.data.length} registered coins in PythRegistry:`);
  for (const f of fields.data) {
    const obj = await client.getDynamicFieldObject({
      parentId: tableId,
      name: f.name
    });
    console.log((f.name as any)?.value?.name, '->', JSON.stringify((obj.data?.content as any)?.fields?.value));
  }
}

main().catch(console.error);
