async function run() {
  const url = 'https://api-sui.cetus.zone/v2/sui/pools';
  console.log('Fetching Cetus pools from', url);
  const resp = await fetch(url);
  const data = await resp.json() as any;
  if (data.code === 200 && data.data?.pools) {
    console.log(`Found ${data.data.pools.length} pools on Cetus!`);
    const interesting = ['USDY', 'BTC', 'WBTC', 'USDSUI', 'SCA', 'WAL'];
    for (const pool of data.data.pools) {
      const symA = pool.coin_a?.symbol;
      const symB = pool.coin_b?.symbol;
      const hasMatch = interesting.some(i => symA?.includes(i) || symB?.includes(i));
      if (hasMatch && Number(pool.liquidity) > 0) {
        console.log(`Pool: ${symA} - ${symB} | ID: ${pool.swap_account} | vol_in_24h: $${pool.vol_in_24h} | coinA: ${pool.coin_a?.address} | coinB: ${pool.coin_b?.address}`);
      }
    }
  } else {
    console.log('Response:', data);
  }
}

run().catch(console.error);
