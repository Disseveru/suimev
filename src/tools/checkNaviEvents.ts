import { rpcManager } from '../client/suiClient.js';
import { NAVI_CONFIG } from '../config/constants.js';

async function checkNaviEvents() {
  const pkgNorm = await rpcManager.executeWithFallback('getNormalizedMoveModulesByPackage', (client) =>
    client.getNormalizedMoveModulesByPackage({ package: NAVI_CONFIG.packageId })
  );

  const lendingMod = pkgNorm['lending'];
  console.log('Lending struct types:');
  for (const [name, struct] of Object.entries(lendingMod.structs)) {
    if (struct.abilities.abilities.includes('Drop') && struct.abilities.abilities.includes('Copy')) {
      console.log('  Event struct:', name, Object.keys(struct.fields));
    }
  }

  const incentiveV3 = pkgNorm['incentive_v3'];
  console.log('\nIncentive_v3 struct types:');
  for (const [name, struct] of Object.entries(incentiveV3.structs)) {
    if (struct.abilities.abilities.includes('Drop') && struct.abilities.abilities.includes('Copy')) {
      console.log('  Event struct:', name, Object.keys(struct.fields));
    }
  }
}

checkNaviEvents().catch(console.error);
