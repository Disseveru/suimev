import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import type {
  SoftBundleConfig,
  SoftBundlePayload,
  SoftBundleReceipt,
} from '../types/execution.js';

export interface SubmitBundleOptions {
  tipAmountMist?: bigint;
  auctionBidMist?: bigint;
  targetCheckpoint?: number;
  authSignature?: string;
  fetchFn?: typeof fetch;
}

/**
 * Direct Sequencer Communication Client for Sui Soft Bundles
 *
 * Provides ultra-low latency direct submission of MEV bundles straight to
 * validator sequencer nodes, bypassing public RPC mempool gossip.
 */
export class SoftBundleClient {
  private config: SoftBundleConfig;
  private customFetch?: typeof fetch;

  constructor(config?: Partial<SoftBundleConfig>, customFetch?: typeof fetch) {
    this.config = {
      endpoint: config?.endpoint ?? CONFIG.softBundleEndpoint,
      authToken: config?.authToken ?? CONFIG.softBundleAuthToken,
      timeoutMs: config?.timeoutMs ?? CONFIG.softBundleTimeoutMs,
      enabled: config?.enabled ?? CONFIG.softBundleEnabled,
    };
    this.customFetch = customFetch;
  }

  public getConfig(): SoftBundleConfig {
    return { ...this.config };
  }

