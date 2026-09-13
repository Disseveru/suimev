import { suiClient } from '../src/client/suiClient.js';
import { createPublicClient, http } from 'viem';
import { mainnet, arbitrum, optimism, base, polygon, bsc, avalanche, sepolia } from 'viem/chains';

const hash = '0x2f209d34bbe5acebcfc90980a551a72bdd97da1b4d444a4b8f09517cba77fb38';

async function investigate() {
  console.log('--- INVESTIGATING TX HASH:', hash);
  const evmChains = [
    { name: 'Ethereum Mainnet', chain: mainnet, rpc: 'https://eth.llamarpc.com' },
    { name: 'Base', chain: base, rpc: 'https://mainnet.base.org' },
    { name: 'Arbitrum One', chain: arbitrum, rpc: 'https://arb1.arbitrum.io/rpc' },
    { name: 'Optimism', chain: optimism, rpc: 'https://mainnet.optimism.io' },
    { name: 'Polygon', chain: polygon, rpc: 'https://polygon-rpc.com' },
    { name: 'BNB Chain', chain: bsc, rpc: 'https://binance.llamarpc.com' },
    { name: 'Avalanche C-Chain', chain: avalanche, rpc: 'https://api.avax.network/ext/bc/C/rpc' },
    { name: 'Ethereum Sepolia', chain: sepolia, rpc: 'https://rpc.sepolia.org' },
    { name: 'Sei v2 EVM', chain: { id: 1329, name: 'Sei' }, rpc: 'https://evm-rpc.sei-apis.com' },
  ];

  for (const c of evmChains) {
    try {
      const client = createPublicClient({ chain: c.chain as any, transport: http(c.rpc) });
      const tx = await client.getTransaction({ hash: hash as `0x${string}` });
      if (tx) {
        console.log(`\n🎉 MATCH FOUND ON: ${c.name}!`);
        console.log('Sender (From):', tx.from);
        console.log('Contract/Recipient (To):', tx.to);
        console.log('Value (wei):', tx.value.toString());
        const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
        console.log('Status:', receipt.status);
        console.log('Block Number:', receipt.blockNumber.toString());
        return;
      }
    } catch {
      // ignore
    }
  }

  console.log('\nNot found as a standard transaction on the top 9 EVM chains.');
}

investigate().catch(console.error);
