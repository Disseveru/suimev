export interface ChainConfig {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorer: string;
  protocols: {
    lendingPool?: `0x${string}`;
    swapRouter?: `0x${string}`;
    poolDataProvider?: `0x${string}`;
    balancerVault?: `0x${string}`;
  };
}

export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
  sei: {
    id: 1329,
    name: 'Sei Network (v2 EVM)',
    nativeCurrency: { name: 'Sei', symbol: 'SEI', decimals: 18 },
    rpcUrls: [
      'https://evm-rpc.sei-apis.com',
      'https://sei-evm-rpc.stakeme.pro',
      'https://evm-rpc-sei.whispernode.com',
    ],
    blockExplorer: 'https://seitrace.com',
    protocols: {
      lendingPool: '0x4a4d9abD36F923cBA0Af62A39C01dEC2944fb638', // Yei Finance Pool-Proxy (Verified on-chain)
      swapRouter: '0xa4cf2f53d1195addde9e4d3aca54f556895712f2',  // DragonSwap Router (Verified on-chain)
      poolDataProvider: '0x60c82A40C57736a9c692C42e87A8849Fb407F0d6', // Yei PoolDataProvider
    },
  },
  'sei-testnet': {
    id: 1328,
    name: 'Sei Atlantic-2 Testnet',
    nativeCurrency: { name: 'Sei', symbol: 'SEI', decimals: 18 },
    rpcUrls: [
      'https://evm-rpc-testnet.sei-apis.com',
      'https://sei-testnet-evm.stakeme.pro',
    ],
    blockExplorer: 'https://testnet.seitrace.com',
    protocols: {},
  },
  monad: {
    id: 10143, // Monad Public Devnet/Testnet Chain ID
    name: 'Monad',
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: [
      'https://testnet-rpc.monad.xyz',
      'https://monad-testnet.g.alchemy.com/v2/demo',
    ],
    blockExplorer: 'https://testnet.monadexplorer.com',
    protocols: {},
  },
};
