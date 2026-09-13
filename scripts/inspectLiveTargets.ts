import { suiClient } from '../src/client/suiClient.js';
import { getLendingPositions, getHealthFactor } from '@naviprotocol/lending';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';

const targets = [
  '0x661bd4c2117bcb4e4143fe3736b83745d84af9ba2a3cf73b9c1e194e6aef46b8',
  '0x09eb6ca0add5a9d563f281fdd3a0378b596b1eea5265f830ff80851febb94e72',
];

async function main() {
  await naviProtocol.initialize();
  for (const addr of targets) {
    console.log(`\n=== TARGET: ${addr} ===`);
    try {
      const positions = await getLendingPositions(addr, { client: suiClient as any });
      console.log('Positions:', JSON.stringify(positions, null, 2));
      const hf = await getHealthFactor(addr, { client: suiClient as any });
      console.log('NAVI SDK HF:', hf);
    } catch (e: any) {
      console.log('Error:', e.message);
    }
  }
}

main().catch(console.error);
