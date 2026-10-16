import * as navi from '@naviprotocol/lending';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../src/protocols/dex/deepbookRouter.js';
import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { pythService } from '../src/oracles/pythService.js';

async function main() {
  await naviProtocol.initialize();
  await pythService.start(1000);
  await CetusRouter.syncDynamicPools();

  const addrs = [
    '0x01eeeeb3000e01b6cfd60d20f95c97f66a13bef90214689050964c3185eec991',
    '0xbab1d9269384c281caae9a67317db8d784d94ec52cd65a7e139f41a7136c662b'
  ];

  for (const addr of addrs) {
    console.log('\n======================================================');
    console.log('Evaluating borrower:', addr);
    const state = await naviIndexer.refreshBorrowerState(addr);
    if (!state) {
      console.log('No state returned');
      continue;
    }
    console.log('Health Factor:', state.healthFactor);
    console.log('Total Collateral USD:', state.totalCollateralUsd);
    console.log('Total Debt USD:', state.totalDebtUsd);
    console.log('Collaterals:', state.collaterals.map(c => `${c.symbol}: ${c.amount} (val: $${c.valueUsd})`));
    console.log('Debts:', state.debts.map(d => `${d.symbol}: ${d.amount} (val: $${d.valueUsd})`));

    for (const d of state.debts) {
      for (const c of state.collaterals) {
        const hasCetus = CetusRouter.hasPool(c.coinType, d.coinType);
        const hasDeepBook = DeepBookRouter.hasPool(c.coinType, d.coinType);
        console.log(`Route ${c.symbol} -> ${d.symbol}: Cetus=${hasCetus}, DeepBook=${hasDeepBook}`);
      }
    }

    const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
    console.log('Best liquidation opportunity:', opp ? JSON.stringify(opp, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2) : 'NONE');
  }

  process.exit(0);
}

main().catch(console.error);
