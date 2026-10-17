import { describe, it, expect, beforeEach } from 'vitest';
import { COIN_CONFIGS, getCoinConfigBySymbol, getCoinConfigByType } from '../src/config/coins.js';
import { priceCache } from '../src/oracles/priceCache.js';
import { ON_CHAIN_PYTH_OBJECTS, pythService } from '../src/oracles/pythService.js';
import { obligationRegistry } from '../src/engine/registry.js';
import { HealthFactorEngine } from '../src/oracles/healthFactor.js';
import { ObligationState } from '../src/config/types.js';

describe('hBTC Oracle Price Feed Tracking & Volatility Liquidation Cascade Suite', () => {
  beforeEach(() => {
    obligationRegistry.clear();
  });

  it('1. Verifies hBTC / HBTC coin configuration & Pyth BTC feed mapping', () => {
    const hbtcCfg = getCoinConfigBySymbol('hBTC');
    expect(hbtcCfg).toBeDefined();
    expect(hbtcCfg?.symbol).toBe('HBTC');
    expect(hbtcCfg?.decimals).toBe(8);
    // Mapped to authoritative Pyth BTC/USD price feed
    expect(hbtcCfg?.pythPriceFeedId).toBe('0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43');

    // Structural fallback resolves Hashi BTC
    const byType = getCoinConfigByType('0xa877d4d97b6a8bae1da982a84980c502c5ad2ead4b24e6c8e50c57cd6ddc3771::btc::BTC');
    expect(byType).toBeDefined();
    expect(byType?.symbol).toBe('HBTC');

    // Pyth on-chain BTC object includes HBTC and hBTC
    expect(ON_CHAIN_PYTH_OBJECTS.WBTC.symbols).toContain('HBTC');
    expect(ON_CHAIN_PYTH_OBJECTS.WBTC.symbols).toContain('hBTC');
  });

  it('2. PriceCache tracks live BTC and hBTC price updates synchronously', () => {
    // Initial seeded price
    expect(priceCache.getPriceUsd(COIN_CONFIGS.HBTC.coinType)).toBeGreaterThan(0);

    // Simulate Pyth oracle price update: BTC drops from $80,000 to $65,000
    priceCache.updatePriceForSymbol('HBTC', '6500000000000', -8, Math.floor(Date.now() / 1000));
    expect(priceCache.getPriceUsd(COIN_CONFIGS.HBTC.coinType)).toBe(65000);
    expect(priceCache.getPriceBySymbol('hBTC')?.price).toBe(65000);

    // Check volatility delta tracking
    const { dropBps, isDrop } = priceCache.recordBtcPriceUpdate(65000);
    expect(isDrop).toBe(true);
    expect(dropBps).toBeGreaterThan(1000); // > 10% drop
  });

  it('3. Rapid BTC price drops trigger cascading liquidations for hBTC-collateralized loans previously in safe tier', () => {
    // Set initial baseline BTC price: $80,000
    priceCache.updatePriceForSymbol('HBTC', '8000000000000', -8, Math.floor(Date.now() / 1000));
    priceCache.updatePriceForSymbol('USDC', '100000000', -8, Math.floor(Date.now() / 1000));

    // Create a borrower loan:
    // Collateral: 1.0 hBTC ($80,000 value, 80% LT = $64,000 borrowing capacity)
    // Debt: 55,000 USDC
    // Initial Health Factor = $64,000 / $55,000 = 1.1636 (SAFE WATCHLIST tier: HF >= 1.07)
    const testObligation: ObligationState = {
      obligationId: '0x_hbtc_borrower_whale',
      protocol: 'scallop',
      ownerAddress: '0x_whale_address',
      collaterals: [
        {
          coinType: COIN_CONFIGS.HBTC.coinType,
          symbol: 'HBTC',
          amount: 100_000_000n, // 1.0 hBTC (8 decimals)
          decimals: 8,
          valueUsd: 80000,
          liquidationThreshold: 0.80,
        },
      ],
      debts: [
        {
          coinType: COIN_CONFIGS.USDC.coinType,
          symbol: 'USDC',
          amount: 55_000_000_000n, // 55,000 USDC (6 decimals)
          decimals: 6,
          valueUsd: 55000,
        },
      ],
      totalCollateralUsd: 80000,
      totalDebtUsd: 55000,
      liquidationThresholdCollateralUsd: 64000,
      healthFactor: 1.1636,
      isLiquidatable: false,
      lastUpdatedMs: Date.now(),
    };

    obligationRegistry.upsertObligation(testObligation);

    // Verify it is placed into safeWatchlist (HF = 1.1636)
    const countsBefore = obligationRegistry.getCounts();
    expect(countsBefore.safe).toBe(1);
    expect(countsBefore.hot).toBe(0);
    expect(countsBefore.immediate).toBe(0);

    // --- RAPID BITCOIN FLASH CRASH SCENARIO ---
    // Bitcoin price plunges 25% from $80,000 to $60,000
    // Collateral: 1.0 hBTC ($60,000 value, 80% LT = $48,000)
    // Debt: 55,000 USDC
    // New Health Factor = $48,000 / $55,000 = 0.8727 (UNDERCOLLATERALIZED / LIQUIDATABLE!)
    priceCache.updatePriceForSymbol('HBTC', '6000000000000', -8, Math.floor(Date.now() / 1000));
    priceCache.updatePriceForSymbol('WBTC', '6000000000000', -8, Math.floor(Date.now() / 1000));

    // Standard hotWatchlist scan would MISS this borrower because it was at HF 1.1636!
    const missedByHotOnly = obligationRegistry.reevaluateHotWatchlist();
    expect(missedByHotOnly.length).toBe(0); // Proves why reevaluateVolatileCollaterals is essential!

    // Volatile Collateral Cascade Sweep: Scans all loans holding BTC/hBTC
    const cascadingLiquidations = obligationRegistry.reevaluateVolatileCollaterals('BTC');
    expect(cascadingLiquidations.length).toBe(1);
    expect(cascadingLiquidations[0].obligationId).toBe('0x_hbtc_borrower_whale');
    expect(cascadingLiquidations[0].healthFactor).toBeCloseTo(0.8727, 3);
    expect(cascadingLiquidations[0].isLiquidatable).toBe(true);

    // Promoted directly to immediateTargets for consensus liquidation
    const immediateTargets = obligationRegistry.getImmediateTargets();
    expect(immediateTargets.length).toBe(1);
    expect(immediateTargets[0].obligationId).toBe('0x_hbtc_borrower_whale');

    // Optimal liquidation opportunity found
    const opp = HealthFactorEngine.findBestLiquidationOpportunity(immediateTargets[0]);
    expect(opp).not.toBeNull();
    expect(opp?.collateralCoinType).toBe(COIN_CONFIGS.HBTC.coinType);
    expect(opp?.debtCoinType).toBe(COIN_CONFIGS.USDC.coinType);
  });
});
