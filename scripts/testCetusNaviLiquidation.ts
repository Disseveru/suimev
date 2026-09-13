import chalk from 'chalk';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SUI_CLOCK_OBJECT_ID, SUI_SYSTEM_STATE_OBJECT_ID } from '../src/config/constants.js';
import { CONFIG } from '../src/config/index.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import * as navi from '@naviprotocol/lending';

async function main() {
  await naviProtocol.initialize();
  const borrower = '0x4202f211420c600fbc07fbe0744b16b31d833a999cb17c72b3fa129c58263b04';
  const suiCoinType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  const cetusCoinType = '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS';

  const cetusPool = naviProtocol.getPoolByCoinType(cetusCoinType);
  const suiPool = naviProtocol.getPoolByCoinType(suiCoinType);

  console.log('CETUS pool contract:', cetusPool?.poolContract, 'id:', cetusPool?.id);
  console.log('SUI pool contract:', suiPool?.poolContract, 'id:', suiPool?.id);

  const cetusClmmPkg = '0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3';
  const cetusGlobalConfig = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
  const cetusSuiCetusPool = '0x2e041f3fd93646dcc877f783c1f2b7fa62d30271bdef1f21ef002cebf857bded';

  const tx = new Transaction();
  tx.setSender(CONFIG.operatorAddress);
  tx.setGasBudget(100_000_000n);

  // 1. Pyth price update
  const poolList = await (navi as any).getPools();
  await (navi as any).updateOraclePriceBeforeUserOperationPTB(tx, borrower, poolList);

  // Flash borrow 10 CETUS = 10_000_000_000 raw units
  const borrowCetusAmount = 10_000_000_000n;
  const maxSqrtPrice = '79226673515401279992447579054';

  const [cetusBalance, emptySuiBalance, flashReceipt] = tx.moveCall({
    target: `${cetusClmmPkg}::pool::flash_swap`,
    typeArguments: [cetusCoinType, suiCoinType],
    arguments: [
      tx.object(cetusGlobalConfig),
      tx.object(cetusSuiCetusPool),
      tx.pure.bool(false), // a2b = false (receive CETUS, pay SUI)
      tx.pure.bool(false), // by_amount_in = false
      tx.pure.u64(borrowCetusAmount),
      tx.pure.u128(maxSqrtPrice),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  const paySuiAmount = tx.moveCall({
    target: `${cetusClmmPkg}::pool::swap_pay_amount`,
    typeArguments: [cetusCoinType, suiCoinType],
    arguments: [flashReceipt],
  });

  // 2. Liquidate CETUS debt on NAVI, seizing SUI collateral
  const [collateralSuiBalance, leftoverCetusBalance] = tx.moveCall({
    target: `${NAVI_CONFIG.packageId}::incentive_v3::liquidation_v2`,
    typeArguments: [cetusCoinType, suiCoinType],
    arguments: [
      tx.object(SUI_CLOCK_OBJECT_ID),
      tx.object(NAVI_CONFIG.priceOracle),
      tx.object(NAVI_CONFIG.storage),
      tx.pure.u8(cetusPool!.id),
      tx.object(cetusPool!.poolContract),
      cetusBalance,
      tx.pure.u8(suiPool!.id),
      tx.object(suiPool!.poolContract),
      tx.pure.address(borrower),
      tx.object(NAVI_CONFIG.incentiveV2),
      tx.object(NAVI_CONFIG.incentiveV3),
      tx.object(SUI_SYSTEM_STATE_OBJECT_ID),
    ],
  });

  // 3. Convert collateral SUI balance to coin
  const seizedSuiCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [suiCoinType],
    arguments: [collateralSuiBalance],
  });

  // Split exact repayment out of SEIZED COLLATERAL (zero-capital!)
  const [repaySuiCoin] = tx.splitCoins(seizedSuiCoin, [paySuiAmount]);
  const repaySuiBalance = tx.moveCall({
    target: '0x2::coin::into_balance',
    typeArguments: [suiCoinType],
    arguments: [repaySuiCoin],
  });

  const zeroCetusBalance = tx.moveCall({
    target: '0x2::balance::zero',
    typeArguments: [cetusCoinType],
    arguments: [],
  });

  tx.moveCall({
    target: `${cetusClmmPkg}::pool::repay_flash_swap`,
    typeArguments: [cetusCoinType, suiCoinType],
    arguments: [
      tx.object(cetusGlobalConfig),
      tx.object(cetusSuiCetusPool),
      zeroCetusBalance,
      repaySuiBalance,
      flashReceipt,
    ],
  });

  const leftoverCetusCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [cetusCoinType],
    arguments: [leftoverCetusBalance],
  });

  const emptySuiCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [suiCoinType],
    arguments: [emptySuiBalance],
  });

  // Transfer remaining seizedSuiCoin (NET MEV PROFIT!) to operator!
  tx.transferObjects([seizedSuiCoin, leftoverCetusCoin, emptySuiCoin], tx.pure.address(CONFIG.operatorAddress));

  console.log('Simulating PTB with devInspect...');
  const simResult = await suiClient.devInspectTransactionBlock({
    sender: CONFIG.operatorAddress,
    transactionBlock: tx,
  });

  console.log('Status:', simResult.effects.status.status);
  if (simResult.effects.status.status === 'failure') {
    console.log(chalk.red('Error:'), simResult.effects.status.error);
  } else {
    console.log(chalk.bold.green('🚀 LIQUIDATION SIMULATION SUCCEEDED 100% ATOMIC ZERO-CAPITAL!'));
    console.log('Balance changes:', simResult.balanceChanges);
  }
}

main().catch(console.error);
