import { pythService } from '../src/oracles/pythService.js';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';

const targetIds = [
  '0xbd420b2f97d48c763181a4dc34a9041050b5e3bac1565c54b385ec29f3e72a1b',
  '0x5b5e1a6493c4555d0ba7fb1a4f60e1daafb6a83fb28ffba356d6229dd0b32838',
  '0xd76c6e3ffbf23368e1db6bf5e243e6a093da329b7c0142e37ddc3f42ebdb9cc4',
  '0x55383932f15e89f86b6789ccbdb3b1d1be2a3d5b74c1e63c71d0cd76701ce5e7',
  '0x013fa56990d33accd2567c2dbad43d7d50a9ea0ee7c458192d54dfa77045ed26',
  '0x362a04f5c498249c34b046acd57238a12a64deb510db769c121fdcfad5288d77',
];

async function run() {
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();

  for (const id of targetIds) {
    console.log(`\n=== ID: ${id} ===`);
    const state = await scallopIndexer.refreshObligationState(id);
    if (!state) continue;
    HealthFactorEngine.evaluateObligation(state);
    console.log(`HF: ${state.healthFactor.toFixed(4)}, Col: $${state.totalCollateralUsd.toFixed(2)}, Debt: $${state.totalDebtUsd.toFixed(2)}`);
    console.log('Collaterals:');
    for (const c of state.collaterals) {
      console.log(`  symbol: ${c.symbol}, coinType: ${c.coinType}, amount: ${c.amount}, valueUsd: $${c.valueUsd.toFixed(2)}`);
    }
    console.log('Debts:');
    for (const d of state.debts) {
      console.log(`  symbol: ${d.symbol}, coinType: ${d.coinType}, amount: ${d.amount}, valueUsd: $${d.valueUsd.toFixed(2)}`);
    }
  }
}

run().catch(console.error);
