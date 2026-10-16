import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';
import { scallopIndexer } from '../src/protocols/scallop/scallopIndexer.js';
import { pythService } from '../src/oracles/pythService.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';

async function main() {
  await scallopProtocol.initialize();
  await pythService.start(1000);

  const query = await scallopProtocol.getOrCreateQuery();
  const oblId = '0x33fee6c01c25a4925ca053df2c99f0cb9d0c5c4985595b6e8eee5b66ebedb277';
  console.log('Querying Scallop obligation:', oblId);
  const data = await query?.queryObligation(oblId);
  console.log('Raw data collaterals:', data?.collaterals);
  console.log('Raw data debts:', data?.debts);

  const state = await scallopIndexer.refreshObligationState(oblId);
  console.log('Evaluated state:', state ? {
    hf: state.healthFactor,
    totalColUsd: state.totalCollateralUsd,
    totalDebtUsd: state.totalDebtUsd,
    isLiquidatable: state.isLiquidatable,
  } : 'NULL');

  process.exit(0);
}

main().catch(console.error);
