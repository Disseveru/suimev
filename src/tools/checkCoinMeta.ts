import { SuiClientManager } from '../client/suiClient.js';

async function run() {
  const client = SuiClientManager.getInstance().getClient();
  const coinTypes = [
    '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC',
    '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
  ];
  for (const t of coinTypes) {
    const meta = await client.getCoinMetadata({ coinType: t });
    console.log(t, '->', meta);
  }
}

run().catch(console.error);
