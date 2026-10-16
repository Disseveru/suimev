import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const digest = '6VwYU66TUsLcTGtcaZHns4F8hoUcNJf6yN4CjLZhoTUp';
  const tx = await suiClient.getTransactionBlock({
    digest,
    options: { showEffects: true, showEvents: true, showBalanceChanges: true },
  });

  console.log('Digest:', tx.digest);
  console.log('Status:', tx.effects?.status?.status);
  console.log('Checkpoint:', tx.checkpoint);
  console.log('Timestamp:', tx.timestampMs ? new Date(Number(tx.timestampMs)).toISOString() : 'N/A');
  console.log('Total Events:', tx.events?.length);
  for (const ev of tx.events || []) {
    console.log('\n--- Event:', ev.type);
    console.log(JSON.stringify(ev.parsedJson, null, 2));
  }
}

main().catch(console.error);
