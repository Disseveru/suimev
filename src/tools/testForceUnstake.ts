import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { obligationRegistry } from '../engine/registry.js';
import { scallopIndexer } from '../protocols/scallop/scallopIndexer.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import { PreFlightSimulator } from '../engine/simulator.js';
import { SUI_CLOCK_OBJECT_ID } from '../config/constants.js';

async function testForceUnstake() {
  console.log('Testing Scallop force_unstake_unhealthy_v2 + Liquidate Flow...');
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();

  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const addr = sdk.client.address;

  scallopIndexer.onObligationUpdate((s) => obligationRegistry.upsertObligation(s));
  await scallopIndexer.discoverObligationsFromHistory();

  const targets = obligationRegistry.getImmediateTargets();
  const target = targets.find(t => t.obligationId === '0x8d3baf0278d47eca6356b894e0b9b7e49f572e7ca7d77086c6a903d00c2a3cde') || targets.find(t => t.totalCollateralUsd > 100);
  if (!target) {
    console.log('No suitable target found');
    return;
  }

  const opp = HealthFactorEngine.findBestLiquidationOpportunity(target);
  if (!opp) return;

  console.log(`Target: ${opp.obligation.obligationId}`);
  console.log(`HF: ${opp.obligation.healthFactor.toFixed(4)}, Repay: ${opp.debtAmountToRepay} ${opp.debtSymbol}`);

  // Build PTB with oracle updates AND force_unstake_unhealthy_v2
  const builder = await sdk.createScallopBuilder();
  const scallopTx = builder.createTxBlock();

  // 1. Update Oracles for ALL exact coins in the target obligation
  const oblData = await (builder as any).query.repos.obligation.getObligationData(opp.obligation.obligationId);
  const coinTypes = [...oblData.collaterals.map((c: any) => c.type), ...oblData.debts.map((d: any) => d.type)];
  const coinsToUpdate = [...new Set(coinTypes.map((t: string) => (builder as any).utils.parseCoinNameFromType(t)))];
  console.log('1. Updating oracles for exact obligation assets:', coinsToUpdate);
  await scallopTx.updateAssetPricesQuick(coinsToUpdate);

  const tx = scallopTx.txBlock;

  // 2. Force unstake unhealthy obligation using v3
  console.log('2. Appending force_unstake_unhealthy_v3...');
  const borrowIncentivePkg = addr.get('borrowIncentive.id');
  tx.moveCall({
    target: `${borrowIncentivePkg}::user::force_unstake_unhealthy_v3`,
    arguments: [
      tx.object(addr.get('borrowIncentive.config')),
      tx.object(addr.get('borrowIncentive.incentivePools')),
      tx.object(addr.get('borrowIncentive.incentiveAccounts')),
      tx.object(addr.get('core.version')),
      tx.object(opp.obligation.obligationId),
      tx.object(addr.get('core.market')),
      tx.object(addr.get('core.coinDecimalsRegistry')),
      tx.object(addr.get('core.oracles.xOracle')),
      tx.object(addr.get('vesca.subsTable')),
      tx.object(addr.get('vesca.subsWhitelist')),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  // 3. Build the rest of Zero-Capital PTB (Flash loan -> Liquidate -> DEX swap -> Repay -> Profit)
  console.log('3. Assembling zero-capital atomic liquidation PTB...');
  const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp, tx);

  // 4. Pre-flight simulate
  console.log('4. Running pre-flight simulation (devInspect)...');
  const sim = await PreFlightSimulator.simulate(built.tx, opp);
  console.log(`Simulation Success: ${sim.success ? '✅ SUCCESS!' : '❌ FAILED'}`);
  console.log(`Net Profit: $${sim.netProfitUsd.toFixed(2)} USD`);
  if (!sim.success) {
    console.log('Simulation Error:', sim.errorMessage);
  } else {
    console.log(`Gas used: ${sim.gasUsedSui.toFixed(4)} SUI ($${sim.gasCostUsd.toFixed(4)})`);
  }
}

testForceUnstake().catch(console.error);
