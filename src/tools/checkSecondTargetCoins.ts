import { suiClient } from '../client/suiClient.js';
import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function checkSecondTarget() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const builder = await sdk.createScallopBuilder();

  const targetId = '0x8d3baf0278d47eca6356b894e0b9b7e49f572e7ca7d77086c6a903d00c2a3cde';
  const oblData = await (builder as any).query.repos.obligation.getObligationData(targetId);
  const coinTypes = [...oblData.collaterals.map((c: any) => c.type), ...oblData.debts.map((d: any) => d.type)];
  const coins = [...new Set(coinTypes.map((t: string) => (builder as any).utils.parseCoinNameFromType(t)))];
  console.log(`Target 2 coins:`, coins);

  const nowSec = Math.floor(Date.now() / 1000);
  for (const c of coins) {
    const feedObj = builder.address.get(`core.coins.${c}.oracle.pyth.feedObject`);
    if (!feedObj) {
      console.log(`Coin ${c}: no pyth feed object`);
      continue;
    }
    const obj = await suiClient.getObject({ id: feedObj, options: { showContent: true } });
    const fields = (obj.data?.content as any)?.fields;
    const priceInfo = fields?.price_info?.fields;
    const priceFeed = priceInfo?.price_feed?.fields;
    const ts = priceFeed?.price?.fields?.timestamp;
    const ageSec = ts ? nowSec - Number(ts) : null;
    console.log(`Coin ${c} (${String(feedObj).slice(0, 10)}...): timestamp=${ts}, age=${ageSec}s`);
  }
}

checkSecondTarget().catch(console.error);
