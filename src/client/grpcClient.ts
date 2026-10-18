import { ChannelCredentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { CONFIG } from '../config/index.js';

export class SuiGrpcClientManager {
  private static instance: SuiGrpcClientManager;
  private client: SuiGrpcClient | null = null;
  private networkVerification: Promise<string> | null = null;

  private constructor() {}

  public static getInstance(): SuiGrpcClientManager {
    if (!SuiGrpcClientManager.instance) {
      SuiGrpcClientManager.instance = new SuiGrpcClientManager();
    }
    return SuiGrpcClientManager.instance;
  }

  public getClient(): SuiGrpcClient {
    if (this.client) return this.client;
    if (!CONFIG.grpcHost) {
      throw new Error(
        'Native Sui gRPC is not configured. Set SUI_GRPC_HOST and, if required by the provider, SUI_GRPC_AUTHORIZATION.'
      );
    }
    if (CONFIG.grpcHost.includes('alchemy.com') && !CONFIG.grpcAuthorization) {
      throw new Error('Sui gRPC authentication is missing for the configured Alchemy host.');
    }

    const transport = new GrpcTransport({
      host: CONFIG.grpcHost,
      channelCredentials: ChannelCredentials.createSsl(),
      ...(CONFIG.grpcAuthorization ? { meta: { authorization: CONFIG.grpcAuthorization } } : {}),
    });

    const client = new SuiGrpcClient({
      network: CONFIG.network,
      transport,
    });
    this.client = new Proxy(client, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (
          (property === 'executeTransaction' || property === 'signAndExecuteTransaction') &&
          typeof value === 'function'
        ) {
          return (...args: unknown[]) => {
            if (CONFIG.dryRun) throw new Error('DRY_RUN is enabled; refusing to broadcast a transaction.');
            if (!CONFIG.liveExecutionApproved) {
              throw new Error('LIVE_EXECUTION_APPROVED is not true; refusing to broadcast a transaction.');
            }
            if (!CONFIG.liveExecutionReady) {
              throw new Error('Live execution is disabled until all Sui gRPC, indexer, protocol, and profit-accounting migrations are complete.');
            }
            return Reflect.apply(value, target, args);
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return this.client;
  }

  public async checkHealth(): Promise<string> {
    if (!this.networkVerification) {
      this.networkVerification = this.getClient().ledgerService.getServiceInfo({})
        .then(({ response }) => {
          if (response.chain?.toLowerCase() !== CONFIG.network) {
            throw new Error(
              `Sui gRPC endpoint is on '${response.chain ?? 'unknown'}'; expected '${CONFIG.network}'.`
            );
          }
          if (!response.chainId) throw new Error('Sui gRPC service info omitted the chain identifier.');
          return response.chainId;
        })
        .catch((error: unknown) => {
          this.networkVerification = null;
          throw error;
        });
    }
    return this.networkVerification;
  }
}

export function formatGrpcExecutionError(status: unknown): string | undefined {
  if (typeof status !== 'object' || status === null || !('success' in status)) {
    return 'gRPC response omitted execution status';
  }
  if (status.success === true) return undefined;
  if (!('error' in status)) return 'gRPC response omitted the execution error';
  return typeof status.error === 'string'
    ? status.error
    : JSON.stringify(status.error) ?? 'gRPC returned an empty execution error';
}

export const grpcManager = SuiGrpcClientManager.getInstance();
