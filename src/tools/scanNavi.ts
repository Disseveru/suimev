import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { obligationRegistry } from '../engine/registry.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';

async function scanNavi() {
  console.log('Scanning NAVI for liquidatable accounts...');
  await pythService.fetchLatestPrices();
  await naviProtocol.initialize();

  naviIndexer.onObligationUpdate((s) => obligationRegistry.upsertObligation(s));
  await naviIndexer.discoverBorrowersFromHistory();

  const obligations = obligationRegistry.getAllObligations().filter(o => o.protocol === 'navi');
  console.log(`Discovered ${obligations.length} NAVI obligations`);

  for (const obl of obligations) {
    console.log(`NAVI Borrower: ${obl.obligationId} | HF: ${obl.healthFactor.toFixed(4)} | Collateral: $${obl.totalCollateralUsd.toFixed(2)} | Debt: $${obl.totalDebtUsd.toFixed(2)}`);
  }

  const targets = obligationRegistry.getImmediateTargets().filter(o => o.protocol === 'navi');
  console.log(`Liquidatable NAVI targets: ${targets.length}`);
}

scanNavi().catch(console.error);
