import { SuiClientManager } from '../client/suiClient.js';
import { Transaction } from '@mysten/sui/transactions';
import { CETUS_CONFIG, SUI_CLOCK_OBJECT_ID } from '../config/constants.js';

async function main() {
  const client = SuiClientManager.getInstance().getClient();
  const tx = new Transaction();

  // Test swapping 0.01 SUI to USDC using Cetus pool::flash_swap directly!
  const poolId = CETUS_CONFIG.pools['USDC_SUI'];
  const coinTypeA = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const coinTypeB = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

  // We are swapping SUI (Coin B) -> USDC (Coin A), so a2b = false!
  const a2b = false;
  const sqrtPriceLimit = '79226673515401279992447579055'; // MAX_SQRT_PRICE_X64
  const swapAmount = 10_000_000n; // 0.01 SUI

  // Split 0.01 SUI from gas
  const [suiCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(swapAmount)]);

  console.log('1. Calling activeClmmPackageId::pool::flash_swap...');
  const [balanceA, balanceB, flashReceipt] = tx.moveCall({
    target: `${CETUS_CONFIG.activeClmmPackageId}::pool::flash_swap`,
    typeArguments: [coinTypeA, coinTypeB],
    arguments: [
      tx.object(CETUS_CONFIG.globalConfigId),
      tx.object(poolId),
      tx.pure.bool(a2b),
      tx.pure.bool(true), // by_amount_in = true
      tx.pure.u64(swapAmount),
      tx.pure.u128(sqrtPriceLimit),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  // balanceA is the received USDC!
  const outUsdcCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [coinTypeA],
    arguments: [balanceA],
  });

  // Destroy the empty balanceB
  tx.moveCall({
    target: '0x2::balance::destroy_zero',
    typeArguments: [coinTypeB],
    arguments: [balanceB],
  });

  // Convert input suiCoin to balance
  const suiBalance = tx.moveCall({
    target: '0x2::coin::into_balance',
    typeArguments: [coinTypeB],
    arguments: [suiCoin],
  });

  // Empty zero balance for A
  const zeroBalanceA = tx.moveCall({
    target: '0x2::balance::zero',
    typeArguments: [coinTypeA],
    arguments: [],
  });

  console.log('2. Calling activeClmmPackageId::pool::repay_flash_swap...');
  tx.moveCall({
    target: `${CETUS_CONFIG.activeClmmPackageId}::pool::repay_flash_swap`,
    typeArguments: [coinTypeA, coinTypeB],
    arguments: [
      tx.object(CETUS_CONFIG.globalConfigId),
      tx.object(poolId),
      zeroBalanceA,
      suiBalance,
      flashReceipt,
    ],
  });

  // Transfer outUsdcCoin to sender
  tx.transferObjects([outUsdcCoin], tx.pure.address('0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d'));

  console.log('3. Running devInspect simulation...');
  const res = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d',
  });

  console.log('Simulation status:', res.effects.status.status);
  if (res.effects.status.error) {
    console.log('Simulation error:', res.effects.status.error);
  } else {
    console.log('✅ DIRECT CETUS SWAP SIMULATED WITH ZERO REVERTS!');
  }
}

main().catch(console.error);
