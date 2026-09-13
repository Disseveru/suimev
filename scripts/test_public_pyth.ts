async function main() {
  const feedId = 'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';
  const candidateUrls = [
    'https://hermes.pyth.network/v2/updates/price/latest',
    'https://hermes.pyth.network/api/latest_vaas',
    'https://xc-mainnet.pyth.network/api/latest_vaas',
    'https://pyth-hermes.switchboard.xyz/v2/updates/price/latest',
    'https://hermes-beta.pyth.network/v2/updates/price/latest',
    'https://sui.apis.scallop.io/api/price/pyth',
    'https://api.scallop.io/api/price/pyth',
  ];

  for (const url of candidateUrls) {
    try {
      const u = new URL(url);
      if (url.includes('v2/updates/price/latest')) {
        u.searchParams.append('ids[]', feedId);
        u.searchParams.set('encoding', 'base64');
      } else if (url.includes('latest_vaas')) {
        u.searchParams.append('ids[]', feedId);
      }
      const res = await fetch(u.toString(), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      console.log(url, 'status:', res.status);
      if (res.ok) {
        const text = await res.text();
        console.log('SUCCESS on', url, text.slice(0, 100));
        break;
      }
    } catch (e: any) {
      console.log(url, 'error:', e.message);
    }
  }
}

main().catch(console.error);
