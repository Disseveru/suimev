import { Transaction } from '@mysten/sui/transactions';
import * as navi from '@naviprotocol/lending';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { pythService } from '../src/oracles/pythService.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { PreFlightSimulator } from '../src/engine/simulator.js';

async function run() {
  await pythService.fetchLatestPrices();
  await naviProtocol.initialize();

  const targetAddress = '0x4202f211420c600fbc07fbe0744b16b31d833a999cb17c72b3fa129c58263b04';
  const state = await naviIndexer.refreshBorrowerState(targetAddress);
  if (!state) {
    console.log('Could not refresh state');
    return;
  }
  HealthFactorEngine.evaluateObligation(state);

  const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
  if (!opp) {
    console.log('No opportunity found');
    return;
  }

  console.log('Target:', opp.obligation.obligationId);
  console.log('Health Factor:', state.healthFactor);
  console.log(`Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol} ($${opp.debtRepayUsd})`);
  console.log(`Seize: ${opp.collateralToReceive} ${opp.collateralSymbol} ($${opp.collateralReceiveUsd})`);

  // Create tx and prepend NAVI oracle price update!
  const tx = new Transaction();
  const poolList = await (navi as any).getPools();
  console.log('Prepending NAVI oracle updates to PTB...');
  await (navi as any).updateOraclePriceBeforeUserOperationPTB(
    tx,
    targetAddress,
    poolList
  );

  console.log('Building liquidation PTB...');
  const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp, tx);

  console.log('Running pre-flight simulation (devInspect)...');
  const sim = await PreFlightSimulator.simulate(built.tx, opp);
  console.log('Simulation Success:', sim.success);
  console.log('Net Profit USD:', sim.netProfitUsd);
  if (!sim.success) {
    console.log('Simulation Error:', sim.errorMessage);
  } else {
    console.log('🎉 SIMULATION PASSED CLEANLY ON MAINNET!');
  }
}

run().catch(console.error);
