import { suiClient } from '../src/client/suiClient.js';

async function check() {
  const address = '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d';
  const balances = await suiClient.getAllBalances({ owner: address });
  console.log('All Coins on Address:', balances);

  const meta = await suiClient.getCoinMetadata({
    coinType: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH'
  });
  console.log('Coin Metadata:', meta);

  const coins = await suiClient.getCoins({
    owner: address,
    coinType: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH'
  });
  console.log('Coin Objects:', coins.data);
}

check().catch(console.error);
