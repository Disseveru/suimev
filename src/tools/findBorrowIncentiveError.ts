import { suiClient } from '../client/suiClient.js';

async function inspectError() {
  const pkgId = '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c';
  const pkg = await suiClient.getObject({
    id: pkgId,
    options: { showBcs: true }
  });
  const bcsData = (pkg.data?.bcs as any)?.moduleMap;
  if (!bcsData) {
    console.log('No bcs data found');
    return;
  }
  console.log('Modules in borrowIncentive:', Object.keys(bcsData));

  // Also check if there's an error module in this package
  for (const [modName, base64Bytes] of Object.entries(bcsData)) {
    const raw = Buffer.from(base64Bytes as string, 'base64').toString('utf8');
    const matches = raw.match(/[A-Z0-9_]{3,}/g) || [];
    const errLike = matches.filter(m => m.startsWith('E_') || m.startsWith('ERR_') || m.includes('HEALTH') || m.includes('STAKE') || m.includes('NOT_'));
    if (errLike.length > 0) {
      console.log(`Module ${modName} error-like strings:`, [...new Set(errLike)].slice(0, 20));
    }
  }
}

inspectError().catch(console.error);
