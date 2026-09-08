async function test() {
  const url = 'https://sdk.api.scallop.io/api/price/pyth';
  try {
    const res = await fetch(url);
    console.log(url, res.status, res.statusText);
    const data = await res.json() as any;
    console.log('Result keys:', Object.keys(data || {}));
    console.log('Data:', JSON.stringify(data).slice(0, 200));
  } catch (e: any) {
    console.error('Error fetching Scallop pyth api:', e.message);
  }
}
test();
