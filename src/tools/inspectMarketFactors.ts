import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function test() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();

  const markets = await (query as any).repos.market.getMarkets({ coinPrices: { sui: 0.83, usdc: 1.0 } });
  console.log('Markets keys:', Object.keys(markets || {}));
  console.log('Collaterals:');
  for (const [k, v] of Object.entries(markets.collaterals || {})) {
    console.log(`  ${k}: cf=${(v as any).collateralFactor}, lf=${(v as any).liquidationFactor}`);
  }
}

test().catch(console.error);
