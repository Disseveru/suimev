import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { pythService } from '../oracles/pythService.js';
import { priceCache } from '../oracles/priceCache.js';

async function run() {
  await pythService.fetchLatestPrices();
  await naviProtocol.initialize();
  
  const target = await naviIndexer.refreshBorrowerState('0xab87fea547114092c0abb613bd4348ae5af436b9f684f5f17e853bf18de7ce25');
  
  if (target) {
    console.log('--- TARGET OBLIGATION ---');
    console.log('Debts:', target.debts);
    console.log('Collaterals:', target.collaterals);
    console.log('Total Collateral USD:', target.totalCollateralUsd);
    console.log('Total Debt USD:', target.totalDebtUsd);
    console.log('Liquidation Threshold USD:', target.liquidationThresholdCollateralUsd);
    console.log('Health Factor:', target.healthFactor);
    console.log('isSuiEmode logic:', target.collaterals.every(c => ['SUI','VSUI','HASUI','AFSUI'].includes(c.symbol.toUpperCase())) && target.debts.every(d => ['SUI','VSUI','HASUI','AFSUI'].includes(d.symbol.toUpperCase())));
  } else {
    console.log('Target not found in liquidatable accounts.');
  }
}
run();
