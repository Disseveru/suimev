import { obligationRegistry } from '../engine/registry.js';
import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';

async function printDetails() {
  await scallopProtocol.initialize();
  scallopIndexer.onObligationUpdate(s => obligationRegistry.upsertObligation(s));
  await scallopIndexer.discoverObligationsFromHistory();

  const obls = obligationRegistry.getAllObligations();
  const target = obls.find(o => o.obligationId === '0x31d948e46ab270e0a19b3e98869c50608aea41933fd1c2aa74c4ac23baccab41');
  if (target) {
    console.log('=== Target Collaterals ===');
    for (const c of target.collaterals) {
      console.log(c.symbol, c.coinType, c.amount.toString());
    }
    console.log('=== Target Debts ===');
    for (const d of target.debts) {
      console.log(d.symbol, d.coinType, d.amount.toString());
    }
  }

  const target2 = obls.find(o => o.obligationId === '0x8d3baf0278d47eca6356b894e0b9b7e49f572e7ca7d77086c6a903d00c2a3cde');
  if (target2) {
    console.log('\n=== Target2 Collaterals ===');
    for (const c of target2.collaterals) {
      console.log(c.symbol, c.coinType, c.amount.toString());
    }
    console.log('=== Target2 Debts ===');
    for (const d of target2.debts) {
      console.log(d.symbol, d.coinType, d.amount.toString());
    }
  }
}

printDetails().catch(console.error);
