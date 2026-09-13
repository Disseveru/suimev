async function main() {
  const wbtc = '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC';
  const usdc = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const sui = '0x2::sui::SUI';

  // Test 7k aggregator
  try {
    const res = await fetch(`https://api.7k.ag/quote?fromCoin=${encodeURIComponent(wbtc)}&toCoin=${encodeURIComponent(usdc)}&amount=100000`);
    const data = await res.json();
    console.log('7k aggregator quote:', data);
  } catch (e: any) {
    console.log('7k error:', e.message);
  }

  // Test Hop aggregator
  try {
    const res = await fetch(`https://api.hop.ag/v1/quote?from=${encodeURIComponent(wbtc)}&to=${encodeURIComponent(usdc)}&amount=100000`);
    const data = await res.json();
    console.log('Hop quote:', data);
  } catch (e: any) {
    console.log('Hop error:', e.message);
  }

  // Test Aftermath
  try {
    const res = await fetch(`https://aftermath.finance/api/router/trade-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        coinInType: wbtc,
        coinOutType: usdc,
        coinInAmount: '100000',
      })
    });
    const data = await res.json();
    console.log('Aftermath quote:', data);
  } catch (e: any) {
    console.log('Aftermath error:', e.message);
  }
}

main().catch(console.error);
