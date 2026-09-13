import chalk from 'chalk';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SUI_CLOCK_OBJECT_ID, SUI_SYSTEM_STATE_OBJECT_ID } from '../src/config/constants.js';
import { CONFIG } from '../src/config/index.js';
import * as navi from '@naviprotocol/lending';

async function main() {
  console.log(chalk.cyan('Testing atomic liquidation PTB for 0x92b642b603b144e734c11949265cffffff1a14d46cb4b0dac4e55e48baf3a295...'));

  const borrower = '0x92b642b603b144e734c11949265cffffff1a14d46cb4b0dac4e55e48baf3a295';
  const debtCoinType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const collateralCoinType = '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI';

  const debtAssetId = 10;
  const debtPoolContract = '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8';

  const collateralAssetId = 34;
  const collateralPoolContract = '0xb0da1bf1702e919a3d5182939944435ccfd1b1facd92acb273007c3f09f42201';

  const deepBookPoolId = '0xa374264d43e6baa5aa8b35ff18ff24fdba7443b4bcb884cb4c2f568d32cdac36';
  const deepBookPackage = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809';

  // Repay 50 USDC (50_000_000 raw units)
  const repayAmount = 50_000_000n;
  const flashLoanFee = (repayAmount * 5n) / 10000n; // 5 bps = 25,000 units
  const totalRepayNeeded = repayAmount + flashLoanFee;

  const tx = new Transaction();
  tx.setSender(CONFIG.operatorAddress);
  tx.setGasBudget(100_000_000n);

  // 1. Refresh Pyth oracle prices for borrower's pools
  const poolList = await (navi as any).getPools();
  await (navi as any).updateOraclePriceBeforeUserOperationPTB(tx, borrower, poolList);

  // 2. Flash loan USDC from NAVI
  const [loanBalance, receipt] = tx.moveCall({
    target: `${NAVI_CONFIG.packageId}::lending::flash_loan_with_ctx`,
    arguments: [
      tx.object(NAVI_CONFIG.flashloanConfig),
      tx.object(debtPoolContract),
      tx.pure.u64(repayAmount),
    ],
    typeArguments: [debtCoinType],
  });

  // 3. Liquidate borrower
  // Move signature: liquidation_v2 takes Balance<DebtCoin> and returns (Balance<Collateral>, Balance<RemainingDebt>)
  const [collateralBalance, leftoverDebtBalance] = tx.moveCall({
    target: `${NAVI_CONFIG.packageId}::incentive_v3::liquidation_v2`,
    arguments: [
      tx.object(SUI_CLOCK_OBJECT_ID),
      tx.object(NAVI_CONFIG.priceOracle),
      tx.object(NAVI_CONFIG.storage),
      tx.pure.u8(debtAssetId),
      tx.object(debtPoolContract),
      loanBalance,
      tx.pure.u8(collateralAssetId),
      tx.object(collateralPoolContract),
      tx.pure.address(borrower),
      tx.object(NAVI_CONFIG.incentiveV2),
      tx.object(NAVI_CONFIG.incentiveV3),
      tx.object(SUI_SYSTEM_STATE_OBJECT_ID),
    ],
    typeArguments: [debtCoinType, collateralCoinType],
  });

  // Convert collateral Balance to Coin for DeepBook swap
  const collateralCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [collateralBalance],
    typeArguments: [collateralCoinType],
  });

  // Convert leftover debt Balance to Coin
  const leftoverDebtCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [leftoverDebtBalance],
    typeArguments: [debtCoinType],
  });

  // 4. Swap USDSUI (collateral) -> USDC on DeepBook v3
  const deepCoin = tx.moveCall({
    target: '0x2::coin::zero',
    typeArguments: ['0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'],
  });

  // We expect at least totalRepayNeeded USDC out
  const [outBase, outQuote, outDeep] = tx.moveCall({
    target: `${deepBookPackage}::pool::swap_exact_base_for_quote`,
    arguments: [
      tx.object(deepBookPoolId),
      collateralCoin,
      deepCoin,
      tx.pure.u64(1n), // min out 1 for simulation test
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
    typeArguments: [collateralCoinType, debtCoinType],
  });

  // outQuote is Coin<USDC>
  // Merge any leftover debt coin into outQuote
  tx.mergeCoins(outQuote, [leftoverDebtCoin]);

  // 5. Split out repayment coin
  const [repayCoin] = tx.splitCoins(outQuote, [tx.pure.u64(totalRepayNeeded)]);

  // Convert repayCoin to Balance
  const repayBalance = tx.moveCall({
    target: '0x2::coin::into_balance',
    arguments: [repayCoin],
    typeArguments: [debtCoinType],
  });

  // 6. Repay flash loan
  const [excessBalance] = tx.moveCall({
    target: `${NAVI_CONFIG.packageId}::lending::flash_repay_with_ctx`,
    arguments: [
      tx.object(SUI_CLOCK_OBJECT_ID),
      tx.object(NAVI_CONFIG.storage),
      tx.object(debtPoolContract),
      receipt,
      repayBalance,
    ],
    typeArguments: [debtCoinType],
  });

  const excessCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    arguments: [excessBalance],
    typeArguments: [debtCoinType],
  });

  // 7. Transfer all remaining profits to operator
  tx.transferObjects([outQuote, excessCoin, outBase, outDeep], tx.pure.address(CONFIG.operatorAddress));

  console.log('Simulating PTB with devInspect...');
  const simResult = await suiClient.devInspectTransactionBlock({
    sender: CONFIG.operatorAddress,
    transactionBlock: tx,
  });

  console.log('Simulation Status:', simResult.effects.status.status);
  if (simResult.effects.status.status === 'failure') {
    console.log(chalk.red('Error:'), simResult.effects.status.error);
  } else {
    console.log(chalk.bold.green('🚀 SIMULATION SUCCESSFUL!'));
    console.log('Gas used:', simResult.effects.gasUsed);
  }
}

main().catch(console.error);
