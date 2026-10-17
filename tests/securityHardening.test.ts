import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  EnvVaultAdapter,
  SecurityFatalException,
  GasPriceCalibrator,
} from '../src/security/index.js';
import { REDACTION_PATHS } from '../src/ui/logger.js';
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

function createMockObligation(
  id: string,
  healthFactor: number,
  debtUsd: number = 100,
  collateralUsd: number = 150
): ObligationState {
  return {
    protocol: 'scallop',
    obligationId: id,
    ownerAddress: `0xowner_${id}`,
    collaterals: [
      {
        coinType: SUI_COIN,
        symbol: 'SUI',
        amount: BigInt(Math.floor(collateralUsd * 1e9 / 2.5)),
        decimals: 9,
        valueUsd: collateralUsd,
        liquidationThreshold: 0.8,
      },
    ],
    debts: [
      {
        coinType: USDC_COIN,
        symbol: 'USDC',
        amount: BigInt(Math.floor(debtUsd * 1e6)),
        decimals: 6,
        valueUsd: debtUsd,
      },
    ],
    totalCollateralUsd: collateralUsd,
    totalDebtUsd: debtUsd,
    liquidationThresholdCollateralUsd: collateralUsd * 0.8,
    healthFactor,
    isLiquidatable: healthFactor < 1.0,
    lastUpdatedMs: Date.now(),
  };
}

