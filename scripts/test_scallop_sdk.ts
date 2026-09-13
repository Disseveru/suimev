import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';

async function testScallop() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  console.log('Scallop SDK instance initialized:', !!sdk);
  if (sdk) {
    const query = await sdk.createScallopQuery();
    await query.init();
    const fees = await query.getFlashLoanFees();
    console.log('Scallop on-chain flash loan fees:', fees);
  }
}
testScallop().catch(console.error);
