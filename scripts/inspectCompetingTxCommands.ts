import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const tx = await suiClient.getTransactionBlock({
    digest: 'D77TA3j8ZDfe8KUgomeSCykcQpAPv7SFghM9cEweeXHy',
    options: {
      showInput: true,
    }
  });
  const inputs = (tx.transaction?.data as any)?.transaction?.inputs || [];
  [0, 12, 18, 24, 25, 29, 30, 31, 32, 33, 34, 35, 36].forEach(idx => {
    console.log(`Input ${idx}:`, JSON.stringify(inputs[idx]));
  });
  const transactions = (tx.transaction?.data as any)?.transaction?.transactions || [];
  for (let i = 0; i < transactions.length; i++) {
    console.log(`Command ${i}:`, JSON.stringify(transactions[i]));
  }
}

main().catch(console.error);