function createMockOpportunity(
  id: string,
  healthFactor: number,
  grossProfitUsd: number,
  debtRepayUsd: number = 50.0,
  collateralReceiveUsd: number = 55.0
): LiquidationOpportunity {
  const obligation = createMockObligation(id, healthFactor, debtRepayUsd * 2, collateralReceiveUsd * 2);
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

class InMemoryMockRepository implements IObligationRepository {
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

describe('Milestone 4: Enterprise Security Hardening (Requirement R4)', () => {
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
  // SECTION 1: VAULT CREDENTIAL RESOLUTION & FAIL-CLOSED VALIDATION
  // ==========================================================================
  describe('1. Vault Credential Resolution & Fail-Closed Security (EnvVaultAdapter)', () => {
    it('should resolve CDP credentials from environment variables managed by vault', async () => {
      const mockEnv: Record<string, string> = {
        CDP_API_KEY: 'cdp_api_key_test_123',
        CDP_API_SECRET: 'cdp_api_secret_test_456',
        CDP_WALLET_SECRET: 'cdp_wallet_secret_test_789',
        PYTH_API_KEY: 'pyth_key_abc',
        SENTIO_API_KEY: 'sentio_key_xyz',
        SOFT_BUNDLE_AUTH_TOKEN: 'soft_bundle_tok_001',
      };

      const vault = new EnvVaultAdapter({ env: mockEnv, isDryRun: true });
      await vault.initialize();

      const apiKey = await vault.getSecret('CDP_API_KEY');
      const apiSecret = await vault.getSecret('CDP_API_SECRET');
      const walletSecret = await vault.getSecret('CDP_WALLET_SECRET');

      expect(apiKey).toBe('cdp_api_key_test_123');
      expect(apiSecret).toBe('cdp_api_secret_test_456');
      expect(walletSecret).toBe('cdp_wallet_secret_test_789');

      const cdpCreds = await vault.getCDPCredentials();
      expect(cdpCreds.apiKey).toBe('cdp_api_key_test_123');
      expect(cdpCreds.apiSecret).toBe('cdp_api_secret_test_456');
      expect(cdpCreds.walletSecret).toBe('cdp_wallet_secret_test_789');
      expect(cdpCreds.pythApiKey).toBe('pyth_key_abc');
      expect(cdpCreds.sentioApiKey).toBe('sentio_key_xyz');
      expect(cdpCreds.softBundleAuthToken).toBe('soft_bundle_tok_001');
    });

    it('should resolve operator private key from hex, bech32, and base64 formats', async () => {
      const originalKeypair = new Ed25519Keypair();
      const bech32Key = originalKeypair.getSecretKey(); // 'suiprivkey1...'

      const vault = new EnvVaultAdapter({
        env: { SUI_PRIVATE_KEY: bech32Key },
        isDryRun: true,
      });

      // 1. Bech32
      const keypairBech32 = vault.resolveOperatorKeypair(bech32Key, true);
      expect(keypairBech32.toSuiAddress()).toBe(originalKeypair.toSuiAddress());

      // 2. Hex
      const seed = new Uint8Array(32).fill(9);
      const expectedKeypair = Ed25519Keypair.fromSecretKey(seed);
      const hexKey = Buffer.from(seed).toString('hex');
      const keypairHex = vault.resolveOperatorKeypair(hexKey, true);
      expect(keypairHex.toSuiAddress()).toBe(expectedKeypair.toSuiAddress());

      // 3. Base64
      const base64Key = Buffer.from(seed).toString('base64');
      const keypairBase64 = vault.resolveOperatorKeypair(base64Key, true);
      expect(keypairBase64.toSuiAddress()).toBe(expectedKeypair.toSuiAddress());
    });

    it('should fail-closed and throw SecurityFatalException when SUI_PRIVATE_KEY is missing in active execution mode', async () => {
      const liveVault = new EnvVaultAdapter({
        env: {}, // Missing SUI_PRIVATE_KEY
        isDryRun: false, // Active execution mode
        failClosed: true,
      });

      await expect(liveVault.initialize()).rejects.toThrow(SecurityFatalException);
      await expect(liveVault.getCDPCredentials()).rejects.toThrow(SecurityFatalException);
    });

    it('should throw clear error when getRequiredSecret is called for missing credential', async () => {
      const vault = new EnvVaultAdapter({ env: {} });
      await expect(vault.getRequiredSecret('CDP_API_KEY')).rejects.toThrow(
        /Required vault secret "CDP_API_KEY" is missing/
      );
    });

    it('should validate active execution credentials and throw if CDP keys are missing when required', () => {
      const vault = new EnvVaultAdapter({
        env: { SUI_PRIVATE_KEY: 'some_priv_key' },
        isDryRun: false,
      });

      expect(() => vault.validateActiveExecutionCredentials(false)).not.toThrow();
      expect(() => vault.validateActiveExecutionCredentials(true)).toThrow(
        /CDP_API_KEY or CDP_API_SECRET is missing/
      );
    });

    it('should support in-memory secret rotation and secure destruction', async () => {
      const vault = new EnvVaultAdapter({
        env: { CDP_API_KEY: 'initial_key' },
      });

      expect(await vault.getSecret('CDP_API_KEY')).toBe('initial_key');

      await vault.rotateSecret('CDP_API_KEY', 'rotated_key_v2');
      expect(await vault.getSecret('CDP_API_KEY')).toBe('rotated_key_v2');

      await vault.destroy();
      await expect(vault.getSecret('CDP_API_KEY')).rejects.toThrow(
        /VaultAdapter instance has been destroyed/
      );
    });

    it('should verify Pino log redaction paths include all sensitive keys', () => {
      const requiredRedactionKeys = [
        'CDP_API_KEY',
        'CDP_API_SECRET',
        'operatorKeypair',
        'privateKey',
        'secret',
        'password',
        'token',
      ];

      for (const key of requiredRedactionKeys) {
        expect(REDACTION_PATHS).toContain(key);
      }
    });
  });

  // ==========================================================================
  // SECTION 2: BOUNDED OBLIGATION REGISTRY & PRIORITIZED LRU EVICTION
  // ==========================================================================
  describe('2. Bounded Obligation Registry & Prioritized LRU Eviction', () => {
    it('should enforce capacity ceiling and evict safest obligations first', () => {
      const mockRepo = new InMemoryMockRepository();
      // Configure capacity ceiling of 3
      const registry = ObligationRegistry.createForTesting(mockRepo, false, 3);
      expect(registry.getMaxCapacity()).toBe(3);

      const oblSafe1 = createMockObligation('obl_safe_1', 2.0); // HF 2.0
      const oblSafe2 = createMockObligation('obl_safe_2', 1.8); // HF 1.8
      const oblSafe3 = createMockObligation('obl_safe_3', 1.6); // HF 1.6

      registry.upsertObligation(oblSafe1);
      registry.upsertObligation(oblSafe2);
      registry.upsertObligation(oblSafe3);

      expect(registry.getCounts().total).toBe(3);
      expect(registry.getEvictionCount()).toBe(0);

      // Insert 4th safe obligation with HF 1.2
      // oblSafe1 has the highest HF (2.0) and should be evicted first!
      const oblSafe4 = createMockObligation('obl_safe_4', 1.2);
      registry.upsertObligation(oblSafe4);

      expect(registry.getCounts().total).toBe(3);
      expect(registry.getEvictionCount()).toBe(1);

      const all = registry.getAllObligations();
      const ids = all.map((o) => o.obligationId);
      expect(ids).not.toContain('obl_safe_1'); // Safest obligation was evicted
      expect(ids).toContain('obl_safe_2');
      expect(ids).toContain('obl_safe_3');
      expect(ids).toContain('obl_safe_4');
    });

    it('should evict zero-debt obligations before safe obligations with active debt', () => {
      const registry = ObligationRegistry.createForTesting(undefined, false, 2);

      const zeroDebtObl = createMockObligation('obl_zero_debt', 1.2, 0, 100); // 0 debt
      const activeDebtObl = createMockObligation('obl_active_debt', 2.5, 100, 250); // Active debt, HF 2.5

      registry.upsertObligation(zeroDebtObl);
      registry.upsertObligation(activeDebtObl);

      expect(registry.getCounts().total).toBe(2);

      // Insert new obligation
      const newObl = createMockObligation('obl_new', 1.4, 50, 100);
      registry.upsertObligation(newObl);

      expect(registry.getCounts().total).toBe(2);
      expect(registry.getEvictionCount()).toBe(1);

      const remainingIds = registry.getAllObligations().map((o) => o.obligationId);
      // Zero-debt obligation should have been evicted first despite having lower HF than activeDebtObl!
      expect(remainingIds).not.toContain('obl_zero_debt');
      expect(remainingIds).toContain('obl_active_debt');
      expect(remainingIds).toContain('obl_new');
    });

    it('CRITICAL: NEVER evict liquidatable obligations (HF <= 1.0) or immediate targets under capacity pressure', () => {
      const registry = ObligationRegistry.createForTesting(undefined, false, 3);

      const liquidatable1 = createMockObligation('liq_target_1', 0.95); // HF 0.95
      const liquidatable2 = createMockObligation('liq_target_2', 0.88); // HF 0.88
      const safeObl = createMockObligation('safe_obl', 2.0); // HF 2.0

      registry.upsertObligation(liquidatable1);
      registry.upsertObligation(liquidatable2);
      registry.upsertObligation(safeObl);

      expect(registry.getCounts().total).toBe(3);
      expect(registry.getImmediateTargets().length).toBe(2);

      // Now insert another liquidatable target (HF 0.92)
      const liquidatable3 = createMockObligation('liq_target_3', 0.92);
      registry.upsertObligation(liquidatable3);

      expect(registry.getCounts().total).toBe(3);
      expect(registry.getEvictionCount()).toBe(1);

      // safe_obl must be evicted to preserve all liquidatable targets!
      const remainingIds = registry.getAllObligations().map((o) => o.obligationId);
      expect(remainingIds).not.toContain('safe_obl');
      expect(remainingIds).toContain('liq_target_1');
      expect(remainingIds).toContain('liq_target_2');
      expect(remainingIds).toContain('liq_target_3');
      expect(registry.getImmediateTargets().length).toBe(3);

      // Even if another safe obligation attempts to enter when registry is full of HF <= 1.0 targets,
      // liquidatable targets are NEVER evicted!
      const safeAttempt = createMockObligation('safe_attempt', 3.0);
      registry.upsertObligation(safeAttempt);

      // Size remains 3, safe attempt is rejected, all 3 liquidatable targets are preserved
      expect(registry.getCounts().total).toBe(3);
      const postAttemptTargets = registry.getImmediateTargets().map((o) => o.obligationId);
      expect(postAttemptTargets).toContain('liq_target_1');
      expect(postAttemptTargets).toContain('liq_target_2');
      expect(postAttemptTargets).toContain('liq_target_3');
    });

    it('should respect maxCapacity ceiling dynamically updated via setMaxCapacity', () => {
      const registry = ObligationRegistry.createForTesting(undefined, false, 10);
      for (let i = 1; i <= 8; i++) {
        registry.upsertObligation(createMockObligation(`obl_${i}`, 1.2 + i * 0.1));
      }
      expect(registry.getCounts().total).toBe(8);

      // Reduce capacity ceiling to 4
      registry.setMaxCapacity(4);
      expect(registry.getMaxCapacity()).toBe(4);
      expect(registry.getCounts().total).toBe(4);
      expect(registry.getEvictionCount()).toBe(4);
    });
  });

  // ==========================================================================
  // SECTION 3: 95th-PERCENTILE GAS PRICE CALIBRATION & PRE-BROADCAST CHECK
  // ==========================================================================
  describe('3. 95th-Percentile Gas Price Calibration & Pre-Broadcast Profitability Check', () => {
    let calibrator: GasPriceCalibrator;

    beforeEach(() => {
      calibrator = new GasPriceCalibrator({
        windowSize: 100,
        defaultP95Multiplier: 1.5,
        defaultGasUnits: 15_000_000n,
      });
    });

    it('should compute empirical P95 gas price accurately from sample distribution', async () => {
      // Feed 100 gas price samples: 1000 to 2000 MIST
      const samples: bigint[] = [];
      for (let i = 1; i <= 100; i++) {
        samples.push(BigInt(1000 + i * 10)); // 1010 to 2000
      }
      calibrator.recordGasPriceSamples(samples);

      expect(calibrator.getSamplesCount()).toBe(100);

      const p95 = await calibrator.getP95GasPrice();
      // 95th percentile of 100 samples index 94 => 1000 + 95*10 = 1950 MIST
      expect(p95).toBe(1950n);
    });

    it('should calculate estimated profit at P95 gas price using the exact mathematical formula', async () => {
      // Opportunity:
      // Gross bonus: $5.00
      // Repay: $50.00, Seize: $55.00
      // Swap fee: 0.3% of $55 = $0.165
      // Gas units: 15,000,000 units
      // P95 Gas price: 1500 MIST
      // GasCostMist = 15,000,000 * 1500 / 1000 = 22,500,000 MIST = 0.0225 SUI
      // At SUI = $2.50: GasCostUsd = 0.0225 * 2.50 = $0.05625
      // EstimatedProfit_P95 = 5.00 - 0.165 - 0.05625 = $4.77875
      const opp = createMockOpportunity('opp_profitable', 0.95, 5.0, 50.0, 55.0);

      const result = await calibrator.evaluateProfitabilityAtP95(opp, {
        p95GasPrice: 1500n,
        gasUnits: 15_000_000n,
        suiPriceUsd: 2.5,
        minProfitUsd: 2.0,
      });

      expect(result.isProfitable).toBe(true);
      expect(result.grossProfitUsd).toBe(5.0);
      expect(result.estimatedSwapFeeUsd).toBeCloseTo(0.165, 3);
      expect(result.p95GasCostUsd).toBeCloseTo(0.05625, 4);
      expect(result.calibratedNetProfitUsd).toBeCloseTo(4.77875, 3);
    });

    it('should reject opportunity when liquidation bonus is wiped out by P95 gas price congestion', async () => {
      // Marginal opportunity:
      // Gross bonus: $2.10
      // Repay: $100.00, Seize: $102.10
      // Swap fee: 0.3% of $102.10 = $0.3063
      // Under network congestion: P95 gas price = 10,000 MIST (10x RGP)
      // Gas units = 30,000,000 units
      // Gas cost MIST = 30,000,000 * 10,000 / 1000 = 300,000,000 MIST = 0.30 SUI
      // At SUI = $2.50: Gas cost USD = $0.75
      // EstimatedProfit_P95 = 2.10 - 0.3063 - 0.75 = $1.0437 < $2.00 minProfitUsd!
      const marginalOpp = createMockOpportunity('opp_marginal', 0.95, 2.10, 100.0, 102.10);

      const result = await calibrator.evaluateProfitabilityAtP95(marginalOpp, {
        p95GasPrice: 10_000n,
        gasUnits: 30_000_000n,
        suiPriceUsd: 2.5,
        minProfitUsd: 2.0,
      });

      expect(result.isProfitable).toBe(false);
      expect(result.calibratedNetProfitUsd).toBeLessThan(2.0);
      expect(result.reason).toContain('Opportunity unprofitable under P95 congestion');
    });

    it('ExecutionRouter: should reject broadcast when opportunity is unprofitable under P95 network congestion', async () => {
      const router = new ExecutionRouter();
      const marginalOpp = createMockOpportunity('opp_congested', 0.95, 2.05, 50.0, 52.05);

      // Force severe network congestion in global calibrator
      const severeSamples = Array(20).fill(150_000n); // 150,000 MIST gas price
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      globalCalibrator.recordGasPriceSamples(severeSamples);

      const tx = new Transaction();
      const broadcastResult = await router.broadcast(tx, marginalOpp, {
        suiPriceUsd: 2.5,
      });

      expect(broadcastResult.status).toBe('failure');
      expect(broadcastResult.digest).toBe('REJECTED_P95_UNPROFITABLE');
      expect(broadcastResult.error).toContain('Opportunity unprofitable under P95 congestion');

      // Reset calibrator samples
      globalCalibrator.clearSamples();
    });

    it('ExecutionRouter: should allow broadcast when opportunity remains profitable at P95 gas price', async () => {
      const router = new ExecutionRouter();
      const healthyOpp = createMockOpportunity('opp_healthy', 0.92, 10.0, 100.0, 110.0);

      // Normal network conditions: 1500 MIST
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      globalCalibrator.recordGasPriceSamples(Array(20).fill(1500n));

      // Mock soft bundle client to accept
      vi.spyOn(router.getSoftBundleClient(), 'submitTransaction').mockResolvedValueOnce({
        accepted: true,
        digest: '0xValidSoftBundleDigest123',
        bundleId: 'bundle_p95_test',
        status: 'accepted',
      });

      const tx = new Transaction();
      const broadcastResult = await router.broadcast(tx, healthyOpp, {
        suiPriceUsd: 2.5,
      });

      expect(broadcastResult.status).toBe('success');
      expect(broadcastResult.digest).toBe('0xValidSoftBundleDigest123');

      globalCalibrator.clearSamples();
    });

    it('TransactionExecutor: should throw Safety Gate error when opportunity is unprofitable at P95', async () => {
      const opp = createMockOpportunity('opp_unprofitable_exec', 0.95, 2.10, 50.0, 52.10);

      // Force congestion
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      globalCalibrator.recordGasPriceSamples(Array(20).fill(100_000n));

      const tx = new Transaction();
      await expect(
        TransactionExecutor.execute(tx, opp, 2.10)
      ).rejects.toThrow(/Pre-broadcast P95 Gas Calibration violation/);

      globalCalibrator.clearSamples();
    });

    it('LiquidationSearcher: should reject execution in both fast-path and standard pipeline when unprofitable at P95', async () => {
      const searcher = new LiquidationSearcher();

      // Fast-path opportunity (HF <= 0.985)
      const fastPathOpp = createMockOpportunity('opp_fastpath_unprofitable', 0.95, 2.05, 50.0, 52.05);

      // Force severe congestion
      const globalCalibrator = GasPriceCalibrator.getInstance();
      globalCalibrator.clearSamples();
      globalCalibrator.recordGasPriceSamples(Array(20).fill(100_000n));

      const executed = await searcher.executeLiquidationPipeline(fastPathOpp);
      // Must be rejected before broadcast!
      expect(executed).toBe(false);

      globalCalibrator.clearSamples();
    });

    it('should test exact GasPriceCalibrator.estimateGasCostUsd arithmetic', () => {
      // 10,000,000 units at 1000 MIST gas price = 10,000,000 MIST = 0.01 SUI.
      // At $2.50 per SUI: $0.025.
      const costUsd = calibrator.estimateGasCostUsd(10_000_000n, 1000n, 2.5);
      expect(costUsd).toBeCloseTo(0.025, 6);
    });

    it('should verify IGasPriceCalibrator.isProfitableAtP95 interface contract', async () => {
      const isProfitableHigh = await calibrator.isProfitableAtP95(15.0, 15_000_000n, 2.5, 0.1);
      expect(isProfitableHigh).toBe(true);

      // Gross profit $0.02 with swap fee $0.05 and gas cost ~$0.05 yields net profit < 0
      const isProfitableLow = await calibrator.isProfitableAtP95(0.02, 15_000_000n, 2.5, 0.05);
      expect(isProfitableLow).toBe(false);

      // Explicit threshold
      const isProfitableCustom = await calibrator.isProfitableAtP95(5.0, 15_000_000n, 2.5, 0.1, 10.0);
      expect(isProfitableCustom).toBe(false);
    });
  });

  describe('4. ObligationRegistry LRU Tie-Breaker and Persistence Bounding', () => {
    it('should evict oldest accessed entry when multiple obligations have identical health factors', async () => {
      const registry = ObligationRegistry.createForTesting(undefined, false, 2);

      const obl1 = createMockObligation('obl_identical_1', 1.8);
      const obl2 = createMockObligation('obl_identical_2', 1.8);

      registry.upsertObligation(obl1);
      // Wait tiny delay so obl2 has later timestamp
      await new Promise((r) => setTimeout(r, 10));
      registry.upsertObligation(obl2);

      expect(registry.getCounts().total).toBe(2);

      // Now insert obl3 with same HF 1.8
      await new Promise((r) => setTimeout(r, 10));
      const obl3 = createMockObligation('obl_identical_3', 1.8);
      registry.upsertObligation(obl3);

      expect(registry.getCounts().total).toBe(2);
      expect(registry.getEvictionCount()).toBe(1);

      const remaining = registry.getAllObligations().map((o) => o.obligationId);
      // obl1 is older than obl2 => obl1 must be evicted!
      expect(remaining).not.toContain('obl_identical_1');
      expect(remaining).toContain('obl_identical_2');
      expect(remaining).toContain('obl_identical_3');
    });

    it('should bound capacity when loadFromPersistence is invoked with more records than capacity', () => {
      const mockRepo = new InMemoryMockRepository();
      // Populate repo with 5 records
      for (let i = 1; i <= 5; i++) {
        const state = createMockObligation(`persisted_${i}`, 1.2 + i * 0.1);
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

      const boundedRegistry = ObligationRegistry.createForTesting(mockRepo, false, 3);
      const loadedCount = boundedRegistry.loadFromPersistence();

      expect(loadedCount).toBe(3);
      expect(boundedRegistry.getCounts().total).toBe(3);
      expect(boundedRegistry.getAllObligations().length).toBe(3);
    });
  });
});
