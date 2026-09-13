import { createPublicClient, http } from 'viem';
import { mainnet, arbitrum, optimism, base, polygon, bsc, avalanche } from 'viem/chains';

const chains = [
  { name: 'Ethereum Mainnet', chain: mainnet, rpc: 'https://rpc.ankr.com/eth' },
  { name: 'Arbitrum', chain: arbitrum, rpc: 'https://rpc.ankr.com/arbitrum' },
  { name: 'Optimism', chain: optimism, rpc: 'https://rpc.ankr.com/optimism' },
  { name: 'Base', chain: base, rpc: 'https://rpc.ankr.com/base' },
  { name: 'Polygon', chain: polygon, rpc: 'https://rpc.ankr.com/polygon' },
  { name: 'BSC', chain: bsc, rpc: 'https://rpc.ankr.com/bsc' },
  { name: 'Avalanche', chain: avalanche, rpc: 'https://rpc.ankr.com/avalanche' },
];

async function checkAll() {
  const hash = '0x2f209d34bbe5acebcfc90980a551a72bdd97da1b4d444a4b8f09517cba77fb38';
  for (const c of chains) {
    try {
      const client = createPublicClient({ chain: c.chain, transport: http(c.rpc) });
      const tx = await client.getTransaction({ hash });
      if (tx) {
        console.log(`FOUND ON ${c.name}!`);
        console.log('From:', tx.from);
        console.log('To:', tx.to);
        console.log('Value:', tx.value.toString());
        return;
      }
    } catch (e) {
      // not found
    }
  }
  console.log('Not found on EVM chains');
}
checkAll();
