import dotenv from 'dotenv';
import { z } from 'zod';
import { SUPPORTED_CHAINS } from './chains.js';

dotenv.config();

const envSchema = z.object({
  CHAIN: z.enum(['sei', 'sei-testnet', 'monad']).default('sei'),
  EVM_PRIVATE_KEY: z.string().optional(),
  FLASH_LIQUIDATOR_ADDRESS: z.string().optional(),
  DRY_RUN: z.preprocess((val) => val === 'true' || val === true || val === '1', z.boolean().default(false)),
  MIN_PROFIT_USD: z.coerce.number().default(2.0),
  MAX_SLIPPAGE_BPS: z.coerce.number().default(100),
  PRIORITY_FEE_GWEI: z.coerce.number().default(1.5),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.parse(process.env);

export const CONFIG = {
  chain: parsed.CHAIN,
  chainConfig: SUPPORTED_CHAINS[parsed.CHAIN],
  privateKey: (parsed.EVM_PRIVATE_KEY && parsed.EVM_PRIVATE_KEY.startsWith('0x') && parsed.EVM_PRIVATE_KEY.length === 66
    ? parsed.EVM_PRIVATE_KEY
    : undefined) as `0x${string}` | undefined,
  flashLiquidatorAddress: (parsed.FLASH_LIQUIDATOR_ADDRESS && parsed.FLASH_LIQUIDATOR_ADDRESS.startsWith('0x') && parsed.FLASH_LIQUIDATOR_ADDRESS.length === 42
    ? parsed.FLASH_LIQUIDATOR_ADDRESS
    : undefined) as `0x${string}` | undefined,
  dryRun: parsed.DRY_RUN,
  minProfitUsd: parsed.MIN_PROFIT_USD,
  maxSlippageBps: parsed.MAX_SLIPPAGE_BPS,
  priorityFeeGwei: parsed.PRIORITY_FEE_GWEI,
  logLevel: parsed.LOG_LEVEL,
};
