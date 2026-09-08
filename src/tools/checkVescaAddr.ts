import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function checkVescaAddr() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;

  const addr = sdk.client.address;
  console.log('vesca.subsTable:    ', addr.get('vesca.subsTable'));
  console.log('vesca.subsWhitelist:', addr.get('vesca.subsWhitelist'));
}

checkVescaAddr().catch(console.error);
