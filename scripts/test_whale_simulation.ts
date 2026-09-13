import { Transaction } from '@mysten/sui/transactions';
import { SuiClientManager } from '../src/client/suiClient.js';
import { SCALLOP_CONFIG, SUI_CLOCK_OBJECT_ID } from '../src/config/constants.js';

const SCALLOP_ORACLE_CONFIG = {
  xOraclePkg: '0xbf926dd6ecdd3bb5231659b739e20cf864dc12f13c5b4c8b939d00fa70350b3a',
  xOracle: '0x93d5bf0936b71eb27255941e532fac33b5a5c7759e377b4923af0a1359ad494f',
  pythRulePkg: '0x71fddacc6ecf164bd8f6c081092beeef20945c5da2c74e0b9f3e1d3c7003fadd',
  pythRegistry: '0xdf5a879c4a572c7a143839c019ca114eaaf696426b6c95a052b865c06f12e279',
  pythState: '0x03719fae774ddab3cfcaa53bbc046f0cbe21410019b6280811bf3f9f4b05839d',
  customRulePkg: '0xcac8cfce94faf15ecbfe12eb5160d512e383d4c25403179515c654f5975fffb9',
  customRegistry: '0x52e60fbe72782c8c9161ab7a3c45cf77b29ed256edefca1577b2c94b03570e70',
  coins: {
    sbeth: {
      type: 'pyth',
      coinType: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
      feedObject: '0x88d7ef5396b1f885ed347f97f3b58daae8a424122668e96bdb4ee847cff62adf',
    },
    usdy: {
      type: 'pyth',
      coinType: '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
      feedObject: '0xd726651e0ef603ac13eaa7c165cd0a192fc6434cc00976c9220459044775a093',
    },
    wal: {
      type: 'pyth',
      coinType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
      feedObject: '0xdbea8600eeeb0399df58c28e73b8201ae880a954813131d33bfa6902ccdadd24',
    },
    deep: {
      type: 'pyth',
      coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
      feedObject: '0x562957f70afaf8a0870e2959abc3e3f327a8159f803d8c56cff27ac2df260477',
    },
    usdc: {
      type: 'pyth',
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      feedObject: '0x6ddfc6f9921e55998cbc2e68f78eba897981d79ac17f66c5277bc38954a2a3f8',
    },
    sui: {
      type: 'pyth',
      coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
      feedObject: '0x89b2add829cb6fcd017153fff428bc9faec4d06d643ecfc435af5b55a9e987f0',
    },
    fdusd: {
      type: 'pyth',
      coinType: '0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD',
      feedObject: '0xf905acf04bac920b667192ea97ea82e615e6a640167b05dcd090df27d85a3ca2',
    },
    sbusdt: {
      type: 'pyth',
      coinType: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
      feedObject: '0x939e666c48cfac89418f69a24cb857263d4c520f90d94ea0770e295b9857961e',
    },
    sca: {
      type: 'custom',
      coinType: '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA',
    },
  },
};

function addPriceUpdates(tx: Transaction, coinKeys: (keyof typeof SCALLOP_ORACLE_CONFIG.coins)[]) {
  for (const k of coinKeys) {
    const info = SCALLOP_ORACLE_CONFIG.coins[k];
    const [request] = tx.moveCall({
      target: `${SCALLOP_ORACLE_CONFIG.xOraclePkg}::x_oracle::price_update_request`,
      typeArguments: [info.coinType],
      arguments: [tx.object(SCALLOP_ORACLE_CONFIG.xOracle)],
    });

    if (info.type === 'pyth') {
      tx.moveCall({
        target: `${SCALLOP_ORACLE_CONFIG.pythRulePkg}::rule::set_price_as_primary`,
        typeArguments: [info.coinType],
        arguments: [
          request,
          tx.object(SCALLOP_ORACLE_CONFIG.pythState),
          tx.object((info as any).feedObject),
          tx.object(SCALLOP_ORACLE_CONFIG.pythRegistry),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    } else if (info.type === 'custom') {
      tx.moveCall({
        target: `${SCALLOP_ORACLE_CONFIG.customRulePkg}::rule::set_price_as_primary`,
        typeArguments: [info.coinType],
        arguments: [
          request,
          tx.object(SCALLOP_ORACLE_CONFIG.customRegistry),
          tx.object(SUI_CLOCK_OBJECT_ID),
        ],
      });
    }

    tx.moveCall({
      target: `${SCALLOP_ORACLE_CONFIG.xOraclePkg}::x_oracle::confirm_price_update_request`,
      typeArguments: [info.coinType],
      arguments: [
        tx.object(SCALLOP_ORACLE_CONFIG.xOracle),
        request,
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });
  }
}

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const tx = new Transaction();
  const whaleObligationId = '0x33fee6c01c25a4925ca053df2c99f0cb9d0c5c4985595b6e8eee5b66ebedb277';

  console.log('1. Injecting xOracle price updates for all 9 whale assets...');
  addPriceUpdates(tx, ['sbeth', 'usdy', 'wal', 'deep', 'usdc', 'sui', 'fdusd', 'sbusdt', 'sca']);

  console.log('2. Adding force_unstake_unhealthy_v3...');
  tx.moveCall({
    target: `${SCALLOP_CONFIG.borrowIncentivePkg}::user::force_unstake_unhealthy_v3`,
    arguments: [
      tx.object(SCALLOP_CONFIG.borrowIncentiveConfig),
      tx.object(SCALLOP_CONFIG.borrowIncentivePools),
      tx.object(SCALLOP_CONFIG.borrowIncentiveAccounts),
      tx.object(SCALLOP_CONFIG.version),
      tx.object(whaleObligationId),
      tx.object(SCALLOP_CONFIG.market),
      tx.object(SCALLOP_CONFIG.coinDecimalsRegistry),
      tx.object(SCALLOP_CONFIG.xOracle),
      tx.object(SCALLOP_CONFIG.vescaSubsTable),
      tx.object(SCALLOP_CONFIG.vescaSubsWhitelist),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  console.log('Simulating full atomic unstake on whale obligation...');
  const res = await client.devInspectTransactionBlock({
    sender: '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d',
    transactionBlock: tx,
  });

  console.log('Simulation Status:', res.effects.status);
  if (res.error) {
    console.error('Simulation Error:', res.error);
  } else {
    console.log('🎉 UNSTAKE SIMULATION SUCCESSFUL! effects summary:');
    console.log('Mutated objects count:', res.effects.mutated?.length);
  }
}

main().catch(console.error);
