import { DeepBookClient } from '@mysten/deepbook-v3';
import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const dbClient = new DeepBookClient({
    client: suiClient as any,
    address: '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d',
    network: 'mainnet',
  });

  const poolId = '0xa374264d43e6baa5aa8b35ff18ff24fdba7443b4bcb884cb4c2f568d32cdac36';
  try {
    const midPrice = await dbClient.midPrice(poolId);
    console.log('DeepBook USDSUI/USDC midPrice:', midPrice);
  } catch (e: any) {
    console.log('midPrice error:', e.message);
  }

  try {
    const tradeParams = await dbClient.poolTradeParams(poolId);
    console.log('tradeParams:', tradeParams);
  } catch (e: any) {
    console.log('tradeParams error:', e.message);
  }

  try {
    const bookParams = await dbClient.poolBookParams(poolId);
    console.log('bookParams:', bookParams);
  } catch (e: any) {
    console.log('bookParams error:', e.message);
  }
}

main().catch(console.error);
