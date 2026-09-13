import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const obj = await suiClient.getObject({
    id: '0x2e041f3fd93646dcc877f783c1f2b7fa62d30271bdef1f21ef002cebf857bded',
    options: { showType: true, showContent: true }
  });
  console.log('Object type:', obj.data?.type);
  console.log('Fields:', JSON.stringify((obj.data?.content as any)?.fields, null, 2));
}

main().catch(console.error);
