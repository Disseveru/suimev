import { suiClient } from '../src/client/suiClient.js';
import { getLendingPositions, getHealthFactor } from '@naviprotocol/lending';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';

async function main() {
  await naviProtocol.initialize();
  const addr = '0x92b642b603b144e734c11949265cffffff1a14d46cb4b0dac4e55e48baf3a295';
  const positions = await getLendingPositions(addr, { client: suiClient as any });
  console.log('Positions for', addr, ':', JSON.stringify(positions, null, 2));

  try {
    const hf = await getHealthFactor(addr, { client: suiClient as any });
    console.log('NAVI SDK HF:', hf);
  } catch (e: any) {
    console.log('HF error:', e.message);
  }
}

main().catch(console.error);
