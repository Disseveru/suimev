import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG } from '../src/config/constants.js';

async function main() {
  const events = await suiClient.queryEvents({
    query: { MoveModule: { package: NAVI_CONFIG.packageId, module: 'lending' } },
    limit: 50,
  });
  const types = new Set<string>();
  for (const ev of events.data) {
    types.add(ev.type);
  }
  console.log('NAVI lending event types:', Array.from(types));

  const incEvents = await suiClient.queryEvents({
    query: { MoveModule: { package: NAVI_CONFIG.packageId, module: 'incentive_v3' } },
    limit: 50,
  });
  const incTypes = new Set<string>();
  for (const ev of incEvents.data) {
    incTypes.add(ev.type);
  }
  console.log('NAVI incentive event types:', Array.from(incTypes));
}

main().catch(console.error);
