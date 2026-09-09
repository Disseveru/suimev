import chalk from 'chalk';
import Table from 'cli-table3';
import { CONFIG } from '../config/index.js';
import { searcher } from '../engine/searcher.js';
import { terminalDashboard } from '../ui/terminal.js';
import { pythService } from '../oracles/pythService.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';
import { obligationRegistry } from '../engine/registry.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import { PreFlightSimulator } from '../engine/simulator.js';
import { TransactionExecutor } from '../engine/executor.js';
import { ObligationState } from '../config/types.js';

const command = process.argv[2] || 'start';

async function main() {
  switch (command) {
    case 'start':
      console.clear();
      await searcher.start();
      terminalDashboard.start(5000);
      terminalDashboard.render();
      break;

    case 'scan':
      console.log(chalk.bold.cyan('\n🔍 Initiating Multi-Protocol Obligation Scan...'));
      await pythService.fetchLatestPrices();

      if (CONFIG.protocols.includes('navi')) {
        await naviProtocol.initialize();
        naviIndexer.onObligationUpdate((state) => obligationRegistry.upsertObligation(state));
        console.log(chalk.yellow('Scanning NAVI Protocol accounts...'));
        await naviIndexer.discoverBorrowersFromHistory();
      }

      if (CONFIG.protocols.includes('scallop')) {
        await scallopProtocol.initialize();
        scallopIndexer.onObligationUpdate((state) => obligationRegistry.upsertObligation(state));
        console.log(chalk.yellow('Scanning Scallop Protocol accounts...'));
        await scallopIndexer.discoverObligationsFromHistory();
      }

      const all = obligationRegistry.getAllObligations();
      console.log(chalk.green(`\nFound ${all.length} total monitored obligation(s).`));

      const table = new Table({
        head: ['Protocol', 'Account / ID', 'Collateral USD', 'Debt USD', 'Health Factor', 'Status'],
        colWidths: [12, 34, 18, 16, 16, 16],
      });

      for (const obl of all) {
        const hf = obl.healthFactor;
        const status = hf < 1.0 ? chalk.red.bold('LIQUIDATABLE') : hf < 1.05 ? chalk.yellow('AT RISK') : chalk.green('SAFE');
        table.push([
          obl.protocol.toUpperCase(),
          obl.obligationId.substring(0, 30) + '...',
          `$${obl.totalCollateralUsd.toFixed(2)}`,
          `$${obl.totalDebtUsd.toFixed(2)}`,
          hf === Infinity ? '∞' : hf.toFixed(4),
          status,
        ]);
      }

      console.log(table.toString());
      process.exit(0);

    case 'simulate':
      console.log(chalk.bold.cyan('\n🧪 Running Zero-Capital Liquidation PTB Simulator Test...'));
      await pythService.fetchLatestPrices();
      await naviProtocol.initialize();

      // Create a test synthetic undercollateralized obligation
      const syntheticObligation: ObligationState = {
        protocol: 'navi',
        obligationId: '0x1111111111111111111111111111111111111111111111111111111111111111',
        ownerAddress: '0x1111111111111111111111111111111111111111111111111111111111111111',
        collaterals: [
          {
            coinType: '0x2::sui::SUI',
            symbol: 'SUI',
            amount: 3000_000_000_000n, // 3000 SUI
            decimals: 9,
            valueUsd: 0,
            liquidationThreshold: 0.80,
          },
        ],
        debts: [
          {
            coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
            symbol: 'USDC',
            amount: 2200_000_000n, // 2200 USDC
            decimals: 6,
            valueUsd: 0,
          },
        ],
        totalCollateralUsd: 0,
        totalDebtUsd: 0,
        liquidationThresholdCollateralUsd: 0,
        healthFactor: 1.0,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      HealthFactorEngine.evaluateObligation(syntheticObligation);
      console.log(chalk.white(`Simulating synthetic account with Health Factor: ${syntheticObligation.healthFactor.toFixed(3)}`));
      const opp = HealthFactorEngine.findBestLiquidationOpportunity(syntheticObligation);

      if (!opp) {
        console.log(chalk.red('Could not compute opportunity'));
        process.exit(1);
      }

      console.log(chalk.yellow(`Target Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol} ($${opp.debtRepayUsd.toFixed(2)})`));
      console.log(chalk.yellow(`Expected Seized Collateral: ${opp.collateralToReceive} ${opp.collateralSymbol} ($${opp.collateralReceiveUsd.toFixed(2)})`));
      console.log(chalk.green(`Expected Gross Profit: $${opp.expectedGrossProfitUsd.toFixed(2)} USD`));

      console.log(chalk.cyan('Constructing atomic zero-capital PTB...'));
      const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp);
      console.log(chalk.green('PTB built successfully! Testing pre-flight simulation...'));

      console.log(chalk.cyan('Running 1: Pre-flight devInspect (Zero-Gas Move Execution)...'));
      const devInspectSim = await PreFlightSimulator.simulate(built.tx, opp);
      console.log(chalk.cyan(`  devInspect Status: ${devInspectSim.success ? chalk.green('SUCCESS') : chalk.yellow('ABORTED / INTERCEPTED')}`));
      console.log(chalk.cyan(`  Simulated Net Profit: $${devInspectSim.netProfitUsd.toFixed(2)} USD`));
      if (!devInspectSim.success && devInspectSim.errorMessage) {
        console.log(chalk.gray(`  devInspect details: ${devInspectSim.errorMessage}`));
      }

      console.log(chalk.cyan('Running 2: Full State dryRunTransactionBlock (Storage + Gas Profiling)...'));
      const dryRunSim = await PreFlightSimulator.dryRun(built.tx, opp);
      console.log(chalk.cyan(`  dryRun Status: ${dryRunSim.success ? chalk.green('SUCCESS') : chalk.yellow('ABORTED')}`));
      if (dryRunSim.computationCostMist !== undefined) {
        console.log(chalk.cyan(`  Computation Cost: ${dryRunSim.computationCostMist.toLocaleString()} MIST`));
        console.log(chalk.cyan(`  Storage Cost: ${dryRunSim.storageCostMist?.toLocaleString()} MIST (Rebate: ${dryRunSim.storageRebateMist?.toLocaleString()} MIST)`));
        console.log(chalk.cyan(`  Net Gas Cost: ${dryRunSim.gasUsedSui.toFixed(6)} SUI ($${dryRunSim.gasCostUsd.toFixed(4)})`));
      }

      console.log(chalk.cyan('\nSentio Visual Move Debugger:'));
      const { sentioService } = await import('../client/sentioService.js');
      const sentioExport = await sentioService.prepareSimulation(built.tx);
      console.log(chalk.white(`  Simulator: ${chalk.blue(sentioExport.sentioSimulatorUrl)}`));
      console.log(chalk.gray(`  Raw Base64 PTB Bytes (paste into Sentio or SuiVision):`));
      console.log(chalk.yellow(`  ${sentioExport.rawTransactionBytesBase64.substring(0, 80)}... [${sentioExport.rawTransactionBytesBase64.length} bytes total]`));

      console.log(chalk.green('\n🛡️ Pre-flight simulation guards verified: No unexecutable transactions reach consensus.'));
      process.exit(0);

    case 'benchmark':
      console.log(chalk.bold.cyan('\n⚡ Benchmarking PTB Assembly & Valuation Latency...'));
      await pythService.fetchLatestPrices();
      await naviProtocol.initialize();

      const testObl: ObligationState = {
        protocol: 'navi',
        obligationId: '0x9999999999999999999999999999999999999999999999999999999999999999',
        ownerAddress: '0x9999999999999999999999999999999999999999999999999999999999999999',
        collaterals: [{ coinType: '0x2::sui::SUI', symbol: 'SUI', amount: 3000_000_000_000n, decimals: 9, valueUsd: 0, liquidationThreshold: 0.8 }],
        debts: [{ coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC', symbol: 'USDC', amount: 2200_000_000n, decimals: 6, valueUsd: 0 }],
        totalCollateralUsd: 0,
        totalDebtUsd: 0,
        liquidationThresholdCollateralUsd: 0,
        healthFactor: 1.0,
        isLiquidatable: false,
        lastUpdatedMs: Date.now(),
      };

      HealthFactorEngine.evaluateObligation(testObl);
      const ITERATIONS = 1000;
      const startEval = performance.now();
      for (let i = 0; i < ITERATIONS; i++) {
        HealthFactorEngine.evaluateObligation(testObl);
      }
      const evalMs = (performance.now() - startEval) / ITERATIONS;
      console.log(chalk.green(`Health Factor Evaluation: ${evalMs.toFixed(4)} ms per operation (${Math.floor(1000 / evalMs).toLocaleString()} ops/sec)`));

      const oppBench = HealthFactorEngine.findBestLiquidationOpportunity(testObl)!;
      const startPtb = performance.now();
      for (let i = 0; i < 200; i++) {
        ZeroCapitalPtbBuilder.buildLiquidationPTB(oppBench);
      }
      const ptbMs = (performance.now() - startPtb) / 200;
      console.log(chalk.green(`Zero-Capital PTB Construction: ${ptbMs.toFixed(4)} ms per block (${Math.floor(1000 / ptbMs).toLocaleString()} blocks/sec)`));
      process.exit(0);

    case 'replay': {
      const digest = process.argv[3];
      if (!digest) {
        console.log(chalk.yellow('\nUsage: npm run replay <TRANSACTION_DIGEST>'));
        console.log(chalk.gray('Example: npm run replay 8kF...abc'));
        console.log(chalk.cyan('\nTools supported:'));
        console.log('  1. Sui CLI Replay: sui replay --rpc <RPC_URL> --digest <DIGEST>');
        console.log('  2. Sentio Move Debugger: https://app.sentio.xyz/sui/tx/<DIGEST>');
        console.log('  3. SuiVision: https://suivision.xyz/txblock/<DIGEST>');
        process.exit(0);
      }
      const { ReplayDebugger } = await import('../tools/replayDebugger.js');
      await ReplayDebugger.printReport(digest);
      process.exit(0);
    }

    case 'alchemy':
    case 'alchemy:status': {
      console.log(chalk.bold.cyan('\n⚡ Querying Alchemy Dedicated Sui Node...'));
      const { alchemyService } = await import('../client/alchemyService.js');
      const health = await alchemyService.checkHealth();

      const table = new Table({
        head: [chalk.yellow('Alchemy Parameter'), chalk.yellow('Value')],
        colWidths: [26, 52],
      });

      table.push(
        ['Endpoint', chalk.cyan(health.endpoint)],
        ['Connection Status', health.isConnected ? chalk.green('ONLINE (HEALTHY)') : chalk.red('OFFLINE')],
        ['Network', chalk.white(health.network)],
        ['Latest Checkpoint', chalk.yellow(health.checkpoint)],
        ['Ping Latency', `${health.latencyMs} ms`],
        ['Reference Gas Price', `${health.referenceGasPrice.toString()} MIST/unit`]
      );

      console.log(table.toString());

      if (health.error) {
        console.log(chalk.red(`\nError: ${health.error}`));
      }
      process.exit(0);
    }

    case 'sentio':
    case 'sentio:status': {
      console.log(chalk.bold.cyan('\n⚡ Querying Sentio Sui Debugger & Simulator Bridge...'));
      const { sentioService } = await import('../client/sentioService.js');
      const isConfigured = sentioService.isConfigured();

      const table = new Table({
        head: [chalk.yellow('Sentio Parameter'), chalk.yellow('Value')],
        colWidths: [26, 56],
      });

      table.push(
        ['Platform', chalk.white('Sentio Sui Move Trace & Simulation Platform')],
        ['Web Simulator URL', chalk.cyan('https://app.sentio.xyz/sui')],
        ['Move VM Tracing', chalk.green('SUPPORTED (Bytecode & Abort Codes)')],
        ['PTB Visual Stepper', chalk.green('SUPPORTED (Commands, Inputs, Transfers)')],
        ['API Access Status', isConfigured ? chalk.green('API KEY CONFIGURED') : chalk.gray('PUBLIC WEB ACCESS (FREE)')]
      );

      console.log(table.toString());
      console.log(chalk.gray('\nTip: To trace an on-chain transaction or failed liquidation:'));
      console.log(chalk.white('  npm run replay <TRANSACTION_DIGEST>'));
      process.exit(0);
    }

    case 'wallet': {
      console.log(chalk.bold.cyan('\n💼 Querying Operator Wallet Gas Balance on Sui Mainnet...'));
      const gas = await TransactionExecutor.checkOperatorGasBalance();
      const table = new Table({
        head: [chalk.yellow('Parameter'), chalk.yellow('Value')],
        colWidths: [26, 68],
      });
      table.push(
        ['Operator Address', chalk.cyan(CONFIG.operatorAddress)],
        ['Balance (SUI)', chalk.white(`${gas.balanceSui.toFixed(4)} SUI`)],
        ['Balance (MIST)', chalk.white(`${gas.balanceMist.toString()} MIST`)],
        ['Required Budget', chalk.yellow(`${(Number(CONFIG.gasBudget) / 1e9).toFixed(4)} SUI (${CONFIG.gasBudget.toString()} MIST)`)],
        ['Gas Sufficiency', gas.isSufficient ? chalk.green.bold('SUFFICIENT (READY FOR ON-CHAIN CONSENSUS)') : chalk.red.bold('INSUFFICIENT SUI FOR GAS BUDGET')],
        ['Execution Mode', CONFIG.dryRun ? chalk.yellow('DRY-RUN (Simulations only)') : chalk.green.bold('LIVE EXECUTION (BROADCASTING ACTIVE)')]
      );
      console.log(table.toString());

      if (!gas.isSufficient) {
        console.log(chalk.yellow(`\n💡 Note: Zero-capital flash loans require $0 borrow capital, but Sui validators require a nominal gas budget (~0.1 SUI) in the operator address (${CONFIG.operatorAddress}) to execute transactions.`));
      }
      process.exit(0);
    }

    case 'execute': {
      console.log(chalk.bold.cyan('\n⚡ Initiating Direct Targeted Liquidation Attempt...'));
      console.log(chalk.gray(`Execution Mode: ${CONFIG.dryRun ? 'DRY-RUN' : 'LIVE ON-CHAIN'}`));
      console.log(chalk.gray(`Operator: ${CONFIG.operatorAddress}`));

      // Check gas balance
      const gas = await TransactionExecutor.checkOperatorGasBalance();
      console.log(chalk.white(`Operator SUI Balance: ${gas.balanceSui.toFixed(4)} SUI`));
      if (!gas.isSufficient) {
        console.log(chalk.yellow(`ℹ️ Operator wallet has ${gas.balanceSui.toFixed(4)} SUI. Pre-flight simulation will run via devInspect (0 SUI needed). For live consensus broadcast, >= 0.05 SUI gas reserve is required.`));
      }

      console.log(chalk.cyan('Fetching oracle prices...'));
      await pythService.fetchLatestPrices();

      if (CONFIG.protocols.includes('navi')) {
        await naviProtocol.initialize();
        naviIndexer.onObligationUpdate((state) => obligationRegistry.upsertObligation(state));
        console.log(chalk.yellow('Scanning NAVI accounts...'));
        await naviIndexer.discoverBorrowersFromHistory();
      }

      if (CONFIG.protocols.includes('scallop')) {
        await scallopProtocol.initialize();
        scallopIndexer.onObligationUpdate((state) => obligationRegistry.upsertObligation(state));
        console.log(chalk.yellow('Scanning Scallop accounts...'));
        await scallopIndexer.discoverObligationsFromHistory();
      }

      const targets = obligationRegistry.getImmediateTargets();
      console.log(chalk.bold.magenta(`\nFound ${targets.length} undercollateralized target(s) (Health Factor < 1.0)`));

      if (targets.length === 0) {
        console.log(chalk.yellow('No accounts currently eligible for immediate liquidation.'));
        process.exit(0);
      }

      for (const target of targets) {
        console.log(chalk.cyan(`\n--- Evaluating Target: ${target.obligationId} (${target.protocol.toUpperCase()}) ---`));
        console.log(`Health Factor: ${chalk.red(target.healthFactor.toFixed(4))}`);
        console.log(`Collateral USD: $${target.totalCollateralUsd.toFixed(2)}, Debt USD: $${target.totalDebtUsd.toFixed(2)}`);

        const opp = HealthFactorEngine.findBestLiquidationOpportunity(target);
        if (!opp) {
          console.log(chalk.yellow('No viable liquidation route for this target.'));
          continue;
        }

        console.log(`Target Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol} ($${opp.debtRepayUsd.toFixed(2)})`);
        console.log(`Expected Seized: ${opp.collateralToReceive} ${opp.collateralSymbol} ($${opp.collateralReceiveUsd.toFixed(2)})`);
        console.log(`Gross Profit Estimate: $${opp.expectedGrossProfitUsd.toFixed(2)}`);

        console.log(chalk.cyan('Assembling zero-capital atomic PTB...'));
        const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp);

        console.log(chalk.cyan('Running pre-flight simulation (devInspectTransactionBlock)...'));
        const sim = await PreFlightSimulator.simulate(built.tx, opp);

        console.log(`Simulation Success: ${sim.success ? chalk.green('YES') : chalk.red('NO')}`);
        console.log(`Simulated Net Profit: $${sim.netProfitUsd.toFixed(2)} USD`);

        if (!sim.success) {
          console.log(chalk.yellow(`Pre-flight rejection reason: ${sim.errorMessage}`));
          console.log(chalk.green('🛡️ Safety guard prevented broadcasting an unexecutable transaction.'));
          continue;
        }

        console.log(chalk.bold.green('🚀 Pre-flight simulation passed! Executing liquidation...'));
        const result = await TransactionExecutor.execute(built.tx, opp, sim.netProfitUsd);
        console.log(chalk.bold(`Digest: ${result.digest}`));
        console.log(chalk.bold(`Success: ${result.success ? chalk.green('TRUE') : chalk.red('FALSE')}`));
        console.log(`Net Profit: $${result.netProfitUsd.toFixed(2)}`);
        console.log(`Gas Used: ${result.gasUsedSui.toFixed(4)} SUI ($${result.gasCostUsd.toFixed(4)})`);
        if (result.errorMessage) {
          console.log(chalk.red(`Error: ${result.errorMessage}`));
        }
        process.exit(result.success ? 0 : 1);
      }

      process.exit(0);
    }

    default:
      console.log(`Unknown command: ${command}. Available: start, scan, simulate, benchmark, replay, sentio, alchemy, wallet, execute`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal CLI error:'), err);
  process.exit(1);
});
