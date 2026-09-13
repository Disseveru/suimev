import { SuiClientManager } from '../src/client/suiClient.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  // Check primary price update policy object
  const xOracle = await client.getObject({
    id: '0x93d5bf0936b71eb27255941e532fac33b5a5c7759e377b4923af0a1359ad494f',
    options: { showContent: true }
  });
  console.log('xOracle:', JSON.stringify(xOracle, null, 2));
}

main().catch(console.error);
