import { NAVI_CONFIG, SCALLOP_CONFIG, CETUS_CONFIG, DEEPBOOK_CONFIG, PYTH_CONFIG } from '../src/config/constants.js';
import { suiClient as client } from '../src/client/suiClient.js';

async function verify() {
  const ids: [string, string][] = [
    ['NAVI Package', NAVI_CONFIG.packageId],
    ['NAVI Storage', NAVI_CONFIG.storage],
    ['NAVI Flashloan Config', NAVI_CONFIG.flashloanConfig],
    ['Scallop Market', SCALLOP_CONFIG.market],
    ['Scallop Version', SCALLOP_CONFIG.version],
    ['Scallop Protocol Pkg', SCALLOP_CONFIG.protocolPkg],
    ['DeepBook v3 Pkg', DEEPBOOK_CONFIG.v3PackageId],
    ['DeepBook Registry', DEEPBOOK_CONFIG.registryId],
    ['Cetus Pool Pkg', CETUS_CONFIG.clmmPoolPackageId],
    ['Cetus Global Config', CETUS_CONFIG.globalConfigId],
    ['Pyth Pkg', PYTH_CONFIG.packageId],
  ];

  for (const [name, id] of ids) {
    try {
      const obj = await client.getObject({ id, options: { showType: true } });
      if (obj.error) {
        console.log(`[FAIL] ${name}: ${id} Error: ${JSON.stringify(obj.error)}`);
      } else {
        console.log(`[PASS] ${name}: ${id} (exists on mainnet, type: ${obj.data?.type || 'package'})`);
      }
    } catch (e: any) {
      console.error(`[ERROR] ${name}: ${id} - ${e.message}`);
    }
  }
}

verify();
