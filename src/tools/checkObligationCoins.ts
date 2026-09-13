import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function run() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const builder = await sdk.createScallopBuilder();
  const oblId = '0xf30c0a48e931cb597ce498c2fbbeafa6ae2c385090c819c2d98c703622bb464c';
  const coinNames = await (builder as any).ctx?.reads?.getObligationCoinNames(oblId);
  console.log('Obligation coin names:', coinNames);
}

run().catch(console.error);
