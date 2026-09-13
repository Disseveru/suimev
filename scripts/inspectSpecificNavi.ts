import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';

async function run() {
  await naviProtocol.initialize();
  const candidates = [
    '0x4202f211420c600fbc07fbe0744b16b31d833a999cb17c72b3fa129c58263b04',
    '0x84e1b26743c563fe60eb44ae56c2dd4193d9ef931159e8dbfefe365093552298',
    '0x09ec154d6689230ff9be88a5b3820d1656b72477bed7de7cc9ab0d730c51767d',
  ];
  for (const addr of candidates) {
    console.log('\n--- Target:', addr);
    const state = await naviIndexer.refreshBorrowerState(addr);
    if (!state) continue;
    HealthFactorEngine.evaluateObligation(state);
    console.log('HF:', state.healthFactor);
    console.log('Total Col:', state.totalCollateralUsd);
    console.log('Total Debt:', state.totalDebtUsd);
    console.log('Collaterals:', state.collaterals.map(c => `${c.symbol}: ${c.amount} ($${c.valueUsd})`));
    console.log('Debts:', state.debts.map(d => `${d.symbol}: ${d.amount} ($${d.valueUsd})`));
    const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
    console.log('Opp:', opp ? {
      repay: `${opp.debtAmountToRepay} ${opp.debtSymbol} ($${opp.debtRepayUsd})`,
      seize: `${opp.collateralToReceive} ${opp.collateralSymbol} ($${opp.collateralReceiveUsd})`,
      grossProfit: opp.expectedGrossProfitUsd
    } : 'None');
  }
}

run().catch(console.error);
