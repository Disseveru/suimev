import { suiClient } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function run() {
  const USDY = '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY';
  console.log('Searching transactions involving USDY coin...');
  const txs = await suiClient.queryTransactionBlocks({
    filter: {
      MoveFunction: {
        package: CETUS_CONFIG.integratePackageId,
        module: 'pool_script',
        function: 'swap',
      },
    },
    options: {
      showInput: true,
      showEffects: true,
    },
    limit: 50,
  });

  console.log(`Examining ${txs.data.length} recent Cetus swaps for USDY...`);
  for (const tx of txs.data) {
    const raw = JSON.stringify(tx);
    if (raw.includes('usdy::USDY') || raw.includes('0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb')) {
      console.log('FOUND TX WITH USDY:', tx.digest);
      // Let's find the pool object ID
      for (const obj of tx.effects?.mutated || []) {
        console.log('  Mutated object:', obj.reference.objectId);
      }
    }
  }
}

run().catch(console.error);
