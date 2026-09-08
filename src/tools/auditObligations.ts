import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { priceCache } from '../oracles/priceCache.js';
import { obligationRegistry } from '../engine/registry.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';
import { getCoinConfigByType } from '../config/coins.js';

async function auditAllObligations() {
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();

  scallopIndexer.onObligationUpdate((s) => obligationRegistry.upsertObligation(s));
  await scallopIndexer.discoverObligationsFromHistory();

  const targets = obligationRegistry.getAllObligations().filter(o => o.totalDebtUsd > 0);
  console.log(`\nAuditing ${targets.length} Scallop obligations with active debt...\n`);

  for (const t of targets) {
    try {
      const obl = await query.queryObligation(t.obligationId);
      if (!obl || !obl.collaterals || !obl.debts) continue;

      let colUsd = 0;
      let thresholdUsd = 0;
      let missingPrices = [];

      for (const c of obl.collaterals) {
        const cfg = getCoinConfigByType(c.type);
        const symbol = cfg?.symbol || c.type.split('::')[2];
        const decimals = cfg?.decimals ?? 9;
        const amount = Number(c.amount) / (10 ** decimals);
        const p = priceCache.getPriceBySymbol(symbol)?.price || 0;
        if (p === 0) missingPrices.push(symbol);
        const val = amount * p;
        const lt = cfg?.liquidationThreshold ?? 0.8;
        colUsd += val;
        thresholdUsd += val * lt;
      }

      let debtUsd = 0;
      for (const d of obl.debts) {
        const cfg = getCoinConfigByType(d.type);
        const symbol = cfg?.symbol || d.type.split('::')[2];
        const decimals = cfg?.decimals ?? 6;
        const amount = Number(d.amount) / (10 ** decimals);
        const p = priceCache.getPriceBySymbol(symbol)?.price || 0;
        debtUsd += amount * p;
      }

      const hf = debtUsd > 0 ? (thresholdUsd / debtUsd) : 999;
      console.log(`Obligation: ${t.obligationId}`);
      console.log(`  Collateral: $${colUsd.toFixed(2)} | Debt: $${debtUsd.toFixed(2)} | HF: ${hf.toFixed(4)}`);
      if (missingPrices.length > 0) {
        console.log(`  ⚠️ Missing prices for: ${missingPrices.join(', ')}`);
      }
      console.log(`  Collateral assets:`, obl.collaterals.map(c => `${c.type.split('::')[2]}: ${c.amount}`));
      console.log(`  Debt assets:`, obl.debts.map(d => `${d.type.split('::')[2]}: ${d.amount}`));
      console.log('---');
    } catch (e: any) {
      console.log(`Obligation ${t.obligationId}: error ${e.message}`);
    }
  }
}

auditAllObligations().catch(console.error);
