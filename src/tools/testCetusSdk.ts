import { initCetusSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClientManager } from '../client/suiClient.js';

async function testCetusSdk() {
  const sdk = initCetusSDK({ network: 'mainnet' });
  console.log('Cetus SDK initialized.');
  try {
    const pools = await sdk.Pool.getPoolsWithPage([]);
    console.log('Fetched Cetus pools count:', pools.length);
    for (const p of pools) {
      if (p.coinTypeA.includes('5d4b3025') || p.coinTypeB.includes('5d4b3025') ||
          p.coinTypeA.includes('c0600061') || p.coinTypeB.includes('c0600061')) {
        console.log('FOUND WORMHOLE POOL:', p.poolAddress, 'A:', p.coinTypeA, 'B:', p.coinTypeB);
      }
    }
  } catch (e: any) {
    console.error('Cetus SDK error:', e?.message || e);
  }
}

testCetusSdk().catch(console.error);
