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
  private primaryClient: SuiGraphQLClient;
  private fallbackClient: SuiGraphQLClient;
  private endpointUrl: string;
  private isHealthy = true;
  private lastLatencyMs = 0;

  private constructor() {
    this.endpointUrl = process.env.SUI_GRAPHQL_URL || 'https://graphql.mainnet.sui.io/graphql';
    const fallbackUrl = process.env.SUI_BACKUP_GRAPHQL_URL || 'https://sui-mainnet.mystenlabs.com/graphql';
    const network = (CONFIG.network === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
    
    this.primaryClient = new SuiGraphQLClient({
      url: this.endpointUrl,
      network,
    });
    this.fallbackClient = new SuiGraphQLClient({
      url: fallbackUrl,
      network,
    });
    this.client = this.primaryClient;
    logger.info({ endpoint: this.endpointUrl, fallback: fallbackUrl }, 'Initialized Modern Sui GraphQL Client with Fallback');
  }

  public static getInstance(): SuiGraphQLService {
    if (!SuiGraphQLService.instance) {
      SuiGraphQLService.instance = new SuiGraphQLService();
    }
    return SuiGraphQLService.instance;
  }

  public getClient(): SuiGraphQLClient {
    return this.primaryClient;
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

  private async executeQuery<T = any>(queryString: string, variables?: Record<string, unknown>): Promise<{ data: T | null; errors?: any[] }> {
    try {
      const res = await this.primaryClient.query({
        query: queryString,
        variables: variables ?? {},
      });
      return { data: res.data as T, errors: res.errors };
    } catch (primaryErr) {
      try {
        const res = await this.fallbackClient.query({
          query: queryString,
          variables: variables ?? {},
        });
        return { data: res.data as T, errors: res.errors };
      } catch (fallbackErr) {
        throw primaryErr;
      }
    }
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

      const res = await this.executeQuery(query, { address });

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

      const res = await this.executeQuery(query, {});
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
   * Batch-fetch multiple object states in chunks using GraphQL field aliases.
   * Eliminates single-object serial HTTP round-trips.
   */
  public async multiGetObjects(addresses: string[]): Promise<Map<string, GraphQLObjectResult>> {
    const results = new Map<string, GraphQLObjectResult>();
    if (addresses.length === 0) return results;

    const CHUNK_SIZE = 30;
    for (let i = 0; i < addresses.length; i += CHUNK_SIZE) {
      const chunk = addresses.slice(i, i + CHUNK_SIZE);
      const aliases = chunk
        .map(
          (addr, idx) => `
        obj_${idx}: object(address: "${addr}") {
          address
          version
          digest
          asMoveObject {
            hasPublicTransfer
            contents {
              type { repr }
              json
            }
          }
          owner {
            __typename
            ... on Shared { initialSharedVersion }
            ... on AddressOwner { owner { address } }
          }
        }`
        )
        .join('\n');

      const query = `query MultiGetObjects { ${aliases} }`;
      try {
        const res = await this.executeQuery<Record<string, any>>(query, {});
        if (res.data) {
          for (const [key, obj] of Object.entries(res.data)) {
            if (obj && obj.address) {
              const typeRepr = obj.asMoveObject?.contents?.type?.repr;
              results.set(obj.address, {
                objectId: obj.address,
                version: String(obj.version),
                digest: obj.digest,
                type: typeRepr ? normalizeStructTag(typeRepr) : undefined,
                owner: obj.owner,
                hasPublicTransfer: obj.asMoveObject?.hasPublicTransfer,
                contents: obj.asMoveObject?.contents?.json,
              });
            }
          }
        }
      } catch (err) {
        logger.warn({ error: err, chunkCount: chunk.length }, 'GraphQL multiGetObjects chunk failed');
      }
    }

    return results;
  }

  /**
   * Batch-fetch Scallop/Navi obligation raw object contents via GraphQL aliases
   */
  public async queryObligationsBatch(
    objectIds: string[]
  ): Promise<Map<string, { collaterals: any[]; debts: any[]; ownerAddress: string }>> {
    const result = new Map<string, { collaterals: any[]; debts: any[]; ownerAddress: string }>();
    if (objectIds.length === 0) return result;

    const CHUNK = 30;
    for (let i = 0; i < objectIds.length; i += CHUNK) {
      const chunk = objectIds.slice(i, i + CHUNK);
      const aliases = chunk
        .map(
          (id, idx) => `
        o_${idx}: object(address: "${id}") {
          address
          asMoveObject {
            contents { json }
            owner {
              __typename
              ... on AddressOwner { owner { address } }
            }
          }
        }`
        )
        .join('\n');

      const query = `query BatchObligations { ${aliases} }`;
      try {
        const res = await this.executeQuery<Record<string, any>>(query, {});
        if (res.data) {
          for (const [_alias, obj] of Object.entries(res.data)) {
            if (obj && obj.address) {
              const json = obj.asMoveObject?.contents?.json ?? {};
              result.set(obj.address, {
                collaterals: json.collaterals?.fields?.items ?? json.collaterals ?? [],
                debts: json.debts?.fields?.items ?? json.debts ?? [],
                ownerAddress: obj.asMoveObject?.owner?.owner?.address ?? obj.address,
              });
            }
          }
        }
      } catch (err) {
        logger.warn({ error: err }, 'GraphQL queryObligationsBatch chunk failed');
      }
    }
    return result;
  }

  /**
   * Execute custom GraphQL query with variables
   */
  public async query<T = unknown>(queryString: string, variables?: Record<string, unknown>): Promise<T | null> {
    const startMs = Date.now();
    try {
      const res = await this.executeQuery<T>(queryString, variables);
      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = true;
      return res.data;
    } catch (err) {
      this.lastLatencyMs = Date.now() - startMs;
      this.isHealthy = false;
      logger.warn({ error: err }, 'Custom GraphQL query failed');
      return null;
    }
  }
}

export const suiGraphQL = SuiGraphQLService.getInstance();
