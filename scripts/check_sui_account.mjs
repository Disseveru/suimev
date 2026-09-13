import { suiClient } from '../src/client/suiClient.js';

async function checkSui() {
  const address = '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d';
  console.log('Checking Sui Mainnet for address:', address);
  
  const balance = await suiClient.getBalance({ owner: address, coinType: '0x2::sui::SUI' });
  console.log('Current SUI balance:', Number(balance.totalBalance) / 1e9, 'SUI (', balance.totalBalance, 'MIST )');

  const allBalances = await suiClient.getAllBalances({ owner: address });
  console.log('All coin balances on address:', allBalances);

  const txs = await suiClient.queryTransactionBlocks({
    filter: { ToAddress: address },
    limit: 10,
    options: { showEffects: true, showBalanceChanges: true }
  });
  console.log('Transaction history count:', txs.data.length);
  for (const t of txs.data) {
    console.log('Tx Digest:', t.digest, 'Status:', t.effects?.status?.status);
  }
}

checkSui().catch(console.error);
