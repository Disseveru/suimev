import type { ProtocolType } from './protocols.js';

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
  liquidateLocked?: boolean;
  naviAccountCap?: string;
}

/**
 * SQLite Persistent Obligation Record (Requirement R1 / Milestone 2)
 */
export interface ObligationRecord {
  obligationId: string;
  protocol: ProtocolType;
  ownerAddress: string;
  collateralsJson: string;
  debtsJson: string;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  healthFactor: number;
  isLiquidatable: boolean;
  lastUpdatedMs: number;
  metadataJson?: string;
}

export type ObligationCallback = (obligation: ObligationState) => void;
export type ScallopObligationCallback = (obligation: ObligationState) => void;

export type WatchlistBucket = 'immediate' | 'hot' | 'safe';

export interface RegistryCounts {
  total: number;
  immediate: number;
  hot: number;
  safe: number;
}

export interface ObligationQueryFilter {
  protocol?: ProtocolType;
  isLiquidatable?: boolean;
  isActive?: boolean;
  maxHealthFactor?: number;
  minDebtUsd?: number;
  limit?: number;
  offset?: number;
}

/**
 * Interface contract for SQLite Obligation Repository (Milestone 2 / Requirement R1)
 */
export interface IObligationRepository {
  initialize(): void;
  upsertObligation(obligation: ObligationRecord): void;
  getObligation(id: string): ObligationRecord | null;
  getAllActiveObligations(): ObligationRecord[];
  deleteObligation(id: string): void;
  close(): void;
  query?(filter?: ObligationQueryFilter): ObligationRecord[];
  upsertObligations?(obligations: ObligationRecord[]): void;
}

