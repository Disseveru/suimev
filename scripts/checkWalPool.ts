import { suiClient } from '../src/client/suiClient.js';

async function run() {
  const pool = await suiClient.getObject({
    id: '0x47e8211061ce047fafb3c547dde4d316bea7ed82f148d68bbed2a6ed89b74d04',
    options: { showContent: true },
  });
  console.log('USDC_WAL pool content:', JSON.stringify(pool.data?.content, null, 2));
}

run().catch(console.error);
