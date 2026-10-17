import { pythService } from '../oracles/pythService.js';
import { naviProtocol } from '../protocols/navi/naviProtocol.js';
import { naviIndexer } from '../protocols/navi/naviIndexer.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { priceCache } from '../oracles/priceCache.js';

async function main() {
  await pythService.fetchLatestPrices();
  await naviProtocol.initialize();
  await naviIndexer.discoverBorrowersFromHistory(150);

  const obligations = naviIndexer.getAllObligations();
  const suiPrice = priceCache.getPriceUsd('0x2::sui::SUI') || 2.20;

  let totalProfitable = 0;
  let totalGrossUsd = 0;
  let totalNetUsd = 0;
  let totalGasSui = 0;
  const list: any[] = [];

  for (const obl of obligations) {
    if (obl.healthFactor < 1.0 && obl.totalCollateralUsd > 0 && obl.totalDebtUsd >= 0.01) {
      const opp = HealthFactorEngine.findBestLiquidationOpportunity(obl, 0.35);
      if (opp && opp.expectedGrossProfitUsd > 0) {
        const estGasSui = 0.005; // ~0.005 SUI gas cost per PTB ($0.011 USD)
        const estGasUsd = estGasSui * suiPrice;
        const netUsd = opp.expectedGrossProfitUsd - estGasUsd;

        list.push({
          owner: obl.ownerAddress.slice(0, 10) + '...',
          collateralUsd: '$' + obl.totalCollateralUsd.toFixed(2),
          debtUsd: '$' + obl.totalDebtUsd.toFixed(2),
          hf: obl.healthFactor.toFixed(4),
          grossProfit: '$' + opp.expectedGrossProfitUsd.toFixed(3),
          netProfit: '$' + netUsd.toFixed(3)
        });

        if (netUsd > 0) {
          totalProfitable++;
          totalGrossUsd += opp.expectedGrossProfitUsd;
          totalNetUsd += netUsd;
          totalGasSui += estGasSui;
        }
      }
    }
  }

  console.log('\n======================================================');
  console.log('📊 DUST LIQUIDATION PROFIT & GAS ESTIMATION REPORT');
  console.log('======================================================');
  console.log('Current SUI Price:', '$' + suiPrice.toFixed(2));
  console.log('Operator Gas Balance Available:', '0.1821 SUI');
  console.log('Max PTBs Gas Balance Can Fund:', Math.floor(0.1821 / 0.005), 'PTB Executions');
  console.log('------------------------------------------------------');
  console.log('Total Liquidatable Micro-Dust Obligations Found:', list.length);
  console.log('Profitable Micro-Dust Targets (Net Profit > $0.00):', totalProfitable);
  console.log('Total Potential Gross Profit:', '$' + totalGrossUsd.toFixed(2), 'USD');
  console.log('Total Potential Net Profit (After Gas):', '$' + totalNetUsd.toFixed(2), 'USD');
  console.log('Total SUI Gas Required to Liquidate All:', totalGasSui.toFixed(4) + ' SUI');
  console.log('------------------------------------------------------');
  console.log('\nTop Micro-Dust Opportunities Breakout:');
  console.table(list.slice(0, 15));
  process.exit(0);
}

main().catch(console.error);
