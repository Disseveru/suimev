import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const txs = await client.queryTransactionBlocks({
    filter: { ChangedObject: '0xd726651e0ef603ac13eaa7c165cd0a192fc6434cc00976c9220459044775a093' },
    limit: 3,
    order: 'descending',
    options: { showInput: true, showEffects: true }
  });
  console.log(`Found ${txs.data.length} transactions mutating usdy feedObject:`);
  for (const t of txs.data) {
    console.log('Digest:', t.digest, 'Sender:', t.transaction?.data?.sender, 'Timestamp:', t.timestampMs);
  }
}

main().catch(console.error);
