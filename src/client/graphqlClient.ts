import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import { normalizeStructTag } from '../config/coins.js';

export interface GraphQLObjectResult {
  objectId: string;
  version: string;
  digest: string;
  type?: string;
  owner?: {
    __typename?: string;
    address?: string;
    initialSharedVersion?: number;
  };
  hasPublicTransfer?: boolean;
  contents?: Record<string, unknown>;
}

/**
 * Modern Sui Network GraphQL State Service
 * Uses @mysten/sui/graphql for ultra-fast on-chain object inspections, multi-asset data polling,
 * and checkpoint indexing without legacy JSON-RPC overhead.
 */
export class SuiGraphQLService {
  private static instance: SuiGraphQLService;
  private client: SuiGraphQLClient;
  private endpointUrl: string;
  private isHealthy = true;
  private lastLatencyMs = 0;

  private constructor() {
    this.endpointUrl = process.env.SUI_GRAPHQL_URL || 'https://sui-mainnet.mystenlabs.com/graphql';
    this.client = new SuiGraphQLClient({
      url: this.endpointUrl,
      network: (CONFIG.network === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet',
    });
    logger.info({ endpoint: this.endpointUrl }, 'Initialized Modern Sui GraphQL Client');
  }

  public static getInstance(): SuiGraphQLService {
    if (!SuiGraphQLService.instance) {
      SuiGraphQLService.instance = new SuiGraphQLService();
    }
    return SuiGraphQLService.instance;
  }

  public getClient(): SuiGraphQLClient {
    return this.client;
  }

  public getEndpointUrl(): string {
    return this.endpointUrl;
  }

  public isEndpointHealthy(): boolean {
    return this.isHealthy;
  }

  public getLastLatencyMs(): number {
    return this.lastLatencyMs;
  }

  /**
   * Fetch object state by address using GraphQL
   */
  public async getObject(address: string): Promise<GraphQLObjectResult | null> {
    const startMs = Date.now();
    try {
      const query = `
        query GetObjectState($address: SuiAddress!) {
          object(address: $address) {
            address
            version
            digest
            asMoveObject {
              hasPublicTransfer
              contents {
                type {
                  repr
                }
                json
              }
            }
            owner {
              __typename
              ... on Shared {
                initialSharedVersion
              }
              ... on AddressOwner {
                owner {
                  address
                }
              }
            }
          }
        }
      `;

      const res = await this.client.query({
        query,
        variables: { address },
      });

      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = true;

      const obj = (res.data as any)?.object;
      if (!obj) return null;

      const typeRepr = obj.asMoveObject?.contents?.type?.repr;
      return {
        objectId: obj.address,
        version: String(obj.version),
        digest: obj.digest,
        type: typeRepr ? normalizeStructTag(typeRepr) : undefined,
        owner: obj.owner,
        hasPublicTransfer: obj.asMoveObject?.hasPublicTransfer,
        contents: obj.asMoveObject?.contents?.json,
      };
    } catch (err) {
      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = false;
      logger.warn({ address, error: err }, 'GraphQL getObject query failed');
      return null;
    }
  }

  /**
   * Fetch latest checkpoint sequence number and timestamp
   */
  public async getLatestCheckpoint(): Promise<{ sequenceNumber: number; timestamp?: string } | null> {
    const startMs = Date.now();
    try {
      const query = `
        query GetLatestCheckpoint {
          checkpoint {
            sequenceNumber
            timestamp
          }
        }
      `;

      const res = await this.client.query({
        query,
        variables: {},
      });
      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = true;

      const cp = (res.data as any)?.checkpoint;
      if (!cp) return null;

      return {
        sequenceNumber: Number(cp.sequenceNumber),
        timestamp: cp.timestamp,
      };
    } catch (err) {
      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = false;
      logger.debug({ error: err }, 'GraphQL getLatestCheckpoint query failed');
      return null;
    }
  }

  /**
   * Execute custom GraphQL query with variables
   */
  public async query<T = unknown>(queryString: string, variables?: Record<string, unknown>): Promise<T | null> {
    const startMs = Date.now();
    try {
      const res = await this.client.query({
        query: queryString,
        variables: variables ?? {},
      });
      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = true;
      return res.data as T;
    } catch (err) {
      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = false;
      logger.warn({ error: err }, 'Custom GraphQL query failed');
      return null;
    }
  }
}

export const suiGraphQL = SuiGraphQLService.getInstance();
