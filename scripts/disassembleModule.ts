import { suiClient } from '../src/client/suiClient.js';

async function run() {
  const obj = await suiClient.getObject({
    id: '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805',
    options: { showBcs: true },
  });
  const bcsData = obj.data?.bcs as any;
  const modBase64 = bcsData.moduleMap['error'];
  const bytes = Buffer.from(modBase64, 'base64');
  const asciiStrings: string[] = [];
  let current = '';
  for (const b of bytes) {
    if (b >= 32 && b <= 126) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= 3) asciiStrings.push(current);
      current = '';
    }
  }
  console.log('Error module strings:', asciiStrings);
}

run().catch(console.error);
