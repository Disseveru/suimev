import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function run() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();
  const acc = await query.getObligationAccountById('0xf30c0a48e931cb597ce498c2fbbeafa6ae2c385090c819c2d98c703622bb464c');
  console.log({
    totalDepositedValue: acc.totalDepositedValue,
    totalBorrowedValue: acc.totalBorrowedValue,
    totalBorrowedValueWithWeight: acc.totalBorrowedValueWithWeight,
    totalRequiredCollateralValue: acc.totalRequiredCollateralValue,
    totalUnhealthyCollateralValue: acc.totalUnhealthyCollateralValue,
    totalRiskLevel: acc.totalRiskLevel,
  });
}

run().catch(console.error);
