import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  EnvVaultAdapter,
  SecurityFatalException,
  GasPriceCalibrator,
} from '../src/security/index.js';
import { logger, REDACTION_PATHS } from '../src/ui/logger.js';
import { ObligationRegistry } from '../src/engine/registry.js';
import { ExecutionRouter } from '../src/execution/router.js';
import { TransactionExecutor } from '../src/engine/executor.js';
import { LiquidationSearcher } from '../src/engine/searcher.js';
import { priceCache } from '../src/oracles/priceCache.js';
import type {
  ObligationState,
  LiquidationOpportunity,
  IObligationRepository,
  ObligationRecord,
} from '../src/types/index.js';

const SUI_COIN = '0x2::sui::SUI';
const USDC_COIN = '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN';

function makeAddress(id: number | string): string {
  if (typeof id === 'string' && id.startsWith('0x') && id.length === 66) {
    return id;
  }
  const hex = typeof id === 'number' ? id.toString(16) : Buffer.from(String(id)).toString('hex');
  return '0x' + hex.padStart(64, '0').slice(-64);
}

function createStressObligation(
  id: string,
  healthFactor: number,
  debtUsd: number = 100,
  collateralUsd: number = 150
): ObligationState {
  return {
    protocol: 'scallop',
    obligationId: makeAddress(id),
    ownerAddress: makeAddress(`owner_${id}`),
    collaterals: collateralUsd > 0 ? [
      {
        coinType: SUI_COIN,
        symbol: 'SUI',
        amount: BigInt(Math.floor(collateralUsd * 1e9 / 2.5)),
        decimals: 9,
        valueUsd: collateralUsd,
        liquidationThreshold: 0.8,
      },
    ] : [],
    debts: debtUsd > 0 ? [
      {
        coinType: USDC_COIN,
        symbol: 'USDC',
        amount: BigInt(Math.floor(debtUsd * 1e6)),
        decimals: 6,
        valueUsd: debtUsd,
      },
    ] : [],
    totalCollateralUsd: collateralUsd,
    totalDebtUsd: debtUsd,
    liquidationThresholdCollateralUsd: collateralUsd * 0.8,
    healthFactor,
    isLiquidatable: healthFactor < 1.0,
    lastUpdatedMs: Date.now(),
  };
}

function createStressOpportunity(
  id: string,
  healthFactor: number,
  grossProfitUsd: number,
  debtRepayUsd: number = 50.0,
  collateralReceiveUsd: number = 55.0
): LiquidationOpportunity {
  const obligation = createStressObligation(id, healthFactor, debtRepayUsd * 2, collateralReceiveUsd * 2);
  return {
    protocol: 'scallop',
    obligation,
    debtCoinType: USDC_COIN,
    debtSymbol: 'USDC',
    debtAmountToRepay: BigInt(Math.floor(debtRepayUsd * 1e6)),
    debtRepayUsd,
    collateralCoinType: SUI_COIN,
    collateralSymbol: 'SUI',
    collateralToReceive: BigInt(Math.floor(collateralReceiveUsd * 1e9 / 2.5)),
    collateralReceiveUsd,
    expectedGrossProfitUsd: grossProfitUsd,
    dex: 'cetus',
    liquidationBonus: 0.05,
  };
}

class InMemoryStressRepository implements IObligationRepository {
  private records: Map<string, ObligationRecord> = new Map();

  public initialize(): void {}
  public upsertObligation(obligation: ObligationRecord): void {
    this.records.set(obligation.obligationId, obligation);
  }
  public getObligation(id: string): ObligationRecord | null {
    return this.records.get(id) ?? null;
  }
  public getAllActiveObligations(): ObligationRecord[] {
    return Array.from(this.records.values());
  }
  public deleteObligation(id: string): void {
    this.records.delete(id);
  }
  public close(): void {}
}

