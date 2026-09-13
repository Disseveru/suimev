import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { pythService } from '../src/oracles/pythService.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { PreFlightSimulator } from '../src/engine/simulator.js';

async function run() {
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();

  const id = '0x5b5e1a6493c4555d0ba7fb1a4f60e1daafb6a83fb28ffba356d6229dd0b32838';
  const state = await scallopIndexer.refreshObligationState(id);
  if (!state) return;
  HealthFactorEngine.evaluateObligation(state);

  const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
  if (!opp) return;

  console.log('Opportunity:');
  console.log(`  Debt: ${opp.debtSymbol} (${opp.debtAmountToRepay})`);
  console.log(`  Collateral: ${opp.collateralSymbol} (${opp.collateralToReceive})`);

  const built = await ZeroCapitalPtbBuilder.buildLiquidationPTBAsync(opp);
  const txData = (built.tx as any).getData();
  console.log('\nPTB Commands:');
  txData.commands.forEach((cmd: any, idx: number) => {
    console.log(`Command ${idx}:`, Object.keys(cmd)[0], JSON.stringify(cmd));
  });

  const sim = await PreFlightSimulator.simulate(built.tx, opp);
  console.log('\nSimulation:');
  console.log('Success:', sim.success);
  console.log('Error:', sim.errorMessage);
  if (sim.rawEffects) {
    console.log('Status:', JSON.stringify(sim.rawEffects.status));
  }
}

run().catch(console.error);
