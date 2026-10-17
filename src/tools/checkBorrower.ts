import { SuiClientManager } from '../client/suiClient.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { pythService } from '../oracles/pythService.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';

async function checkBorrower() {
  await pythService.fetchLatestPrices();
  await naviProtocol.initialize();
  const state1 = await naviIndexer.refreshBorrowerState('0x01eeeeb3000e01b6cfd60d20f95c97f66a13bef90214689050964c3185eec991');
  const state2 = await naviIndexer.refreshBorrowerState('0xbab1d9269384c281caae9a67317db8d784d94ec52cd65a7e139f41a7136c662b');

  if (state1) {
    HealthFactorEngine.evaluateObligation(state1);
    console.log('Borrower 1 HF:', state1.healthFactor);
    console.log('Borrower 1 debts:', state1.debts.map(d => ({ symbol: d.symbol, amount: d.amount.toString(), coinType: d.coinType, valueUsd: d.valueUsd })));
    console.log('Borrower 1 collaterals:', state1.collaterals.map(c => ({ symbol: c.symbol, amount: c.amount.toString(), coinType: c.coinType, valueUsd: c.valueUsd })));
  }

  if (state2) {
    HealthFactorEngine.evaluateObligation(state2);
    console.log('Borrower 2 HF:', state2.healthFactor);
    console.log('Borrower 2 debts:', state2.debts.map(d => ({ symbol: d.symbol, amount: d.amount.toString(), coinType: d.coinType, valueUsd: d.valueUsd })));
    console.log('Borrower 2 collaterals:', state2.collaterals.map(c => ({ symbol: c.symbol, amount: c.amount.toString(), coinType: c.coinType, valueUsd: c.valueUsd })));
  }
}

checkBorrower().catch(console.error);
