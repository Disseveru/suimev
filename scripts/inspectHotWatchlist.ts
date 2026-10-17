import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { pythService } from '../src/oracles/pythService.js';
import { obligationRegistry } from '../src/engine/registry.js';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../src/protocols/dex/deepbookRouter.js';

async function main() {
  await naviProtocol.initialize();
  await scallopProtocol.initialize();
  await CetusRouter.syncDynamicPools();
  await pythService.start(1000);

  await naviIndexer.discoverBorrowersFromHistory(50);
  await scallopIndexer.discoverObligationsFromHistory(50);

  const hot = obligationRegistry.getHotWatchlist();
  console.log(`\n=== HOT WATCHLIST ACCOUNTS (Total: ${hot.length}) ===`);
  for (const h of hot) {
    console.log(`\nAccount: ${h.obligationId} (${h.protocol})`);
    console.log(`  HF: ${h.healthFactor.toFixed(4)} | Debt: $${h.totalDebtUsd.toFixed(2)} | Collateral: $${h.totalCollateralUsd.toFixed(2)}`);
    console.log(`  Collaterals: ${h.collaterals.map(c => `${c.symbol} ($${c.valueUsd.toFixed(2)})`).join(', ')}`);
    console.log(`  Debts: ${h.debts.map(d => `${d.symbol} ($${d.valueUsd.toFixed(2)})`).join(', ')}`);
    for (const d of h.debts) {
      for (const c of h.collaterals) {
        const hasCetus = CetusRouter.hasPool(c.coinType, d.coinType);
        const hasDeepBook = DeepBookRouter.hasPool(c.coinType, d.coinType);
        console.log(`    Route ${c.symbol} -> ${d.symbol}: Cetus=${hasCetus}, DeepBook=${hasDeepBook}`);
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);
