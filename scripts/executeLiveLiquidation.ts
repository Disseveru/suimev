import chalk from 'chalk';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SUI_CLOCK_OBJECT_ID, SUI_SYSTEM_STATE_OBJECT_ID } from '../src/config/constants.js';
import { CONFIG } from '../src/config/index.js';
import * as navi from '@naviprotocol/lending';

async function main() {
  console.log(chalk.bold.cyan('=== LIVE MAINNET LIQUIDATION EXECUTION ==='));
  console.log(chalk.yellow(`Operator Wallet: ${CONFIG.operatorAddress}`));
  console.log(chalk.yellow(`Target Borrower: 0x09eb6ca0add5a9d563f281fdd3a0378b596b1eea5265f830ff80851febb94e72`));

  const borrower = '0x09eb6ca0add5a9d563f281fdd3a0378b596b1eea5265f830ff80851febb94e72';
  const suiCoinType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  const usdcCoinType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

  const debtAssetId = 10;
  const debtPoolContract = '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8';

  const collateralAssetId = 0;
  const collateralPoolContract = '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5';

  const tx = new Transaction();
  tx.setSender(CONFIG.operatorAddress);
  tx.setGasBudget(100_000_000n); // 0.1 SUI budget

  // 1. Refresh Pyth oracle prices for borrower's pools
  console.log(chalk.blue('1. Fetching Pyth price feeds and adding update PTB commands...'));
  const poolList = await (navi as any).getPools();
  await (navi as any).updateOraclePriceBeforeUserOperationPTB(tx, borrower, poolList);

  // 2. Flash swap USDC from Cetus CLMM
  console.log(chalk.blue('2. Adding Cetus CLMM flash swap (144 units USDC)...'));
  const cetusClmmPkg = '0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3';
  const cetusGlobalConfig = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
  const cetusUsdcSuiPool = '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab';

  const borrowAmount = 144n;
  const maxSqrtPrice = '79226673515401279992447579054';

  const [usdcBalance, emptySuiBalance, flashReceipt] = tx.moveCall({
    target: `${cetusClmmPkg}::pool::flash_swap`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [
      tx.object(cetusGlobalConfig),
      tx.object(cetusUsdcSuiPool),
      tx.pure.bool(false), // a2b = false
      tx.pure.bool(false), // by_amount_in = false
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
  console.log(chalk.blue('3. Adding NAVI liquidation_v2 call...'));
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

  // 4. Repay flash swap with SUI from gas
  console.log(chalk.blue('4. Adding flash swap repayment...'));
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

  // 5. Convert seized collateral balance and leftover coins to Coins and transfer to operator
  console.log(chalk.blue('5. Adding profit transfer to operator wallet...'));
  const profitSuiCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [suiCoinType],
    arguments: [collateralBalance],
  });

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

  tx.transferObjects([profitSuiCoin, leftoverDebtCoin, emptySuiCoin], tx.pure.address(CONFIG.operatorAddress));

  // 6. Pre-flight simulation
  console.log(chalk.magenta('Pre-flight simulating PTB with devInspect...'));
  const simResult = await suiClient.devInspectTransactionBlock({
    sender: CONFIG.operatorAddress,
    transactionBlock: tx,
  });

  if (simResult.effects.status.status !== 'success') {
    console.error(chalk.bold.red('❌ Pre-flight simulation failed:'), simResult.effects.status.error);
    process.exit(1);
  }

  console.log(chalk.bold.green('✅ Pre-flight simulation SUCCEEDED!'));
  console.log(chalk.gray(`Computation Gas: ${simResult.effects.gasUsed.computationCost}`));

  // 7. BROADCAST TO SUI CONSENSUS
  console.log(chalk.bold.magenta('\n🚀 BROADCASTING LIVE LIQUIDATION TRANSACTION TO SUI MAINNET CONSENSUS...'));
  const executeResult = await suiClient.signAndExecuteTransaction({
    signer: CONFIG.operatorKeypair,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showBalanceChanges: true,
    },
  });

  const digest = executeResult.digest;
  console.log(chalk.bold.green(`\n🎉 TRANSACTION BROADCAST CONFIRMED!`));
  console.log(chalk.cyan(`Transaction Digest: ${digest}`));
  console.log(chalk.cyan(`SuiVision: https://suivision.xyz/txblock/${digest}`));
  console.log(chalk.cyan(`SuiScan: https://suiscan.xyz/mainnet/tx/${digest}`));

  console.log(chalk.blue('\nWaiting for transaction finality...'));
  const finality = await suiClient.waitForTransaction({
    digest,
    options: {
      showEffects: true,
      showEvents: true,
      showBalanceChanges: true,
    },
  });

  console.log(chalk.bold.green(`Status: ${finality.effects?.status?.status}`));
  console.log(chalk.yellow('Balance Changes:'), JSON.stringify(finality.balanceChanges, null, 2));
  console.log(chalk.yellow('Events:'), JSON.stringify(finality.events, null, 2));
}

main().catch((err) => {
  console.error(chalk.bold.red('Fatal error during live execution:'), err);
  process.exit(1);
});
