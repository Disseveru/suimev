import { scallopProtocol } from '../src/protocols/scallop/scallopProtocol.js';

async function run() {
  await scallopProtocol.initialize();
  const query = await (scallopProtocol.getSdk() as any).createScallopQuery();

  const ids = [
    '0xbd420b2f97d48c763181a4dc34a9041050b5e3bac1565c54b385ec29f3e72a1b',
    '0x5b5e1a6493c4555d0ba7fb1a4f60e1daafb6a83fb28ffba356d6229dd0b32838',
    '0xd76c6e3ffbf23368e1db6bf5e243e6a093da329b7c0142e37ddc3f42ebdb9cc4',
    '0x55383932f15e89f86b6789ccbdb3b1d1be2a3d5b74c1e63c71d0cd76701ce5e7',
    '0x013fa56990d33accd2567c2dbad43d7d50a9ea0ee7c458192d54dfa77045ed26',
    '0x362a04f5c498249c34b046acd57238a12a64deb510db769c121fdcfad5288d77',
  ];

  for (const id of ids) {
    try {
      const acc = await query.getObligationAccountById(id);
      console.log(`\n=== Obligation ${id} ===`);
      console.log('Total Collateral USD:', acc.totalCollateralValue);
      console.log('Total Debt USD:', acc.totalDebtValue);
      console.log('Required Collateral Value USD:', acc.totalRequiredCollateralValue);
      console.log('Health Factor:', acc.healthFactor);
      console.log('Is Liquidatable:', acc.isLiquidatable);
    } catch (e: any) {
      console.log(`Error for ${id}: ${e.message}`);
    }
  }
}

run().catch(console.error);
