import { obligationRegistry } from '../src/engine/registry.js';
import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { pythService } from '../src/oracles/pythService.js';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';

async function main() {
  await naviProtocol.initialize();
  await scallopProtocol.initialize();
  await CetusRouter.syncDynamicPools();
  await pythService.start(1000);

  console.log('Discovering NAVI borrowers from history...');
  await naviIndexer.discoverBorrowersFromHistory(50);

  console.log('Discovering Scallop obligations...');
  await scallopIndexer.discoverObligationsFromHistory(50);

  const immediate = obligationRegistry.getImmediateTargets();
  const hot = obligationRegistry.getHotWatchlist();
  const all = obligationRegistry.getAllObligations();

  console.log('Total Monitored Obligations:', all.length);
  console.log('Immediate Targets (HF < 1.0):', immediate.length);
  for (const t of immediate) {
    console.log(`- [${t.protocol}] ID: ${t.obligationId} | HF: ${t.healthFactor.toFixed(4)} | Debt: $${t.totalDebtUsd.toFixed(2)} | Col: $${t.totalCollateralUsd.toFixed(2)}`);
  }

  console.log('Hot Watchlist (1.0 <= HF < 1.07):', hot.length);
  for (const h of hot.slice(0, 10)) {
    console.log(`- [${h.protocol}] ID: ${h.obligationId} | HF: ${h.healthFactor.toFixed(4)} | Debt: $${h.totalDebtUsd.toFixed(2)} | Col: $${h.totalCollateralUsd.toFixed(2)}`);
  }

  process.exit(0);
}

main().catch(console.error);
