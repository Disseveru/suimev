import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG } from '../src/config/constants.js';

async function main() {
  const initialPkg = '0x1e4a13a0494d5facdbe8473e74127b838c2d446ecec0ce262e2eddafa77259cb';
  const evType1 = `${initialPkg}::event::LiquidationCallEvent`;
  const evType2 = `${initialPkg}::event::LiquidationEvent`;

  console.log('Querying LiquidationCallEvent...');
  const res1 = await suiClient.queryEvents({
    query: { MoveEventType: evType1 },
    limit: 10,
  });
  console.log(`Found ${res1.data.length} LiquidationCallEvent events`);
  for (const e of res1.data) {
    console.log(`Time: ${new Date(Number(e.timestampMs)).toISOString()} | Tx: ${e.id.txDigest}`);
    console.log('Data:', JSON.stringify(e.parsedJson, null, 2));
  }

  console.log('\nQuerying LiquidationEvent...');
  const res2 = await suiClient.queryEvents({
    query: { MoveEventType: evType2 },
    limit: 10,
  });
  console.log(`Found ${res2.data.length} LiquidationEvent events`);
  for (const e of res2.data) {
    console.log(`Time: ${new Date(Number(e.timestampMs)).toISOString()} | Tx: ${e.id.txDigest}`);
    console.log('Data:', JSON.stringify(e.parsedJson, null, 2));
  }
}

main().catch(console.error);