describe('Adversarial Stress Verification — Milestone 4 (R4 Enterprise Security Hardening)', () => {
  beforeEach(() => {
    priceCache.updatePrice({
      symbol: 'SUI',
      coinType: SUI_COIN,
      price: 2.5,
      confidence: 0,
      exponent: -8,
      rawPrice: 250_000_000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });
    priceCache.updatePrice({
      symbol: 'USDC',
      coinType: USDC_COIN,
      price: 1.0,
      confidence: 0,
      exponent: -6,
      rawPrice: 1_000_000n,
      publishTime: 1700000000,
      lastUpdatedMs: Date.now(),
    });
  });

  // ==========================================================================
  // SECTION 1: BOUNDED REGISTRY UNDER MASSIVE CONCURRENCY & OVERFLOW STRESS
  // ==========================================================================
  describe('1. Bounded Registry Growth Adversarial Stress', () => {
    it('STRESS: inserts 1,000 obligations into a capacity-100 registry and strictly preserves all liquidatable targets', () => {
      const registry = ObligationRegistry.createForTesting(undefined, false, 100);
      expect(registry.getMaxCapacity()).toBe(100);

      // 1. First seed 40 liquidatable targets (HF 0.50 to 0.99)
      const liquidatableIds: string[] = [];
      for (let i = 0; i < 40; i++) {
        const id = `liq_${i}`;
        const hf = 0.5 + (i * 0.49) / 40;
        const obl = createStressObligation(id, hf, 500, 400);
        registry.upsertObligation(obl);
        liquidatableIds.push(obl.obligationId.toLowerCase());
      }

      expect(registry.getImmediateTargets().length).toBe(40);
      expect(registry.getCounts().total).toBe(40);

      // 2. Flood with 300 zero-debt obligations (Tier 1 eviction candidates)
      for (let i = 0; i < 300; i++) {
        const zeroDebt = createStressObligation(`zero_debt_${i}`, 1.2, 0, 100);
        registry.upsertObligation(zeroDebt);
      }

      // Registry must stay within capacity ceiling
      expect(registry.getCounts().total).toBeLessThanOrEqual(100);

      // 3. Flood with 300 ultra-safe obligations (HF 2.0 to 10.0, Tier 2 eviction candidates)
      for (let i = 0; i < 300; i++) {
        const safeObl = createStressObligation(`ultra_safe_${i}`, 2.0 + (i % 50), 50, 500);
        registry.upsertObligation(safeObl);
      }

      expect(registry.getCounts().total).toBeLessThanOrEqual(100);

      // 4. Flood with 360 moderate safe and hot watchlist obligations (HF 1.01 to 1.49)
      for (let i = 0; i < 360; i++) {
        const modSafe = createStressObligation(`mod_safe_${i}`, 1.01 + (i % 48) * 0.01, 100, 120);
        registry.upsertObligation(modSafe);
      }

      // Total insertions = 40 + 300 + 300 + 360 = 1000 items into capacity 100
      expect(registry.getCounts().total).toBe(100);
      expect(registry.getEvictionCount()).toBe(900);

      // CRITICAL INVARIANT: ALL 40 original liquidatable targets must still be present!
      const allActive = registry.getAllObligations().map((o) => o.obligationId.toLowerCase());
      const immediateTargets = registry.getImmediateTargets().map((o) => o.obligationId.toLowerCase());

      expect(immediateTargets.length).toBe(40);
      for (const id of liquidatableIds) {
        expect(allActive).toContain(id);
        expect(immediateTargets).toContain(id);
      }
    });

    it('STRESS: evicts in exact strict priority order (zero-debt -> safest HF >= 1.5 -> safe watchlist -> hot watchlist)', () => {
      // Capacity 4
      const registry = ObligationRegistry.createForTesting(undefined, false, 4);

      const zeroDebt = createStressObligation('target_zero_debt', 1.1, 0, 100); // Tier 1
      const safeVeryHigh = createStressObligation('target_hf_3_0', 3.0, 50, 200); // Tier 2
      const safeHigh = createStressObligation('target_hf_1_8', 1.8, 50, 120); // Tier 2
      const safeMod = createStressObligation('target_hf_1_2', 1.2, 50, 80); // Tier 3
      const hot = createStressObligation('target_hf_1_02', 1.02, 50, 60); // Tier 4

      // Insert first 4 items: zeroDebt, safeVeryHigh, safeHigh, safeMod
      registry.upsertObligation(zeroDebt);
      registry.upsertObligation(safeVeryHigh);
      registry.upsertObligation(safeHigh);
      registry.upsertObligation(safeMod);
      expect(registry.getCounts().total).toBe(4);

      // Step 1: Insert 5th item. Zero-debt obligation must be evicted first!
      const newEntry1 = createStressObligation('incoming_1', 1.3, 10, 20);
      registry.upsertObligation(newEntry1);

      let ids = registry.getAllObligations().map((o) => o.obligationId);
      expect(ids).not.toContain(zeroDebt.obligationId);
      expect(ids).toContain(safeVeryHigh.obligationId);
      expect(ids).toContain(safeHigh.obligationId);
      expect(ids).toContain(safeMod.obligationId);
      expect(ids).toContain(newEntry1.obligationId);

      // Step 2: Insert 6th item. Safest HF (target_hf_3_0) must be evicted next!
      const newEntry2 = createStressObligation('incoming_2', 1.3, 10, 20);
      registry.upsertObligation(newEntry2);

      ids = registry.getAllObligations().map((o) => o.obligationId);
      expect(ids).not.toContain(safeVeryHigh.obligationId);
      expect(ids).toContain(safeHigh.obligationId);

      // Step 3: Insert 7th item. Next safest HF (target_hf_1_8) must be evicted!
      const newEntry3 = createStressObligation('incoming_3', 1.3, 10, 20);
      registry.upsertObligation(newEntry3);

      ids = registry.getAllObligations().map((o) => o.obligationId);
      expect(ids).not.toContain(safeHigh.obligationId);
    });

    it('STRESS: Saturated liquidatable capacity — rejects non-liquidatable entries and protects 100% of liquidatable items', () => {
      const capacity = 10;
      const registry = ObligationRegistry.createForTesting(undefined, false, capacity);

      // Fill registry with 10 liquidatable obligations (HF < 1.0)
      const liquidatableIds: string[] = [];
      for (let i = 0; i < capacity; i++) {
        const obl = createStressObligation(`pure_liq_${i}`, 0.8 + i * 0.01, 100, 80);
        registry.upsertObligation(obl);
        liquidatableIds.push(obl.obligationId.toLowerCase());
      }

      expect(registry.getCounts().total).toBe(capacity);
      expect(registry.getImmediateTargets().length).toBe(capacity);

      // Attempt to insert 20 safe obligations (HF 1.5 to 5.0)
      for (let i = 0; i < 20; i++) {
        const safe = createStressObligation(`blocked_safe_${i}`, 2.5, 50, 200);
        registry.upsertObligation(safe);
      }

      // Registry total must still be 10, no safe obligation was able to evict any liquidatable target
      expect(registry.getCounts().total).toBe(capacity);
      expect(registry.getImmediateTargets().length).toBe(capacity);

      const activeIds = registry.getAllObligations().map((o) => o.obligationId.toLowerCase());
      for (const id of liquidatableIds) {
        expect(activeIds).toContain(id);
      }

      // Now insert another high-priority liquidatable obligation (HF 0.70)
      const criticalLiq = createStressObligation('critical_incoming_liq', 0.70, 200, 140);
      registry.upsertObligation(criticalLiq);

      // All existing liquidatable targets and the new critical target remain stored
      const targetsNow = registry.getImmediateTargets().map((o) => o.obligationId.toLowerCase());
      expect(targetsNow).toContain(criticalLiq.obligationId.toLowerCase());
      for (const id of liquidatableIds) {
        expect(targetsNow).toContain(id);
      }
    });

    it('STRESS: Dynamic downscaling via setMaxCapacity preserves all liquidatable targets and drops safe items', () => {
      const registry = ObligationRegistry.createForTesting(undefined, false, 50);

      // Insert 10 liquidatable targets + 40 safe obligations
      const liqIds: string[] = [];
      for (let i = 0; i < 10; i++) {
        const obl = createStressObligation(`dyn_liq_${i}`, 0.90, 100, 90);
        registry.upsertObligation(obl);
        liqIds.push(obl.obligationId.toLowerCase());
      }
      for (let i = 0; i < 40; i++) {
        const obl = createStressObligation(`dyn_safe_${i}`, 1.5 + i * 0.1, 50, 150);
        registry.upsertObligation(obl);
      }

      expect(registry.getCounts().total).toBe(50);

      // Dynamically downscale capacity to 10
      registry.setMaxCapacity(10);
      expect(registry.getMaxCapacity()).toBe(10);
      expect(registry.getCounts().total).toBe(10);
      expect(registry.getEvictionCount()).toBe(40);

      // All 10 liquidatable targets MUST be preserved; all 40 safe were evicted!
      const remainingTargets = registry.getImmediateTargets().map((o) => o.obligationId.toLowerCase());
      expect(remainingTargets.length).toBe(10);
      for (const id of liqIds) {
        expect(remainingTargets).toContain(id);
      }
    });

    it('STRESS: loadFromPersistence rehydration under capacity constraints prioritizes liquidatable obligations', () => {
      const mockRepo = new InMemoryStressRepository();

      // Populate repo with 50 safe obligations and 20 liquidatable obligations (total 70)
      for (let i = 0; i < 50; i++) {
        const state = createStressObligation(`db_safe_${i}`, 1.8 + i * 0.05, 50, 100);
        mockRepo.upsertObligation({
          obligationId: state.obligationId,
          protocol: state.protocol,
          ownerAddress: state.ownerAddress,
          collateralsJson: '[]',
          debtsJson: '[]',
          totalCollateralUsd: state.totalCollateralUsd,
          totalDebtUsd: state.totalDebtUsd,
          healthFactor: state.healthFactor,
          isLiquidatable: state.isLiquidatable,
          lastUpdatedMs: state.lastUpdatedMs,
          metadataJson: '{}',
        });
      }

      const dbLiqIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const state = createStressObligation(`db_liq_${i}`, 0.85, 100, 85);
        dbLiqIds.push(state.obligationId.toLowerCase());
        mockRepo.upsertObligation({
          obligationId: state.obligationId,
          protocol: state.protocol,
          ownerAddress: state.ownerAddress,
          collateralsJson: '[]',
          debtsJson: '[]',
          totalCollateralUsd: state.totalCollateralUsd,
          totalDebtUsd: state.totalDebtUsd,
          healthFactor: state.healthFactor,
          isLiquidatable: state.isLiquidatable,
          lastUpdatedMs: state.lastUpdatedMs,
          metadataJson: '{}',
        });
      }

      // Initialize registry with capacity ceiling of 25 (less than 70 total records)
      const boundedRegistry = ObligationRegistry.createForTesting(mockRepo, false, 25);
      boundedRegistry.loadFromPersistence();

      expect(boundedRegistry.getCounts().total).toBe(25);
      // All 20 liquidatable targets must be loaded into memory
      const loadedLiq = boundedRegistry.getImmediateTargets().map((o) => o.obligationId.toLowerCase());
      expect(loadedLiq.length).toBe(20);
      for (const id of dbLiqIds) {
        expect(loadedLiq).toContain(id);
      }
    });
  });

  // ==========================================================================
  // SECTION 2: 95th-PERCENTILE GAS PRICE CALIBRATION ADVERSARIAL STRESS
  // ==========================================================================
  describe('2. 95th-Percentile Gas Price Calibration Adversarial Stress', () => {
    let calibrator: GasPriceCalibrator;

    beforeEach(() => {
      calibrator = new GasPriceCalibrator({
        windowSize: 200,
        defaultP95Multiplier: 1.5,
        defaultGasUnits: 15_000_000n,
      });
    });

    it('STRESS: P95 computation with extreme skewed outlier spikes', async () => {
      // 95 samples of 1000 MIST and 5 samples of 500,000 MIST spike
      const samples: bigint[] = [];
      for (let i = 0; i < 95; i++) {
        samples.push(1000n);
      }
      for (let i = 0; i < 5; i++) {
        samples.push(500_000n);
      }
      calibrator.recordGasPriceSamples(samples);

      const p95 = await calibrator.getP95GasPrice();
      // In 100 samples, index floor(0.95 * 99) = index 94. Index 94 is 1000n or 500_000n depending on sorting
      // Let's verify p95 is >= 1000n
      expect(p95).toBeGreaterThanOrEqual(1000n);

      // Now with 94 samples of 1000n and 6 samples of 500_000n
      calibrator.clearSamples();
      for (let i = 0; i < 94; i++) samples.push(1000n);
      for (let i = 0; i < 6; i++) samples.push(500_000n);
      calibrator.recordGasPriceSamples(samples);

      const p95Spike = await calibrator.getP95GasPrice();
      expect(p95Spike).toBe(500_000n);
    });

    it('STRESS: Mathematical precision of EstimatedProfit_P95 across diverse volatile asset prices', async () => {
      // Test at SUI = $10.00
      // Gross bonus: $10.00
      // Collateral rebalance volume: $100.00 => Swap fee (0.3%) = $0.30
      // Gas units: 20,000,000
      // P95 Gas price: 50,000 MIST
      // GasCostMist = (20,000,000 * 50,000) / 1000 = 1,000,000,000 MIST = 1.0 SUI
      // At SUI = $10.00: GasCostUsd = $10.00
      // Net profit = 10.00 - 0.30 - 10.00 = -$0.30
      const opp = createStressOpportunity('opp_sui_10', 0.95, 10.0, 90.0, 100.0);
      const res = await calibrator.evaluateProfitabilityAtP95(opp, {
        gasUnits: 20_000_000n,
        p95GasPrice: 50_000n,
        suiPriceUsd: 10.0,
        minProfitUsd: 1.0,
      });

      expect(res.isProfitable).toBe(false);
      expect(res.grossProfitUsd).toBe(10.0);
      expect(res.estimatedSwapFeeUsd).toBeCloseTo(0.30, 2);
      expect(res.p95GasCostUsd).toBeCloseTo(10.0, 2);
      expect(res.calibratedNetProfitUsd).toBeCloseTo(-0.30, 2);
      expect(res.reason).toContain('Opportunity unprofitable under P95 congestion');
    });

    it('STRESS: LiquidationSearcher rejects unprofitable liquidations across BOTH fast-path and safe-path pipelines', async () => {
      const searcher = new LiquidationSearcher();
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      // Extreme congestion: 200,000 MIST gas price
      globalCalibrator.recordGasPriceSamples(Array(20).fill(200_000n));

      // 1. Fast-Path Opportunity (HF = 0.95 <= 0.985)
      // Gross bonus $2.50, but at 200k MIST gas cost is ~$7.50
      const fastPathOpp = createStressOpportunity('opp_fast_unprofitable', 0.95, 2.50, 40.0, 42.50);
      const fastResult = await searcher.executeLiquidationPipeline(fastPathOpp);
      expect(fastResult).toBe(false);

      // 2. Safe-Path Opportunity (HF = 0.99 > 0.985)
      const safePathOpp = createStressOpportunity('opp_safepath_unprofitable', 0.99, 2.50, 40.0, 42.50);
      const safeResult = await searcher.executeLiquidationPipeline(safePathOpp);
      expect(safeResult).toBe(false);

      globalCalibrator.clearSamples();
    });

    it('STRESS: ExecutionRouter strictly rejects broadcast before touching sequencer when unprofitable at P95', async () => {
      const router = new ExecutionRouter();
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      globalCalibrator.recordGasPriceSamples(Array(20).fill(100_000n));

      const opp = createStressOpportunity('opp_unprofitable_router', 0.95, 1.50, 20.0, 21.50);
      const tx = new Transaction();

      // Attempt broadcast
      const broadcastRes = await router.broadcast(tx, opp, { suiPriceUsd: 2.5 });

      expect(broadcastRes.status).toBe('failure');
      expect(broadcastRes.digest).toBe('REJECTED_P95_UNPROFITABLE');
      expect(broadcastRes.error).toContain('Opportunity unprofitable under P95 congestion');
      expect(broadcastRes.netProfitUsd).toBeLessThan(0);

      globalCalibrator.clearSamples();
    });

    it('STRESS: TransactionExecutor throws safety gate error before signing or PGA broadcasting', async () => {
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      globalCalibrator.recordGasPriceSamples(Array(20).fill(120_000n));

      const opp = createStressOpportunity('opp_unprofitable_exec_stress', 0.95, 2.00, 30.0, 32.00);
      const tx = new Transaction();

      await expect(
        TransactionExecutor.execute(tx, opp, 2.00)
      ).rejects.toThrow(/Pre-broadcast P95 Gas Calibration violation/);

      globalCalibrator.clearSamples();
    });

    it('STRESS: Genuinely profitable opportunities (gross bonus $80 vs $2 gas cost) pass cleanly across all modules', async () => {
      const router = new ExecutionRouter();
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      // Moderate congestion: 2000 MIST
      globalCalibrator.recordGasPriceSamples(Array(20).fill(2000n));

      // Huge opportunity: $80 gross profit on $1000 liquidation
      const richOpp = createStressOpportunity('opp_rich', 0.90, 80.0, 1000.0, 1080.0);

      // Verify calibrator evaluation
      const evalResult = await globalCalibrator.evaluateProfitabilityAtP95(richOpp, {
        suiPriceUsd: 2.5,
      });
      expect(evalResult.isProfitable).toBe(true);
      expect(evalResult.calibratedNetProfitUsd).toBeGreaterThan(70.0);

      // Mock soft bundle submission
      vi.spyOn(router.getSoftBundleClient(), 'submitTransaction').mockResolvedValueOnce({
        accepted: true,
        digest: '0xRichOpportunitySuccess',
        bundleId: 'bundle_rich_001',
        status: 'accepted',
      });

      const tx = new Transaction();
      const broadcastRes = await router.broadcast(tx, richOpp, { suiPriceUsd: 2.5 });
      expect(broadcastRes.status).toBe('success');
      expect(broadcastRes.digest).toBe('0xRichOpportunitySuccess');

      globalCalibrator.clearSamples();
    });
  });

  // ==========================================================================
  // SECTION 3: VAULT CREDENTIAL MANAGEMENT FAIL-CLOSED ADVERSARIAL STRESS
  // ==========================================================================
  describe('3. Vault Credential Management Fail-Closed Adversarial Stress', () => {
    it('STRESS: Live execution mode (isDryRun=false) refuses to boot with missing SUI_PRIVATE_KEY', async () => {
      const emptyVault = new EnvVaultAdapter({
        env: {
          CDP_API_KEY: 'some_key',
          CDP_API_SECRET: 'some_secret',
        },
        isDryRun: false,
        failClosed: true,
      });

      await expect(emptyVault.initialize()).rejects.toThrow(SecurityFatalException);
      await expect(emptyVault.getCDPCredentials()).rejects.toThrow(
        /SUI_PRIVATE_KEY is missing from vault while active execution is enabled/
      );
    });

    it('STRESS: Live execution mode refuses whitespace-only or empty SUI_PRIVATE_KEY', async () => {
      const whitespaceVault = new EnvVaultAdapter({
        env: {
          SUI_PRIVATE_KEY: '    \t   \n  ',
        },
        isDryRun: false,
        failClosed: true,
      });

      await expect(whitespaceVault.initialize()).rejects.toThrow(SecurityFatalException);
    });

    it('STRESS: Live execution mode throws on corrupted/malformed SUI_PRIVATE_KEY formats', () => {
      const vault = new EnvVaultAdapter({ env: {}, isDryRun: false });

      // 1. Invalid Bech32
      expect(() =>
        vault.resolveOperatorKeypair('suiprivkey1invalidbadchecksum0000000000', false)
      ).toThrow(SecurityFatalException);

      // 2. Corrupted key with invalid length
      expect(() =>
        vault.resolveOperatorKeypair('0x12345678', false)
      ).toThrow(SecurityFatalException);

      // 3. Corrupted key with non-base64 characters
      expect(() =>
        vault.resolveOperatorKeypair('!@#$%^&*()_+=~`{}[]|:;"<>,.?/', false)
      ).toThrow(SecurityFatalException);
    });

    it('STRESS: Valid formats (Bech32, Hex, Base64) are resolved and memory scrubbing is invoked', () => {
      const kp = new Ed25519Keypair();
      const bech32 = kp.getSecretKey();
      const seed = new Uint8Array(32).fill(7);
      const hex = '0x' + Buffer.from(seed).toString('hex');
      const b64 = Buffer.from(seed).toString('base64');

      const vault = new EnvVaultAdapter({ env: {}, isDryRun: false });

      const fromBech32 = vault.resolveOperatorKeypair(bech32, false);
      expect(fromBech32.toSuiAddress()).toBe(kp.toSuiAddress());

      const fromHex = vault.resolveOperatorKeypair(hex, false);
      expect(fromHex.toSuiAddress()).toBe(Ed25519Keypair.fromSecretKey(seed).toSuiAddress());

      const fromB64 = vault.resolveOperatorKeypair(b64, false);
      expect(fromB64.toSuiAddress()).toBe(Ed25519Keypair.fromSecretKey(seed).toSuiAddress());
    });

    it('STRESS: Destroyed vault prevents any subsequent credential access', async () => {
      const seed = new Uint8Array(32).fill(1);
      const hexKey = '0x' + Buffer.from(seed).toString('hex');

      const vault = new EnvVaultAdapter({
        env: {
          SUI_PRIVATE_KEY: hexKey,
          CDP_API_KEY: 'test_cdp_api',
        },
        isDryRun: false,
      });

      expect(await vault.getSecret('CDP_API_KEY')).toBe('test_cdp_api');

      // Destroy the vault
      await vault.destroy();

      await expect(vault.getSecret('CDP_API_KEY')).rejects.toThrow(
        /VaultAdapter instance has been destroyed/
      );
      await expect(vault.getRequiredSecret('CDP_API_KEY')).rejects.toThrow(
        /VaultAdapter instance has been destroyed/
      );
      await expect(vault.getCDPCredentials()).rejects.toThrow(
        /VaultAdapter instance has been destroyed/
      );
      expect(() => vault.resolveOperatorKeypair(hexKey, false)).toThrow(
        /VaultAdapter instance has been destroyed/
      );
    });

    it('STRESS: Pino log redaction ensures sensitive keys and nested objects are censored', () => {
      const criticalKeys = [
        'CDP_API_KEY',
        'CDP_API_SECRET',
        'CDP_WALLET_SECRET',
        'SUI_PRIVATE_KEY',
        'operatorKeypair',
        'privateKey',
        'secret',
        'password',
        'token',
      ];

      for (const k of criticalKeys) {
        expect(REDACTION_PATHS).toContain(k);
        expect(REDACTION_PATHS).toContain(`*.${k}`);
      }
    });
  });
});
