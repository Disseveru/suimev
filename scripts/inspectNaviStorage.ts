import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG } from '../src/config/constants.js';

async function main() {
  const obj = await suiClient.getObject({
    id: NAVI_CONFIG.storage,
    options: { showContent: true, showType: true }
  });
  console.log('Storage obj fields:', Object.keys((obj.data?.content as any)?.fields || {}));
  console.log('Storage content:', JSON.stringify((obj.data?.content as any)?.fields, null, 2).slice(0, 1000));

  const fields = await suiClient.getDynamicFields({
    parentId: NAVI_CONFIG.storage,
    limit: 20
  });
  console.log('Storage dynamic fields count:', fields.data.length);
  console.log('Storage dynamic fields sample:', fields.data.slice(0, 5));
}

main().catch(console.error);
