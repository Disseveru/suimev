import { suiClient } from '../client/suiClient.js';
import { SCALLOP_CONFIG } from '../config/constants.js';

async function main() {
  const res = await suiClient.queryEvents({
    query: {
      MoveModule: { package: SCALLOP_CONFIG.protocolPkg, module: 'liquidate' },
    },
    limit: 5,
  });
  for (const ev of res.data) {
    console.log('Digest:', ev.id.txDigest);
  }
}

main().catch(console.error);
