import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { rpcManager } from '../client/suiClient.js';
import { logger } from '../ui/logger.js';
import chalk from 'chalk';
import Table from 'cli-table3';

export type SuiTransactionBlockResponse = Awaited<ReturnType<SuiJsonRpcClient['getTransactionBlock']>>;

export interface ReplayInfo {
  digest: string;
  success: boolean;
  error?: string;
  gasSummary: {
    computationCostMist: bigint;
    storageCostMist: bigint;
    storageRebateMist: bigint;
    netGasCostMist: bigint;
    netGasCostSui: number;
  };
  commandsCount: number;
  eventsCount: number;
  balanceChangesCount: number;
  suiReplayCommand: string;
  sentioDebuggerUrl: string;
  suiVisionUrl: string;
  suiScanUrl: string;
  rawResponse?: SuiTransactionBlockResponse;
}

/**
 * Transaction Replay and Trace Tool
 * Facilitates local stepping via `sui replay` and remote trace inspection via Sentio / SuiVision.
 */
export class ReplayDebugger {
  /**
   * Fetch transaction data and generate replay & trace information
   */
  public static async analyzeTransaction(digest: string): Promise<ReplayInfo> {
    const tx = await rpcManager.executeWithFallback('getTransactionBlock', async (client) => {
      return (await client.getTransactionBlock({
        digest,
        options: {
          showEffects: true,
          showInput: true,
          showEvents: true,
          showBalanceChanges: true,
          showObjectChanges: true,
        },
      })) as unknown as SuiTransactionBlockResponse;
    });

    const effects = tx.effects;
    const status = effects?.status;
    const isSuccess = status?.status === 'success';
    const errorMsg = status?.error;

    // Gas calculations
    const gasUsed = effects?.gasUsed;
    const computationCost = BigInt(gasUsed?.computationCost || '0');
    const storageCost = BigInt(gasUsed?.storageCost || '0');
    const storageRebate = BigInt(gasUsed?.storageRebate || '0');
    const netGasCost = computationCost + storageCost - storageRebate;
    const netGasCostSui = Number(netGasCost) / 1e9;

    const rpcUrl = rpcManager.getActiveUrl();

    // Sui CLI Replay command
    const suiReplayCommand = `sui replay --rpc ${rpcUrl} --digest ${digest}`;

    // Debugger and trace explorer URLs
    const sentioDebuggerUrl = `https://app.sentio.xyz/sui/tx/${digest}`;
    const suiVisionUrl = `https://suivision.xyz/txblock/${digest}`;
    const suiScanUrl = `https://suiscan.xyz/mainnet/tx/${digest}`;

    const commandsCount = (tx.transaction?.data?.transaction as { commands?: unknown[] })?.commands?.length || 0;
    const eventsCount = tx.events?.length || 0;
    const balanceChangesCount = tx.balanceChanges?.length || 0;

    return {
      digest,
      success: isSuccess,
      error: errorMsg,
      gasSummary: {
        computationCostMist: computationCost,
        storageCostMist: storageCost,
        storageRebateMist: storageRebate,
        netGasCostMist: netGasCost,
        netGasCostSui: netGasCostSui,
      },
      commandsCount,
      eventsCount,
      balanceChangesCount,
      suiReplayCommand,
      sentioDebuggerUrl,
      suiVisionUrl,
      suiScanUrl,
      rawResponse: tx,
    };
  }

  /**
   * Render terminal audit & replay report for a given transaction digest
   */
  public static async printReport(digest: string): Promise<void> {
    try {
      console.log(chalk.cyan(`\n🔍 Fetching on-chain transaction data for digest: ${chalk.bold(digest)}...`));
      const info = await this.analyzeTransaction(digest);

      const table = new Table({
        head: [chalk.cyan('Metric / Attribute'), chalk.cyan('Value')],
        colWidths: [26, 70],
      });

      table.push(
        ['Transaction Digest', chalk.yellow(info.digest)],
        ['Execution Status', info.success ? chalk.green('✓ SUCCESS') : chalk.red(`✗ FAILED: ${info.error || 'Reverted'}`)],
        ['PTB Commands Count', `${info.commandsCount} Move commands`],
        ['Events Emitted', `${info.eventsCount} events`],
        ['Balance Changes', `${info.balanceChangesCount} coin balance mutations`],
        ['Computation Cost', `${info.gasSummary.computationCostMist.toLocaleString()} MIST`],
        ['Storage Cost / Rebate', `${info.gasSummary.storageCostMist.toLocaleString()} MIST / rebate: ${info.gasSummary.storageRebateMist.toLocaleString()} MIST`],
        ['Net Gas Consumption', `${info.gasSummary.netGasCostSui.toFixed(6)} SUI (${info.gasSummary.netGasCostMist.toLocaleString()} MIST)`],
        ['Local Sui CLI Replay', chalk.magenta(info.suiReplayCommand)],
        ['Sentio Trace Debugger', chalk.blue(info.sentioDebuggerUrl)],
        ['SuiVision Explorer', chalk.blue(info.suiVisionUrl)],
        ['SuiScan Explorer', chalk.blue(info.suiScanUrl)]
      );

      console.log(table.toString());

      if (!info.success && info.error) {
        console.log(chalk.red(`\n⚠️  Execution Failure Root Cause Analysis:`));
        console.log(chalk.yellow(`  ${info.error}`));
        console.log(chalk.white(`\n💡 To step through Move instructions locally, run:`));
        console.log(chalk.cyan(`   ${info.suiReplayCommand}\n`));
      }
    } catch (err: unknown) {
      logger.error({ error: err, digest }, 'Failed to analyze transaction for replay');
      console.error(chalk.red(`\n❌ Error fetching transaction ${digest}: ${err instanceof Error ? err.message : String(err)}\n`));
    }
  }
}
