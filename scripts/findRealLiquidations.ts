import chalk from 'chalk';
import { suiClient, rpcManager } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SCALLOP_CONFIG } from '../src/config/constants.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { naviIndexer } from '../src/protocols/navi/naviIndexer.js';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { PreFlightSimulator } from '../src/engine/simulator.js';
import { TransactionExecutor } from '../src/engine/executor.js';
import * as navi from '@naviprotocol/lending';
import { Transaction } from '@mysten/sui/transactions';

async function loadNaviOraclePrices() {
  console.log(chalk.cyan('Loading NAVI on-chain oracle prices for all 38 assets...'));
  const fields = await suiClient.getDynamicFields({
    parentId: '0xc0601facd3b98d1e82905e660bf9f5998097dedcf86ed802cf485865e3e3667c',
    limit: 50,
  });

  const pools = naviProtocol.getAllPools();
  const poolByOracleId = new Map<number, any>();
  for (const p of pools) {
    poolByOracleId.set(p.oracleId, p);
  }

  for (const f of fields.data) {
    const oracleId = Number(f.name.value);
    const obj = await suiClient.getObject({ id: f.objectId, options: { showContent: true } });
    const content = (obj.data?.content as any)?.fields;
    const priceFields = content?.value?.fields;
    if (priceFields) {
      const val = Number(priceFields.value);
      const dec = Number(priceFields.decimal);
      const priceUsd = val / Math.pow(10, dec);

      const p = poolByOracleId.get(oracleId);
      if (p) {
        priceCache.updatePrice({
          symbol: p.symbol,
          coinType: p.coinType,
          price: priceUsd,
          confidence: 0,
          exponent: -dec,
          rawPrice: BigInt(priceFields.value),
          publishTime: Math.floor(Date.now() / 1000),
          lastUpdatedMs: Date.now(),
        });
      }
    }
  }
}

async function run() {
  await naviProtocol.initialize();
  await scallopProtocol.initialize();
  await loadNaviOraclePrices();

  console.log(chalk.bold.cyan('\n--- STEP 1: Evaluating NAVI Accounts with True Oracle Prices ---'));
  await naviIndexer.discoverBorrowersFromHistory(40);

  const naviBorrowers = (naviIndexer as any).knownBorrowers as Set<string>;
  console.log(`Discovered ${naviBorrowers.size} NAVI borrowers`);

  const trueNaviUnder: any[] = [];
  for (const addr of naviBorrowers) {
    const state = await naviIndexer.refreshBorrowerState(addr);
    if (!state) continue;
    HealthFactorEngine.evaluateObligation(state);
    if (state.healthFactor < 1.0 && state.totalCollateralUsd > 0.05) {
      trueNaviUnder.push(state);
      console.log(chalk.red(`🚨 REAL Undercollateralized NAVI: ${addr} | HF: ${state.healthFactor.toFixed(4)} | Col: $${state.totalCollateralUsd.toFixed(2)} | Debt: $${state.totalDebtUsd.toFixed(2)}`));
    }
  }

  console.log(`Total truly undercollateralized NAVI accounts: ${trueNaviUnder.length}`);

  for (const obl of trueNaviUnder) {
    const opp = HealthFactorEngine.findBestLiquidationOpportunity(obl);
    if (!opp) continue;
    console.log(chalk.yellow(`\nAttempting NAVI Liquidation on ${obl.obligationId}...`));
    console.log(`Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol} ($${opp.debtRepayUsd.toFixed(2)})`);
    console.log(`Seize: ${opp.collateralToReceive} ${opp.collateralSymbol} ($${opp.collateralReceiveUsd.toFixed(2)})`);

    try {
      const tx = new Transaction();
      const poolList = await (navi as any).getPools();
      await (navi as any).updateOraclePriceBeforeUserOperationPTB(tx, obl.obligationId, poolList);
      const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp, tx);

      const sim = await PreFlightSimulator.simulate(built.tx, opp);
      console.log(`devInspect Simulation: ${sim.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);
      if (sim.success) {
        console.log(chalk.bold.green(`🚀 EXECUTING LIVE ON-CHAIN TRANSACTION!`));
        const res = await TransactionExecutor.execute(built.tx, opp, sim.netProfitUsd);
        console.log('Result:', res);
        return;
      } else {
        console.log('Error:', sim.errorMessage);
      }
    } catch (e: any) {
      console.log('Error:', e.message);
    }
  }

  console.log(chalk.bold.cyan('\n--- STEP 2: Evaluating Scallop Accounts with Scallop Query SDK ---'));
  await scallopIndexer.discoverObligationsFromHistory(40);
  const scallopIds = (scallopIndexer as any).knownObligationIds as Set<string>;
  console.log(`Discovered ${scallopIds.size} Scallop obligations`);

  const query = await (scallopProtocol.getSdk() as any).createScallopQuery();
  const trueScallopUnder: any[] = [];

  for (const id of scallopIds) {
    try {
      const acc = await query.getObligationAccountById(id);
      if (acc && acc.totalCollateralValue > 0 && acc.totalDebtValue > 0) {
        if (acc.totalCollateralValue < acc.totalRequiredCollateralValue) {
          trueScallopUnder.push({ id, acc });
          console.log(chalk.red(`🚨 REAL Undercollateralized Scallop: ${id} | Col: $${acc.totalCollateralValue.toFixed(2)} | ReqCol: $${acc.totalRequiredCollateralValue.toFixed(2)} | Debt: $${acc.totalDebtValue.toFixed(2)}`));
        }
      }
    } catch {
      // skip
    }
  }

  console.log(`Total truly undercollateralized Scallop accounts: ${trueScallopUnder.length}`);

  for (const { id } of trueScallopUnder) {
    const state = await scallopIndexer.refreshObligationState(id);
    if (!state) continue;
    HealthFactorEngine.evaluateObligation(state);
    const opp = HealthFactorEngine.findBestLiquidationOpportunity(state);
    if (!opp) continue;

    console.log(chalk.yellow(`\nAttempting Scallop Liquidation on ${id}...`));
    console.log(`Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol} ($${opp.debtRepayUsd.toFixed(2)})`);
    console.log(`Seize: ${opp.collateralToReceive} ${opp.collateralSymbol} ($${opp.collateralReceiveUsd.toFixed(2)})`);

    try {
      const built = await ZeroCapitalPtbBuilder.buildLiquidationPTBAsync(opp);
      const sim = await PreFlightSimulator.simulate(built.tx, opp);
      console.log(`devInspect Simulation: ${sim.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);
      if (sim.success) {
        console.log(chalk.bold.green(`🚀 EXECUTING LIVE ON-CHAIN TRANSACTION!`));
        const res = await TransactionExecutor.execute(built.tx, opp, sim.netProfitUsd);
        console.log('Result:', res);
        return;
      } else {
        console.log('Error:', sim.errorMessage);
      }
    } catch (e: any) {
      console.log('Error:', e.message);
    }
  }
}

run().catch(console.error);
