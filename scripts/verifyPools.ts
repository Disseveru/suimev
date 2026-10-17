import { suiClient } from '../src/client/suiClient.js';
import { CANONICAL_CETUS_POOLS } from '../src/protocols/dex/cetusRouter.js';

async function main() {
  const entries = Object.entries(CANONICAL_CETUS_POOLS);
  const uniquePoolIds = Array.from(new Set(entries.map(([_, p]) => p.poolId)));
  
  const objects = await suiClient.multiGetObjects({
    ids: uniquePoolIds,
    options: { showType: true },
  });

  const objMap = new Map();
  uniquePoolIds.forEach((id, i) => {
    objMap.set(id, objects[i]);
  });

  let valid = 0;
  let invalid = 0;

  for (const [name, def] of entries) {
    const obj = objMap.get(def.poolId);
    if (obj?.data) {
      valid++;
      console.log(`[PASS] ${name.padEnd(16)} -> ${def.poolId}`);
    } else {
      invalid++;
      console.log(`[FAIL] ${name.padEnd(16)} -> ${def.poolId} ERROR: ${JSON.stringify(obj?.error)}`);
    }
  }

  console.log(`\nVerified Cetus Pools: ${valid} valid, ${invalid} invalid (out of ${uniquePoolIds.length} unique pools)`);
}

main().catch(console.error);
