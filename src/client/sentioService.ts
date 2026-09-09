import { Transaction } from '@mysten/sui/transactions';
import { rpcManager } from './suiClient.js';
import { CONFIG } from '../config/index.js';

export interface SentioSimulationExport {
  rawTransactionBytesBase64: string;
  sentioSimulatorUrl: string;
  sentioTraceUrl?: string;
  sender: string;
  gasBudget: number;
}

/**
 * Sentio Sui Simulator & Move Debugger Bridge
 * Provides visual simulation links and serialized PTB exports
 * compatible with https://app.sentio.xyz/sui
 */
export class SentioService {
  /**
   * Generates a direct Sentio simulation link and base64 transaction payload
   * for visual Move VM opcode stepping and abort inspection.
   */
  public static async prepareSimulation(tx: Transaction): Promise<SentioSimulationExport> {
    const client = rpcManager.getClient();
    let bytes: Uint8Array;
    try {
      bytes = await tx.build({ client });
    } catch {
      // If address has 0 gas coins (e.g. test runner), assign mock gas object for simulation encoding
      const clonedTx = Transaction.from(tx);
      clonedTx.setGasPayment([
        {
          objectId: '0x' + '0'.repeat(63) + '1',
          version: '1',
          digest: '11111111111111111111111111111111',
        },
      ]);
      bytes = await clonedTx.build({ client, onlyTransactionKind: false });
    }
    const base64Bytes = Buffer.from(bytes).toString('base64');

    return {
      rawTransactionBytesBase64: base64Bytes,
      sentioSimulatorUrl: 'https://app.sentio.xyz/sui',
      sender: CONFIG.operatorAddress,
      gasBudget: CONFIG.gasBudget,
    };
  }

  /**
   * Format transaction replay/trace URL for Sentio
   */
  public static getTraceUrl(digest: string): string {
    return `https://app.sentio.xyz/sui/tx/${digest}`;
  }

  /**
   * Check if Sentio API or configurations are set
   */
  public static isConfigured(): boolean {
    return Boolean(CONFIG.sentioApiKey);
  }
}

export const sentioService = SentioService;
