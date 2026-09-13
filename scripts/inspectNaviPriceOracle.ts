import { suiClient } from '../src/client/suiClient.js';

async function run() {
  const fields = await suiClient.getDynamicFields({
    parentId: '0xc0601facd3b98d1e82905e660bf9f5998097dedcf86ed802cf485865e3e3667c',
    limit: 50,
  });
  console.log(`Found ${fields.data.length} oracle entries in NAVI:`);
  for (const f of fields.data) {
    const obj = await suiClient.getObject({ id: f.objectId, options: { showContent: true } });
    const content = (obj.data?.content as any)?.fields;
    console.log(`Asset ${f.name.value}:`, content?.value?.fields);
  }
}

run().catch(console.error);
