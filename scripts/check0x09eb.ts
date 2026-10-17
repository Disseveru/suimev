import * as navi from '@naviprotocol/lending';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { pythService } from '../src/oracles/pythService.js';

async function main() {
  await naviProtocol.initialize();
  await pythService.start(1000);

  const borrower = '0x09eb6ca0add5a9d563f281fdd3a0378b596b1eea5265f830ff80851febb94e72';
  console.log('Inspecting borrower:', borrower);
  const state = await naviIndexer.refreshBorrowerState(borrower);
  if (!state) {
    console.log('No state returned');
    return;
  }
  console.log('Health factor:', state.healthFactor);
  console.log('Total Collateral USD:', state.totalCollateralUsd);
  console.log('Total Debt USD:', state.totalDebtUsd);
  console.log('Collaterals:', state.collaterals);
  console.log('Debts:', state.debts);
  console.log('Is liquidatable:', state.isLiquidatable);
}

main().catch(console.error);
