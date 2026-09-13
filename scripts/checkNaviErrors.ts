import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG } from '../src/config/constants.js';

async function run() {
  const mod = await suiClient.getNormalizedMoveModule({
    package: NAVI_CONFIG.packageId,
    module: 'error',
  });

  for (const fn of Object.keys(mod.exposedFunctions)) {
    const tx = new Transaction();
    tx.moveCall({
      target: `${NAVI_CONFIG.packageId}::error::${fn}`,
    });
    try {
      const res = await suiClient.devInspectTransactionBlock({
        transactionBlock: tx,
        sender: '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d',
      });
      const val = res.results?.[0]?.returnValues?.[0]?.[0];
      if (val) {
        // Parse u64 from little endian bytes
        const num = new DataView(new Uint8Array(val).buffer).getBigUint64(0, true);
        console.log(`${fn}: ${num}`);
      }
    } catch (e: any) {
      // ignore
    }
  }
}

run().catch(console.error);
