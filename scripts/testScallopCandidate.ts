import chalk from 'chalk';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { PreFlightSimulator } from '../src/engine/simulator.js';
import { TransactionExecutor } from '../src/engine/executor.js';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';
import { DeepBookRouter } from '../src/protocols/dex/deepbookRouter.js';
import { priceCache } from '../src/oracles/priceCache.js';

async function main() {
  await scallopProtocol.initialize();
  const id = '0xbd420b2f97d48c763181a4dc34a9041050b5e3bac1565c54b385ec29f3e72a1b';
  const query = await (scallopProtocol.getSdk() as any).createScallopQuery();
  const acc = await query.getObligationAccountById(id);
  console.log('Scallop query account:', JSON.stringify(acc, null, 2));

  const state = await scallopIndexer.refreshObligationState(id);
  console.log('State:', JSON.stringify(state, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));

  if (state) {
    HealthFactorEngine.evaluateObligation(state);
    console.log('Evaluated HF:', state.healthFactor);

    for (const targetDebt of state.debts) {
      for (const targetCollateral of state.collaterals) {
        console.log(`Pair: ${targetCollateral.symbol} (${targetCollateral.coinType}) -> ${targetDebt.symbol} (${targetDebt.coinType})`);
        console.log('  CetusRouter.hasPool:', CetusRouter.hasPool(targetCollateral.coinType, targetDebt.coinType));
        console.log('  DeepBookRouter.hasPool:', DeepBookRouter.hasPool(targetCollateral.coinType, targetDebt.coinType));
        console.log('  colPrice:', priceCache.getPriceUsd(targetCollateral.coinType));
        console.log('  debtPrice:', priceCache.getPriceUsd(targetDebt.coinType));
      }
    }

    const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
    console.log('Opp:', opp);
    if (opp) {
      console.log('Building PTB...');
      const built = await ZeroCapitalPtbBuilder.buildLiquidationPTBAsync(opp);
      console.log('Simulating...');
      const sim = await PreFlightSimulator.simulate(built.tx, opp);
      console.log('Sim result:', sim);
      if (sim.success) {
        console.log(chalk.bold.green('🚀 SIMULATION PASSED! EXECUTING LIVE!'));
        const res = await TransactionExecutor.execute(built.tx, opp, sim.netProfitUsd);
        console.log('Live execution result:', res);
      }
    }
  }
}

main().catch(console.error);
