import type { Keypair } from '@mysten/sui/cryptography';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export type VaultSecretKey =
  | 'SUI_PRIVATE_KEY'
  | 'PYTH_API_KEY'
  | 'SENTIO_API_KEY'
  | 'ALCHEMY_SUI_MAINNET_RPC'
  | 'SOFT_BUNDLE_AUTH_TOKEN'
  | 'RPC_API_KEYS'
  | 'CDP_API_KEY'
  | 'CDP_API_SECRET'
  | 'CDP_WALLET_SECRET'
  | (string & {});

export interface CDPCredentials {
  apiKey?: string;
  apiSecret?: string;
  walletSecret?: string;
  operatorKeypair?: Keypair | Ed25519Keypair;
  operatorAddress: string;
  pythApiKey?: string;
  sentioApiKey?: string;
  softBundleAuthToken?: string;
  rpcUrls: string[];
}

export interface IVaultAdapter {
  initialize(): Promise<void>;
  getSecret(key: VaultSecretKey | string): Promise<string | null>;
  getRequiredSecret(key: VaultSecretKey | string): Promise<string>;
  getCDPCredentials?(): Promise<CDPCredentials>;
  rotateSecret?(key: VaultSecretKey | string, newValue: string): Promise<void>;
  destroy(): Promise<void>;
}

export interface VaultConfig {
  provider: 'env' | 'aws_kms' | 'gcp_kms' | 'vault';
  failClosed: boolean;
  maskLogs: boolean;
}

export interface AgentRegistryConfig {
  maxTotalCapacity: number;
  maxSafeWatchlistCapacity?: number;
  maxHotWatchlistCapacity?: number;
  lruEvictionBatchSize?: number;
  ttlMs?: number;
}

export interface AgentRegistryMetrics {
  totalCapacity: number;
  currentSize: number;
  evictionCount: number;
  rejectionCount: number;
  lastEvictionMs?: number;
}

export interface GasPriceCalibration {
  referenceGasPrice: bigint;
  p95GasPrice: bigint;
  multiplier: number;
  sampleCount: number;
  lastCalibrationMs: number;
}

export interface P95ProfitabilityCheckResult {
  isProfitable: boolean;
  grossProfitUsd: number;
  estimatedSwapFeeUsd: number;
  p95GasCostUsd: number;
  calibratedNetProfitUsd: number;
  p95GasPrice: bigint;
  thresholdUsd: number;
  reason?: string;
}

export interface IGasPriceCalibrator {
  getP95GasPrice(): Promise<bigint>;
  isProfitableAtP95(
    estimatedGrossProfitUsd: number,
    estimatedGasUnits: bigint,
    suiPriceUsd: number,
    estimatedSwapFeeUsd?: number,
    minProfitUsd?: number
  ): Promise<boolean>;
}
