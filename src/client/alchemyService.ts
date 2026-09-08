import { CONFIG } from '../config/index.js';

export interface AlchemyHealthStatus {
  isConnected: boolean;
  endpoint: string;
  checkpoint: string;
  latencyMs: number;
  referenceGasPrice: bigint;
  network: string;
  error?: string;
}

/**
 * Dedicated Alchemy Sui Node & Telemetry Service
 * Interfaces with Alchemy's high-speed Sui Mainnet/Testnet JSON-RPC gateway.
 */
export class AlchemySuiService {
  private endpoint: string;

  constructor() {
    this.endpoint =
      CONFIG.alchemyMainnetRpc ||
      (CONFIG.rpcUrl.includes('alchemy.com') ? CONFIG.rpcUrl : CONFIG.rpcUrl);
  }

  /**
   * Get the active Alchemy endpoint URL (with masked key for logging)
   */
  public getMaskedEndpoint(): string {
    return this.endpoint.replace(/(\/v2\/)[^/?#]+/, '$1****');
  }

  /**
   * Execute raw JSON-RPC call against Alchemy Sui gateway
   */
  public async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Alchemy HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as { result?: T; error?: { code: number; message: string } };

    if (data.error) {
      throw new Error(`Alchemy RPC Error (${data.error.code}): ${data.error.message}`);
    }

    return data.result as T;
  }

  /**
   * Measure latency and verify connection to Alchemy Sui node
   */
  public async checkHealth(): Promise<AlchemyHealthStatus> {
    const startTime = Date.now();
    try {
      const [checkpoint, rgp] = await Promise.all([
        this.call<string>('sui_getLatestCheckpointSequenceNumber'),
        this.call<string>('suix_getReferenceGasPrice'),
      ]);

      const latencyMs = Date.now() - startTime;

      return {
        isConnected: true,
        endpoint: this.getMaskedEndpoint(),
        checkpoint: checkpoint || '0',
        latencyMs,
        referenceGasPrice: BigInt(rgp || '100'),
        network: CONFIG.network,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        isConnected: false,
        endpoint: this.getMaskedEndpoint(),
        checkpoint: '0',
        latencyMs,
        referenceGasPrice: 100n,
        network: CONFIG.network,
        error: errorMsg,
      };
    }
  }

  /**
   * Query latest on-chain checkpoint sequence number from Alchemy
   */
  public async getLatestCheckpoint(): Promise<string> {
    return await this.call<string>('sui_getLatestCheckpointSequenceNumber');
  }

  /**
   * Query live Reference Gas Price directly from Alchemy
   */
  public async getReferenceGasPrice(): Promise<bigint> {
    const rgp = await this.call<string>('suix_getReferenceGasPrice');
    return BigInt(rgp || '100');
  }

  /**
   * Execute dry-run profiling against Alchemy
   */
  public async dryRunTransactionBlock(txBytesBase64: string): Promise<Record<string, unknown>> {
    return await this.call<Record<string, unknown>>('sui_dryRunTransactionBlock', [txBytesBase64]);
  }
}

export const alchemyService = new AlchemySuiService();
