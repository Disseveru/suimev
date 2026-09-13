import chalk from 'chalk';
import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';

async function main() {
  await scallopProtocol.initialize();
  await scallopIndexer.discoverObligationsFromHistory(60);

  const ids = Array.from((scallopIndexer as any).knownObligationIds as Set<string>);
  console.log(`Discovered ${ids.length} Scallop obligations. Checking health factors concurrently...`);

  const query = await (scallopProtocol.getSdk() as any).createScallopQuery();
  const undercollateralized: any[] = [];

  // Batch process with concurrency 20
  const batchSize = 20;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    await Promise.all(batch.map(async (id) => {
      try {
        const acc = await query.getObligationAccountById(id);
        if (acc && acc.totalCollateralValue > 0 && acc.totalDebtValue > 0) {
          if (acc.totalCollateralValue < acc.totalRequiredCollateralValue) {
            console.log(chalk.red(`\n🚨 UNDERCOLLATERALIZED OBLIGATION: ${id}`));
            console.log(`   Col: $${acc.totalCollateralValue.toFixed(2)} | ReqCol: $${acc.totalRequiredCollateralValue.toFixed(2)} | Debt: $${acc.totalDebtValue.toFixed(2)}`);
            console.log('   Collaterals:', acc.collaterals?.map((c: any) => `${c.symbol || c.coinName}: ${c.coinPrice * (c.amount / Math.pow(10, c.coinDecimal))}`));
            console.log('   Debts:', acc.debts?.map((d: any) => `${d.symbol || d.coinName}: ${d.coinPrice * (d.amount / Math.pow(10, d.coinDecimal))}`));
            undercollateralized.push({ id, acc });
          }
        }
      } catch {}
    }));
    process.stdout.write(`Checked ${Math.min(i + batchSize, ids.length)}/${ids.length}\r`);
  }

  console.log(`\n\nTotal undercollateralized Scallop obligations: ${undercollateralized.length}`);
}

main().catch(console.error);
