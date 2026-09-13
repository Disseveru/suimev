import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import { PreFlightSimulator } from '../engine/simulator.js';
import { ScallopPtbBuilder } from '../protocols/scallop/scallopPtb.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';

async function test() {
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) throw new Error('No Scallop SDK');

  const oblId = '0xf30c0a48e931cb597ce498c2fbbeafa6ae2c385090c819c2d98c703622bb464c';
  console.log(`Refreshing obligation state for ${oblId}...`);
  const oblState = await scallopIndexer.refreshObligationState(oblId);
  if (!oblState) {
    console.error('Could not load obligation state');
    return;
  }

  const calculated = HealthFactorEngine.evaluateObligation(oblState);
  console.log('\n=== HEALTH FACTOR ===');
  console.log('Calculated Health Factor:', calculated.healthFactor);
  console.log('Total Debt USD:', calculated.totalDebtUsd);
  console.log('Total Collateral USD:', calculated.totalCollateralUsd);

  const opp = HealthFactorEngine.findBestLiquidationOpportunity(calculated);
  if (!opp) {
    console.log('No liquidation opportunity found');
    return;
  }

  console.log('\n=== LIQUIDATION OPPORTUNITY ===', {
    debtSymbol: opp.debtSymbol,
    repayAmount: opp.debtAmountToRepay.toString(),
    collateralSymbol: opp.collateralSymbol,
    seizeAmount: opp.collateralToReceive.toString(),
    estimatedProfitUsd: opp.expectedGrossProfitUsd,
  });

  const builder = await sdk.createScallopBuilder();
  const allCoinTypes = [
    ...oblState.debts.map(d => d.coinType),
    ...oblState.collaterals.map(c => c.coinType),
  ];

  const coinNamesSet = new Set<string>();
  for (const cType of allCoinTypes) {
    try {
      const name = builder.utils.parseCoinNameFromType(cType);
      if (name) coinNamesSet.add(name);
    } catch {
      // ignore
    }
  }
  const coinsToUpdate = Array.from(coinNamesSet);
  console.log(`\nPrepending oracle updates for ALL obligation coins: ${coinsToUpdate.join(', ')}...`);

  const scallopTx = builder.createTxBlock();
  await scallopTx.updateAssetPricesQuick(coinsToUpdate, { isSponsoredTx: false });

  const isLocked = await scallopProtocol.isObligationLocked(oblId);
  console.log(`Obligation locked: ${isLocked}`);
  if (isLocked) {
    ScallopPtbBuilder.addForceUnstakeUnhealthy(scallopTx.txBlock, oblId);
  }

  const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp, scallopTx.txBlock);
  console.log(`Total commands in PTB: ${built.tx.getData().commands.length}`);

  console.log('Running PreFlightSimulator...');
  const sim = await PreFlightSimulator.simulate(built.tx, opp);
  console.log('\n=== SIMULATION RESULT ===');
  console.log('Success:', sim.success);
  console.log('Net Profit USD:', sim.netProfitUsd);
  console.log('Gas Used SUI:', sim.gasUsedSui);
  console.log('Error Message:', sim.errorMessage);
  if ((sim as any).rawSimulationResult) {
    console.log('Effects status:', JSON.stringify((sim as any).rawSimulationResult.effects?.status, null, 2));
  }
}

test().catch(console.error);
