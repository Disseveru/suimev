import { SuiClientManager } from '../client/suiClient.js';
import { CONFIG } from '../config/index.js';
import { Transaction } from '@mysten/sui/transactions';
import { gasManager } from '../client/gasManager.js';

async function rebalanceGasCoins() {
  const client = SuiClientManager.getInstance().getClient();
  const operator = CONFIG.operatorAddress;

  console.log(`Rebalancing gas coins for operator: ${operator}`);

  const coins = await client.getCoins({ owner: operator, coinType: '0x2::sui::SUI' });
  if (coins.data.length === 0) {
    console.error('No SUI coins found in wallet.');
    return;
  }

  // Sort descending by balance
  const sorted = [...coins.data].sort((a, b) => {
    const diff = BigInt(b.balance) - BigInt(a.balance);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  });

  const primary = sorted[0];
  const others = sorted.slice(1);

  console.log(`Primary coin: ${primary.coinObjectId} (${(Number(primary.balance)/1e9).toFixed(4)} SUI)`);
  console.log(`Other coins to merge: ${others.length}`);

  const tx = new Transaction();
  tx.setGasBudget(15_000_000);
  tx.setGasPayment([{ objectId: primary.coinObjectId, version: primary.version, digest: primary.digest }]);

  // Merge any secondary coins back into primary
  if (others.length > 0) {
    tx.mergeCoins(tx.gas, others.map(o => tx.object(o.coinObjectId)));
  }

  // Split into 3 coins of 1.0 SUI each (1_000_000_000 MIST)
  const [c1, c2, c3] = tx.splitCoins(tx.gas, [1_000_000_000n, 1_000_000_000n, 1_000_000_000n]);
  tx.transferObjects([c1, c2, c3], tx.pure.address(operator));

  // Pre-flight simulation
  console.log('Simulating on-chain...');
  const dev = await client.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: operator,
  });

  if (dev.effects.status.status !== 'success') {
    console.error('Simulation failed:', dev.effects.status.error);
    return;
  }
  console.log('Simulation success! Broadcasting to Sui consensus...');

  const result = await client.signAndExecuteTransaction({
    signer: CONFIG.operatorKeypair,
    transaction: tx,
    options: { showEffects: true, showBalanceChanges: true },
  });

  console.log('Rebalance executed successfully!');
  console.log(`Transaction digest: ${result.digest}`);
  console.log(`Suiscan: https://suiscan.xyz/mainnet/tx/${result.digest}`);

  // Update in-memory gas manager
  await gasManager.refreshGasCoins();

  // Print new coin breakdown
  const updatedCoins = await client.getCoins({ owner: operator, coinType: '0x2::sui::SUI' });
  console.log('\nUpdated Coin Objects in Wallet:');
  for (const c of updatedCoins.data) {
    console.log(`  - Object ${c.coinObjectId}: ${(Number(c.balance)/1e9).toFixed(4)} SUI (${c.balance} MIST)`);
  }
}

rebalanceGasCoins().catch((err) => {
  console.error('Failed to rebalance gas coins:', err);
  process.exit(1);
});
