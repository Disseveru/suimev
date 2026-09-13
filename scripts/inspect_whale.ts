import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const whaleObligationId = '0x33fee6c01c25a4925ca053df2c99f0cb9d0c5c4985595b6e8eee5b66ebedb277';
  const obj = await client.getObject({
    id: whaleObligationId,
    options: { showContent: true }
  });
  console.log('Whale Obligation fields:');
  const fields = (obj.data?.content as any)?.fields;
  console.log('collaterals:', JSON.stringify(fields?.collaterals, null, 2));
  console.log('debts:', JSON.stringify(fields?.debts, null, 2));
}

main().catch(console.error);
