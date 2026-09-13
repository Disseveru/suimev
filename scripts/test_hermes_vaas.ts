async function main() {
  const url = 'https://sdk.api.scallop.io/api/price/pyth';
  console.log('Fetching from Scallop SDK Pyth endpoint:', url);
  const res = await fetch(url);
  console.log('Status:', res.status);
  if (res.ok) {
    const json = await res.json();
    console.log('json keys:', Object.keys(json));
    console.log('data:', JSON.stringify(json.data).slice(0, 200));
  } else {
    const text = await res.text();
    console.log('Error:', text);
  }
}

main().catch(console.error);
