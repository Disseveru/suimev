import { Scallop } from '@scallop-io/sui-scallop-sdk';
import { SCALLOP_CONFIG } from '../src/config/constants.js';

async function main() {
  const sdk = new Scallop({
    addressId: SCALLOP_CONFIG.addressId,
    networkType: 'mainnet',
  });
  await sdk.init();
  const builder = await sdk.createScallopBuilder();
  const tx = builder.createTxBlock();
  
  console.log('Available txBlock properties:', Object.keys(tx));
  if (typeof (tx as any).updateAssetPricesQuick === 'function') {
    console.log('Found updateAssetPricesQuick!');
    try {
      await (tx as any).updateAssetPricesQuick(['sui', 'usdc']);
      console.log('updateAssetPricesQuick succeeded! Commands:', (tx.txBlock as any)?.blockData?.transactions?.length);
    } catch (e: any) {
      console.error('updateAssetPricesQuick error:', e.message);
    }
  }
}

main().catch(console.error);
