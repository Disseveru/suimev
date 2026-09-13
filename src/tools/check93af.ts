import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function main() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();
  const id = '0x93afc0bad8767a3cfcf3ac36971cb7df659b3f55be654c83553c4b4443c5fa56';
  try {
    const acc = await query.getObligationAccountById(id);
    console.log(id, {
      borrowed: acc.totalBorrowedValue,
      deposited: acc.totalDepositedValue,
      risk: acc.totalRiskLevel,
      unhealthy: acc.totalUnhealthyCollateralValue
    });
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

main().catch(console.error);
