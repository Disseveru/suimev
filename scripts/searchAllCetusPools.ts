async function main() {
  try {
    const res = await fetch('https://api-sui.cetus.zone/v2/sui/pools');
    const data = await res.json();
    console.log('Response keys:', Object.keys(data));
    if (data.data) console.log('data keys:', Object.keys(data.data));
    if (Array.isArray(data.data)) console.log('data length:', data.data.length);
    console.log('Sample data:', JSON.stringify(data).slice(0, 500));
    console.log('Cetus BTC pools:', btcPools?.map((p: any) => ({
      symbol: p.symbol,
      address: p.pool_address,
      coin_a: p.coin_a_address,
      coin_b: p.coin_b_address,
      vol: p.vol_in_usd_24h,
      liquidity: p.total_liquidity_in_usd
    })));
  } catch (e: any) {
    console.log('Error fetching Cetus API:', e.message);
  }
}

main().catch(console.error);
