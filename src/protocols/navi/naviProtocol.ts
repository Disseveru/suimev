import * as navi from '@naviprotocol/lending';
import { suiClient } from '../../client/suiClient.js';
import { COIN_CONFIGS, getCoinConfigByType, normalizeStructTag } from '../../config/coins.js';
import { logger } from '../../ui/logger.js';

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
}

/**
 * NAVI Protocol Adapter
 * Handles pool state queries, reserve balances, and flash loan parameters.
 */
export class NaviProtocol {
  private static instance: NaviProtocol;
  private poolsByCoinType: Map<string, NaviPoolInfo> = new Map();
  private poolsById: Map<number, NaviPoolInfo> = new Map();
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): NaviProtocol {
    if (!NaviProtocol.instance) {
      NaviProtocol.instance = new NaviProtocol();
    }
    return NaviProtocol.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Initializing NAVI Protocol pool registry...');
      const pools = await navi.getPools();

      if (pools && Array.isArray(pools)) {
        for (const pool of pools) {
          if (pool.suiCoinType && pool.contract?.pool) {
            const coinCfg = getCoinConfigByType(pool.suiCoinType);
            const poolInfo: NaviPoolInfo = {
              id: pool.id ?? 0,
              coinType: pool.suiCoinType,
              symbol: coinCfg?.symbol ?? pool.token?.symbol ?? 'UNKNOWN',
              poolContract: pool.contract.pool,
              reserveBalance: BigInt(pool.balance || '0'),
              borrowFeeBps: 5,
              supplyApy: Number(pool.supplyIncentiveApyInfo?.apy || 0),
              borrowApy: Number(pool.borrowIncentiveApyInfo?.apy || 0),
              flashloanEnabled: true,
            };

            this.poolsByCoinType.set(normalizeStructTag(pool.suiCoinType), poolInfo);
            if (pool.id !== undefined) {
              this.poolsById.set(pool.id, poolInfo);
            }
          }
        }
      }

      this.isInitialized = true;
      logger.info(`NAVI Protocol initialized with ${this.poolsByCoinType.size} active pools`);
    } catch (err) {
      logger.warn({ error: err }, 'Failed to initialize NAVI config from network, falling back to static pool mappings');
      this.initStaticFallback();
      this.isInitialized = true;
    }
  }

  private initStaticFallback(): void {
    // Static mainnet pool contracts for critical assets (audited against @naviprotocol/lending)
    const staticPools: Record<string, { id: number; contract: string }> = {
      SUI: { id: 0, contract: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5' },
      USDC: { id: 10, contract: '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8' },
      WUSDC: { id: 1, contract: '0xa02a98f9c88db51c6f5efaaf2261c81f34dd56d86073387e0ef1805ca22e39c8' },
      USDT: { id: 19, contract: '0xa3e0471746e5d35043801bce247d3b3784cc74329d39f7ed665446ddcf22a9e2' },
      WUSDT: { id: 2, contract: '0x0e060c3b5b8de00fb50511b7a45188c8e34b6995c01f69d98ea5a466fe10d103' },
      WETH: { id: 3, contract: '0x71b9f6e822c48ce827bceadce82201d6a7559f7b0350ed1daa1dc2ba3ac41b56' },
      CETUS: { id: 4, contract: '0x3c376f857ec4247b8ee456c1db19e9c74e0154d4876915e54221b5052d5b1e2e' },
      NAVI: { id: 7, contract: '0xc0e02e7a245e855dd365422faf76f87d9f5b2148a26d48dda6e8253c3fe9fa60' },
      DEEP: { id: 15, contract: '0x08373c5efffd07f88eace1c76abe4777489d9ec044fd4cd567f982d9c169e946' },
    };

    for (const [symbol, info] of Object.entries(staticPools)) {
      const cfg = COIN_CONFIGS[symbol];
      if (cfg) {
        const poolInfo: NaviPoolInfo = {
          id: info.id,
          coinType: cfg.coinType,
          symbol,
          poolContract: info.contract,
          reserveBalance: 0n,
          borrowFeeBps: 5,
          supplyApy: 0,
          borrowApy: 0,
          flashloanEnabled: true,
        };
        this.poolsByCoinType.set(normalizeStructTag(cfg.coinType), poolInfo);
        this.poolsById.set(info.id, poolInfo);
      }
    }
  }

  public getPoolByCoinType(coinType: string): NaviPoolInfo | undefined {
    return this.poolsByCoinType.get(normalizeStructTag(coinType));
  }

  public getPoolById(id: number): NaviPoolInfo | undefined {
    return this.poolsById.get(id);
  }

  public getAllPools(): NaviPoolInfo[] {
    return Array.from(this.poolsByCoinType.values());
  }
}

export const naviProtocol = NaviProtocol.getInstance();
