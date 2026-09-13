import { Scallop } from '@scallop-io/sui-scallop-sdk';
import { SCALLOP_CONFIG } from '../src/config/constants.js';

async function main() {
  const sdk = new Scallop({
    addressId: SCALLOP_CONFIG.addressId,
    networkType: 'mainnet',
  });
  await sdk.init();
  console.log('sdk keys:', Object.keys(sdk));
  console.log('sdk proto keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(sdk)));
}

main().catch(console.error);
