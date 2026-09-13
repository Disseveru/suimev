import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG } from '../src/config/constants.js';

async function run() {
  const obj = await suiClient.getObject({
    id: NAVI_CONFIG.packageId,
    options: { showBcs: true },
  });
  const bcsData = obj.data?.bcs as any;
  if (bcsData?.moduleMap) {
    console.log('NAVI modules:', Object.keys(bcsData.moduleMap));
    for (const modName of ['error', 'calculator', 'oracle']) {
      const modBase64 = bcsData.moduleMap[modName];
      if (modBase64) {
        const bytes = Buffer.from(modBase64, 'base64');
        const strings: string[] = [];
        let cur = '';
        for (const b of bytes) {
          if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
          else {
            if (cur.length >= 3) strings.push(cur);
            cur = '';
          }
        }
        console.log(`Strings in NAVI ${modName}:`, strings);
      }
    }
  }
}

run().catch(console.error);
