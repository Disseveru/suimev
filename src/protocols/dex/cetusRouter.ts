import { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';
import { CETUS_CONFIG, SUI_CLOCK_OBJECT_ID } from '../../config/constants.js';
import { SwapQuote } from '../../config/types.js';
import { priceCache } from '../../oracles/priceCache.js';
import { getCoinConfigByType, normalizeStructTag } from '../../config/coins.js';
import { ensureCetusCompat } from '../../client/cetusCompat.js';
import { CONFIG } from '../../config/index.js';
import { logger } from '../../ui/logger.js';

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
  'USDC_SBETH': {
    poolId: '0x9e59de50d9e5979fc03ac5bcacdb581c823dbd27d63a036131e17b391f2fac88',
    coinTypeA: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    coinTypeB: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
  },
  'WETH_WUSDC': {
    poolId: '0x5b0b24c27ccf6d0e98f3a8704d2e577de83fa574d3a9060eb8945eeb82b3e2df',
    coinTypeA: '0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN',
    coinTypeB: '0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN',
  },
  'USDT_SUI': {
    poolId: '0x6fdef479da176aa7564b541ac7b4e501c4912d1cacd944942f0dd505137e95c1',
    coinTypeA: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'USDC_WAL': {
    poolId: '0x47e8211061ce047fafb3c547dde4d316bea7ed82f148d68bbed2a6ed89b74d04',
    coinTypeA: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    coinTypeB: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  },
  'HASUI_SUI': {
    poolId: '0xa6bd09a3a50b80610f1af9f4e5ca8d9a7d009e620374e9b1bff814def8ceb7b8',
    coinTypeA: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'USDC_NAVX': {
    poolId: '0xedd6e5722a403032d4db54715c428f8b9ba016701580d9570b89ddbbccad2b0e',
    coinTypeA: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    coinTypeB: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
  },
  'NAVX_WAL': {
    poolId: '0x2de19f93553f0156ca590c3c05da4e0c3a30231253b0988b258b186f4def3f3e',
    coinTypeA: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
    coinTypeB: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  },
  'VSUI_SUI': {
    poolId: '0xe88a531737be7ccf3c9597143e1d132d733e3be85e27a988d404d88e894a4f89',
    coinTypeA: '0x549e8b69270def3cafaf13141f315201853d90895d96706e61266b66838a3d45::vsui::VSUI',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'CERT_SUI': {
    poolId: '0xe88a531737be7ccf3c9597143e1d132d733e3be85e27a988d404d88e894a4f89',
    coinTypeA: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'BLUB_SUI': {
    poolId: '0x6f5ef2889f274dfabc7d41fad0b9f68a2e52868cc074ab73e119db3ef30a0b7a',
    coinTypeA: '0xfa7ac3951fdca92c5200d468d31a365eb03b2be9936fde615e69f0c1274ad3a0::BLUB::BLUB',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'IKA_WAL': {
    poolId: '0xa712328e5ed6f2ec7c053d50701b19a82c47b7f7bbbb49237f810fba33b6aad5',
    coinTypeA: '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA',
    coinTypeB: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  },
  'BUCK_USDC': {
    poolId: '0x6ec881313f166e714f52a78c187d90d7966ef4a378efbfa98e3b5e90a618be24',
    coinTypeA: '0xce7ffda7a8c4f9a35d94e223d6a4a6b2512f7a08b5e28e67f0b5d0c07b6cb0d8::buck::BUCK',
    coinTypeB: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  },
  'AUSD_USDC': {
    poolId: '0x0f90e9e900c3b0eb23180de07d5705a6104bc1ec96ea10c4f8ebec48c089c894',
    coinTypeA: '0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2abda22b25c3bd51b65e76::ausd::AUSD',
    coinTypeB: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  },
  'NS_SUI': {
    poolId: '0x3565b9bb765b214f4da6ec82121305bb9930f711200fa4f75747cb9b867c4692',
    coinTypeA: '0x5145494a5f5100e64540b1a052d5bf52327702d8471b425cb43e67db57936ac0::ns::NS',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'SSUI_SUI': {
    poolId: '0xb4b6a7ee7b60f157778b021d7b328153cfc900e576ec5a6439bf244b76a0f443',
    coinTypeA: '0xd9e6e44f53535914d9b62649ef9066eb4b143715ff2f4ce8e4e9cfb5b9c03b1e::ssui::SSUI',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
  'FUD_SUI': {
    poolId: '0xc5d3c8c7efcc51cbab207612f1dbb1fb3a1bdfd924dd1804d9c0e5a87be758f8',
    coinTypeA: '0x76cb819b01abed502bee8a702b4c2d5f5074744637f812d9047f60effa637742::fud::FUD',
    coinTypeB: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
  },
};

// Pre-indexed Direct Pool Map for O(1) ~20ns routing lookup
export interface DirectPoolEntry {
  poolId: string;
  a2b: boolean;
  coinTypeA: string;
  coinTypeB: string;
}

const DIRECT_POOL_MAP = new Map<string, DirectPoolEntry>();

for (const pool of Object.values(CANONICAL_CETUS_POOLS)) {
  const normA = normalizeStructTag(pool.coinTypeA);
  const normB = normalizeStructTag(pool.coinTypeB);
  DIRECT_POOL_MAP.set(`${normA}:::${normB}`, {
    poolId: pool.poolId,
    a2b: true,
    coinTypeA: pool.coinTypeA,
    coinTypeB: pool.coinTypeB,
  });
  DIRECT_POOL_MAP.set(`${normB}:::${normA}`, {
    poolId: pool.poolId,
    a2b: false,
    coinTypeA: pool.coinTypeA,
    coinTypeB: pool.coinTypeB,
  });
}

const SUI_TOKEN = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_TOKEN = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const NORM_SUI = normalizeStructTag(SUI_TOKEN);
const NORM_USDC = normalizeStructTag(USDC_TOKEN);

/**
 * Cetus CLMM Atomic DEX Swap Router
 * Computes quotations and constructs pure Move swap calls within PTBs.
 */
export class CetusRouter {
  /**
   * Dynamically register a pool into the O(1) routing map
   */
  public static registerPool(poolId: string, coinTypeA: string, coinTypeB: string): void {
    if (!poolId || !coinTypeA || !coinTypeB) return;
    const normA = normalizeStructTag(coinTypeA);
    const normB = normalizeStructTag(coinTypeB);
    DIRECT_POOL_MAP.set(`${normA}:::${normB}`, {
      poolId,
      a2b: true,
      coinTypeA,
      coinTypeB,
    });
    DIRECT_POOL_MAP.set(`${normB}:::${normA}`, {
      poolId,
      a2b: false,
      coinTypeA,
      coinTypeB,
    });
  }

  /**
   * Fetch all active Cetus pools directly from Cetus API/SDK and index them into memory
   */
  public static async syncDynamicPools(): Promise<number> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const res = await fetch('https://api-sui.cetus.zone/v2/sui/pools', {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timer);

      if (!res.ok) {
        logger.warn({ status: res.status }, 'Cetus API responded with non-200 status during dynamic pool sync');
        return Math.floor(DIRECT_POOL_MAP.size / 2);
      }

      const body = (await res.json()) as any;
      const pools = body?.data?.lp_list || body?.data?.pools || [];
      let registered = 0;

      for (const pool of pools) {
        const poolId = pool.address || pool.pool_address || pool.poolId;
        const coinA = pool.coin_a_address || pool.coin_type_a || pool.coinA;
        const coinB = pool.coin_b_address || pool.coin_type_b || pool.coinB;
        if (poolId && coinA && coinB) {
          this.registerPool(poolId, coinA, coinB);
          registered++;
        }
      }

      logger.info(
        { discoveredPools: registered, totalIndexedRoutes: DIRECT_POOL_MAP.size },
        '🚀 Cetus Dynamic Pool Discovery synchronized successfully'
      );
      return registered;
    } catch (err: any) {
      logger.warn(
        { error: err?.message || String(err) },
        'Dynamic Cetus pool sync deferred; baseline canonical pool cache remains active'
      );
      return Math.floor(DIRECT_POOL_MAP.size / 2);
    }
  }

  /**
   * Start periodic background sync for newly deployed Cetus pools
   */
  public static startDynamicSync(intervalMs: number = 600_000): NodeJS.Timeout {
    return setInterval(() => {
      this.syncDynamicPools().catch((err) => {
        logger.warn({ error: err?.message || String(err) }, 'Background Cetus pool sync failed');
      });
    }, intervalMs);
  }

  /**
   * Find matching Cetus pool for pair with precise CoinA/CoinB classification (O(1) Map lookup)
   */
  public static findPoolId(fromCoinType: string, toCoinType: string): DirectPoolEntry | null {
    const key = `${normalizeStructTag(fromCoinType)}:::${normalizeStructTag(toCoinType)}`;
    return DIRECT_POOL_MAP.get(key) ?? null;
  }

  /**
   * Check if a direct or 2-hop Cetus route exists for pair (hops via SUI or USDC)
   */
  public static hasPool(fromCoinType: string, toCoinType: string): boolean {
    if (this.findPoolId(fromCoinType, toCoinType) !== null) {
      return true;
    }
    const normFrom = normalizeStructTag(fromCoinType);
    const normTo = normalizeStructTag(toCoinType);

    // Check 2-hop route via SUI
    if (normFrom !== NORM_SUI && normTo !== NORM_SUI) {
      if (this.findPoolId(fromCoinType, SUI_TOKEN) !== null && this.findPoolId(SUI_TOKEN, toCoinType) !== null) {
        return true;
      }
    }

    // Check 2-hop route via USDC
    if (normFrom !== NORM_USDC && normTo !== NORM_USDC) {
      if (this.findPoolId(fromCoinType, USDC_TOKEN) !== null && this.findPoolId(USDC_TOKEN, toCoinType) !== null) {
        return true;
      }
    }

    return false;
  }

  /**
   * Compute swap quote and minimum output with slippage protection (supports direct & 2-hop)
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
      // Check 2-hop routes
      const normFrom = normalizeStructTag(fromCoinType);
      const normTo = normalizeStructTag(toCoinType);

      let intermediateToken: string | null = null;
      if (normFrom !== NORM_SUI && normTo !== NORM_SUI && this.findPoolId(fromCoinType, SUI_TOKEN) && this.findPoolId(SUI_TOKEN, toCoinType)) {
        intermediateToken = SUI_TOKEN;
      } else if (normFrom !== NORM_USDC && normTo !== NORM_USDC && this.findPoolId(fromCoinType, USDC_TOKEN) && this.findPoolId(USDC_TOKEN, toCoinType)) {
        intermediateToken = USDC_TOKEN;
      }

      if (intermediateToken) {
        return {
          dex: 'cetus',
          fromCoinType,
          toCoinType,
          amountIn,
          expectedAmountOut,
          minimumAmountOut,
          slippageBps,
          priceImpactPct: 0.2, // Multi-hop routing
          poolId: intermediateToken === SUI_TOKEN ? '2-hop-via-sui' : '2-hop-via-usdc',
          a2b: true,
        };
      }
      throw new Error(`No Cetus liquidity pool or route found for pair ${fromCoinType} -> ${toCoinType}`);
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
   * Add Cetus atomic CLMM swap to PTB (handles direct and 2-hop routed swaps)
   */
  public static addSwap(
    tx: Transaction,
    quote: SwapQuote,
    inputCoin: TransactionObjectArgument
  ): TransactionObjectArgument {
    if (quote.poolId === '2-hop-via-sui' || quote.poolId === '2-hop-via-usdc') {
      const hopToken = quote.poolId === '2-hop-via-sui' ? SUI_TOKEN : USDC_TOKEN;
      const halfSlippage = Math.max(25, Math.floor(quote.slippageBps / 2));
      const quoteHop1 = this.getQuote(quote.fromCoinType, hopToken, quote.amountIn, halfSlippage);
      const intermediateCoin = this.addDirectSwap(tx, quoteHop1, inputCoin, false);
      const quoteHop2 = this.getQuote(hopToken, quote.toCoinType, quoteHop1.expectedAmountOut, halfSlippage);
      // For hop 2, useCoinValue = true sweeps the actual on-chain output of hop 1, preventing InsufficientBalance aborts
      return this.addDirectSwap(tx, quoteHop2, intermediateCoin, true);
    }

    return this.addDirectSwap(tx, quote, inputCoin, false);
  }

  /**
   * Add direct pool swap to PTB
   */
  private static addDirectSwap(
    tx: Transaction,
    quote: SwapQuote,
    inputCoin: TransactionObjectArgument,
    useCoinValue: boolean = false
  ): TransactionObjectArgument {
    const poolInfo = this.findPoolId(quote.fromCoinType, quote.toCoinType);
    if (!poolInfo) {
      throw new Error(`No direct Cetus liquidity pool found for pair ${quote.fromCoinType} -> ${quote.toCoinType}`);
    }
    const coinTypeA = poolInfo.coinTypeA;
    const coinTypeB = poolInfo.coinTypeB;

    // Default sqrtPriceLimit for Cetus (0 for a2b or max for b2a)
    const sqrtPriceLimit = quote.a2b
      ? '4295048016' // MIN_SQRT_PRICE_X64
      : '79226673515401279992447579055'; // MAX_SQRT_PRICE_X64

    // Always dynamically query the exact on-chain coin value so the CLMM swap
    // matches the exact amount seized from the borrower
    const amountArg = tx.moveCall({
      target: '0x2::coin::value',
      typeArguments: [quote.fromCoinType],
      arguments: [inputCoin],
    });

    // Direct atomic swap on Cetus CLMM pool bypassing deprecated router package
    const [balanceA, balanceB, flashReceipt] = tx.moveCall({
      target: `${CETUS_CONFIG.activeClmmPackageId}::pool::flash_swap`,
      typeArguments: [coinTypeA, coinTypeB],
      arguments: [
        tx.object(CETUS_CONFIG.globalConfigId),
        tx.object(quote.poolId),
        tx.pure.bool(quote.a2b),
        tx.pure.bool(true), // by_amount_in = true
        amountArg,
        tx.pure.u128(sqrtPriceLimit),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });

    const inputBalance = tx.moveCall({
      target: '0x2::coin::into_balance',
      typeArguments: [quote.fromCoinType],
      arguments: [inputCoin],
    });

    let outCoin: TransactionObjectArgument;

    if (quote.a2b) {
      // Swapping A -> B
      outCoin = tx.moveCall({
        target: '0x2::coin::from_balance',
        typeArguments: [coinTypeB],
        arguments: [balanceB],
      });
      tx.moveCall({
        target: '0x2::balance::destroy_zero',
        typeArguments: [coinTypeA],
        arguments: [balanceA],
      });
      const zeroBalanceB = tx.moveCall({
        target: '0x2::balance::zero',
        typeArguments: [coinTypeB],
        arguments: [],
      });
      tx.moveCall({
        target: `${CETUS_CONFIG.activeClmmPackageId}::pool::repay_flash_swap`,
        typeArguments: [coinTypeA, coinTypeB],
        arguments: [
          tx.object(CETUS_CONFIG.globalConfigId),
          tx.object(quote.poolId),
          inputBalance,
          zeroBalanceB,
          flashReceipt,
        ],
      });
    } else {
      // Swapping B -> A
      outCoin = tx.moveCall({
        target: '0x2::coin::from_balance',
        typeArguments: [coinTypeA],
        arguments: [balanceA],
      });
      tx.moveCall({
        target: '0x2::balance::destroy_zero',
        typeArguments: [coinTypeB],
        arguments: [balanceB],
      });
      const zeroBalanceA = tx.moveCall({
        target: '0x2::balance::zero',
        typeArguments: [coinTypeA],
        arguments: [],
      });
      tx.moveCall({
        target: `${CETUS_CONFIG.activeClmmPackageId}::pool::repay_flash_swap`,
        typeArguments: [coinTypeA, coinTypeB],
        arguments: [
          tx.object(CETUS_CONFIG.globalConfigId),
          tx.object(quote.poolId),
          zeroBalanceA,
          inputBalance,
          flashReceipt,
        ],
      });
    }

    return outCoin;
  }

  /**
   * Add Cetus CLMM atomic flash swap to PTB
   * Uses the active CLMM package directly.
   */
  public static addFlashSwap(
    tx: Transaction,
    poolId: string,
    coinTypeA: string,
    coinTypeB: string,
    borrowCoinType: string,
    borrowAmount: bigint
  ): {
    loanBalance: TransactionObjectArgument;
    emptyBalance: TransactionObjectArgument;
    flashReceipt: TransactionObjectArgument;
    payAmount: TransactionObjectArgument;
    a2b: boolean;
  } {
    const normBorrow = normalizeStructTag(borrowCoinType);
    const normA = normalizeStructTag(coinTypeA);
    // If borrowCoinType is Coin A: we want to receive A, which means a2b = false (swap B to A)
    // If borrowCoinType is Coin B: we want to receive B, which means a2b = true (swap A to B)
    const a2b = normBorrow !== normA;
    const sqrtPriceLimit = a2b ? '4295048016' : '79226673515401279992447579054';

    const [balanceA, balanceB, flashReceipt] = tx.moveCall({
      target: `${CETUS_CONFIG.activeClmmPackageId}::pool::flash_swap`,
      typeArguments: [coinTypeA, coinTypeB],
      arguments: [
        tx.object(CETUS_CONFIG.globalConfigId),
        tx.object(poolId),
        tx.pure.bool(a2b),
        tx.pure.bool(false), // by_amount_in = false
        tx.pure.u64(borrowAmount),
        tx.pure.u128(sqrtPriceLimit),
        tx.object(SUI_CLOCK_OBJECT_ID),
      ],
    });

    const payAmount = tx.moveCall({
      target: `${CETUS_CONFIG.activeClmmPackageId}::pool::swap_pay_amount`,
      typeArguments: [coinTypeA, coinTypeB],
      arguments: [flashReceipt],
    });

    const loanBalance = a2b ? balanceB : balanceA;
    const emptyBalance = a2b ? balanceA : balanceB;

    return {
      loanBalance,
      emptyBalance,
      flashReceipt,
      payAmount,
      a2b,
    };
  }

  /**
   * Repay Cetus CLMM atomic flash swap in PTB
   */
  public static addRepayFlashSwap(
    tx: Transaction,
    poolId: string,
    coinTypeA: string,
    coinTypeB: string,
    repayBalance: TransactionObjectArgument,
    flashReceipt: TransactionObjectArgument,
    a2b: boolean
  ): void {
    const zeroBalanceA = a2b ? repayBalance : tx.moveCall({
      target: '0x2::balance::zero',
      typeArguments: [coinTypeA],
      arguments: [],
    });
    const zeroBalanceB = a2b ? tx.moveCall({
      target: '0x2::balance::zero',
      typeArguments: [coinTypeB],
      arguments: [],
    }) : repayBalance;

    tx.moveCall({
      target: `${CETUS_CONFIG.activeClmmPackageId}::pool::repay_flash_swap`,
      typeArguments: [coinTypeA, coinTypeB],
      arguments: [
        tx.object(CETUS_CONFIG.globalConfigId),
        tx.object(poolId),
        zeroBalanceA,
        zeroBalanceB,
        flashReceipt,
      ],
    });
  }
}
