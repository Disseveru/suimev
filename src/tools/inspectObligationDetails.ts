import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function inspectScallopHealth() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;

  const query = await sdk.createScallopQuery();

  const id1 = '0x31d948e46ab270e0a19b3e98869c50608aea41933fd1c2aa74c4ac23baccab41';
  const id2 = '0x8d3baf0278d47eca6356b894e0b9b7e49f572e7ca7d77086c6a903d00c2a3cde';

  for (const id of [id1, id2]) {
    console.log(`\n--- Inspecting Obligation ${id} ---`);
    try {
      const obl = await query.queryObligation(id);
      console.log('Obligation Keys:', Object.keys(obl || {}));
      console.log('Raw Obligation:', JSON.stringify(obl, null, 2).slice(0, 500));
    } catch (e: any) {
      console.error('Error querying obligation:', e.message);
    }
  }
}

inspectScallopHealth().catch(console.error);
