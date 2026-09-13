import * as navi from '@naviprotocol/lending';

async function run() {
  const addr = '0xa163b7f6bd4e93b14665ddacd95c754913bea7c600efb470536c4bb449124d5d';
  const pos = await (navi as any).getLendingPositions(addr);
  console.log('Detailed supply:', JSON.stringify(pos[0], null, 2));
  console.log('Detailed borrow:', JSON.stringify(pos[1], null, 2));
}

run().catch(console.error);
