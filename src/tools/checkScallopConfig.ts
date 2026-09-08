import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { SCALLOP_CONFIG } from '../config/constants.js';

async function checkScallopConfig() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;

  const addr = sdk.client.address;
  console.log('=== SCALLOP ADDR COMPARISON ===');
  console.log('market in constants:             ', SCALLOP_CONFIG.market);
  console.log('market in SDK:                   ', addr.get('core.market'));
  console.log('version in constants:            ', SCALLOP_CONFIG.version);
  console.log('version in SDK:                  ', addr.get('core.version'));
  console.log('coinDecimalsRegistry in const:   ', SCALLOP_CONFIG.coinDecimalsRegistry);
  console.log('coinDecimalsRegistry in SDK:     ', addr.get('core.coinDecimalsRegistry'));
  console.log('xOracle in constants:            ', SCALLOP_CONFIG.xOracle);
  console.log('xOracle in SDK:                  ', addr.get('core.oracles.xOracle'));
  console.log('protocolPkg in constants:        ', SCALLOP_CONFIG.protocolPkg);
  console.log('protocolPkg in SDK:              ', addr.get('core.packages.protocol.id'));
}

checkScallopConfig().catch(console.error);
