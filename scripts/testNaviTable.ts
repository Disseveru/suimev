import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const tableId = '0xabc6c3fbc89b96e3351fdbeb5730bcc5398648367260c6a4e201779e34694e04';
  const fields = await suiClient.getDynamicFields({
    parentId: tableId,
    limit: 10
  });
  console.log('Dynamic fields on user_info table:', fields.data.length);
  for (const f of fields.data) {
    console.log('Field name:', f.name);
  }
}

main().catch(console.error);
