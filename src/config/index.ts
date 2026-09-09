import dotenv from 'dotenv';
import { z } from 'zod';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// Load .env file
dotenv.config();

const optionalUrl = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().url().optional()
);

const optionalString = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().optional()
);

const envSchema = z.object({
  NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  SUI_RPC_URL: z.string().url().default('https://fullnode.mainnet.sui.io:443'),
  SUI_BACKUP_RPCS: z.string().default('https://sui-mainnet.nodeinfra.com,https://mainnet.sui.rpcpool.com'),
  SUI_WS_URL: z.string().default('wss://fullnode.mainnet.sui.io:443'),
  PYTH_HERMES_URL: z.string().url().default('https://pyth.dourolabs.app/hermes'),
  PYTH_API_KEY: optionalString,
  SUI_PRIVATE_KEY: optionalString,
  DRY_RUN: z.preprocess((val) => val === 'true' || val === true || val === '1', z.boolean().default(true)),
  MIN_PROFIT_USD: z.coerce.number().default(2.0),
  MAX_SLIPPAGE_BPS: z.coerce.number().default(100),
  GAS_BUDGET: z.coerce.number().default(50_000_000), // 0.05 SUI
  GAS_PRICE_MULTIPLIER: z.coerce.number().default(1.15),
  MAX_GAS_PRICE_MULTIPLIER: z.coerce.number().default(5.0),
  PRIORITY_PROFIT_SHARE: z.coerce.number().min(0.0).max(0.9).default(0.20),
  LIQUIDATION_CLOSE_FACTOR: z.coerce.number().min(0.1).max(1.0).default(0.5),
  PROTOCOLS: z.string().default('navi,scallop'),
  PREFERRED_DEX: z.enum(['cetus', 'deepbook', 'auto']).default('cetus'),
  POLL_INTERVAL_MS: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  ALCHEMY_SUI_MAINNET_RPC: optionalUrl,
  ALCHEMY_SUI_TESTNET_RPC: optionalUrl,
  SENTIO_API_KEY: optionalString,
});

const parsedEnv = envSchema.parse(process.env);

// Select active RPC URL (prefer dedicated Alchemy endpoint over deprecated public fullnode)
const activeRpcUrl =
  parsedEnv.SUI_RPC_URL === 'https://fullnode.mainnet.sui.io:443' && parsedEnv.ALCHEMY_SUI_MAINNET_RPC
    ? parsedEnv.ALCHEMY_SUI_MAINNET_RPC
    : parsedEnv.SUI_RPC_URL;

// Parse backup RPCs array
const backupRpcs = parsedEnv.SUI_BACKUP_RPCS
  ? parsedEnv.SUI_BACKUP_RPCS.split(',').map((u) => u.trim()).filter(Boolean)
  : [];

// Keypair handling: generate an ephemeral keypair if no private key is provided for safe dry runs
let operatorKeypair: Ed25519Keypair;
if (parsedEnv.SUI_PRIVATE_KEY && parsedEnv.SUI_PRIVATE_KEY.startsWith('suiprivkey')) {
  try {
    operatorKeypair = Ed25519Keypair.fromSecretKey(parsedEnv.SUI_PRIVATE_KEY);
  } catch {
    operatorKeypair = new Ed25519Keypair();
  }
} else {
  operatorKeypair = new Ed25519Keypair();
}

export const CONFIG = {
  network: parsedEnv.NETWORK,
  rpcUrl: activeRpcUrl,
  backupRpcs,
  alchemyMainnetRpc: parsedEnv.ALCHEMY_SUI_MAINNET_RPC,
  alchemyTestnetRpc: parsedEnv.ALCHEMY_SUI_TESTNET_RPC,
  sentioApiKey: parsedEnv.SENTIO_API_KEY,
  wsUrl: parsedEnv.SUI_WS_URL,
  pythHermesUrl: parsedEnv.PYTH_HERMES_URL,
  pythApiKey: parsedEnv.PYTH_API_KEY,
  operatorKeypair,
  operatorAddress: operatorKeypair.toSuiAddress(),
  dryRun: parsedEnv.DRY_RUN,
  minProfitUsd: parsedEnv.MIN_PROFIT_USD,
  maxSlippageBps: parsedEnv.MAX_SLIPPAGE_BPS,
  gasBudget: parsedEnv.GAS_BUDGET,
  gasPriceMultiplier: parsedEnv.GAS_PRICE_MULTIPLIER,
  maxGasPriceMultiplier: parsedEnv.MAX_GAS_PRICE_MULTIPLIER,
  priorityProfitShare: parsedEnv.PRIORITY_PROFIT_SHARE,
  liquidationCloseFactor: parsedEnv.LIQUIDATION_CLOSE_FACTOR,
  protocols: parsedEnv.PROTOCOLS.split(',').map((p) => p.trim().toLowerCase()) as ('navi' | 'scallop')[],
  preferredDex: parsedEnv.PREFERRED_DEX,
  pollIntervalMs: parsedEnv.POLL_INTERVAL_MS,
  logLevel: parsedEnv.LOG_LEVEL,
};

export type AppConfig = typeof CONFIG;
