import chalk from 'chalk';
import Table from 'cli-table3';
import { CONFIG } from '../config/index.js';
import { priceCache } from '../oracles/priceCache.js';
import { searcher } from '../engine/searcher.js';
import { obligationRegistry } from '../engine/registry.js';

/**
 * Terminal UI Telemetry Dashboard
 * Renders real-time MEV liquidation metrics, Pyth oracle prices, and account health distributions.
 */
export class TerminalDashboard {
  private timer: NodeJS.Timeout | null = null;

  public start(refreshIntervalMs: number = 3000): void {
    if (this.timer) return;

    this.timer = setInterval(() => {
      this.render();
    }, refreshIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public render(): void {
    const stats = searcher.stats;
    const prices = priceCache.getAllPrices();
    const counts = obligationRegistry.getCounts();

    const banner = chalk.bold.cyan(`
  ╔══════════════════════════════════════════════════════════════════════════╗
  ║                 ⚡ SuiMEV ZERO-CAPITAL LIQUIDATOR ENGINE ⚡               ║
  ║               NAVI & Scallop Protocol • Cetus & DeepBook v3              ║
  ╚══════════════════════════════════════════════════════════════════════════╝
    `);

    // System Status Card
    const statusTable = new Table({
      head: [chalk.yellow('Parameter'), chalk.yellow('Value')],
      colWidths: [26, 48],
    });

    statusTable.push(
      ['Execution Mode', CONFIG.dryRun ? chalk.green('🛡️ DRY-RUN (Safe)') : chalk.red.bold('⚡ LIVE ON-CHAIN')],
      ['Network', chalk.cyan(CONFIG.network)],
      ['Primary Gateway', chalk.cyan(CONFIG.rpcUrl.includes('alchemy.com') ? '⚡ Alchemy Dedicated Node' : 'Public RPC')],
      ['Operator Wallet', chalk.gray(CONFIG.operatorAddress.substring(0, 20) + '...' + CONFIG.operatorAddress.substring(CONFIG.operatorAddress.length - 8))],
      ['Uptime', `${stats.uptimeSeconds}s`],
      ['Active Protocols', CONFIG.protocols.join(', ')],
      ['Min Profit Threshold', `$${CONFIG.minProfitUsd.toFixed(2)} USD`],
      ['PGA Bid Policy', `${(CONFIG.priorityProfitShare * 100).toFixed(0)}% profit share (max ${CONFIG.maxGasPriceMultiplier}x RGP)`],
      ['Max Slippage', `${CONFIG.maxSlippageBps} bps (${(CONFIG.maxSlippageBps / 100).toFixed(2)}%)`]
    );

    // Obligation Registry Status
    const regTable = new Table({
      head: [chalk.yellow('Queue Priority'), chalk.yellow('Criteria'), chalk.yellow('Count'), chalk.yellow('Status')],
      colWidths: [22, 22, 12, 18],
    });

    regTable.push(
      [chalk.red.bold('🚨 Immediate Targets'), 'HF < 1.00', chalk.bold(String(counts.immediate)), counts.immediate > 0 ? chalk.red('EXECUTING') : chalk.gray('Idle')],
      [chalk.yellow('🔥 Hot Watchlist'), '1.00 <= HF < 1.05', String(counts.hot), chalk.yellow('Tick Monitored')],
      [chalk.green('🛡️ Safe Accounts'), 'HF >= 1.05', String(counts.safe), chalk.green('Healthy')],
      [chalk.blue('Total Monitored'), 'All Accounts', chalk.bold(String(counts.total)), 'Active']
    );

    // Live Pyth Price Feed Board
    const priceTable = new Table({
      head: [chalk.yellow('Asset'), chalk.yellow('Price (USD)'), chalk.yellow('Raw Integer'), chalk.yellow('Publish Time')],
      colWidths: [14, 18, 22, 20],
    });

    for (const p of prices) {
      priceTable.push([
        chalk.bold(p.symbol),
        chalk.green(`$${p.price.toFixed(p.price < 1 ? 4 : 2)}`),
        p.rawPrice.toString(),
        new Date(p.publishTime * 1000).toLocaleTimeString(),
      ]);
    }

    // Cumulative PnL & Performance
    const pnlTable = new Table({
      head: [chalk.yellow('Simulations'), chalk.yellow('Liquidations'), chalk.yellow('Gas Spent (SUI)'), chalk.yellow('Net Profit (USD)')],
      colWidths: [18, 18, 20, 20],
    });

    pnlTable.push([
      `${stats.successfulSimulations} / ${stats.totalSimulations}`,
      `${stats.successfulLiquidations} / ${stats.totalLiquidationsAttempted}`,
      chalk.magenta(`${stats.cumulativeGasSpentSui.toFixed(4)} SUI`),
      chalk.green.bold(`+$${stats.cumulativeNetProfitUsd.toFixed(2)} USD`),
    ]);

    // Print to console
    console.log(banner);
    console.log(chalk.bold.white('  📊 SYSTEM & STRATEGY CONFIGURATION'));
    console.log(statusTable.toString());
    console.log(chalk.bold.white('\n  🎯 OBLIGATION REGISTRY & PRIORITY QUEUE'));
    console.log(regTable.toString());
    console.log(chalk.bold.white('\n  🔮 PYTH ORACLE REAL-TIME FEEDS'));
    console.log(priceTable.toString());
    console.log(chalk.bold.white('\n  💰 MEV LIQUIDATION PERFORMANCE & PnL'));
    console.log(pnlTable.toString());
  }
}

export const terminalDashboard = new TerminalDashboard();
