/**
 * Configuration, Oracle, and Client types
 */

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

export type PriceUpdateCallback = (feedId: string, price: number) => void;

export type SuiEventHandler = (event: Record<string, unknown>) => void;

export interface RpcEndpointConfig {
  url: string;
  weight?: number;
  maxRps?: number;
  timeoutMs?: number;
  isPrimary?: boolean;
}

export interface RpcConfig {
  primaryUrl: string;
  backupUrls: string[];
  wsUrl: string;
  graphqlUrl?: string;
  alchemyApiKey?: string;
  alchemyMainnetRpc?: string;
  requestTimeoutMs?: number;
  maxRetries?: number;
}

export interface CachedGasCoin {
  objectId: string;
  version: string;
  digest: string;
  balanceMist: bigint;
  lastUpdatedMs: number;
}

export interface CachedGasData {
  objectId: string;
  version: string;
  digest: string;
  updatedAt: number;
}

export interface AlchemyHealthStatus {
  isConnected: boolean;
  endpoint: string;
  checkpoint: string;
  latencyMs: number;
  referenceGasPrice: bigint;
  network: string;
  error?: string;
}

export interface GraphQLObjectResult {
  objectId: string;
  version: string;
  digest: string;
  type?: string;
  owner?: {
    __typename?: string;
    address?: string;
    initialSharedVersion?: number;
  };
  hasPublicTransfer?: boolean;
  contents?: Record<string, unknown>;
}

export interface SentioSimulationExport {
  rawTransactionBytesBase64: string;
  sentioSimulatorUrl: string;
  sentioTraceUrl?: string;
  sender: string;
  gasBudget: number;
}
