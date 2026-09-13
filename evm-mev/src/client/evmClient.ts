import { createPublicClient, http, fallback, PublicClient } from 'viem';
import { CONFIG } from '../config/index.js';

export class EvmClientManager {
  private client: PublicClient;

  constructor() {
    const transports = CONFIG.chainConfig.rpcUrls.map((url) =>
      http(url, { retryCount: 3, timeout: 5000 })
    );

    this.client = createPublicClient({
      transport: fallback(transports),
    });
  }

  public getClient(): PublicClient {
    return this.client;
  }

  public async getBlockNumber(): Promise<bigint> {
    return await this.client.getBlockNumber();
  }

  public async getGasPrice(): Promise<bigint> {
    return await this.client.getGasPrice();
  }
}

export const evmClientManager = new EvmClientManager();
export const evmClient: PublicClient = evmClientManager.getClient();
