import https from 'https';

const url = 'https://api.wormholescan.io/api/v1/operations?txHash=0x2f209d34bbe5acebcfc90980a551a72bdd97da1b4d444a4b8f09517cba77fb38';

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('HTTP Status:', res.statusCode);
    console.log('Body:', data);
  });
}).on('error', err => {
  console.error('Error:', err.message);
});
