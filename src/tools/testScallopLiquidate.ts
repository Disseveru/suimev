import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { obligationRegistry } from '../engine/registry.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import { PreFlightSimulator } from '../engine/simulator.js';
import { Transaction } from '@mysten/sui/transactions';

async function run() {
  console.log('Testing Scallop Liquidation with Oracle Updates...');
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();

  const sdk = scallopProtocol.getSdk();
  if (!sdk) {
    console.error('No Scallop SDK');
    return;
  }
  const builder = await sdk.createScallopBuilder();

  scallopIndexer.onObligationUpdate((state) => obligationRegistry.upsertObligation(state));
  await scallopIndexer.discoverObligationsFromHistory();

  const targets = obligationRegistry.getImmediateTargets();
  console.log(`Found ${targets.length} targets`);

  for (const target of targets) {
    const opp = HealthFactorEngine.findBestLiquidationOpportunity(target);
    if (!opp) continue;
    console.log(`\nEvaluating: ${opp.obligation.obligationId}`);
    console.log(`Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol}, Seize: ${opp.collateralToReceive} ${opp.collateralSymbol}`);

    // Test 1: Standard PTB
    const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp);
    const sim1 = await PreFlightSimulator.simulate(built.tx, opp);
    console.log('Standard PTB simulation:', sim1.success, sim1.errorMessage);

    // Test 2: PTB with Scallop Oracle Updates prepended
    try {
      const scallopTx = builder.createTxBlock();
      // Only update the coins relevant to this liquidation: e.g. debt and collateral
      const coinsToUpdate = [opp.debtSymbol.toLowerCase(), opp.collateralSymbol.toLowerCase()];
      console.log(`Updating oracle prices for: ${coinsToUpdate.join(', ')}...`);
      await scallopTx.updateAssetPricesQuick(coinsToUpdate);
      console.log('Commands in scallopTx.txBlock after update:', scallopTx.txBlock.getData().commands.length);

      // Now build the liquidation PTB on scallopTx.txBlock
      const built2 = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp, scallopTx.txBlock);
      const sim2 = await PreFlightSimulator.simulate(built2.tx, opp);
      console.log('PTB WITH ORACLE UPDATE simulation:', sim2.success);
      if (sim2.success) {
        console.log('🎉 NET PROFIT USD:', sim2.netProfitUsd);
        console.log('Gas used SUI:', sim2.gasUsedSui);
      } else {
        console.log('Error message:', sim2.errorMessage);
      }
    } catch (err) {
      console.error('updateAssetPricesQuick error:', err);
    }
    break; // only test first candidate
  }
}

run().catch(console.error);
