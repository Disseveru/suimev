import { getHealthFactor, getLendingPositions } from '@naviprotocol/lending';
import { suiClient } from '../src/client/suiClient.js';

const addrs = [
  '0x09ec154d6689230ff9be88a5b3820d1656b72477bed7de7cc9ab0d730c51767d',
  '0x4202f211420c600fbc07fbe0744b16b31d833a999cb17c72b3fa129c58263b04',
  '0x553c6c9d9ad3d07c02a75ef8c24f64cc71736ba558f3b35a96b992e1ffa33504',
  '0xbdabb158b96e26b2f981d818bf2874359058f8158830981eaf87f73b2d529f6e',
  '0x84e1b26743c563fe60eb44ae56c2dd4193d9ef931159e8dbfefe365093552298'
];

async function main() {
  for (const addr of addrs) {
    try {
      const hf = await getHealthFactor(addr, { client: suiClient as any });
      console.log(`Address ${addr} -> Health Factor: ${hf}`);
    } catch (e: any) {
      console.log(`Address ${addr} -> Error: ${e.message}`);
    }
  }
}

main().catch(console.error);
