import { createPublicClient, http } from 'viem';

const client = createPublicClient({ transport: http('https://evm-rpc.sei-apis.com') });

async function checkRouter() {
  const code = await client.getBytecode({ address: '0xa4cf2f53d1195addde9e4d3aca54f556895712f2' });
  console.log('[PASS] Official DragonSwap Router Bytecode length:', code ? code.length : 0);
  const factoryCode = await client.getBytecode({ address: '0x71f6b49ae1558357bBb5A6074f1143c46cBcA03d' });
  console.log('[PASS] Official DragonSwap Factory Bytecode length:', factoryCode ? factoryCode.length : 0);
  process.exit(0);
}

checkRouter().catch(console.error);