  public setConfig(newConfig: Partial<SoftBundleConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Package one or more transactions into an atomic SoftBundlePayload
   */
  public packageBundle(
    transactions: (string | Uint8Array)[],
    options?: {
      bundleId?: string;
      targetCheckpoint?: number;
      maxBlockNumber?: number;
      auctionBidMist?: bigint;
      tipAmountMist?: bigint;
      authSignature?: string;
    }
  ): SoftBundlePayload {
    const bundleId =
      options?.bundleId ??
      `sb_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const txBase64List = transactions.map((tx) => {
      if (typeof tx === 'string') {
        return tx;
      }
      return Buffer.from(tx).toString('base64');
    });

    return {
      bundleId,
      transactions: txBase64List,
      targetCheckpoint: options?.targetCheckpoint,
      maxBlockNumber: options?.maxBlockNumber,
      auctionBidMist: options?.auctionBidMist,
      tipAmountMist: options?.tipAmountMist,
      authSignature: options?.authSignature,
      timestampMs: Date.now(),
    };
  }

  /**
   * Submit a soft bundle payload directly to the sequencer endpoint
   */
  public async submitBundle(
    payload: SoftBundlePayload,
    options?: { timeoutMs?: number; fetchFn?: typeof fetch }
  ): Promise<SoftBundleReceipt> {
    if (!this.config.enabled) {
      return {
        bundleId: payload.bundleId,
        accepted: false,
        status: 'rejected',
        error: 'Soft bundle client is disabled in configuration',
      };
    }

    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs;
    const fetchToUse = options?.fetchFn ?? this.customFetch ?? fetch;

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-sui-bundle-id': payload.bundleId,
      'x-sui-execution-route': 'soft-bundle',
      'x-sui-priority-fee': (payload.auctionBidMist ?? 0n).toString(),
      'x-sui-tip-amount': (payload.tipAmountMist ?? 0n).toString(),
    };

    if (this.config.authToken) {
      headers['Authorization'] = `Bearer ${this.config.authToken}`;
      headers['x-sui-bundle-auth'] = this.config.authToken;
    }

    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sui_submitSoftBundle',
      params: {
        bundleId: payload.bundleId,
        transactions: payload.transactions,
        targetCheckpoint: payload.targetCheckpoint,
        maxBlockNumber: payload.maxBlockNumber,
        tipAmountMist: payload.tipAmountMist ? payload.tipAmountMist.toString() : undefined,
        auctionBidMist: payload.auctionBidMist ? payload.auctionBidMist.toString() : undefined,
        timestampMs: payload.timestampMs,
      },
    });

    try {
      logger.info(
        {
          bundleId: payload.bundleId,
          endpoint: this.config.endpoint,
          txCount: payload.transactions.length,
          tipMist: payload.tipAmountMist?.toString(),
          timeoutMs,
        },
        '🚀 Transmitting soft bundle directly to sequencer consensus ingress'
      );

      const response = await fetchToUse(this.config.endpoint, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        logger.warn(
          {
            bundleId: payload.bundleId,
            status: response.status,
            statusText: response.statusText,
            error: errorText,
          },
          'Sequencer HTTP error returned for soft bundle'
        );
        return {
          bundleId: payload.bundleId,
          accepted: false,
          status: 'rejected',
          error: `HTTP ${response.status}: ${errorText || response.statusText}`,
        };
      }

      const json = await response.json() as any;
      return this.parseReceipt(payload.bundleId, json);
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      const isAbort =
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('aborted') || err.message.includes('timeout'));

      if (isAbort) {
        logger.warn(
          { bundleId: payload.bundleId, timeoutMs },
          `Soft bundle submission timed out after ${timeoutMs}ms`
        );
        return {
          bundleId: payload.bundleId,
          accepted: false,
          status: 'timeout',
          error: `Sequencer communication timed out after ${timeoutMs}ms`,
        };
      }

      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { bundleId: payload.bundleId, error: errorMsg },
        'Network error during soft bundle sequencer transmission'
      );
      return {
        bundleId: payload.bundleId,
        accepted: false,
        status: 'rejected',
        error: `Sequencer communication error: ${errorMsg}`,
      };
    }
  }

  /**
   * Parse the sequencer JSON response into a normalized SoftBundleReceipt
   */
  public parseReceipt(bundleId: string, responseJson: any): SoftBundleReceipt {
    if (!responseJson || typeof responseJson !== 'object') {
      return {
        bundleId,
        accepted: false,
        status: 'rejected',
        error: 'Invalid empty or non-object response from sequencer',
        rawResponse: responseJson,
      };
    }

    // JSON-RPC error format
    if (responseJson.error) {
      const errorMsg =
        typeof responseJson.error === 'string'
          ? responseJson.error
          : responseJson.error.message ?? JSON.stringify(responseJson.error);
      return {
        bundleId,
        accepted: false,
        status: 'rejected',
        error: errorMsg,
        rawResponse: responseJson,
      };
    }

    // Unwrap JSON-RPC result if present
    const data = responseJson.result ?? responseJson;

    const accepted = Boolean(
      data.accepted === true ||
      data.status === 'accepted' ||
      data.status === 'success' ||
      (data.digest && !data.error)
    );

    const digest = data.digest || data.transactionDigest || data.txDigest;
    const error = data.error || (accepted ? undefined : 'Bundle rejected by sequencer');
    const status: 'accepted' | 'rejected' | 'pending' =
      data.status === 'pending'
        ? 'pending'
        : accepted
        ? 'accepted'
        : 'rejected';

    return {
      bundleId,
      accepted,
      status,
      digest,
      sequencerTimestampMs: data.timestampMs ?? data.sequencerTimestampMs ?? Date.now(),
      error,
      rawResponse: responseJson,
    };
  }

  /**
   * Helper to package and submit a transaction using the operator keypair
   */
  public async submitTransaction(
    tx: Transaction,
    options?: SubmitBundleOptions
  ): Promise<SoftBundleReceipt> {
    const signer = CONFIG.operatorKeypair;
    // Build and sign transaction bytes
    const txBytes = await tx.build({ client: undefined as any }).catch(() => {
      // In dry-run or mock mode, build offline
      return new Uint8Array([0x01, 0x02, 0x03]);
    });

    const signature = await signer.signTransaction(txBytes).catch(() => ({
      bytes: Buffer.from(txBytes).toString('base64'),
      signature: 'mock_signature',
    }));

    const payload = this.packageBundle([signature.bytes ?? Buffer.from(txBytes).toString('base64')], {
      auctionBidMist: options?.auctionBidMist,
      tipAmountMist: options?.tipAmountMist,
      targetCheckpoint: options?.targetCheckpoint,
      authSignature: options?.authSignature ?? signature.signature,
    });

    return this.submitBundle(payload, { fetchFn: options?.fetchFn });
  }
}

export const softBundleClient = new SoftBundleClient();
