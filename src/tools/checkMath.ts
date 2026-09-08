import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { priceCache } from '../oracles/priceCache.js';
import { COIN_CONFIGS, getCoinConfigByType } from '../config/coins.js';

async function checkMath() {
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();

  const id = '0x8d3baf0278d47eca6356b894e0b9b7e49f572e7ca7d77086c6a903d00c2a3cde';
  const obl = await query.queryObligation(id);
  if (!obl || !obl.collaterals || !obl.debts) {
    console.log('Obligation not found');
    return;
  }

  console.log('--- Collaterals for 0x8d3baf02... ---');
  let totalColUsd = 0;
  let totalThresholdUsd = 0;
  for (const c of obl.collaterals) {
    const cfg = getCoinConfigByType(c.type);
    const symbol = cfg?.symbol || c.type.split('::')[2];
    const decimals = cfg?.decimals ?? 9;
    const amount = Number(c.amount) / (10 ** decimals);
    const price = priceCache.getPriceBySymbol(symbol)?.price || 0;
    const val = amount * price;
    const lt = cfg?.liquidationThreshold ?? 0.8;
    totalColUsd += val;
    totalThresholdUsd += val * lt;
    console.log(`  ${symbol}: amount=${amount.toFixed(2)}, price=$${price.toFixed(4)}, val=$${val.toFixed(2)}, lt=${lt}`);
  }
  console.log(`Total Collateral USD: $${totalColUsd.toFixed(2)}`);
  console.log(`Total Liquidation Threshold USD: $${totalThresholdUsd.toFixed(2)}`);

  console.log('\n--- Debts for 0x8d3baf02... ---');
  let totalDebtUsd = 0;
  for (const d of obl.debts) {
    const cfg = getCoinConfigByType(d.type);
    const symbol = cfg?.symbol || d.type.split('::')[2];
    const decimals = cfg?.decimals ?? 6;
    const amount = Number(d.amount) / (10 ** decimals);
    const price = priceCache.getPriceBySymbol(symbol)?.price || 0;
    const val = amount * price;
    totalDebtUsd += val;
    console.log(`  ${symbol}: amount=${amount.toFixed(2)}, borrowIndex=${d.borrowIndex}, price=$${price.toFixed(4)}, val=$${val.toFixed(2)}`);
  }
  console.log(`Total Debt USD: $${totalDebtUsd.toFixed(2)}`);
  console.log(`Off-chain Health Factor: ${(totalThresholdUsd / totalDebtUsd).toFixed(4)}`);
}

checkMath().catch(console.error);
