import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { pythService } from '../oracles/pythService.js';

async function test() {
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const builder = await sdk.createScallopBuilder();
  const scallopTx = builder.createTxBlock();
  await scallopTx.updateAssetPricesQuick(['sui', 'usdy', 'sbusdt', 'usdsui', 'usdc']);
  const cmds = scallopTx.txBlock.getData().commands;
  console.log('Commands count:', cmds.length);
  cmds.forEach((c: any, i: number) => {
    console.log(`[Command ${i}]`, c.$kind, c.target || (c.MoveCall && c.MoveCall.target) || JSON.stringify(c));
  });
}

test().catch(console.error);
