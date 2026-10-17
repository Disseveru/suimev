import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';

export type ProtocolType = 'navi' | 'scallop';

export type DEXType = 'cetus' | 'deepbook' | 'astros';

// NAVI Protocol Types
export interface NaviPoolInfo {
  id: number;
  coinType: string;
  symbol: string;
  poolContract: string;
  reserveBalance: bigint;
  borrowFeeBps: number;
  supplyApy: number;
  borrowApy: number;
  flashloanEnabled: boolean;
  liquidationBonus: number;
  liquidationRatio: number;
  liquidationThreshold: number;
  oracleId: number;
  /** Optional legacy alias for id */
  poolId?: number;
  /** Optional legacy alias for poolContract */
  reserveAddress?: string;
  /** Optional legacy rate representation */
  borrowFeeRate?: number;
  /** Optional supply cap */
  supplyCap?: bigint;
  /** Optional borrow cap */
  borrowCap?: bigint;
}

export interface NaviFlashLoanResult {
  loanCoin: TransactionObjectArgument;
  receipt: TransactionObjectArgument;
}

// Scallop Protocol Types
export interface ScallopFlashLoanResult {
  loanCoin: TransactionObjectArgument;
  receipt: TransactionObjectArgument;
}

export interface ScallopLiquidateResult {
  collateralCoin: TransactionObjectArgument;
  leftoverDebtCoin: TransactionObjectArgument;
}

export interface BuildScallopLiquidationParams {
  tx?: Transaction;
  obligationId: string;
  debtCoinType: string;
  collateralCoinType: string;
  debtAmountToRepay: bigint;
  expectedCollateralAmount?: bigint;
  recipientAddress: string;
  isLocked?: boolean;
  dex?: 'cetus' | 'deepbook';
  maxSlippageBps?: number;
}

export interface ScallopCompleteLiquidationResult {
  tx: Transaction;
  collateralCoin: TransactionObjectArgument;
  leftoverDebtCoin: TransactionObjectArgument;
  profitCoin: TransactionObjectArgument;
}

export interface ScallopObligationRisk {
  obligationId: string;
  totalRiskLevel: number;
  isLiquidatable: boolean;
  liquidateLocked: boolean;
}

// DEX Types
export interface CetusPoolDef {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
}

export interface DirectPoolEntry {
  poolId: string;
  isA2B: boolean;
  aType: string;
  bType: string;
}

export interface DeepBookPoolDef {
  poolId: string;
  baseCoin: string;
  quoteCoin: string;
  lotSize?: number;
  tickSize?: number;
}

export interface AstrosRouteResponse {
  data?: {
    amount_in: number | string;
    amount_out: number | string;
    routes: Array<{
      dex: string;
      path: string[];
      amount_in: number | string;
      amount_out: number | string;
    }>;
    from_token: {
      address: string;
      decimals: number;
      price: number;
    };
    to_token: {
      address: string;
      decimals: number;
      price: number;
    };
  };
}
