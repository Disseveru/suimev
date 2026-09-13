import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';

async function run() {
  await naviProtocol.initialize();
  const ids = [
    '0x58fc3ca255bfd18f9017906a661b8371b861b350ccc0146a19b1f48e5cf203ef',
    '0x1cc62ca8fed8ea5e441ccf11e323c6236699aabb1211fc3b06c1e5ee240a3a5c',
    '0x4452241481d1b1254864eb644c4e513c1d89d522166edf7567e0b0704a147078',
  ];

  for (const id of ids) {
    console.log(`\n=== INSPECTING NAVI WHALE: ${id} ===`);
    const state = await naviIndexer.refreshBorrowerState(id);
    if (!state) {
      console.log('Could not refresh state');
      continue;
    }
    console.log('Debts:', state.debts);
    console.log('Collaterals:', state.collaterals);
    console.log('Health Factor:', state.healthFactor);
    console.log('Total Debt USD:', state.totalDebtUsd);
    console.log('Total Collateral USD:', state.totalCollateralUsd);

    const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
    console.log('Opportunity:', opp);
  }
}

run().catch(console.error);
