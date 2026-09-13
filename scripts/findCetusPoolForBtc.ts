import { suiClient } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

async function main() {
  const btcType = '0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC';
  const usdcType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const usdtType = '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT';
  const suiType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

  console.log('Querying Cetus pool created events for BTC...');
  const events = await suiClient.queryEvents({
    query: {
      MoveEventType: `${CETUS_CONFIG.clmmPoolPackageId}::factory::CreatePoolEvent`,
    },
    limit: 50,
  });

  console.log(`Found ${events.data.length} CreatePool events`);
  for (const ev of events.data) {
    const parsed = ev.parsedJson as any;
    if (parsed.coin_type_a?.includes('btc') || parsed.coin_type_b?.includes('btc') ||
        parsed.coin_type_a?.includes('BTC') || parsed.coin_type_b?.includes('BTC')) {
      console.log('BTC Pool found:', parsed);
    }
  }
}

main().catch(console.error);
