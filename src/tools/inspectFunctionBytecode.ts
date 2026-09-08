import { rpcManager } from '../client/suiClient.js';

async function inspectFunctionBytecode() {
  const pkgId = '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c';
  const pkg = await rpcManager.executeWithFallback('getObject', (client) =>
    client.getObject({ id: pkgId, options: { showBcs: true } })
  );

  const bcsData = pkg.data?.bcs as any;
  const userBase64 = bcsData.moduleMap['user'];
  const buf = Buffer.from(userBase64, 'base64');
  console.log('user module length:', buf.length);

  // Search for strings in user module
  const strings: string[] = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b <= 126) cur += String.fromCharCode(b);
    else {
      if (cur.length >= 3) strings.push(cur);
      cur = '';
    }
  }
  console.log('Strings in user module:', strings);
}

inspectFunctionBytecode().catch(console.error);
