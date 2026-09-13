import { suiClient } from '../src/client/suiClient.js';

async function run() {
  console.log('Querying DeepBook v3 package events...');
  const events = await suiClient.queryEvents({
    query: {
      MoveModule: {
        package: '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809',
        module: 'registry',
      },
    },
    limit: 50,
  });

  console.log(`Found ${events.data.length} DeepBook registry events:`);
  for (const ev of events.data) {
    console.log(ev.type, JSON.stringify(ev.parsedJson));
  }
}

run().catch(console.error);
