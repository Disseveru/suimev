import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { obligationRegistry } from '../engine/registry.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';
import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import { PreFlightSimulator } from '../engine/simulator.js';

async function main() {
  console.log('Fetching live Pyth prices...');
  await pythService.fetchLatestPrices();

  console.log('Initializing protocol SDKs...');
  await Promise.all([scallopProtocol.initialize(), naviProtocol.initialize()]);

  // Hook indexers to registry
  scallopIndexer.onObligationUpdate(state => obligationRegistry.upsertObligation(state));
  naviIndexer.onObligationUpdate(state => obligationRegistry.upsertObligation(state));

  console.log('Discovering Scallop obligations (up to 30 pages)...');
  await scallopIndexer.discoverObligationsFromHistory(30);

  console.log('Discovering NAVI borrowers (up to 30 pages)...');
  await naviIndexer.discoverBorrowersFromHistory(30);

  const allTargets = obligationRegistry.getImmediateTargets();
  console.log(`\nRegistry evaluation complete. Immediate liquidation targets (HF < 1.0): ${allTargets.length}`);

  for (const target of allTargets) {
    const opp = HealthFactorEngine.findBestLiquidationOpportunity(target);
    if (!opp) {
      console.log(`Skipping target ${target.obligationId} (no valid opportunity or $0 collateral)`);
      continue;
    }

    console.log(`\n========================================`);
    console.log(`EVALUATING TARGET: ${opp.protocol.toUpperCase()} - ${opp.obligation.obligationId}`);
    console.log(`Health Factor: ${target.healthFactor.toFixed(4)}`);
    console.log(`Total Debt: $${target.totalDebtUsd.toFixed(2)}, Total Collateral: $${target.totalCollateralUsd.toFixed(2)}`);
    console.log(`Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol}, Seize: ${opp.collateralToReceive} ${opp.collateralSymbol}`);
    console.log(`Estimated Gross Profit: $${opp.estimatedProfitUsd?.toFixed(2) ?? 'N/A'}`);

    try {
      const ptb = await ZeroCapitalPtbBuilder.buildLiquidationPTBAsync(opp);
      console.log(`Simulating PTB (${ptb.tx.getData().commands.length} commands)...`);
      const sim = await PreFlightSimulator.simulate(ptb.tx, opp);
      console.log(`Simulation Result: ${sim.success ? 'SUCCESS ✅' : 'FAILED ❌'}`);
      if (sim.success) {
        console.log(`🎉 PROFITABLE OPPORTUNITY FOUND!`);
        console.log(`Net Profit USD: $${sim.netProfitUsd.toFixed(2)}`);
        console.log(`Gas Used SUI: ${sim.gasUsedSui.toFixed(6)} SUI`);
        return; // Found a working profitable candidate!
      } else {
        console.log(`Raw Simulation Error: ${sim.errorMessage}`);
      }
    } catch (err: any) {
      console.log(`PTB Build error: ${err.message || err}`);
    }
  }

  // Also check near-liquidation watchlist (HF between 1.00 and 1.05)
  const allObligations = obligationRegistry.getAllObligations();
  const watchlist = allObligations
    .filter(o => o.healthFactor >= 1.0 && o.healthFactor <= 1.05 && o.totalDebtUsd > 10)
    .sort((a, b) => a.healthFactor - b.healthFactor);

  console.log(`\n=== WATCHLIST: Top 5 Near-Liquidation Whales (HF 1.00 - 1.05) ===`);
  for (const w of watchlist.slice(0, 5)) {
    console.log(`[${w.protocol.toUpperCase()}] ID: ${w.obligationId} | HF: ${w.healthFactor.toFixed(4)} | Debt: $${w.totalDebtUsd.toFixed(2)} | Collateral: $${w.totalCollateralUsd.toFixed(2)}`);
  }
}

main().catch(console.error);
