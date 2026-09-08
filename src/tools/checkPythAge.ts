import { suiClient } from '../client/suiClient.js';

async function checkPythTimestamps() {
  const ids = [
    { name: 'sui', id: '0x89b2add829cb6fcd017153fff428bc9faec4d06d643ecfc435af5b55a9e987f0' },
    { name: 'usdy', id: '0xd726651e0ef603ac13eaa7c165cd0a192fc6434cc00976c9220459044775a093' },
    { name: 'usdc', id: '0x6ddfc6f9921e55998cbc2e68f78eba897981d79ac17f66c5277bc38954a2a3f8' },
    { name: 'sbusdt', id: '0x939e666c48cfac89418f69a24cb857263d4c520f90d94ea0770e295b9857961e' },
  ];

  const nowSec = Math.floor(Date.now() / 1000);
  console.log(`Current Time (UTC): ${new Date().toISOString()} (${nowSec})`);

  for (const item of ids) {
    try {
      const obj = await suiClient.getObject({
        id: item.id,
        options: { showContent: true }
      });
      const fields = (obj.data?.content as any)?.fields;
      const priceInfo = fields?.price_info?.fields;
      const priceFeed = priceInfo?.price_feed?.fields;
      const ts = priceFeed?.price?.fields?.timestamp;
      const ageSec = ts ? nowSec - Number(ts) : null;
      console.log(`${item.name} (${item.id.slice(0, 10)}...): timestamp=${ts}, age=${ageSec}s (${(ageSec! / 60).toFixed(1)} mins ago)`);
    } catch (e: any) {
      console.log(`${item.name}: error ${e.message}`);
    }
  }
}

checkPythTimestamps().catch(console.error);
