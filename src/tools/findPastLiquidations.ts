import { suiClient } from '../client/suiClient.js';
import { NAVI_CONFIG, SCALLOP_CONFIG } from '../config/constants.js';

async function main() {
  console.log('--- 1. Querying Scallop Liquidation Events (package query) ---');
  try {
    const res = await suiClient.queryEvents({
      query: {
        MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'liquidate' },
      },
      limit: 50,
    });
    console.log(`Scallop liquidate events found: ${res.data.length}`);
    for (const ev of res.data.slice(0, 10)) {
      console.log('Scallop Event Type:', ev.type, 'Date:', new Date(Number(ev.timestampMs)).toISOString());
      console.log('Data:', JSON.stringify(ev.parsedJson, null, 2));
    }
  } catch (err: any) {
    console.error('Scallop query error:', err.message);
  }

  console.log('\n--- 2. Querying NAVI Liquidation Events ---');
  try {
    const res = await suiClient.queryEvents({
      query: {
        MoveModule: { package: NAVI_CONFIG.packageId, module: 'lending' },
      },
      limit: 100,
    });
    const liqs = res.data.filter(e => e.type.toLowerCase().includes('liquidat'));
    console.log(`NAVI liquidation events found: ${liqs.length}`);
    for (const ev of liqs.slice(0, 5)) {
      console.log('NAVI Event Type:', ev.type, 'Date:', new Date(Number(ev.timestampMs)).toISOString());
      console.log('Data:', JSON.stringify(ev.parsedJson, null, 2));
    }
  } catch (err: any) {
    console.error('NAVI query error:', err.message);
  }
}

main().catch(console.error);
