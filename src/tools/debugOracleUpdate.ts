import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { SuiClientManager } from '../client/suiClient.js';

async function run() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) {
    console.error('No Scallop SDK');
    return;
  }
  const builder = await sdk.createScallopBuilder();
  const scallopTx = builder.createTxBlock();
  
  console.log('Calling updateAssetPricesQuick for sui, usdt...');
  try {
    await scallopTx.updateAssetPricesQuick(['sui', 'usdt'], { isSponsoredTx: false });
    console.log('Success! Commands count:', scallopTx.txBlock.getData().commands.length);
    console.log('Commands:', JSON.stringify(scallopTx.txBlock.getData().commands, null, 2));
  } catch (err: any) {
    console.error('Error in updateAssetPricesQuick:', err.message || err);
  }
}

run().catch(console.error);
