import chalk from 'chalk';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { SUI_CLOCK_OBJECT_ID } from '../src/config/constants.js';
import { CONFIG } from '../src/config/index.js';

async function main() {
  const suiCoinType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
  const usdcCoinType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const cetusClmmPkg = '0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3';
  const cetusGlobalConfig = '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f';
  const cetusUsdcSuiPool = '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab';

  const tx = new Transaction();
  tx.setSender(CONFIG.operatorAddress);

  const borrowAmount = 233n;
  const maxSqrtPrice = '79226673515401279992447579054';

  const [usdcBalance, emptySuiBalance, flashReceipt] = tx.moveCall({
    target: `${cetusClmmPkg}::pool::flash_swap`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [
      tx.object(cetusGlobalConfig),
      tx.object(cetusUsdcSuiPool),
      tx.pure.bool(false),
      tx.pure.bool(false),
      tx.pure.u64(borrowAmount),
      tx.pure.u128(maxSqrtPrice),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  const payAmount = tx.moveCall({
    target: `${cetusClmmPkg}::pool::swap_pay_amount`,
    typeArguments: [usdcCoinType, suiCoinType],
    arguments: [flashReceipt],
  });

  // Split repayment SUI from gas
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

  // Transfer borrowed USDC and empty SUI to operator
  const usdcCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [usdcCoinType],
    arguments: [usdcBalance],
  });
  const emptySuiCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [suiCoinType],
    arguments: [emptySuiBalance],
  });
  tx.transferObjects([usdcCoin, emptySuiCoin], tx.pure.address(CONFIG.operatorAddress));

  const sim = await suiClient.devInspectTransactionBlock({
    sender: CONFIG.operatorAddress,
    transactionBlock: tx,
  });
  console.log('Flash Swap Status:', sim.effects.status);
  const bytes = sim.results?.[1]?.returnValues?.[0]?.[0];
  if (bytes) {
    const buf = Buffer.from(bytes);
    const payU64 = buf.readBigUInt64LE(0);
    console.log('Pay Amount (MIST):', payU64.toString());
  }
}

main().catch(console.error);
