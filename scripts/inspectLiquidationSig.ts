import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const fn = await suiClient.getNormalizedMoveFunction({
    package: '0x512f28261c1a293f49416d8885b8d5d32bde6dd68a99a0be36fe42b248e6833a',
    module: 'incentive_v3',
    function: 'liquidation_v2',
  });
  console.log('liquidation_v2 parameters:', JSON.stringify(fn.parameters, null, 2));
  console.log('liquidation_v2 return:', JSON.stringify(fn.return, null, 2));

  const lendingMod = await suiClient.getNormalizedMoveModule({
    package: '0x512f28261c1a293f49416d8885b8d5d32bde6dd68a99a0be36fe42b248e6833a',
    module: 'lending',
  });
  const flashFns = Object.keys(lendingMod.exposedFunctions).filter(k => k.includes('flash'));
  console.log('Flash functions in lending:', flashFns);
  for (const fn of flashFns) {
    console.log(`\n=== ${fn} ===`);
    console.log('Parameters:', JSON.stringify(lendingMod.exposedFunctions[fn].parameters, null, 2));
    console.log('Return:', JSON.stringify(lendingMod.exposedFunctions[fn].return, null, 2));
  }
}

main().catch(console.error);
