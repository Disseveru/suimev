async function check() {
  const endpoints = [
    'https://hermes-beta.pyth.network/v2/updates/price/latest?ids[]=0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
    'https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
    'https://xc-mainnet.pyth.network/api/latest_price_feeds?ids[]=0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
    'https://xc-mainnet.pyth.network/api/latest_vaas?ids[]=0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744',
    'https://sui-mainnet.scallop.io/api/price/pyth'
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      console.log(url.split('/')[2], res.status, res.statusText);
      if (res.status === 200) {
        const text = await res.text();
        console.log('  Success! Length:', text.length, 'sample:', text.slice(0, 100));
      }
    } catch (e: any) {
      console.log(url.split('/')[2], 'Error:', e.message);
    }
  }
}

check().catch(console.error);
