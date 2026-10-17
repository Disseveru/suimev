// using native fetch

async function run() {
  const query = `
    query {
      objects(filter: {type: "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::Pool<0x549e8b69270def3cafaf13141f315201853d90895d96706e61266b66838a3d45::vsui::VSUI, 0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI>"}) {
        nodes {
          address
        }
      }
    }
  `;

  const res = await fetch('https://graphql.mainnet.sui.io/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  console.log(await res.json());
}
run();
