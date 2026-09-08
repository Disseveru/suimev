import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function testPythUpdate() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const builder = await sdk.createScallopBuilder();

  // Test what happens inside prepare
  const addr = builder.address;
  const coins = ['sui', 'usdy', 'sbusdt', 'usdsui', 'usdc'];
  for (const c of coins) {
    const feed = addr.get(`core.coins.${c}.oracle.pyth.feed`);
    const feedObj = addr.get(`core.coins.${c}.oracle.pyth.feedObject`);
    console.log(`Coin: ${c} | Feed ID: ${feed} | Feed Obj: ${feedObj}`);
  }

  const feeds = coins.map(c => addr.get(`core.coins.${c}.oracle.pyth.feed`)).filter(Boolean);
  console.log('Feeds:', feeds);

  // Test Hermes query directly
  const url = `https://hermes.pyth.network/v2/updates/price/latest?` + feeds.map(f => `ids[]=${f}`).join('&');
  console.log('Fetching from Hermes:', url);
  try {
    const res = await fetch(url);
    console.log('Hermes status:', res.status, res.statusText);
    const json = await res.json() as any;
    console.log('Hermes response binary data length:', json?.binary?.data?.length);
  } catch (err) {
    console.error('Hermes fetch error:', err);
  }
}

testPythUpdate().catch(console.error);
