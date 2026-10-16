import { suiClient } from '../src/client/suiClient.js';
import { CONFIG } from '../src/config/index.js';

async function main() {
  const address = CONFIG.operatorAddress;
  console.log('Checking balances for operator:', address);
  const allBalances = await suiClient.getAllBalances({ owner: address });
  console.log('\n--- ALL BALANCES ---');
  for (const b of allBalances) {
    const totalMist = BigInt(b.totalBalance);
    const divisor = b.coinType.includes('sui::SUI') ? 1e9 : 1e6;
    console.log(`${b.coinType}: ${totalMist.toString()} raw (${(Number(totalMist) / divisor).toFixed(6)}) [Coin count: ${b.coinObjectCount}]`);
  }

  const coins = await suiClient.getCoins({ owner: address, coinType: '0x2::sui::SUI' });
  console.log('\n--- SUI COIN OBJECTS ---');
  for (const c of coins.data) {
    console.log(`- ${c.coinObjectId}: ${c.balance} MIST (${(Number(c.balance) / 1e9).toFixed(6)} SUI)`);
  }
}

main().catch(console.error);
