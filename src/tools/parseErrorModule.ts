import { rpcManager } from '../client/suiClient.js';

async function parseModuleCalls() {
  const pkgId = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805';
  const pkg = await rpcManager.executeWithFallback('getObject', (client) =>
    client.getObject({ id: pkgId, options: { showBcs: true } })
  );

  const bcsData = pkg.data?.bcs as any;
  const moduleBase64 = bcsData.moduleMap['liquidate'];
  const buffer = Buffer.from(moduleBase64, 'base64');

  // Let's check the error constants in the error module or whitelist module in the same package
  console.log('All modules in package 0xde5c...:');
  for (const modName of Object.keys(bcsData.moduleMap)) {
    if (modName.includes('whitelist') || modName.includes('error') || modName.includes('evaluator')) {
      console.log('Relevant module:', modName);
    }
  }

  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: pkgId })
  );

  const errorMod = pkgNorm['error'];
  if (errorMod) {
    console.log('Error function names:', Object.keys(errorMod.exposedFunctions).sort());
  }

  // To find which error function corresponds to 770, let's search byte instructions in error module
  // In Move bytecode, an error function that returns a u64 constant has:
  // ldc <const_idx> or ldu64 <value> followed by ret
  // In bytecode: 0x0c <u64_le> 0x2a (ld_u64, ret) or 0x05 <u8_idx> 0x2a (ld_const, ret)
  if (bcsData.moduleMap['error']) {
    const errBuf = Buffer.from(bcsData.moduleMap['error'], 'base64');
    for (let i = 0; i < errBuf.length - 1; i++) {
      if (errBuf[i] === 0x02 && errBuf[i + 1] === 0x03) {
        console.log(`Found 770 at byte ${i}`);
        // Let's print surrounding bytes
        const start = Math.max(0, i - 50);
        const end = Math.min(errBuf.length, i + 50);
        console.log(`Context at ${i}:`, errBuf.subarray(start, end).toString('latin1').replace(/[^\x20-\x7E]/g, '.'));
      }
    }
  }
}

parseModuleCalls().catch(console.error);
