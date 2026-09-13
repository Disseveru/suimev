import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../src/protocols/dex/deepbookRouter.js';
import { priceCache } from '../src/oracles/priceCache.js';

const addrs = [
  '0xbdabb158b96e26b2f981d818bf2874359058f8158830981eaf87f73b2d529f6e',
  '0x84e1b26743c563fe60eb44ae56c2dd4193d9ef931159e8dbfefe365093552298',
  '0x4202f211420c600fbc07fbe0744b16b31d833a999cb17c72b3fa129c58263b04',
  '0x553c6c9d9ad3d07c02a75ef8c24f64cc71736ba558f3b35a96b992e1ffa33504',
  '0x09ec154d6689230ff9be88a5b3820d1656b72477bed7de7cc9ab0d730c51767d',
];

async function main() {
  await naviProtocol.initialize();
  for (const addr of addrs) {
    const state = await naviIndexer.refreshBorrowerState(addr);
    if (!state) continue;
    HealthFactorEngine.evaluateObligation(state);
    console.log(`\n=== NAVI Borrower ${addr} ===`);
    console.log(`HF: ${state.healthFactor.toFixed(4)} | Total Col: $${state.totalCollateralUsd.toFixed(2)} | Total Debt: $${state.totalDebtUsd.toFixed(2)}`);
    console.log('Collaterals:', state.collaterals.map(c => `${c.symbol} (${c.amount}) = $${c.valueUsd.toFixed(2)}`));
    console.log('Debts:', state.debts.map(d => `${d.symbol} (${d.amount}) = $${d.valueUsd.toFixed(2)}`));
    for (const d of state.debts) {
      for (const c of state.collaterals) {
        const cetus = CetusRouter.hasPool(c.coinType, d.coinType);
        const deep = DeepBookRouter.hasPool(c.coinType, d.coinType);
        const same = c.coinType.toLowerCase() === d.coinType.toLowerCase();
        console.log(`  Pair ${c.symbol} -> ${d.symbol}: Cetus=${cetus}, Deep=${deep}, Same=${same}, colPrice=${priceCache.getPriceUsd(c.coinType)}, debtPrice=${priceCache.getPriceUsd(d.coinType)}`);
      }
    }
    const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
    console.log('Opportunity found:', opp ? `${opp.debtAmountToRepay} ${opp.debtSymbol} -> ${opp.collateralToReceive} ${opp.collateralSymbol} (profit $${opp.expectedGrossProfitUsd.toFixed(2)})` : 'NONE');
  }
}

main().catch(console.error);
