import { priceCache } from '../src/oracles/priceCache.js';
import { pythService } from '../src/oracles/pythService.js';

async function run() {
  await pythService.fetchLatestPrices();
  console.log('WAL price in priceCache:', priceCache.getPriceUsd('0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'));
  console.log('SUI price in priceCache:', priceCache.getPriceUsd('0x2::sui::SUI'));
}

run().catch(console.error);
