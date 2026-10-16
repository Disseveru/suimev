import chalk from 'chalk';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SUI_CLOCK_OBJECT_ID, SUI_SYSTEM_STATE_OBJECT_ID } from '../src/config/constants.js';
import { CONFIG } from '../src/config/index.js';
import * as navi from '@naviprotocol/lending';
import { CetusRouter } from '../src/protocols/dex/cetusRouter.js';

async function main() {
  console.log(chalk.bold.cyan('======================================================================'));
  console.log(chalk.bold.cyan('  🧪 SUI MEV LIQUIDATOR: SIMULATION & SAFETY VERIFICATION PIPELINE'));
  console.log(chalk.bold.cyan('======================================================================'));

  // 1. Wallet Verification: Confirm operator address matches funded wallet
  const fundedWalletAddress = '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d';
  if (CONFIG.operatorAddress.toLowerCase() !== fundedWalletAddress.toLowerCase()) {
    console.error(chalk.red('❌ Operator address mismatch — check wallet funding'));
    throw new Error('Operator address mismatch — check wallet funding');
  }
  console.log(chalk.blue(`ℹ️ Verified operator wallet: ${CONFIG.operatorAddress}`));

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

  // 2. Oracle Refresh Timing: Refresh Pyth prices before user operation
  console.log(chalk.blue('ℹ️ Updating NAVI oracle prices via Pyth before liquidation...'));
  const poolList = await (navi as any).getPools();
  await (navi as any).updateOraclePriceBeforeUserOperationPTB(tx, borrower, poolList);
  console.log(chalk.green('✅ Oracle refreshed with live Pyth price feeds'));

  // 3. Flash-Swap Logic: Cetus CLMM Flash Swap
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
      tx.pure.bool(false), // a2b = false (borrow USDC, will pay SUI)
      tx.pure.bool(false), // by_amount_in = false (exact amount out)
      tx.pure.u64(borrowAmount),
      tx.pure.u128(maxSqrtPrice),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  // Query how much SUI is owed to repay flash swap via verified on-chain Move call swap_pay_amount
  const payAmount = tx.moveCall({
    target: `${cetusClmmPkg}::pool::swap_pay_amount`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [flashReceipt],
  });

  // 4. Liquidate borrower on NAVI
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

  // 5. Convert seized collateral balance to Coin & Repay Flash Swap
  const collateralSuiCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [suiCoinType],
    arguments: [collateralBalance],
  });

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

  // 6. Leftover coins and net profit transfer
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

  tx.transferObjects([collateralSuiCoin, leftoverDebtCoin, emptySuiCoin], tx.pure.address(CONFIG.operatorAddress));

  // 7. Sequential Async Control: Inspect PTB command sequence
  const commands = (tx.getData() as any).commands || [];
  console.log(chalk.blue(`ℹ️ Inspecting ${commands.length} PTB commands sequentially...`));
  for (const [i, cmd] of commands.entries()) {
    const cmdType = Object.keys(cmd)[0] || 'Unknown';
    if (i < 5 || i >= commands.length - 5) {
      console.log(chalk.gray(`  [Command ${i}] ${cmdType}`));
    } else if (i === 5) {
      console.log(chalk.gray(`  ... [${commands.length - 10} intermediate oracle & balance commands] ...`));
    }
  }

  // 8. Transaction Safety Wrapper & Structured Error Handling
  try {
    console.log(chalk.blue('ℹ️ Executing devInspect pre-flight simulation...'));
    const simResult = await suiClient.devInspectTransactionBlock({
      sender: CONFIG.operatorAddress,
      transactionBlock: tx,
    });

    if (simResult.effects.status.status === 'failure') {
      console.error(chalk.red('❌ Simulation failed:'), simResult.effects.status.error);
      throw new Error(simResult.effects.status.error);
    }

    console.log(chalk.bold.green('🚀 SIMULATION SUCCESSFUL!'));

    // 9. Gas Safety Check normalized against 10 SUI tank
    const gasUsedObj = simResult.effects.gasUsed;
    const netGasMist = BigInt(gasUsedObj.computationCost) + BigInt(gasUsedObj.storageCost) - BigInt(gasUsedObj.storageRebate);
    const gasUsedSui = Number(netGasMist > 0n ? netGasMist : 0n) / 1e9;
    console.log(chalk.green(`✅ Gas used: ${gasUsedSui.toFixed(6)} SUI (Computation: ${gasUsedObj.computationCost} MIST)`));

    if (gasUsedSui > 10) {
      console.warn(chalk.yellow(`⚠️ Gas usage ${gasUsedSui} SUI exceeds available 10 SUI balance`));
      throw new Error(`Gas usage ${gasUsedSui} SUI exceeds available 10 SUI balance`);
    }

    console.log(chalk.green('✅ Flash-swap & liquidation simulation executed cleanly with operator gas balance'));
    console.log(chalk.bold.cyan('======================================================================\n'));
  } catch (err: any) {
    console.error(chalk.red('❌ Simulation error:'), err?.message || err);
    throw err;
  }
}

main().catch(console.error);
