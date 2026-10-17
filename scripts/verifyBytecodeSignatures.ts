import { suiClient } from '../src/client/suiClient.js';
import { NAVI_CONFIG, SCALLOP_CONFIG, CETUS_CONFIG } from '../src/config/constants.js';

async function check() {
  console.log('=== NAVI PROTOCOL ON-CHAIN MOVE BYTECODE ===');
  const naviMod = await suiClient.getNormalizedMoveModule({
    package: NAVI_CONFIG.packageId,
    module: 'incentive_v3',
  });
  console.log('liquidation_v2 parameters count:', naviMod.exposedFunctions.liquidation_v2.parameters.length);
  console.log('liquidation_v2 parameter types:');
  naviMod.exposedFunctions.liquidation_v2.parameters.forEach((param, i) => {
    console.log(`  arg ${i}:`, JSON.stringify(param));
  });
  console.log('liquidation_v2 return:', JSON.stringify(naviMod.exposedFunctions.liquidation_v2.return));

  const naviLending = await suiClient.getNormalizedMoveModule({
    package: NAVI_CONFIG.packageId,
    module: 'lending',
  });
  console.log('flash_loan_with_ctx_v2 return:', JSON.stringify(naviLending.exposedFunctions.flash_loan_with_ctx_v2.return));
  console.log('flash_repay_with_ctx params:');
  naviLending.exposedFunctions.flash_repay_with_ctx.parameters.forEach((param, i) => {
    console.log(`  repay arg ${i}:`, JSON.stringify(param));
  });

  console.log('\n=== SCALLOP PROTOCOL ON-CHAIN MOVE BYTECODE ===');
  const scLiquidate = await suiClient.getNormalizedMoveModule({
    package: SCALLOP_CONFIG.protocolPkg,
    module: 'liquidate',
  });
  console.log('scallop liquidate parameters:');
  scLiquidate.exposedFunctions.liquidate.parameters.forEach((param, i) => {
    console.log(`  arg ${i}:`, JSON.stringify(param));
  });
  console.log('scallop liquidate return:', JSON.stringify(scLiquidate.exposedFunctions.liquidate.return));

  const scIncentive = await suiClient.getNormalizedMoveModule({
    package: SCALLOP_CONFIG.borrowIncentivePkg,
    module: 'user',
  });
  console.log('scallop force_unstake_unhealthy_v3 params count:', scIncentive.exposedFunctions.force_unstake_unhealthy_v3.parameters.length);

  console.log('\n=== CETUS CLMM ON-CHAIN MOVE BYTECODE ===');
  const cetusPool = await suiClient.getNormalizedMoveModule({
    package: CETUS_CONFIG.activeClmmPackageId,
    module: 'pool',
  });
  console.log('cetus flash_swap params count:', cetusPool.exposedFunctions.flash_swap.parameters.length);
  console.log('cetus flash_swap return:');
  cetusPool.exposedFunctions.flash_swap.return.forEach((ret, i) => {
    console.log(`  ret ${i}:`, JSON.stringify(ret));
  });
  console.log('cetus repay_flash_swap params:');
  cetusPool.exposedFunctions.repay_flash_swap.parameters.forEach((param, i) => {
    console.log(`  repay arg ${i}:`, JSON.stringify(param));
  });
  console.log('cetus swap_pay_amount return:', JSON.stringify(cetusPool.exposedFunctions.swap_pay_amount.return));
}

check().catch(console.error);
