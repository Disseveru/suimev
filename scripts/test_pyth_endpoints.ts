async function main() {
  const feedId = 'e3d1723999820435ebab53003a542ff26847720692af92523eea613a9a28d500'; // USDY
  const endpoints = [
    'https://hermes.pyth.network',
    'https://hermes-beta.pyth.network',
    'https://pyth.dourolabs.app/hermes',
    'https://benchmarks.pyth.network',
    'https://api.pyth.network',
  ];

  for (const base of endpoints) {
    try {
      const url = `${base}/v2/updates/price/latest?ids[]=${feedId}&encoding=base64`;
      const res = await fetch(url);
      console.log(base, 'status:', res.status);
      if (res.ok) {
        const json = await res.json();
        console.log(base, 'SUCCESS! data length:', json.binary?.data?.length);
      }
    } catch (e: any) {
      console.log(base, 'error:', e.message);
    }
  }
}

main().catch(console.error);
