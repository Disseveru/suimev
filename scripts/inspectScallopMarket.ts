import { suiClient } from '../src/client/suiClient.js';
import { SCALLOP_CONFIG } from '../src/config/constants.js';

async function main() {
  const obj = await suiClient.getObject({
    id: SCALLOP_CONFIG.market,
    options: { showContent: true, showType: true }
  });
  console.log('Scallop Market obj fields:', Object.keys((obj.data?.content as any)?.fields || {}));
  console.log('Scallop Market content:', JSON.stringify((obj.data?.content as any)?.fields, null, 2).slice(0, 1000));
}

main().catch(console.error);
