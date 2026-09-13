import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const tx = await suiClient.getTransactionBlock({
    digest: 'D77TA3j8ZDfe8KUgomeSCykcQpAPv7SFghM9cEweeXHy',
    options: {
      showInput: true,
      showEffects: true,
      showEvents: true,
      showBalanceChanges: true,
    }
  });
  console.log('Tx transaction kind:', (tx.transaction?.data as any)?.transaction?.kind);
  console.log('Tx inputs:', JSON.stringify((tx.transaction?.data as any)?.transaction, null, 2).slice(0, 2000));
}

main().catch(console.error);
