import { pythService } from '../src/oracles/pythService.js';
import { priceCache } from '../src/oracles/priceCache.js';

async function testFetch() {
  const success = await pythService.fetchOnChainPricesViaAlchemy();
  console.log('On-chain Pyth fetch success:', success);
  for (const sym of ['SUI', 'USDC', 'USDT', 'WETH', 'CETUS', 'DEEP']) {
    console.log(`${sym} Price USD: $${priceCache.getPriceBySymbol(sym)?.price}`);
  }
  process.exit(0);
}

testFetch().catch(console.error);
