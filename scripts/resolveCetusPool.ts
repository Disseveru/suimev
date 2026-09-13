import { Transaction } from '@mysten/sui/transactions';
import { suiClient } from '../src/client/suiClient.js';
import { CETUS_CONFIG } from '../src/config/constants.js';

const CETUS_POOLS_ID = '0xf699e7f2276f5c9a75944b37a0c5b5d9ddfd2471bf6242483b03ab2887d198d0';

export async function findCetusPool(coinA: string, coinB: string, tickSpacing: number = 2) {
  const tx = new Transaction();
  const [key] = tx.moveCall({
    target: `${CETUS_CONFIG.clmmPoolPackageId}::factory::new_pool_key`,
    typeArguments: [coinA, coinB],
    arguments: [tx.pure.u32(tickSpacing)],
  });

  // Call devInspect to get the key
  const res = await suiClient.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: '0x59b1cf64e8e21e9c13488e80e9b961d16000a3d10fae16123dbfaeef9e309e3d',
  });

  const returnValues = res.results?.[0]?.returnValues;
  if (!returnValues || returnValues.length === 0) return null;
  const keyBytes = returnValues[0][0];
  const keyHex = '0x' + Buffer.from(keyBytes).toString('hex');

  // Query dynamic field on linked table
  // Linked table id is 0x4c9ab808d50ca1358cc699bb53b6334b9471d4718fb19bb621ff41c2e93bbce4
  try {
    const field = await suiClient.getDynamicFieldObject({
      parentId: '0x4c9ab808d50ca1358cc699bb53b6334b9471d4718fb19bb621ff41c2e93bbce4',
      name: {
        type: '0x2::object::ID',
        value: keyHex,
      },
    });
    const content = field.data?.content as any;
    const poolId = content?.fields?.value?.fields?.pool_id;
    return poolId;
  } catch {
    return null;
  }
}

async function run() {
  const USDY = '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY';
  const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

  const tickSpacings = [2, 10, 20, 60, 200, 220];
  for (const ts of tickSpacings) {
    const p1 = await findCetusPool(USDY, USDC, ts);
    if (p1) console.log(`FOUND USDY/USDC Pool (ts=${ts}):`, p1);
    const p2 = await findCetusPool(USDC, USDY, ts);
    if (p2) console.log(`FOUND USDC/USDY Pool (ts=${ts}):`, p2);
    const p3 = await findCetusPool(USDY, SUI, ts);
    if (p3) console.log(`FOUND USDY/SUI Pool (ts=${ts}):`, p3);
    const p4 = await findCetusPool(SUI, USDY, ts);
    if (p4) console.log(`FOUND SUI/USDY Pool (ts=${ts}):`, p4);
  }
}

run().catch(console.error);
