import { describe, it, expect, beforeAll } from 'vitest';
import { ZeroCapitalPtbBuilder } from '../src/engine/ptbBuilder.js';
import { PreFlightSimulator } from '../src/engine/simulator.js';
import { sentioService } from '../src/client/sentioService.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { naviProtocol } from '../src/protocols/navi/naviProtocol.js';
import { grpcManager } from '../src/client/grpcClient.js';
import { LiquidationOpportunity, ObligationState } from '../src/config/types.js';

describe('Sui Simulation & Sentio Integration Tests', () => {
  const mockOpportunity: LiquidationOpportunity = {
    protocol: 'navi',
    obligation: {
      protocol: 'navi',
      obligationId: '0x0000000000000000000000000000000000000000000000000000000000000abc',
      ownerAddress: '0x0000000000000000000000000000000000000000000000000000000000000abc',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 800_000_000_000n,
          decimals: 9,
          valueUsd: 2000,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
          symbol: 'USDC',
          amount: 1700_000_000n,
          decimals: 6,
          valueUsd: 1700,
        },
      ],
      totalCollateralUsd: 2000,
      totalDebtUsd: 1700,
      liquidationThresholdCollateralUsd: 1600,
      healthFactor: 0.941,
      isLiquidatable: true,
      lastUpdatedMs: Date.now(),
    },
    debtCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    debtSymbol: 'USDC',
    debtAmountToRepay: 850_000_000n,
    debtRepayUsd: 850,
    collateralCoinType: '0x2::sui::SUI',
    collateralSymbol: 'SUI',
    collateralToReceive: 357_000_000_000n,
    collateralReceiveUsd: 892.5,
    expectedGrossProfitUsd: 42.5,
    dex: 'cetus',
    liquidationBonus: 0.05,
  };

  beforeAll(async () => {
    vi.spyOn(grpcManager, 'checkHealth').mockResolvedValue('test-chain');
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: '0x2::sui::SUI',
      price: 2.50,
      confidence: 0,
      exponent: -8,
      rawPrice: 250_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    priceCache.updatePrice({
      symbol: 'USDC',
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      price: 1.00,
      confidence: 0,
      exponent: -8,
      rawPrice: 100_000_000n,
      publishTime: Math.floor(Date.now() / 1000),
      lastUpdatedMs: Date.now(),
    });

    await naviProtocol.initialize();
  });

  it('runs devInspect pre-flight simulation and catches reverts safely', async () => {
    vi.spyOn(grpcManager, 'getClient').mockReturnValue({
      simulateTransaction: vi.fn().mockResolvedValue({
        $kind: 'FailedTransaction',
        FailedTransaction: {
          status: { success: false, error: 'MoveAbort(0x2::navi::liquidate, 1)' },
          effects: null,
        },
      }),
    } as never);
    const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(mockOpportunity);
    const sim = await PreFlightSimulator.simulate(built.tx, mockOpportunity);

    expect(sim).toBeDefined();
    expect(sim.simulationType).toBe('devInspect');
    expect(sim.sentioSimulatorUrl).toContain('sentio.xyz');
    expect(typeof sim.success).toBe('boolean');
  });

  it('runs native gRPC simulation for the dry-run path', async () => {
    const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(mockOpportunity);
    vi.spyOn(grpcManager, 'getClient').mockReturnValue({
      simulateTransaction: vi.fn().mockResolvedValue({
        $kind: 'Transaction',
        Transaction: {
          status: { success: true, error: null },
          effects: {
            gasUsed: { computationCost: '1000', storageCost: '500', storageRebate: '500', nonRefundableStorageFee: '0' },
          },
        },
      }),
    } as never);
    const dryRun = await PreFlightSimulator.dryRun(built.tx, mockOpportunity);

    expect(dryRun).toBeDefined();
    expect(dryRun.simulationType).toBe('dryRun');
    expect(typeof dryRun.success).toBe('boolean');
  });

  it('generates serialized PTB payload and Sentio debugger URLs', async () => {
    const built = ZeroCapitalPtbBuilder.buildLiquidationPTB(mockOpportunity);
    const sentioExport = await sentioService.prepareSimulation(built.tx);

    expect(sentioExport.rawTransactionBytesBase64).toBeDefined();
    expect(sentioExport.rawTransactionBytesBase64.length).toBeGreaterThan(50);
    expect(sentioExport.sentioSimulatorUrl).toBe('https://app.sentio.xyz/sui');

    const traceUrl = sentioService.getTraceUrl('F93jd83hKLa7sd7z35uAJPn4XVm');
    expect(traceUrl).toBe('https://app.sentio.xyz/sui/tx/F93jd83hKLa7sd7z35uAJPn4XVm');
  });
});
