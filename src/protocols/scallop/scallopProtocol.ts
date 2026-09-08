import { Scallop } from '@scallop-io/sui-scallop-sdk';
import { SCALLOP_CONFIG } from '../../config/constants.js';
import { CONFIG } from '../../config/index.js';
import { logger } from '../../ui/logger.js';

/**
 * Scallop Protocol SDK Wrapper
 */
export class ScallopProtocol {
  private static instance: ScallopProtocol;
  private sdk: Scallop | null = null;
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): ScallopProtocol {
    if (!ScallopProtocol.instance) {
      ScallopProtocol.instance = new ScallopProtocol();
    }
    return ScallopProtocol.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      logger.info('Initializing Scallop SDK...');
      this.sdk = new Scallop({
        addressId: SCALLOP_CONFIG.addressId,
        network: CONFIG.network === 'mainnet' ? 'mainnet' : 'testnet',
        fullnodeUrl: CONFIG.rpcUrl.includes('alchemy') ? 'https://fullnode.mainnet.sui.io:443' : CONFIG.rpcUrl,
        walletAddress: CONFIG.operatorAddress,
      });

      await this.sdk.init();
      this.isInitialized = true;
      logger.info('Scallop Protocol SDK initialized successfully');
    } catch (err) {
      logger.warn({ error: err }, 'Could not initialize online Scallop SDK, continuing with static config');
      this.isInitialized = true;
    }
  }

  public getSdk(): Scallop | null {
    return this.sdk;
  }
}

export const scallopProtocol = ScallopProtocol.getInstance();
