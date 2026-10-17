import type { Transaction } from '@mysten/sui/transactions';
import type { ProtocolType, DEXType } from './protocols.js';
import type { ObligationState } from './obligations.js';

export interface SwapQuote {
  dex: DEXType;
  fromCoinType: string;
  toCoinType: string;
  amountIn: bigint;
  expectedAmountOut: bigint;
  minimumAmountOut: bigint;
  slippageBps: number;
  priceImpactPct: number;
  poolId: string;
  a2b: boolean;
}

export interface LiquidationOpportunity {
  protocol: ProtocolType;
  obligation: ObligationState;
  debtCoinType: string;
  debtSymbol: string;
  debtAmountToRepay: bigint;      // Amount of debt to repay in smallest unit
  debtRepayUsd: number;
  collateralCoinType: string;
  collateralSymbol: string;
  collateralToReceive: bigint;    // Expected collateral returned by protocol
  collateralReceiveUsd: number;
  expectedGrossProfitUsd: number; // Collateral USD - Debt USD
  dex: DEXType;
  liquidationBonus: number;
}

export interface BuiltLiquidationPTB {
  tx: Transaction;
  opportunity: LiquidationOpportunity;
  estimatedFlashLoanFee: bigint;
  expectedProfitDebtUnits: bigint;
}

export interface SimulationResult {
  success: boolean;
  opportunity: LiquidationOpportunity;
  gasUsedSui: number;
  gasCostUsd: number;
  netProfitUsd: number;
  netProfitSui: number;
  isProfitable: boolean;
  errorMessage?: string;
  rawEffects?: unknown;
  simulationType?: 'devInspect' | 'dryRun';
  computationCostMist?: bigint;
  storageCostMist?: bigint;
  storageRebateMist?: bigint;
  sentioSimulatorUrl?: string;
}

export interface ExecutionResult {
  digest: string;
  success: boolean;
  opportunity: LiquidationOpportunity;
  gasUsedSui: number;
  gasCostUsd: number;
  netProfitUsd: number;
  timestamp: number;
  errorMessage?: string;
  strategyUsed?: 'soft_bundle' | 'pga_fallback';
  latencyMs?: number;
  status?: string;
}

export type ExecutionRouteType = 'soft_bundle' | 'pga_fallback';

export interface SoftBundleConfig {
  endpoint: string;
  authToken?: string;
  timeoutMs: number;
  enabled: boolean;
}

export interface SoftBundlePayload {
  bundleId: string;
  transactions: string[]; // Base64 encoded BCS serialized transaction bytes
  targetCheckpoint?: number;
  maxBlockNumber?: number;
  auctionBidMist?: bigint;
  tipAmountMist?: bigint;
  authSignature?: string;
  timestampMs: number;
}

export interface SoftBundleReceipt {
  bundleId: string;
  accepted: boolean;
  status: 'accepted' | 'rejected' | 'pending' | 'timeout';
  digest?: string;
  sequencerTimestampMs?: number;
  error?: string;
  rawResponse?: unknown;
}

export interface SoftBundleResult {
  bundleId: string;
  accepted: boolean;
  sequencerTimestampMs?: number;
  digest?: string;
  error?: string;
}

export interface PgaFallbackPayload {
  tx: Transaction;
  gasBudgetMist: bigint;
  gasPriceMist: bigint;
  maxTipAllocationMist: bigint;
  retryAttempts?: number;
  gasStepMultiplier?: number;
}

export interface PgaBroadcastResult {
  digest: string;
  success: boolean;
  gasUsedMist?: bigint;
  gasUsedSui?: number;
  gasCostUsd?: number;
  gasPriceMist?: bigint;
  attemptsUsed: number;
  effects?: unknown;
  error?: string;
}

export interface ExecutionBroadcastResult {
  strategyUsed: 'soft_bundle' | 'pga_fallback';
  status: 'success' | 'failure' | 'reverted' | 'simulated';
  digest: string;
  latencyMs: number;
  gasUsedSui?: number;
  gasCostUsd?: number;
  netProfitUsd?: number;
  error?: string;
  effects?: unknown;
}

export interface SlippageCheckParams {
  expectedAmountOut: bigint;
  actualAmountOut?: bigint;
  maxSlippageBps: number;
  spotPrice?: number;
  oraclePrice?: number;
}

export interface SlippageCheckResult {
  isValid: boolean;
  minAmountOut: bigint;
  expectedAmountOut: bigint;
  actualAmountOut?: bigint;
  slippageBps: number;
  maxSlippageBps: number;
  priceDivergencePct?: number;
  reason?: string;
}

export interface BatchLiquidationTarget {
  opportunity: LiquidationOpportunity;
  builtPtb?: BuiltLiquidationPTB;
  estimatedGasUnits?: bigint;
}

export interface BatchedPTBResult {
  tx: Transaction;
  opportunities: LiquidationOpportunity[];
  commandCount: number;
  estimatedTotalGasMist: bigint;
  targetCount: number;
}

export interface BatcherOptions {
  maxCommands?: number;
  maxGasBudgetMist?: bigint;
  maxTargets?: number;
}

export interface ExecutionPlan {
  opportunity: LiquidationOpportunity;
  ptb: BuiltLiquidationPTB;
  preferredRoute: ExecutionRouteType;
  fallbackToPga: boolean;
  maxSlippageBps: number;
  minNetProfitUsd: number;
}

export interface IExecutionService {
  execute(plan: ExecutionPlan): Promise<ExecutionResult>;
  executeSoftBundle(bundle: SoftBundlePayload): Promise<ExecutionResult>;
  executePgaFallback(tx: Transaction, maxGasBudget: bigint): Promise<ExecutionResult>;
}

export interface LatencyMetric {
  evalDurationMs: number;
  ptbBuildDurationMs: number;
  simulationDurationMs: number;
  broadcastDurationMs: number;
  totalCycleDurationMs: number;
}

export interface ExecutionMetric {
  opportunityId: string;
  protocol: ProtocolType;
  debtSymbol: string;
  collateralSymbol: string;
  expectedProfitUsd: number;
  actualProfitUsd?: number;
  gasCostSui: number;
  success: boolean;
  digest?: string;
  error?: string;
  timestampMs: number;
  latencies: LatencyMetric;
}

export interface SystemStats {
  uptimeSeconds: number;
  totalObligationsMonitored: number;
  immediateTargetsCount: number;
  hotWatchlistCount: number;
  safeCount: number;
  totalSimulations: number;
  successfulSimulations: number;
  totalLiquidationsAttempted: number;
  successfulLiquidations: number;
  failedLiquidations: number;
  cumulativeNetProfitUsd: number;
  cumulativeGasSpentSui: number;
  lastLiquidationTime?: number;
}
