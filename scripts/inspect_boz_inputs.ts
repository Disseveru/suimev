import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const tx = await client.getTransactionBlock({
    digest: 'Boz4F7sZ7cRBHNfMNnip5pmwzMSseQrsh9rKxyC7e3ec',
    options: { showInput: true }
  });
  const inputs = (tx.transaction?.data as any)?.transaction?.inputs || [];
  inputs.forEach((inp: any, idx: number) => {
    if (inp.type === 'pure') {
      console.log(`Input ${idx}: pure (${inp.valueType})`);
    } else {
      console.log(`Input ${idx}: object ${inp.objectId}`);
    }
  });
}

main().catch(console.error);
