import chalk from 'chalk';
import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { CONFIG } from '../src/config/index.js';

async function main() {
  const recipient = process.argv[2] || process.env.RECIPIENT_ADDRESS;
  if (!recipient) {
    console.error('Usage: npx tsx scripts/transferSui.ts <recipient_address> [amountSui]');
    process.exit(1);
  }
  const amountSui = process.argv[3] ? parseFloat(process.argv[3]) : 5.0;
  const amountMist = BigInt(Math.floor(amountSui * 1e9));

  console.log(chalk.bold.cyan('======================================================================'));
  console.log(chalk.bold.cyan('  💸 SUI MEV LIQUIDATOR: TRANSFERRING 5 SUI'));
  console.log(chalk.bold.cyan('======================================================================'));
  console.log('Sender (Operator):', CONFIG.operatorAddress);
  console.log('Recipient:', recipient);
  console.log('Amount:', amountMist.toString(), 'MIST (5.0 SUI)');

  // 1. Verify sender balance
  const balance = await suiClient.getBalance({ owner: CONFIG.operatorAddress });
  console.log('Current Sender Balance:', balance.totalBalance, 'MIST', `(${(Number(balance.totalBalance) / 1e9).toFixed(6)} SUI)`);
  if (BigInt(balance.totalBalance) < amountMist + 50_000_000n) {
    throw new Error(`Insufficient balance to transfer 5 SUI + gas buffer. Available: ${balance.totalBalance} MIST`);
  }

  // 2. Build Transaction
  const tx = new Transaction();
  tx.setSender(CONFIG.operatorAddress);
  tx.setGasBudget(50_000_000n); // 0.05 SUI max

  const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
  tx.transferObjects([coin], tx.pure.address(recipient));

  // 3. Pre-flight Simulation
  console.log('Running pre-flight devInspect simulation...');
  const sim = await suiClient.devInspectTransactionBlock({
    sender: CONFIG.operatorAddress,
    transactionBlock: tx,
  });

  if (sim.effects.status.status !== 'success') {
    console.error(chalk.red('❌ Pre-flight simulation failed:'), sim.effects.status.error);
    process.exit(1);
  }
  console.log(chalk.green('✅ Pre-flight simulation successful! Gas computation:'), sim.effects.gasUsed.computationCost);

  // 4. Execute Transaction
  console.log(chalk.bold.yellow('🚀 Broadcasting transfer transaction to Sui Mainnet...'));
  const response = await suiClient.signAndExecuteTransaction({
    signer: CONFIG.operatorKeypair,
    transaction: tx,
    options: {
      showEffects: true,
      showBalanceChanges: true,
    },
  });

  console.log(chalk.bold.green('\n🎉 TRANSFER COMPLETE!'));
  console.log('Transaction Digest:', chalk.bold.cyan(response.digest));
  console.log('Status:', response.effects?.status.status === 'success' ? chalk.bold.green('SUCCESS') : chalk.red('FAILED'));
  console.log('Explorer URL:', `https://suiscan.xyz/mainnet/tx/${response.digest}`);
  console.log('Balance Changes:', JSON.stringify(response.balanceChanges, null, 2));

  // 5. Check new balances
  const newSenderBal = await suiClient.getBalance({ owner: CONFIG.operatorAddress });
  const newRecipBal = await suiClient.getBalance({ owner: recipient });
  console.log('\n--- UPDATED BALANCES ---');
  console.log('Sender Balance:', (Number(newSenderBal.totalBalance) / 1e9).toFixed(6), 'SUI');
  console.log('Recipient Balance:', (Number(newRecipBal.totalBalance) / 1e9).toFixed(6), 'SUI');
}

main().catch(console.error);
