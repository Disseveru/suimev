import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function checkVescaAddr() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;

  const addr = sdk.client.address;
  console.log('vesca.subsTable:             ', addr.get('vesca.subsTable'));
  console.log('vesca.subsWhitelist:         ', addr.get('vesca.subsWhitelist'));
  console.log('borrowIncentive.id:          ', addr.get('borrowIncentive.id'));
  console.log('borrowIncentive.config:      ', addr.get('borrowIncentive.config'));
  console.log('borrowIncentive.incentivePools:    ', addr.get('borrowIncentive.incentivePools'));
  console.log('borrowIncentive.incentiveAccounts: ', addr.get('borrowIncentive.incentiveAccounts'));
}

checkVescaAddr().catch(console.error);
