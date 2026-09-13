import { suiClient } from '../client/suiClient.js';

async function main() {
  const digest = 'AgAVzB9Q9ASLsK1igG8CjH8WYvW3WmFjHKGpkcM16vW5';
  const tx = await suiClient.getTransactionBlock({
    digest,
    options: {
      showInput: true,
      showEffects: true,
      showBalanceChanges: true,
    }
  });

  console.log('Transaction Data:', JSON.stringify(tx.transaction?.data, null, 2));
}

main().catch(console.error);
