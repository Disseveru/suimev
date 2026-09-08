import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { DEEPBOOK_CONFIG, SUI_CLOCK_OBJECT_ID } from '../../config/constants.js';
import { SwapQuote } from '../../config/types.js';
import { priceCache } from '../../oracles/priceCache.js';
import { getCoinConfigByType } from '../../config/coins.js';
import { CONFIG } from '../../config/index.js';

/**
 * DeepBook v3 Atomic DEX Router
 * Constructs spot market swap Move calls within PTBs.
 */
export class DeepBookRouter {
  public static findPoolId(fromCoinType: string, toCoinType: string): { poolId: string; isBaseForQuote: boolean; baseCoin: string; quoteCoin: string } | null {
    const fromCfg = getCoinConfigByType(fromCoinType);
    const toCfg = getCoinConfigByType(toCoinType);

    if (!fromCfg || !toCfg) return null;

    const fromSym = fromCfg.symbol.toUpperCase();
    const toSym = toCfg.symbol.toUpperCase();

    // SUI / USDC pool
    if (fromSym === 'SUI' && toSym === 'USDC') {
      return { poolId: DEEPBOOK_CONFIG.pools.SUI_USDC, isBaseForQuote: true, baseCoin: fromCfg.coinType, quoteCoin: toCfg.coinType };
    }
    if (fromSym === 'USDC' && toSym === 'SUI') {
      return { poolId: DEEPBOOK_CONFIG.pools.SUI_USDC, isBaseForQuote: false, baseCoin: toCfg.coinType, quoteCoin: fromCfg.coinType };
    }

    // DEEP / SUI pool
    if (fromSym === 'DEEP' && toSym === 'SUI') {
      return { poolId: DEEPBOOK_CONFIG.pools.DEEP_SUI, isBaseForQuote: true, baseCoin: fromCfg.coinType, quoteCoin: toCfg.coinType };
    }
    if (fromSym === 'SUI' && toSym === 'DEEP') {
      return { poolId: DEEPBOOK_CONFIG.pools.DEEP_SUI, isBaseForQuote: false, baseCoin: toCfg.coinType, quoteCoin: fromCfg.coinType };
    }

    // DEEP / USDC pool
    if (fromSym === 'DEEP' && toSym === 'USDC') {
      return { poolId: DEEPBOOK_CONFIG.pools.DEEP_USDC, isBaseForQuote: true, baseCoin: fromCfg.coinType, quoteCoin: toCfg.coinType };
    }
    if (fromSym === 'USDC' && toSym === 'DEEP') {
      return { poolId: DEEPBOOK_CONFIG.pools.DEEP_USDC, isBaseForQuote: false, baseCoin: toCfg.coinType, quoteCoin: fromCfg.coinType };
    }

    // USDT / USDC pool
    if (fromSym === 'USDT' && toSym === 'USDC') {
      return { poolId: DEEPBOOK_CONFIG.pools.USDT_USDC, isBaseForQuote: true, baseCoin: fromCfg.coinType, quoteCoin: toCfg.coinType };
    }
    if (fromSym === 'USDC' && toSym === 'USDT') {
      return { poolId: DEEPBOOK_CONFIG.pools.USDT_USDC, isBaseForQuote: false, baseCoin: toCfg.coinType, quoteCoin: fromCfg.coinType };
    }

    return null;
  }

  public static hasPool(fromCoinType: string, toCoinType: string): boolean {
    return this.findPoolId(fromCoinType, toCoinType) !== null;
  }

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

    const normAmountOut = valueInUsd / priceOut;
    const expectedAmountOut = BigInt(Math.floor(normAmountOut * Math.pow(10, toDecimals)));

    const slippageFactor = 10000n - BigInt(slippageBps);
    const minimumAmountOut = (expectedAmountOut * slippageFactor) / 10000n;

    const poolInfo = this.findPoolId(fromCoinType, toCoinType);
    if (!poolInfo) {
      throw new Error(`No DeepBook v3 liquidity pool found for pair ${fromCoinType} -> ${toCoinType}`);
    }

    return {
      dex: 'deepbook',
      fromCoinType,
      toCoinType,
      amountIn,
      expectedAmountOut,
      minimumAmountOut,
      slippageBps,
      priceImpactPct: 0.15,
      poolId: poolInfo.poolId,
      a2b: poolInfo.isBaseForQuote,
    };
  }

  /**
   * Add DeepBook v3 spot swap to PTB
   */
  public static addSwap(
    tx: Transaction,
    quote: SwapQuote,
    inputCoin: TransactionObjectArgument
  ): TransactionObjectArgument {
    const poolInfo = this.findPoolId(quote.fromCoinType, quote.toCoinType);
    if (!poolInfo) {
      throw new Error(`No DeepBook v3 pool found for pair ${quote.fromCoinType} -> ${quote.toCoinType}`);
    }

    const isBaseForQuote = quote.a2b;
    const baseCoinType = poolInfo.baseCoin;
    const quoteCoinType = poolInfo.quoteCoin;

    const functionName = isBaseForQuote
      ? 'swap_exact_base_for_quote'
      : 'swap_exact_quote_for_base';

    // Zero DEEP coin for fees (DeepBook allows 0 deep coin or normal SUI fee)
    const deepCoin = tx.moveCall({
      target: '0x2::coin::zero',
      typeArguments: ['0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'],
    });

    // DeepBook v3 returns a 3-tuple: [Coin<Base>, Coin<Quote>, Coin<DEEP>]
    const [outBaseCoin, outQuoteCoin, outDeepCoin] = tx.moveCall({
      target: `${DEEPBOOK_CONFIG.v3PackageId}::pool::${functionName}`,
      arguments: [
        tx.object(quote.poolId),
        inputCoin,
        deepCoin,
        tx.pure.u64(quote.minimumAmountOut),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
      typeArguments: [baseCoinType, quoteCoinType],
    });

    // Determine target received coin and sweep leftover coins safely to operator
    let targetOutputCoin: TransactionObjectArgument;
    let unusedResidualCoin: TransactionObjectArgument;

    if (isBaseForQuote) {
      targetOutputCoin = outQuoteCoin;
      unusedResidualCoin = outBaseCoin;
    } else {
      targetOutputCoin = outBaseCoin;
      unusedResidualCoin = outQuoteCoin;
    }

    // Transfer leftover input and DEEP refund back to operator wallet
    tx.transferObjects([unusedResidualCoin, outDeepCoin], tx.pure.address(CONFIG.operatorAddress));

    return targetOutputCoin;
  }
}
