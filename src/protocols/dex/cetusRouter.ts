import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { CETUS_CONFIG, SUI_CLOCK_OBJECT_ID } from '../../config/constants.js';
import { SwapQuote } from '../../config/types.js';
import { priceCache } from '../../oracles/priceCache.js';
import { getCoinConfigByType, normalizeStructTag } from '../../config/coins.js';
import { ensureCetusCompat } from '../../client/cetusCompat.js';
import { CONFIG } from '../../config/index.js';

// Activate Cetus SDK compatibility shim
ensureCetusCompat();

export interface CetusPoolDef {
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
}

export const CANONICAL_CETUS_POOLS: Record<string, CetusPoolDef> = {
  'USDC_SUI': {
    poolId: '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
    coinTypeA: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'CETUS_SUI': {
    poolId: '0x2e041f3fd93646dcc877f783c1f2b7fa62d30271bdef1f21ef002cebf857bded',
    coinTypeA: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'DEEP_SUI': {
    poolId: '0xe01243f37f712ef87e556afb9b1d03d0fae13f96d324ec912daffc339dfdcbd2',
    coinTypeA: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'USDC_USDT': {
    poolId: '0xb8a67c149fd1bc7f9aca1541c61e51ba13bdded64c273c278e50850ae3bff073',
    coinTypeA: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    coinTypeB: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
  },
  'USDC_ETH': {
    poolId: '0x9e59de50d9e5979fc03ac5bcacdb581c823dbd27d63a036131e17b391f2fac88',
    coinTypeA: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    coinTypeB: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
  },
};

/**
 * Cetus CLMM Atomic DEX Swap Router
 * Computes quotations and constructs pure Move swap calls within PTBs.
 */
export class CetusRouter {
  /**
   * Find matching Cetus pool for pair with precise CoinA/CoinB classification
   */
  public static findPoolId(fromCoinType: string, toCoinType: string): { poolId: string; a2b: boolean; coinTypeA: string; coinTypeB: string } | null {
    const normFrom = normalizeStructTag(fromCoinType);
    const normTo = normalizeStructTag(toCoinType);

    for (const pool of Object.values(CANONICAL_CETUS_POOLS)) {
      const normA = normalizeStructTag(pool.coinTypeA);
      const normB = normalizeStructTag(pool.coinTypeB);

      if (normFrom === normA && normTo === normB) {
        return { poolId: pool.poolId, a2b: true, coinTypeA: pool.coinTypeA, coinTypeB: pool.coinTypeB };
      }
      if (normFrom === normB && normTo === normA) {
        return { poolId: pool.poolId, a2b: false, coinTypeA: pool.coinTypeA, coinTypeB: pool.coinTypeB };
      }
    }

    return null;
  }

  /**
   * Check if a direct Cetus pool exists for pair
   */
  public static hasPool(fromCoinType: string, toCoinType: string): boolean {
    return this.findPoolId(fromCoinType, toCoinType) !== null;
  }

  /**
   * Compute swap quote and minimum output with slippage protection
   */
  public static getQuote(
    fromCoinType: string,
    toCoinType: string,
    amountIn: bigint,
    slippageBps: number = 100
  ): SwapQuote {
    const fromCfg = getCoinConfigByType(fromCoinType);
    const toCfg = getCoinConfigByType(toCoinType);

    const fromDecimals = fromCfg?.decimals ?? 9;
    const toDecimals = toCfg?.decimals ?? 9;

    const priceIn = priceCache.getPriceUsd(fromCoinType) || 1.0;
    const priceOut = priceCache.getPriceUsd(toCoinType) || 1.0;

    const normAmountIn = Number(amountIn) / Math.pow(10, fromDecimals);
    const valueInUsd = normAmountIn * priceIn;

    // Estimated output tokens
    const normAmountOut = valueInUsd / priceOut;
    const expectedAmountOut = BigInt(Math.floor(normAmountOut * Math.pow(10, toDecimals)));

    // Minimum output with slippage deduction
    const slippageFactor = 10000n - BigInt(slippageBps);
    const minimumAmountOut = (expectedAmountOut * slippageFactor) / 10000n;

    const poolInfo = this.findPoolId(fromCoinType, toCoinType);
    if (!poolInfo) {
      throw new Error(`No Cetus liquidity pool found for pair ${fromCoinType} -> ${toCoinType}`);
    }

    return {
      dex: 'cetus',
      fromCoinType,
      toCoinType,
      amountIn,
      expectedAmountOut,
      minimumAmountOut,
      slippageBps,
      priceImpactPct: 0.1, // Minimal impact in deep pools
      poolId: poolInfo.poolId,
      a2b: poolInfo.a2b,
    };
  }

  /**
   * Add Cetus atomic CLMM swap to PTB
   * Consumes inputCoin and returns outputCoin without transferring to wallet address
   */
  public static addSwap(
    tx: Transaction,
    quote: SwapQuote,
    inputCoin: TransactionObjectArgument
  ): TransactionObjectArgument {
    const poolInfo = this.findPoolId(quote.fromCoinType, quote.toCoinType);
    if (!poolInfo) {
      throw new Error(`No Cetus liquidity pool found for pair ${quote.fromCoinType} -> ${quote.toCoinType}`);
    }
    const coinTypeA = poolInfo.coinTypeA;
    const coinTypeB = poolInfo.coinTypeB;

    // Default sqrtPriceLimit for Cetus (0 for a2b or max for b2a)
    const sqrtPriceLimit = quote.a2b
      ? '4295048016' // MIN_SQRT_PRICE_X64
      : '79226673515401279992447579055'; // MAX_SQRT_PRICE_X64

    const primaryCoinInputA = quote.a2b ? inputCoin : tx.moveCall({
      target: '0x2::coin::zero',
      typeArguments: [coinTypeA],
    });

    const primaryCoinInputB = quote.a2b ? tx.moveCall({
      target: '0x2::coin::zero',
      typeArguments: [coinTypeB],
    }) : inputCoin;

    const [outCoinA, outCoinB] = tx.moveCall({
      target: `${CETUS_CONFIG.integratePackageId}::router::swap`,
      arguments: [
        tx.object(CETUS_CONFIG.globalConfigId),
        tx.object(quote.poolId),
        primaryCoinInputA,
        primaryCoinInputB,
        tx.pure.bool(quote.a2b),
        tx.pure.bool(true), // by_amount_in = true
        tx.pure.u64(quote.amountIn),
        tx.pure.u128(sqrtPriceLimit),
        tx.pure.bool(false), // use coin value always false
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
      typeArguments: [coinTypeA, coinTypeB],
    });

    // Safely transfer any unused input coin remainder / slippage dust back to operator wallet
    const unusedCoin = quote.a2b ? outCoinA : outCoinB;
    tx.transferObjects([unusedCoin], tx.pure.address(CONFIG.operatorAddress));

    // Return the received token
    return quote.a2b ? outCoinB : outCoinA;
  }
}
