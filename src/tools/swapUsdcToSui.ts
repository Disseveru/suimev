import { SuiClientManager } from '../client/suiClient.js';
import { CONFIG } from '../config/index.js';
import { Transaction } from '@mysten/sui/transactions';
import { CetusRouter } from '../protocols/dex/cetusRouter.js';
import { logger } from '../ui/logger.js';

async function swapUsdcToSui() {
  const client = SuiClientManager.getInstance().getClient();
  const operator = CONFIG.operatorAddress;

  const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const SUI_TYPE = '0x2::sui::SUI';

  // Check operator balances
  const allBalances = await client.getAllBalances({ owner: operator });
  const usdcBal = allBalances.find(b => b.coinType === USDC_TYPE);
  const totalUsdcUnits = BigInt(usdcBal?.totalBalance || '0');

  console.log(`\n======================================================`);
  console.log(`USDC -> SUI Conversion Tool`);
  console.log(`Operator Address: ${operator}`);
  console.log(`Available USDC Balance: ${Number(totalUsdcUnits) / 1e6} USDC (${totalUsdcUnits} units)`);
  console.log(`======================================================\n`);

  if (totalUsdcUnits <= 0n) {
    console.log('No USDC balance found to swap.');
    return;
  }

  // Quote on Cetus
  const quote = CetusRouter.getQuote(USDC_TYPE, SUI_TYPE, totalUsdcUnits, 150); // 1.5% slippage
  console.log('Cetus Swap Quote:');
  console.log(`  - Amount In: ${Number(quote.amountIn) / 1e6} USDC`);
  console.log(`  - Expected Out: ${(Number(quote.expectedAmountOut) / 1e9).toFixed(4)} SUI`);
  console.log(`  - Minimum Out: ${(Number(quote.minimumAmountOut) / 1e9).toFixed(4)} SUI`);
  console.log(`  - Pool ID: ${quote.poolId}`);

  // Build PTB
  const tx = new Transaction();
  tx.setGasBudget(15_000_000); // 0.015 SUI budget

  // Take USDC from address balance
  const usdcCoin = tx.coin({ type: USDC_TYPE, balance: Number(totalUsdcUnits) });
  const suiCoin = CetusRouter.addSwap(tx, quote, usdcCoin);
  tx.transferObjects([suiCoin], operator);

  // Pre-flight simulation
  console.log('\nRunning pre-flight devInspect...');
  const devInspect = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: operator,
  });

  if (devInspect.effects.status.status !== 'success') {
    console.error('❌ Pre-flight simulation failed:', devInspect.effects.status.error);
    return;
  }
  console.log('✅ Pre-flight simulation succeeded!');
  console.log(`Gas estimate: ${Number(devInspect.effects.gasUsed.computationCost) + Number(devInspect.effects.gasUsed.storageCost) - Number(devInspect.effects.gasUsed.storageRebate)} MIST`);

  // Sign and broadcast
  console.log('\n🚀 Broadcasting swap transaction to Sui consensus...');
  const result = await client.signAndExecuteTransaction({
    signer: CONFIG.operatorKeypair,
    transaction: tx,
    options: {
      showEffects: true,
      showBalanceChanges: true,
    },
  });

  console.log(`\n✅ Swap executed successfully!`);
  console.log(`  - Digest: ${result.digest}`);
  console.log(`  - Status: ${result.effects?.status.status}`);
  console.log(`  - Suiscan: https://suiscan.xyz/mainnet/tx/${result.digest}`);

  // Print updated balances
  const updatedBalances = await client.getAllBalances({ owner: operator });
  console.log('\nUpdated Balances:');
  for (const b of updatedBalances) {
    const sym = b.coinType.split('::').pop();
    const isSui = b.coinType.includes('sui::SUI');
    const isUsdc = b.coinType.includes('usdc::USDC');
    if (isSui) {
      console.log(`  - SUI: ${(Number(b.totalBalance) / 1e9).toFixed(4)} SUI (${b.totalBalance} MIST)`);
    } else if (isUsdc) {
      console.log(`  - USDC: ${(Number(b.totalBalance) / 1e6).toFixed(4)} USDC`);
    } else {
      console.log(`  - ${sym}: ${b.totalBalance}`);
    }
  }
}

swapUsdcToSui().catch((err) => {
  console.error('Swap failed with error:', err);
  process.exit(1);
});
