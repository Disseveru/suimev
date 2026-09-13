import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';

async function run() {
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();
  const id = '0x98f487704c12a3bde456fb373a8f8195a60b60cf8c782f26961064d0983a3852';
  const acc = await query.getObligationAccountById(id);
  console.log({
    id,
    deposited: acc.totalDepositedValue,
    borrowed: acc.totalBorrowedValue,
    required: acc.totalRequiredCollateralValue,
    unhealthy: acc.totalUnhealthyCollateralValue,
    riskLevel: acc.totalRiskLevel,
  });
}

run().catch(console.error);
