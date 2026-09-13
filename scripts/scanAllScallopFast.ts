import chalk from 'chalk';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';

async function main() {
  await scallopProtocol.initialize();
  await scallopIndexer.discoverObligationsFromHistory(40);

  const ids = Array.from((scallopIndexer as any).knownObligationIds as Set<string>);
  console.log(chalk.cyan(`Discovered ${ids.length} Scallop obligations.`));

  const query = await (scallopProtocol.getSdk() as any).createScallopQuery();
  const liquidatable: any[] = [];

  const BATCH_SIZE = 30;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batchIds = ids.slice(i, i + BATCH_SIZE);
    try {
      const accounts = await query.getObligationAccountsByIds(batchIds);
      for (const acc of accounts) {
        if (acc && acc.totalCollateralValue > 0 && acc.totalDebtValue > 0) {
          if (acc.totalCollateralValue < acc.totalRequiredCollateralValue) {
            console.log(chalk.bold.red(`\n🚨 REAL UNDERCOLLATERALIZED SCALLOP ACCOUNT: ${acc.id}`));
            console.log(`   Col Value: $${acc.totalCollateralValue.toFixed(2)} | Req Col: $${acc.totalRequiredCollateralValue.toFixed(2)} | Debt: $${acc.totalDebtValue.toFixed(2)}`);
            console.log('   Collaterals:', acc.collaterals?.map((c: any) => `${c.symbol || c.coinName} ($${(c.coinPrice * (c.amount / Math.pow(10, c.coinDecimal))).toFixed(2)})`));
            console.log('   Debts:', acc.debts?.map((d: any) => `${d.symbol || d.coinName} ($${(d.coinPrice * (d.amount / Math.pow(10, d.coinDecimal))).toFixed(2)})`));
            liquidatable.push(acc);
          }
        }
      }
    } catch (e: any) {
      console.log(`Error on batch ${i}:`, e.message);
    }
    process.stdout.write(`Evaluated ${Math.min(i + BATCH_SIZE, ids.length)}/${ids.length}\r`);
  }

  console.log(chalk.bold.green(`\n\nFound ${liquidatable.length} undercollateralized Scallop obligations!`));
}

main().catch(console.error);
