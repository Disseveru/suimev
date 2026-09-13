import { DeepBookClient } from '@mysten/deepbook-v3';
import { suiClient } from '../src/client/suiClient.js';
import { DEEPBOOK_CONFIG } from '../src/config/constants.js';

async function main() {
  const dbClient = new DeepBookClient({
    client: suiClient as any,
    address: '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d',
    network: 'mainnet',
  });
  console.log('DeepBookClient methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(dbClient)));
  const usdsui = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
  const usdc = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const sui = '0x2::sui::SUI';

  try {
    const p1 = await dbClient.getPoolIdByAssets(usdsui, usdc);
    console.log('DeepBook pool USDSUI / USDC:', p1);
  } catch (e: any) {
    console.log('Error USDSUI/USDC:', e.message);
  }

  try {
    const p2 = await dbClient.getPoolIdByAssets(usdc, usdsui);
    console.log('DeepBook pool USDC / USDSUI:', p2);
  } catch (e: any) {
    console.log('Error USDC/USDSUI:', e.message);
  }

  try {
    const p3 = await dbClient.getPoolIdByAssets(usdsui, sui);
    console.log('DeepBook pool USDSUI / SUI:', p3);
  } catch (e: any) {
    console.log('Error USDSUI/SUI:', e.message);
  }
}

main().catch(console.error);
