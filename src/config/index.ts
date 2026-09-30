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

// Select active WebSocket URL (prefer dedicated Alchemy WebSocket over deprecated public fullnode)
const activeWsUrl =
  parsedEnv.SUI_WS_URL === 'wss://fullnode.mainnet.sui.io:443' && parsedEnv.ALCHEMY_SUI_MAINNET_RPC
    ? parsedEnv.ALCHEMY_SUI_MAINNET_RPC.replace(/^http/i, 'ws')
    : parsedEnv.SUI_WS_URL;

// Parse backup RPCs array
const backupRpcs = parsedEnv.SUI_BACKUP_RPCS
  ? parsedEnv.SUI_BACKUP_RPCS.split(',').map((u) => u.trim()).filter(Boolean)
  : [];

// Keypair handling: parse multi-format private keys with safety guards for live consensus
function parseOperatorKeypair(rawKey?: string, isDryRun: boolean = true): Ed25519Keypair {
  if (!rawKey || !rawKey.trim()) {
    if (!isDryRun) {
      throw new Error(
        'CRITICAL SECURITY ERROR: SUI_PRIVATE_KEY is empty in .env while DRY_RUN=false! Live broadcasting requires a persistent keypair.'
      );
    }
    return new Ed25519Keypair();
  }

  const trimmed = rawKey.trim();

  // 1. Bech32 format (e.g. suiprivkey1...)
  if (trimmed.startsWith('suiprivkey')) {
    try {
      return Ed25519Keypair.fromSecretKey(trimmed);
    } catch (e) {
      if (!isDryRun) throw new Error(`Invalid suiprivkey format in SUI_PRIVATE_KEY: ${e}`);
    }
  }

  // 2. Hex format (with or without 0x prefix)
  const hexCandidate = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hexCandidate) && (hexCandidate.length === 64 || hexCandidate.length === 66 || hexCandidate.length === 128)) {
    try {
      const buf = Buffer.from(hexCandidate, 'hex');
      if (buf.length === 33 && buf[0] === 0) {
        return Ed25519Keypair.fromSecretKey(new Uint8Array(buf.subarray(1)));
      } else if (buf.length === 32 || buf.length === 64) {
        return Ed25519Keypair.fromSecretKey(new Uint8Array(buf.subarray(0, 32)));
      }
    } catch (e) {
      if (!isDryRun) throw new Error(`Failed to parse hex SUI_PRIVATE_KEY: ${e}`);
    }
  }

  // 3. Base64 format (standard format used in sui.keystore)
  try {
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length === 33 && buf[0] === 0) {
      return Ed25519Keypair.fromSecretKey(new Uint8Array(buf.subarray(1)));
    } else if (buf.length === 32 || buf.length === 64) {
      return Ed25519Keypair.fromSecretKey(new Uint8Array(buf.subarray(0, 32)));
    }
  } catch (e) {
    if (!isDryRun) throw new Error(`Failed to parse base64 SUI_PRIVATE_KEY: ${e}`);
  }

  if (!isDryRun) {
    throw new Error(
      'CRITICAL CONFIG ERROR: Malformed SUI_PRIVATE_KEY in .env while DRY_RUN=false! Refusing to generate ephemeral key in live mode.'
    );
  }

  return new Ed25519Keypair();
}

const operatorKeypair = parseOperatorKeypair(parsedEnv.SUI_PRIVATE_KEY, parsedEnv.DRY_RUN);

export const CONFIG = {
  network: parsedEnv.NETWORK,
  rpcUrl: activeRpcUrl,
  backupRpcs,
  alchemyMainnetRpc: parsedEnv.ALCHEMY_SUI_MAINNET_RPC,
  alchemyTestnetRpc: parsedEnv.ALCHEMY_SUI_TESTNET_RPC,
  sentioApiKey: parsedEnv.SENTIO_API_KEY,
  wsUrl: activeWsUrl,
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
