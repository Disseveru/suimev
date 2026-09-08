import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function testCoinNames() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;

  const targetId = '0x31d948e46ab270e0a19b3e98869c50608aea41933fd1c2aa74c4ac23baccab41';
  const targetId2 = '0x8d3baf0278d47eca6356b894e0b9b7e49f572e7ca7d77086c6a903d00c2a3cde';

  const builder = await sdk.createScallopBuilder();
  const oblData1 = await (builder as any).query.repos.obligation.getObligationData(targetId);
  const types1 = [...oblData1.collaterals.map((c: any) => c.type), ...oblData1.debts.map((d: any) => d.type)];
  const names1 = types1.map((t: string) => (builder as any).utils.parseCoinNameFromType(t));
  console.log('Obligation 1 coin names:', names1);

  const oblData2 = await (builder as any).query.repos.obligation.getObligationData(targetId2);
  const types2 = [...oblData2.collaterals.map((c: any) => c.type), ...oblData2.debts.map((d: any) => d.type)];
  const names2 = types2.map((t: string) => (builder as any).utils.parseCoinNameFromType(t));
  console.log('Obligation 2 coin names:', names2);
}

testCoinNames().catch(console.error);
