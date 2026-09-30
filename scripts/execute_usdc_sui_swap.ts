import { Transaction } from '@mysten/sui/transactions';
import { SuiClientManager } from '../src/client/suiClient.js';
import { CONFIG } from '../src/config/index.js';
import { CETUS_CONFIG, SUI_CLOCK_OBJECT_ID } from '../src/config/constants.js';

async function executeSwap() {
  const client = SuiClientManager.getInstance([CONFIG.rpcUrl, ...CONFIG.backupRpcs]).getClient();
  const operatorKeypair = CONFIG.operatorKeypair;
  const operatorAddress = CONFIG.operatorAddress;

  console.log(`[INIT] Operator Address: ${operatorAddress}`);

  const usdcType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const suiType = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

  // 1. Fetch active USDC coins
  const usdcCoins = await client.getCoins({
    owner: operatorAddress,
    coinType: usdcType,
  });

  const fundedCoins = usdcCoins.data.filter((c) => BigInt(c.balance) > 0n);
  if (fundedCoins.length === 0) {
    throw new Error('No funded USDC coin object found for operator.');
  }

  const usdcCoin = fundedCoins[0];
  const swapAmount = BigInt(usdcCoin.balance);
  console.log(`[SWAP] Target USDC Coin: ${usdcCoin.coinObjectId}`);
  console.log(`[SWAP] Swap Amount: ${Number(swapAmount) / 1e6} USDC (${swapAmount} raw units)`);

  // 2. Build Cetus CLMM Swap PTB
  const tx = new Transaction();
  tx.setSender(operatorAddress);
  tx.setGasBudget(30_000_000); // 0.03 SUI max gas budget

  const poolId = CETUS_CONFIG.pools['USDC_SUI'];
  const coinTypeA = usdcType;
  const coinTypeB = suiType;
  const a2b = true; // Swapping USDC (Coin A) -> SUI (Coin B)
  const sqrtPriceLimit = '4295048016'; // MIN_SQRT_PRICE_X64

  // Cetus CLMM pool::flash_swap
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

  // Convert input USDC coin to Balance<USDC>
  const inputBalance = tx.moveCall({
    target: '0x2::coin::into_balance',
    typeArguments: [coinTypeA],
    arguments: [tx.object(usdcCoin.coinObjectId)],
  });

  // Convert received Balance<SUI> to Coin<SUI>
  const outCoin = tx.moveCall({
    target: '0x2::coin::from_balance',
    typeArguments: [coinTypeB],
    arguments: [balanceB],
  });

  // Destroy empty zero balanceA
  tx.moveCall({
    target: '0x2::balance::destroy_zero',
    typeArguments: [coinTypeA],
    arguments: [balanceA],
  });

  // Create empty zero balanceB for repayment
  const zeroBalanceB = tx.moveCall({
    target: '0x2::balance::zero',
    typeArguments: [coinTypeB],
    arguments: [],
  });

  // Repay the flash swap with the inputBalance
  tx.moveCall({
    target: `${CETUS_CONFIG.activeClmmPackageId}::pool::repay_flash_swap`,
    typeArguments: [coinTypeA, coinTypeB],
    arguments: [
      tx.object(CETUS_CONFIG.globalConfigId),
      tx.object(poolId),
      inputBalance,
      zeroBalanceB,
      flashReceipt,
    ],
  });

  // Transfer the received SUI coin directly to the operator
  tx.transferObjects([outCoin], tx.pure.address(operatorAddress));

  // 3. Pre-Flight DevInspect Simulation (AGENTS.md mandatory safety rule)
  console.log('\n[SIMULATION] Running pre-flight devInspect dry-run...');
  const simResult = await client.devInspectTransactionBlock({
    sender: operatorAddress,
    transactionBlock: tx,
  });

  if (simResult.effects.status.status !== 'success') {
    console.error('[SIMULATION FAILED]', JSON.stringify(simResult.effects.status, null, 2));
    throw new Error(`Simulation failed: ${simResult.effects.status.error || 'Unknown error'}`);
  }

  const gasUsed = simResult.effects.gasUsed;
  const compCost = BigInt(gasUsed.computationCost);
  const storCost = BigInt(gasUsed.storageCost);
  const rebate = BigInt(gasUsed.storageRebate);
  const netGasCost = compCost + storCost - rebate;
  console.log(`[SIMULATION PASSED] Status: SUCCESS`);
  console.log(`[SIMULATION GAS] Estimated Net Gas: ${Number(netGasCost) / 1e9} SUI (${netGasCost} MIST)`);

  // 4. On-Chain Execution
  console.log('\n[EXECUTION] Signing and broadcasting swap to Sui Mainnet consensus...');
  const execResult = await client.signAndExecuteTransaction({
    signer: operatorKeypair,
    transaction: tx,
    requestType: 'WaitForLocalExecution',
    options: {
      showEffects: true,
      showBalanceChanges: true,
    },
  });

  const txDigest = execResult.digest;
  const txStatus = execResult.effects?.status.status;
  console.log(`\n[SUCCESS] Transaction Executed!`);
  console.log(` - Digest: ${txDigest}`);
  console.log(` - Status: ${txStatus}`);
  console.log(` - Explorer: https://suiscan.xyz/mainnet/tx/${txDigest}`);

  console.log('\n[BALANCE CHANGES]:');
  for (const bc of execResult.balanceChanges || []) {
    if (bc.owner && typeof bc.owner === 'object' && 'AddressOwner' in bc.owner && bc.owner.AddressOwner === operatorAddress) {
      const isSui = bc.coinType.includes('::sui::SUI');
      const formatted = isSui ? `${Number(bc.amount) / 1e9} SUI` : `${Number(bc.amount) / 1e6} USDC`;
      console.log(` - ${bc.coinType}: ${formatted} (${bc.amount})`);
    }
  }
}

executeSwap().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
