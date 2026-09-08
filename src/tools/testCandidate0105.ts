import { obligationRegistry } from '../engine/registry.js';
import { HealthFactorEngine } from '../oracles/healthFactor.js';
import { ZeroCapitalPtbBuilder } from '../engine/ptbBuilder.js';
import { PreFlightSimulator } from '../engine/simulator.js';
import { scallopProtocol } from '../protocols/scallop/scallopProtocol.js';
import { pythService } from '../oracles/pythService.js';
import { SUI_CLOCK_OBJECT_ID } from '../config/constants.js';

async function testCandidate() {
  console.log('Testing Candidate 0x0105d858902b7d594b4d39b932fbb77ea4b8a4e5e1f9f8421905b76ad4cc08bc...');
  await pythService.fetchLatestPrices();
  await scallopProtocol.initialize();
  const sdk = scallopProtocol.getSdk();
  if (!sdk) return;
  const query = await sdk.createScallopQuery();
  const builder = await sdk.createScallopBuilder();

  const id = '0x0105d858902b7d594b4d39b932fbb77ea4b8a4e5e1f9f8421905b76ad4cc08bc';
  const isLocked = await query.getObligationLocked(id);
  console.log('Target 0x0105d8... locked status:', isLocked);

  const oblData = await (builder as any).query.repos.obligation.getObligationData(id);
  console.log('Obligation collaterals:', oblData.collaterals);
  console.log('Obligation debts:', oblData.debts);

  // Re-fetch and evaluate
  const opp = HealthFactorEngine.findBestLiquidationOpportunity({
    protocol: 'scallop',
    obligationId: id,
    ownerAddress: id,
    collaterals: [
      {
        coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
        symbol: 'SUI',
        amount: BigInt('12500000000000'),
        decimals: 9,
        valueUsd: 10367,
        liquidationThreshold: 0.80,
      }
    ],
    debts: [
      {
        coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
        symbol: 'USDC',
        amount: BigInt('7851140069'),
        decimals: 6,
        valueUsd: 7851,
      },
      {
        coinType: '0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI',
        symbol: 'USDSUI',
        amount: BigInt('490980073'),
        decimals: 6,
        valueUsd: 490,
      }
    ],
    totalCollateralUsd: 10367,
    totalDebtUsd: 8341,
    liquidationThresholdCollateralUsd: 8293,
    healthFactor: 0.9942,
    isLiquidatable: true,
    lastUpdatedMs: Date.now(),
  });

  if (!opp) {
    console.log('No liquidation opportunity found');
    return;
  }

  console.log('Building PTB for candidate 0x0105d8...');
  const scallopTx = builder.createTxBlock();
  await scallopTx.updateAssetPricesQuick(['sui', 'usdsui', 'usdc']);

  const tx = scallopTx.txBlock;
  const addr = sdk.client.address;
  const borrowIncentivePkg = addr.get('borrowIncentive.id');

  tx.moveCall({
    target: `${borrowIncentivePkg}::user::force_unstake_unhealthy_v3`,
    arguments: [
      tx.object(addr.get('borrowIncentive.config')),
      tx.object(addr.get('borrowIncentive.incentivePools')),
      tx.object(addr.get('borrowIncentive.incentiveAccounts')),
      tx.object(addr.get('core.version')),
      tx.object(id),
      tx.object(addr.get('core.market')),
      tx.object(addr.get('core.coinDecimalsRegistry')),
      tx.object(addr.get('core.oracles.xOracle')),
      tx.object(addr.get('vesca.subsTable')),
      tx.object(addr.get('vesca.subsWhitelist')),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });

  const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(opp, tx);
  console.log('Running pre-flight simulation (devInspect)...');
  const sim = await PreFlightSimulator.simulate(built.tx, opp);
  console.log(`Simulation Success: ${sim.success ? '✅ SUCCESS!' : '❌ FAILED'}`);
  console.log(`Net Profit: $${sim.netProfitUsd.toFixed(2)} USD`);
  if (!sim.success) {
    console.log('Simulation Error:', sim.errorMessage);
  } else {
    console.log(`Gas used: ${sim.gasUsedSui.toFixed(4)} SUI ($${sim.gasCostUsd.toFixed(4)})`);
  }
}

testCandidate().catch(console.error);
