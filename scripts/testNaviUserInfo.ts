import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const tableId = '0xabc6c3fbc89b96e3351fdbeb5730bcc5398648367260c6a4e201779e34694e04';
  const fields = await suiClient.getDynamicFields({
    parentId: tableId,
    limit: 5
  });
  for (const f of fields.data) {
    const obj = await suiClient.getObject({ id: f.objectId, options: { showContent: true } });
    console.log('User address:', f.name.value);
    console.log('User content:', JSON.stringify(obj.data?.content, null, 2));
  }
}

main().catch(console.error);
