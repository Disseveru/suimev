async function checkCetusPools() {
  const wusdt = '0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN';
  const wusdc = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN';

  try {
    const res = await fetch('https://api-sui.cetus.zone/v2/sui/pools');
    if (res.ok) {
      const data: any = await res.json();
      const pools = data.data?.pools || [];
      console.log(`Total Cetus pools: ${pools.length}`);
      const related = pools.filter((p: any) =>
        p.coin_type_a === wusdt || p.coin_type_b === wusdt ||
        p.coin_type_a === wusdc || p.coin_type_b === wusdc
      );
      console.log(`Related Cetus pools (${related.length}):`);
      for (const p of related) {
        console.log(`Pool ${p.symbol}: ${p.pool_address}, TVL: $${p.tvl_in_usd}, Vol24h: $${p.vol_24h_usd}`);
      }
    }
  } catch (err: any) {
    console.error('Error fetching Cetus pools:', err.message || err);
  }
}

checkCetusPools().catch(console.error);
