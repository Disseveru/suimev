import { getAllFlashLoanAssets } from '@naviprotocol/lending';

async function main() {
  const assets = await getAllFlashLoanAssets();
  console.log('NAVI Flash loan supported assets count:', assets?.length);
  for (const a of assets || []) {
    console.log(`Asset ${a.assetId} (${a.coinType}): fee=${a.fee}`);
  }
}

main().catch(console.error);
