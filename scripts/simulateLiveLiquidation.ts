import chalk from 'chalk';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SUI_CLOCK_OBJECT_ID, SUI_SYSTEM_STATE_OBJECT_ID } from '../src/config/constants.js';
import { CONFIG } from '../src/config/index.js';
import * as navi from '@naviprotocol/lending';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';

async function main() {
  console.log(chalk.cyan('Simulating Live Liquidation on 0x09eb6ca0add5a9d563f281fdd3a0378b596b1eea5265f830ff80851febb94e72...'));

  const borrower = '0x09eb6ca0add5a9d563f281fdd3a0378b596b1eea5265f830ff80851febb94e72';
  const suiCoinType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  const usdcCoinType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  const debtAssetId = 10;
  const debtPoolContract = '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8';

  const collateralAssetId = 0;
  const collateralPoolContract = '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5';

  const tx = new Transaction();
  tx.setSender(CONFIG.operatorAddress);
  tx.setGasBudget(100_000_000n);

  // 1. Refresh Pyth oracle prices for borrower's pools
  const poolList = await (navi as any).getPools();
  await (navi as any).updateOraclePriceBeforeUserOperationPTB(tx, borrower, poolList);

  // 2. Flash swap USDC from Cetus CLMM
  const cetusClmmPkg = '0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3';
  const cetusGlobalConfig = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
  const cetusUsdcSuiPool = '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab';

  // We flash-borrow 144 units of USDC (~0.000144 USDC)
  const borrowAmount = 144n;
  const maxSqrtPrice = '79226673515401279992447579054';

  const [usdcBalance, emptySuiBalance, flashReceipt] = tx.moveCall({
    target: `${cetusClmmPkg}::pool::flash_swap`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [
      tx.object(cetusGlobalConfig),
      tx.object(cetusUsdcSuiPool),
      tx.pure.bool(false), // a2b = false (borrow USDC, will pay SUI)
      tx.pure.bool(false), // by_amount_in = false (exact amount out)
      tx.pure.u64(borrowAmount),
      tx.pure.u128(maxSqrtPrice),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  // Query how much SUI is owed to repay flash swap
  const payAmount = tx.moveCall({
    target: `${cetusClmmPkg}::pool::swap_pay_amount`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [flashReceipt],
  });

  // 3. Liquidate borrower on NAVI
  const [collateralBalance, leftoverDebtBalance] = tx.moveCall({
    target: `${NAVI_CONFIG.packageId}::incentive_v3::liquidation_v2`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [
      tx.object(SUI_CLOCK_OBJECT_ID),
      tx.object(NAVI_CONFIG.priceOracle),
      tx.object(NAVI_CONFIG.storage),
      tx.pure.u8(debtAssetId),
      tx.object(debtPoolContract),
      usdcBalance,
      tx.pure.u8(collateralAssetId),
      tx.object(collateralPoolContract),
      tx.pure.address(borrower),
      tx.object(NAVI_CONFIG.incentiveV2),
      tx.object(NAVI_CONFIG.incentiveV3),
      tx.object(SUI_SYSTEM_STATE_OBJECT_ID),
    ],
  });

  // 4. Convert seized collateral balance to Coin
  const collateralSuiCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [suiCoinType],
    arguments: [collateralBalance],
  });

  // Repay from gas temporarily to observe exact amounts
  const [repaySuiCoin] = tx.splitCoins(tx.gas, [payAmount]);
  const repaySuiBalance = tx.moveCall({
    target: '0x2::coin::into_balance',
    typeArguments: [suiCoinType],
    arguments: [repaySuiCoin],
  });

  const zeroUsdcBalance = tx.moveCall({
    target: '0x2::balance::zero',
    typeArguments: [usdcCoinType],
    arguments: [],
  });

  tx.moveCall({
    target: `${cetusClmmPkg}::pool::repay_flash_swap`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [
      tx.object(cetusGlobalConfig),
      tx.object(cetusUsdcSuiPool),
      zeroUsdcBalance,
      repaySuiBalance,
      flashReceipt,
    ],
  });

  // 5. Leftover coins and net profit transfer
  const leftoverDebtCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [usdcCoinType],
    arguments: [leftoverDebtBalance],
  });

  const emptySuiCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [suiCoinType],
    arguments: [emptySuiBalance],
  });

  // collateralSuiCoin now holds the pure net profit (remaining collateral after paying Cetus)
  tx.transferObjects([collateralSuiCoin, leftoverDebtCoin, emptySuiCoin], tx.pure.address(CONFIG.operatorAddress));

  console.log('Simulating PTB with devInspect...');
  const commands = (tx.getData() as any).commands || [];
  for (let i = 40; i < commands.length; i++) {
    console.log(`Command ${i}:`, JSON.stringify(commands[i]));
  }
  const simResult = await suiClient.devInspectTransactionBlock({
    sender: CONFIG.operatorAddress,
    transactionBlock: tx,
  });

  console.log('Simulation Status:', simResult.effects.status.status);
  if (simResult.effects.status.status === 'failure') {
    console.log(chalk.red('Error:'), simResult.effects.status.error);
    if (simResult.results) {
      for (let i = 45; i < simResult.results.length; i++) {
        console.log(`Result ${i}:`, JSON.stringify(simResult.results[i]));
      }
    }
  } else {
    console.log(chalk.bold.green('🚀 SIMULATION SUCCESSFUL!'));
    console.log('Gas used:', simResult.effects.gasUsed);
    console.log('Balance changes:', simResult.balanceChanges);
    if (simResult.results) {
      for (let i = 44; i < simResult.results.length; i++) {
        console.log(`Result ${i}:`, JSON.stringify(simResult.results[i]));
      }
    }
  }
}

main().catch(console.error);
