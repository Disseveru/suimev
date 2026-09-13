import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const tx = await client.getTransactionBlock({
    digest: 'Boz4F7sZ7cRBHNfMNnip5pmwzMSseQrsh9rKxyC7e3ec',
    options: { showInput: true, showEffects: true }
  });
  console.log('Status:', tx.effects?.status);
  const commands = (tx.transaction?.data as any)?.transaction?.transactions || [];
  commands.forEach((c: any, idx: number) => {
    if (c.MoveCall) {
      console.log(`Command ${idx}: MoveCall: ${c.MoveCall.package}::${c.MoveCall.module}::${c.MoveCall.function}`);
    } else {
      console.log(`Command ${idx}:`, Object.keys(c)[0], JSON.stringify(c));
    }
  });
}

main().catch(console.error);
