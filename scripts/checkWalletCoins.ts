import { suiClient } from '../src/client/suiClient.js';
import { CONFIG } from '../src/config/index.js';

async function main() {
  const coins = await suiClient.getAllCoins({
    owner: CONFIG.operatorAddress,
  });
  console.log(`Operator ${CONFIG.operatorAddress} owns ${coins.data.length} coins:`);
  for (const c of coins.data) {
    console.log(`  ${c.coinType}: ${c.balance} (object: ${c.coinObjectId})`);
  }
}

main().catch(console.error);
