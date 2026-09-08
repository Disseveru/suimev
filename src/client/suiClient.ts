import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';

interface RpcEndpointState {
  url: string;
  client: SuiJsonRpcClient;
  failures: number;
  lastLatencyMs: number;
  isHealthy: boolean;
}

/**
 * Resilient Multi-RPC Sui Client Manager
 * Performs automatic failover, health tracking, and latency-based routing.
 */
export class SuiClientManager {
  private static instance: SuiClientManager;
  private endpoints: RpcEndpointState[] = [];
  private activeIndex = 0;

  private constructor() {
    const urls = [CONFIG.rpcUrl, ...CONFIG.backupRpcs];
    // Deduplicate URLs
    const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));

    this.endpoints = uniqueUrls.map((url) => ({
      url,
      client: new SuiJsonRpcClient({ url, network: CONFIG.network as 'mainnet' | 'testnet' }),
      failures: 0,
      lastLatencyMs: 0,
      isHealthy: true,
    }));

    logger.info({ endpoints: uniqueUrls }, `Initialized Multi-RPC Client Manager with ${uniqueUrls.length} endpoint(s)`);
  }

  public static getInstance(): SuiClientManager {
    if (!SuiClientManager.instance) {
      SuiClientManager.instance = new SuiClientManager();
    }
    return SuiClientManager.instance;
  }

  public getClient(): SuiJsonRpcClient {
    return this.endpoints[this.activeIndex].client;
  }

  public getActiveUrl(): string {
    return this.endpoints[this.activeIndex].url;
  }

  /**
   * Execute an RPC call with automatic failover across configured endpoints
   */
  public async executeWithFallback<T>(
    operationName: string,
    action: (client: SuiJsonRpcClient) => Promise<T>
  ): Promise<T> {
    const startIndex = this.activeIndex;
    let lastError: unknown;

    for (let attempt = 0; attempt < this.endpoints.length; attempt++) {
      const idx = (startIndex + attempt) % this.endpoints.length;
      const endpoint = this.endpoints[idx];

      if (!endpoint.isHealthy && attempt < this.endpoints.length - 1) {
        continue;
      }

      const startMs = Date.now();
      try {
        const result = await action(endpoint.client);
        endpoint.lastLatencyMs = Date.now() - startMs;
        endpoint.failures = 0;
        endpoint.isHealthy = true;
        this.activeIndex = idx;
        return result;
      } catch (err: unknown) {
        lastError = err;
        endpoint.failures++;
        endpoint.lastLatencyMs = Date.now() - startMs;

        const isRateLimit = String(err).includes('429') || String(err).includes('Too Many Requests');
        if (endpoint.failures >= 3 || isRateLimit) {
          endpoint.isHealthy = false;
        }

        logger.warn(
          {
            operation: operationName,
            endpoint: endpoint.url,
            latencyMs: endpoint.lastLatencyMs,
            failures: endpoint.failures,
            error: err instanceof Error ? err.message : String(err),
          },
          `RPC call failed on ${endpoint.url}. Attempting next endpoint...`
        );
      }
    }

    throw new Error(
      `All ${this.endpoints.length} Sui RPC endpoints failed for '${operationName}'. Last error: ${lastError}`
    );
  }

  /**
   * Periodic health checker to recover endpoints and update latency
   */
  public async checkHealth(): Promise<void> {
    for (const ep of this.endpoints) {
      const startMs = Date.now();
      try {
        await ep.client.getChainIdentifier();
        ep.lastLatencyMs = Date.now() - startMs;
        ep.isHealthy = true;
        ep.failures = 0;
      } catch {
        ep.isHealthy = false;
        ep.failures++;
      }
    }
  }
}

export const rpcManager = SuiClientManager.getInstance();
export const suiClient = new Proxy({} as SuiJsonRpcClient, {
  get: (_, prop: string | symbol) => {
    const client = rpcManager.getClient() as any;
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
