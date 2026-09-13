import https from 'https';

const address = '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d';
const rpcUrl = 'https://mainnet.suiet.app';

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params
    });

    const req = https.request(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  console.log('Checking Sui Node for address:', address);
  const bal = await rpc('suix_getBalance', [address, '0x2::sui::SUI']);
  console.log('SUI Balance:', bal.result);

  const allBal = await rpc('suix_getAllBalances', [address]);
  console.log('All Balances:', allBal.result);

  const txs = await rpc('suix_queryTransactionBlocks', [{ filter: { ToAddress: address }, limit: 5 }]);
  console.log('Recent Incoming Transactions:', txs.result?.data?.length || 0);
}

run().catch(console.error);
