import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const obj = await client.getObject({
    id: '0xf6de1d3279a269a597d813cbaca59aa906543ab9a8c64e84a4722f1a20863985',
    options: { showType: true }
  });
  console.log('0xf6de type:', obj.data?.type);
}

main().catch(console.error);
