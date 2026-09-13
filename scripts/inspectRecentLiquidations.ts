import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SCALLOP_CONFIG } from '../src/config/constants.js';

async function main() {
  console.log('--- 1. Querying NAVI Liquidation Events ---');
  try {
    const naviLiq = await suiClient.queryEvents({
      query: {
        MoveModule: { package: NAVI_CONFIG.packageId, module: 'incentive_v3' },
      },
      limit: 100,
    });
    const liqs = naviLiq.data.filter((e) => e.type.toLowerCase().includes('liquidat'));
    console.log(`Found ${liqs.length} liquidation events in recent 100 incentive_v3 events`);
    for (const l of liqs.slice(0, 5)) {
      console.log('NAVI Liquidation:', l.timestampMs ? new Date(Number(l.timestampMs)).toISOString() : '', l.parsedJson);
    }
  } catch (e: any) {
    console.log('NAVI error:', e.message);
  }

  console.log('\n--- 2. Querying Scallop Liquidation Events ---');
  try {
    const scallopLiq = await suiClient.queryEvents({
      query: {
        MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'liquidator' },
      },
      limit: 100,
    });
    console.log(`Found ${scallopLiq.data.length} Scallop liquidator events`);
    for (const l of scallopLiq.data.slice(0, 5)) {
      console.log('Scallop Liquidation:', l.timestampMs ? new Date(Number(l.timestampMs)).toISOString() : '', l.parsedJson);
    }
  } catch (e: any) {
    console.log('Scallop error:', e.message);
  }
}

main().catch(console.error);
