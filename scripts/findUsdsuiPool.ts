import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const pools = [
    '0xa374264d', // prefix
  ];
  // Let's search DeepBook pools or Cetus pools for USDSUI and USDC
  const usdsui = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';
  const usdc = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  console.log('Searching for USDSUI / USDC pools...');
  // Check DeepBook v3 registry or Cetus
}

main().catch(console.error);
