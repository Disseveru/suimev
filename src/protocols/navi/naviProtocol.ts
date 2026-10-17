import * as navi from '@naviprotocol/lending';
import { suiClient } from '../../client/suiClient.js';
import { COIN_CONFIGS, getCoinConfigByType, normalizeStructTag } from '../../config/coins.js';
import { NAVI_CONFIG, NAVI_API_ENDPOINTS } from '../../config/constants.js';
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
  liquidationBonus: number;
  liquidationRatio: number;
  liquidationThreshold: number;
  oracleId: number;
}

/**
 * NAVI Protocol Adapter
 * Handles pool state queries, reserve balances, and flash loan parameters.
 */
export class NaviProtocol {
  private static instance: NaviProtocol;
  private poolsByCoinType: Map<string, NaviPoolInfo> = new Map();
  private poolsById: Map<number, NaviPoolInfo> = new Map();
  private rawPools: any[] = [];
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

      // 1. Dynamically synchronize live protocol package and object IDs from official SDK or Open API
      try {
        const liveConfig = await (navi as any).getConfig();
        if (liveConfig?.package) {
          NAVI_CONFIG.packageId = liveConfig.package;
        }
        if (liveConfig?.storage) {
          NAVI_CONFIG.storage = liveConfig.storage;
        }
        if (liveConfig?.incentiveV2) {
          NAVI_CONFIG.incentiveV2 = liveConfig.incentiveV2;
        }
        if (liveConfig?.incentiveV3) {
          NAVI_CONFIG.incentiveV3 = liveConfig.incentiveV3;
        }
        if (liveConfig?.priceOracle) {
          NAVI_CONFIG.priceOracle = liveConfig.priceOracle;
        }
        if (liveConfig?.flashloanConfig) {
          NAVI_CONFIG.flashloanConfig = liveConfig.flashloanConfig;
        }
        if (liveConfig?.flashloanSupportedAssets) {
          NAVI_CONFIG.flashloanSupportedAssets = liveConfig.flashloanSupportedAssets;
        }
        logger.info({ packageId: NAVI_CONFIG.packageId }, 'Dynamically synchronized NAVI protocol configuration');
      } catch (cfgErr) {
        // Fall back to querying official NAVI Open API endpoint
        try {
          const res = await fetch(NAVI_API_ENDPOINTS.package);
          if (res.ok) {
            const data: any = await res.json();
            if (data?.packageId) {
              NAVI_CONFIG.packageId = data.packageId;
              logger.info({ packageId: NAVI_CONFIG.packageId }, 'Synchronized NAVI package ID from Open API');
            }
          }
        } catch {
          logger.warn({ error: cfgErr }, 'Failed to fetch dynamic NAVI config from SDK and API, using static fallback');
        }
      }

      // 2. Query pools from SDK (or API)
      const pools = await navi.getPools();
      if (pools && Array.isArray(pools)) {
        this.rawPools = pools;
        for (const pool of pools) {
          if (pool.suiCoinType && pool.contract?.pool) {
            const coinCfg = getCoinConfigByType(pool.suiCoinType);
            const bonusStr = (pool as any).liquidationFactor?.bonus;
            const ratioStr = (pool as any).liquidationFactor?.ratio;
            const thresholdStr = (pool as any).liquidationFactor?.threshold;

            const liquidationBonus = bonusStr ? Number(bonusStr) : (coinCfg?.liquidationBonus ?? 0.05);
            const liquidationRatio = ratioStr ? Number(ratioStr) : 0.35;
            const liquidationThreshold = thresholdStr ? Number(thresholdStr) : (coinCfg?.liquidationThreshold ?? 0.80);
            const oracleId = (pool as any).oracleId ?? (pool as any).oracle?.oracleId ?? pool.id ?? 0;

            const poolInfo: NaviPoolInfo = {
              id: pool.id ?? 0,
              coinType: pool.suiCoinType,
              symbol: coinCfg?.symbol ?? pool.token?.symbol ?? 'UNKNOWN',
              poolContract: pool.contract.pool,
              reserveBalance: BigInt(pool.balance || '0'),
              borrowFeeBps: 0, // NAVI flash loans charge 0 bps per official OpenAPI flashloan endpoint
              supplyApy: Number(pool.supplyIncentiveApyInfo?.apy || 0),
              borrowApy: Number(pool.borrowIncentiveApyInfo?.apy || 0),
              flashloanEnabled: true,
              liquidationBonus,
              liquidationRatio,
              liquidationThreshold,
              oracleId,
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
    // Static mainnet pool contracts for critical assets (audited against @naviprotocol/lending & NAVI API)
    const staticPools: Record<string, { id: number; contract: string; bonus: number; threshold: number }> = {
      SUI: { id: 0, contract: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5', bonus: 0.10, threshold: 0.80 },
      USDC: { id: 10, contract: '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8', bonus: 0.08, threshold: 0.85 },
      WUSDC: { id: 1, contract: '0xa02a98f9c88db51c6f5efaaf2261c81f34dd56d86073387e0ef1805ca22e39c8', bonus: 0.08, threshold: 0.85 },
      USDT: { id: 19, contract: '0xa3e0471746e5d35043801bce247d3b3784cc74329d39f7ed665446ddcf22a9e2', bonus: 0.08, threshold: 0.85 },
      WUSDT: { id: 2, contract: '0x0e060c3b5b8de00fb50511b7a45188c8e34b6995c01f69d98ea5a466fe10d103', bonus: 0.08, threshold: 0.85 },
      WETH: { id: 3, contract: '0x71b9f6e822c48ce827bceadce82201d6a7559f7b0350ed1daa1dc2ba3ac41b56', bonus: 0.10, threshold: 0.80 },
      CETUS: { id: 4, contract: '0x3c376f857ec4247b8ee456c1db19e9c74e0154d4876915e54221b5052d5b1e2e', bonus: 0.10, threshold: 0.40 },
      NAVI: { id: 7, contract: '0xc0e02e7a245e855dd365422faf76f87d9f5b2148a26d48dda6e8253c3fe9fa60', bonus: 0.10, threshold: 0.60 },
      DEEP: { id: 15, contract: '0x08373c5efffd07f88eace1c76abe4777489d9ec044fd4cd567f982d9c169e946', bonus: 0.10, threshold: 0.60 },
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
          borrowFeeBps: 0,
          supplyApy: 0,
          borrowApy: 0,
          flashloanEnabled: true,
          liquidationBonus: info.bonus,
          liquidationRatio: 0.35,
          liquidationThreshold: info.threshold,
          oracleId: info.id,
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

  public getRawPools(): any[] {
    return this.rawPools;
  }
}

export const naviProtocol = NaviProtocol.getInstance();
