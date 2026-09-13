async function main() {
  const url1 = 'https://sui.apis.scallop.io/addresses/695fcdc084f790c04eb068dc';
  try {
    const res1 = await fetch(url1);
    console.log('res1 status:', res1.status);
    if (res1.ok) {
      const data = await res1.json();
      console.log('mainnet keys:', Object.keys(data.mainnet || {}));
      console.log('core keys:', Object.keys(data.mainnet?.core || {}));
      console.log('oracles in data:', JSON.stringify(data.mainnet?.core?.oracles, null, 2));
      console.log('coins in data:', Object.keys(data.mainnet?.core?.coins || {}));
      const whaleCoins = ['sbeth', 'usdy', 'wal', 'sca', 'deep', 'usdc', 'sui', 'fdusd', 'sbusdt', 'wusdt'];
      console.log('packages:', JSON.stringify(data.mainnet?.core?.packages, null, 2));
      return;
    }
  } catch (e: any) {
    console.error('fetch error:', e.message);
  }

  // Also check Scallop SDK constants/addresses endpoint
  const url2 = 'https://sdk.api.scallop.io/addresses/695fcdc084f790c04eb068dc';
  try {
    const res2 = await fetch(url2);
    console.log('res2 status:', res2.status);
  } catch (e: any) {
    console.error('fetch error 2:', e.message);
  }
}

main().catch(console.error);
