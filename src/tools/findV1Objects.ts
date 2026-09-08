import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function findV1() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;

  const addr = sdk.client.address;
  console.log('borrowIncentive addresses in SDK:');
  const all = addr.getAllAddresses();
  console.log('borrowIncentive:', JSON.stringify(all['mainnet']?.['borrowIncentive'], null, 2));
}

findV1().catch(console.error);
