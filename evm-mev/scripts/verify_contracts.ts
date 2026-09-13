import { createPublicClient, http } from 'viem';

const client = createPublicClient({
  transport: http('https://evm-rpc.sei-apis.com', { timeout: 10000 })
});

async function check() {
  const code = await client.getBytecode({ address: '0x37854f72f6e7812519965b622b38032746406983' });
  console.log('Yei Finance bytecode length:', code ? code.length : 0);
  const routerCode = await client.getBytecode({ address: '0x1a27a79a5e8f2780738d8d73bdf70233066e0c7c' });
  console.log('DragonSwap bytecode length:', routerCode ? routerCode.length : 0);
  process.exit(0);
}

check().catch(console.error);
