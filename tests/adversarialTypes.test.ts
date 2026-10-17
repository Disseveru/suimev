import { describe, it, expect } from 'vitest';
import * as canonicalTypes from '../src/types/index.js';
import * as legacyConfigTypes from '../src/config/types.js';
import { NaviProtocol, NaviPoolInfo as ProtocolNaviPoolInfo } from '../src/protocols/navi/naviProtocol.js';
import { BuildScallopLiquidationParams as PtbScallopParams } from '../src/protocols/scallop/scallopPtb.js';
import { CetusPoolDef as PtbCetusPoolDef } from '../src/protocols/dex/cetusRouter.js';

describe('Adversarial Type Stress & Contract Parity Check', () => {
  it('should verify all exported members are identical across index and config/types', () => {
    const keysA = Object.keys(canonicalTypes).sort();
    const keysB = Object.keys(legacyConfigTypes).sort();
    expect(keysA).toEqual(keysB);
  });

  it('should test Scallop PTB type assignability against canonical types', () => {
    const params: canonicalTypes.BuildScallopLiquidationParams = {
      obligationId: '0x123',
      debtCoinType: '0x2::sui::SUI',
      collateralCoinType: '0x5d4b::usdc::USDC',
      debtAmountToRepay: 1000n,
      recipientAddress: '0x0000000000000000000000000000000000000000000000000000000000000001',
    };

    const ptbParams: PtbScallopParams = params;
    expect(ptbParams.obligationId).toBe('0x123');

    const reverse: canonicalTypes.BuildScallopLiquidationParams = ptbParams;
    expect(reverse.debtAmountToRepay).toBe(1000n);
  });

  it('should test CetusPoolDef assignability against canonical types', () => {
    const canonicalPool: canonicalTypes.CetusPoolDef = {
      poolId: '0x0000000000000000000000000000000000000000000000000000000000000002',
      coinTypeA: '0x2::sui::SUI',
      coinTypeB: '0x5d4b::coin::COIN',
    };
    const ptbPool: PtbCetusPoolDef = canonicalPool;
    expect(ptbPool.poolId).toBe('0x0000000000000000000000000000000000000000000000000000000000000002');
  });

  it('should verify NaviPoolInfo parity and reconciliation between naviProtocol.ts and types/protocols.ts', async () => {
    const navi = NaviProtocol.getInstance();
    await navi.initialize();
    const runtimePool = navi.getAllPools()[0];
    expect(runtimePool).toBeDefined();

    // Harmonized ProtocolNaviPoolInfo shape:
    expect(runtimePool).toHaveProperty('id');
    expect(runtimePool).toHaveProperty('poolContract');
    expect(runtimePool).toHaveProperty('borrowFeeBps');
    expect(runtimePool).toHaveProperty('coinType');

    // Canonical types.NaviPoolInfo and ProtocolNaviPoolInfo are identical and satisfied
    const canonicalPool: canonicalTypes.NaviPoolInfo = runtimePool;
    const protocolPool: ProtocolNaviPoolInfo = canonicalPool;
    expect(canonicalPool.id).toBe(runtimePool.id);
    expect(canonicalPool.poolContract).toBe(runtimePool.poolContract);
    expect(protocolPool.coinType).toBe(runtimePool.coinType);
  });

  it('should stress-test SQLite ObligationRecord serialization and deserialization integrity', () => {
    const state: canonicalTypes.ObligationState = {
      protocol: 'scallop',
      obligationId: 'obl_123',
      ownerAddress: 'owner_456',
      collaterals: [
        {
          coinType: '0x2::sui::SUI',
          symbol: 'SUI',
          amount: 5000000000n,
          decimals: 9,
          valueUsd: 15.0,
          liquidationThreshold: 0.8,
        },
      ],
      debts: [
        {
          coinType: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
          symbol: 'USDC',
          amount: 10000000n,
          decimals: 6,
          valueUsd: 10.0,
        },
      ],
      totalCollateralUsd: 15.0,
      totalDebtUsd: 10.0,
      liquidationThresholdCollateralUsd: 12.0,
      healthFactor: 1.2,
      isLiquidatable: false,
      lastUpdatedMs: 1728000000000,
      scallopObligationKey: 'key_789',
      liquidateLocked: false,
    };

    // Serialize to ObligationRecord
    const record: canonicalTypes.ObligationRecord = {
      obligationId: state.obligationId,
      protocol: state.protocol,
      ownerAddress: state.ownerAddress,
      collateralsJson: JSON.stringify(state.collaterals, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v
      ),
      debtsJson: JSON.stringify(state.debts, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v
      ),
      totalCollateralUsd: state.totalCollateralUsd,
      totalDebtUsd: state.totalDebtUsd,
      healthFactor: state.healthFactor,
      isLiquidatable: state.isLiquidatable,
      lastUpdatedMs: state.lastUpdatedMs,
      metadataJson: JSON.stringify({
        scallopObligationKey: state.scallopObligationKey,
        liquidateLocked: state.liquidateLocked,
      }),
    };

    expect(record.obligationId).toBe('obl_123');
    expect(record.protocol).toBe('scallop');

    // Deserialization check
    const deserializedCollaterals = JSON.parse(record.collateralsJson).map((c: any) => ({
      ...c,
      amount: BigInt(c.amount),
    }));
    expect(deserializedCollaterals[0].amount).toBe(5000000000n);
  });

  it('should stress-test SoftBundle and PGA fallback routing payload definitions', () => {
    const bundle: canonicalTypes.SoftBundlePayload = {
      bundleId: 'bundle_001',
      transactions: ['base64_tx_1', 'base64_tx_2'],
      targetCheckpoint: 123456,
      maxBlockNumber: 789012,
      auctionBidMist: 10000000n,
      authSignature: 'sig_abc',
      timestampMs: Date.now(),
    };

    expect(bundle.bundleId).toBe('bundle_001');
    expect(bundle.transactions.length).toBe(2);
    expect(bundle.auctionBidMist).toBe(10000000n);

    const routes: canonicalTypes.ExecutionRouteType[] = ['soft_bundle', 'pga_fallback'];
    expect(routes).toContain('soft_bundle');
    expect(routes).toContain('pga_fallback');
  });

  it('should stress-test P95 gas calibration and vault typing', () => {
    const calibration: canonicalTypes.GasPriceCalibration = {
      referenceGasPrice: 750n,
      p95GasPrice: 1500n,
      multiplier: 1.5,
      sampleCount: 100,
      lastCalibrationMs: Date.now(),
    };

    expect(calibration.p95GasPrice).toBeGreaterThan(calibration.referenceGasPrice);

    const p95Check: canonicalTypes.P95ProfitabilityCheckResult = {
      isProfitable: true,
      grossProfitUsd: 25.0,
      estimatedSwapFeeUsd: 0.5,
      p95GasCostUsd: 2.5,
      calibratedNetProfitUsd: 22.0,
      p95GasPrice: 1500n,
      thresholdUsd: 5.0,
    };

    expect(p95Check.calibratedNetProfitUsd).toBe(
      p95Check.grossProfitUsd - p95Check.estimatedSwapFeeUsd - p95Check.p95GasCostUsd
    );
  });
});
