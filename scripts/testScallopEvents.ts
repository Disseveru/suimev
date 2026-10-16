import { suiClient } from '../src/client/suiClient.js';
import { SCALLOP_CONFIG } from '../src/config/constants.js';

async function main() {
  console.log('Querying latest Scallop borrow events...');
  const borrowEvents = await suiClient.queryEvents({
    query: { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'borrow' } },
    limit: 10,
  });

  console.log('Got borrow events:', borrowEvents.data.length);
  for (const ev of borrowEvents.data) {
    console.log('Event:', JSON.stringify(ev.parsedJson));
  }

  console.log('\nQuerying latest Scallop open_obligation events...');
  const openEvents = await suiClient.queryEvents({
    query: { MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'open_obligation' } },
    limit: 10,
  });
  console.log('Got open events:', openEvents.data.length);
  for (const ev of openEvents.data) {
    console.log('Event:', JSON.stringify(ev.parsedJson));
  }
}

main().catch(console.error);
