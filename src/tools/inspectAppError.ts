import { suiClient } from '../client/suiClient.js';

async function inspectAppError() {
  const pkgId = '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c';
  const pkg = await suiClient.getObject({
    id: pkgId,
    options: { showBcs: true }
  });
  const bcsData = (pkg.data?.bcs as any)?.moduleMap;
  const appErrorBytes = bcsData['app_error'];
  if (appErrorBytes) {
    const raw = Buffer.from(appErrorBytes, 'base64').toString('utf8');
    const strings = raw.match(/[a-zA-Z0-9_]{3,}/g) || [];
    console.log('Strings in app_error:', strings);
  }

  const incentiveAccountBytes = bcsData['incentive_account'];
  if (incentiveAccountBytes) {
    const raw = Buffer.from(incentiveAccountBytes, 'base64').toString('utf8');
    const strings = raw.match(/[a-zA-Z0-9_]{3,}/g) || [];
    console.log('Strings in incentive_account:', strings.filter(s => s.toLowerCase().includes('error') || s.toLowerCase().includes('unhealthy') || s.toLowerCase().includes('unstake')));
  }
}

inspectAppError().catch(console.error);
