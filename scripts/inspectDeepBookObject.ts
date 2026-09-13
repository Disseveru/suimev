import { suiClient } from '../src/client/suiClient.js';

async function main() {
  const poolId = '0xa374264d43e6baa5aa8b35ff18ff24fdba7443b4bcb884cb4c2f568d32cdac36';
  const obj = await suiClient.getObject({
    id: poolId,
    options: { showType: true, showContent: true }
  });
  console.log('Object type:', obj.data?.type);
  const fields = (obj.data?.content as any)?.fields;
  console.log('Fields:', Object.keys(fields || {}));
  console.log('book:', fields?.book?.fields);
  console.log('vault_balances:', fields?.vault_balances);
}

main().catch(console.error);
