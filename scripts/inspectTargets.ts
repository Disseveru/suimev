import chalk from 'chalk';
import { pythService } from '../src/oracles/pythService.js';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { PreFlightSimulator } from '../src/engine/simulator.js';

const targetIds = [
  '0xbd420b2f97d48c763181a4dc34a9041050b5e3bac1565c54b385ec29f3e72a1b',
  '0x8c4e15e3418f09861c334eee5c8846c4f03932e652438cb2e44d372e5926ec03',
  '0x5b5e1a6493c4555d0ba7fb1a4f60e1daafb6a83fb28ffba356d6229dd0b32838',
  '0xd76c6e3ffbf23368e1db6bf5e243e6a093da329b7c0142e37ddc3f42ebdb9cc4',
  '0x33fee6c01c25a4925ca053df2c99f01fa2eb9321598fef6ae5262c556b6a67f0',
  '0xf30c0a48e931cb597ce498c2fbbe2d7c0897fb9535fc03c4f74955b248a80397',
  '0x9ccc2b9d34d65d547c4d775915bb03df9b4f9c5da75079a49aa5cf9a9be8f9a2',
  '0x149436de0778b5580fa1d6554d2703875883fe9ea95689363a0bbda411bbd727',
  '0xb2ad870bc95dae1d95f643c4bb33423b09fa5a9ebf5e921d7bbf117dcf1fbe4d',
  '0x55383932f15e89f86b6789ccbdb3b1d1be2a3d5b74c1e63c71d0cd76701ce5e7',
  '0x013fa56990d33accd2567c2dbad43d7d50a9ea0ee7c458192d54dfa77045ed26',
  '0x362a04f5c498249c34b046acd57238a12a64deb510db769c121fdcfad5288d77',
];

async function run() {
  console.log(chalk.bold.cyan('Initializing Pyth & Scallop...'));
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();

  for (const id of targetIds) {
    console.log(chalk.yellow(`\n======================================================`));
    console.log(chalk.bold(`Inspecting Obligation: ${id}`));

    const state = await scallopIndexer.refreshObligationState(id);
    if (!state) {
      console.log(chalk.red('Could not fetch or parse obligation state'));
      continue;
    }

    console.log(`Collateral USD: $${state.totalCollateralUsd.toFixed(2)}`);
    console.log(`Debt USD: $${state.totalDebtUsd.toFixed(2)}`);
    console.log(`Health Factor: ${chalk.bold(state.healthFactor.toFixed(4))}`);
    console.log(`Collaterals:`, state.collaterals.map(c => `${c.symbol}: ${c.amount.toString()} ($${c.valueUsd.toFixed(2)})`));
    console.log(`Debts:`, state.debts.map(d => `${d.symbol}: ${d.amount.toString()} ($${d.valueUsd.toFixed(2)})`));

    const isLocked = await scallopProtocol.isObligationLocked(id);
    console.log(`Locked in borrow incentive: ${isLocked ? chalk.red('YES') : chalk.green('NO')}`);

    const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
    if (!opp) {
      console.log(chalk.gray('No viable liquidation opportunity found (e.g. no DEX route or zero profit)'));
      continue;
    }

    console.log(chalk.cyan(`Found Opportunity:`));
    console.log(`  Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol} ($${opp.debtRepayUsd.toFixed(2)})`);
    console.log(`  Seize: ${opp.collateralToReceive} ${opp.collateralSymbol} ($${opp.collateralReceiveUsd.toFixed(2)})`);
    console.log(`  Expected Gross Profit: $${opp.expectedGrossProfitUsd.toFixed(2)}`);

    try {
      console.log(chalk.cyan(`Building PTB...`));
      const built = await ZeroCapitalPtbBuilder.buildLiquidationPTBAsync(opp);
      console.log(chalk.cyan(`Simulating via devInspect...`));
      const sim = await PreFlightSimulator.simulate(built.tx, opp);
      console.log(`Simulation Result: ${sim.success ? chalk.bold.green('SUCCESS') : chalk.bold.red('FAILED')}`);
      console.log(`Simulated Net Profit: $${sim.netProfitUsd.toFixed(2)}`);
      if (!sim.success) {
        console.log(`Error: ${sim.errorMessage}`);
      } else {
        console.log(chalk.bold.green(`🎉 CANDIDATE PASSED SIMULATION!`));
      }
    } catch (e: any) {
      console.log(chalk.red(`Error building/simulating: ${e.message}`));
    }
  }
}

run().catch(console.error);
