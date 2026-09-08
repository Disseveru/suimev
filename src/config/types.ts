/**
 * Core Type Definitions for SuiMEV Liquidator
 */

export type ProtocolType = 'navi' | 'scallop';

export type DEXType = 'cetus' | 'deepbook';

export interface CoinMetadataConfig {
  symbol: string;
  name: string;
  decimals: number;
  coinType: string;
  pythPriceFeedId: string;
  naviPoolId?: number;
  scallopCoinName?: string;
  liquidationThreshold: number; // e.g. 0.80 for 80%
  liquidationBonus: number;     // e.g. 0.05 for 5% bonus
}

export interface OraclePrice {
  symbol: string;
  coinType: string;
  price: number;            // Normalized USD price, e.g. 2.45
  confidence: number;       // Confidence interval
  exponent: number;         // Pyth exponent (e.g. -8)
  rawPrice: bigint;         // Raw integer price
  publishTime: number;      // Unix timestamp in seconds
  lastUpdatedMs: number;    // Local millisecond timestamp
}

export interface CollateralPosition {
  coinType: string;
  symbol: string;
  amount: bigint;           // Raw balance in smallest denomination (MIST / wei)
  decimals: number;
  valueUsd: number;         // USD value: (amount / 10^decimals) * price
  liquidationThreshold: number;
}

export interface DebtPosition {
  coinType: string;
  symbol: string;
  amount: bigint;           // Raw borrowed balance
  decimals: number;
  valueUsd: number;         // USD value
}

export interface ObligationState {
  protocol: ProtocolType;
  obligationId: string;     // Unique identifier (account address or obligation object ID)
  ownerAddress: string;
  collaterals: CollateralPosition[];
  debts: DebtPosition[];
  totalCollateralUsd: number;
  totalDebtUsd: number;
  liquidationThresholdCollateralUsd: number;
  healthFactor: number;     // Health factor: < 1.0 is liquidatable
  isLiquidatable: boolean;
  lastUpdatedMs: number;
  // Protocol specific metadata
  scallopObligationKey?: string;
  naviAccountCap?: string;
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
