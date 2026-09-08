import { rpcManager } from '../client/suiClient.js';

async function inspectBytecode() {
  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  const pkg = await rpcManager.executeWithFallback('getObject', (client) =>
    client.getObject({ id: pkgId, options: { showBcs: true } })
  );

  const bcsData = pkg.data?.bcs as any;
  if (!bcsData || bcsData.dataType !== 'package') {
    console.error('No package BCS');
    return;
  }

  const moduleBase64 = bcsData.moduleMap['liquidate'];
  const buffer = Buffer.from(moduleBase64, 'base64');
  console.log(`Bytecode size for liquidate module: ${buffer.length} bytes`);

  // Find all ASCII strings of length >= 3
  const strings: string[] = [];
  let current = '';
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    if (byte >= 32 && byte <= 126) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length >= 3) {
        strings.push(current);
      }
      current = '';
    }
  }
  console.log('Strings in module:', [...new Set(strings)]);
}

inspectBytecode().catch(console.error);
