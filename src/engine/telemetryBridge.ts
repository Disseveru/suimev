import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config/index.js';
import {
  TelemetryPayload,
  TelemetryRecentLiquidationItem,
  TelemetryHotWatchlistItem,
} from '../config/types.js';
import { gasManager } from '../client/gasManager.js';
import { obligationRegistry } from './registry.js';
import { searcher } from './searcher.js';
import { logger } from '../ui/logger.js';

/**
 * 15-event FIFO ring buffer helper for liquidation events
 */
export class LiquidationRingBuffer {
  private buffer: TelemetryRecentLiquidationItem[] = [];
  private readonly capacity: number;

  constructor(capacity = 15) {
    this.capacity = capacity;
  }

  public push(item: TelemetryRecentLiquidationItem): void {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift(); // Evict oldest
    }
    this.buffer.push(item);
  }

  public getEvents(): TelemetryRecentLiquidationItem[] {
    return [...this.buffer];
  }

  public size(): number {
    return this.buffer.length;
  }

  public clear(): void {
    this.buffer = [];
  }
}

const BACKOFF_DELAYS = [10, 25, 50, 100, 150];

/**
 * Windows-safe atomic file writer with retry loop (PROJECT.md Architecture 2)
 */
export async function writeAtomicJson(filePath: string, data: unknown, retries = 5): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const content = JSON.stringify(data, null, 2);

  await fs.promises.writeFile(tmpPath, content, 'utf8');

  let renamed = false;
  try {
    let attempt = 0;
    while (attempt < retries) {
      try {
        await fs.promises.rename(tmpPath, filePath);
        renamed = true;
        return;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === 'EBUSY' || code === 'EPERM') {
          attempt++;
          if (attempt >= retries) {
            logger.debug({ filePath, code }, 'Lock contention exhausted retries; preserving existing state file');
            return;
          }
          const baseDelay = BACKOFF_DELAYS[Math.min(attempt - 1, BACKOFF_DELAYS.length - 1)];
          const jitter = Math.floor(Math.random() * 10);
          await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
        } else {
          throw err;
        }
      }
    }
  } finally {
    if (!renamed) {
      try {
        await fs.promises.unlink(tmpPath);
      } catch {
        /* ignore cleanup error */
      }
    }
  }
}

/**
 * Telemetry State Bridge Daemon
 * Decoupled in-memory exporter serializing engine metrics to .state/telemetry.json
 */
export class TelemetryBridge {
  private static instance: TelemetryBridge;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private stateFilePath: string = path.resolve(process.cwd(), '.state', 'telemetry.json');
  private ringBuffer = new LiquidationRingBuffer(15);
  private explicitStatus: 'ONLINE' | 'PAUSED' | 'ERROR' | null = null;
  private writePromise: Promise<void> | null = null;
  private pendingWrite = false;

  private constructor() {}

  public static getInstance(): TelemetryBridge {
    if (!TelemetryBridge.instance) {
      TelemetryBridge.instance = new TelemetryBridge();
    }
    return TelemetryBridge.instance;
  }

  public setStateFilePath(newPath: string): void {
    this.stateFilePath = newPath;
  }

  public getStateFilePath(): string {
    return this.stateFilePath;
  }

  public setStatus(status: 'ONLINE' | 'PAUSED' | 'ERROR' | null): void {
    this.explicitStatus = status;
  }

  public start(intervalMs = 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Export initial snapshot immediately
    this.exportSnapshot().catch((err) => {
      logger.debug({ error: err }, 'Initial telemetry snapshot export encountered an error');
    });

    this.timer = setInterval(() => {
      this.exportSnapshot().catch((err) => {
        logger.debug({ error: err }, 'Periodic telemetry snapshot export encountered an error');
      });
    }, intervalMs);

    // Unref so this timer never prevents Node process from exiting
    this.timer.unref();
    logger.info({ intervalMs, path: this.stateFilePath }, '📡 Telemetry State Bridge daemon started');
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.pendingWrite = false;
    this.writePromise = null;
    logger.info('📡 Telemetry State Bridge daemon stopped');
  }

  public recordLiquidation(event: TelemetryRecentLiquidationItem): void {
    this.ringBuffer.push(event);
    // Immediate on-demand reflex export
    this.exportSnapshot().catch((err) => {
      logger.debug({ error: err }, 'On-demand telemetry snapshot export after liquidation failed');
    });
  }

  public getRecentLiquidations(): TelemetryRecentLiquidationItem[] {
    return this.ringBuffer.getEvents();
  }

  public clearRingBuffer(): void {
    this.ringBuffer.clear();
  }

  public generatePayload(): TelemetryPayload {
    const gasTankBalanceSui = gasManager.getCachedBalanceSui();
    const primaryCoin = (gasManager as any).primaryGasCoin;
    const gasTankBalanceMist =
      primaryCoin && primaryCoin.balanceMist !== undefined && primaryCoin.balanceMist !== null
        ? String(primaryCoin.balanceMist)
        : BigInt(Math.floor(gasTankBalanceSui * 1e9)).toString();

    const counts = obligationRegistry.getCounts();
    const hotAccounts = obligationRegistry.getHotWatchlistAccounts(1.00, 1.05);

    const hotWatchlist: TelemetryHotWatchlistItem[] = hotAccounts.map((ob) => ({
      obligationId: ob.obligationId,
      protocol: ob.protocol,
      borrower: ob.ownerAddress,
      healthFactor: Number(ob.healthFactor.toFixed(4)),
      totalDebtUsd: Number(ob.totalDebtUsd.toFixed(2)),
      totalCollateralUsd: Number(ob.totalCollateralUsd.toFixed(2)),
      urgency: ob.healthFactor < 1.02 ? 'CRITICAL' : 'HOT',
    }));

    let botStatus: 'ONLINE' | 'PAUSED' | 'ERROR' = 'ONLINE';
    if (this.explicitStatus) {
      botStatus = this.explicitStatus;
    } else if (searcher && !searcher.isRunning) {
      botStatus = 'PAUSED';
    }

    return {
      timestamp: new Date().toISOString(),
      botStatus,
      operator: {
        address: CONFIG.operatorAddress || '0x0000000000000000000000000000000000000000000000000000000000000000',
        gasTankBalanceSui,
        gasTankBalanceMist,
      },
      financials: {
        netRealizedPnlUsd: Number((searcher?.stats?.cumulativeNetProfitUsd ?? 0).toFixed(2)),
        cumulativeGasSpentSui: Number((searcher?.stats?.cumulativeGasSpentSui ?? 0).toFixed(4)),
        successfulLiquidations: searcher?.stats?.successfulLiquidations ?? 0,
        failedLiquidations: searcher?.stats?.failedLiquidations ?? 0,
        totalSimulations: searcher?.stats?.totalSimulations ?? 0,
      },
      obligations: {
        totalMonitored: counts.total,
        naviCount: counts.navi,
        scallopCount: counts.scallop,
        immediateTargetsCount: counts.immediate,
        hotWatchlistCount: counts.hot,
        safeCount: counts.safe,
      },
      hotWatchlist,
      recentLiquidations: this.ringBuffer.getEvents(),
    };
  }

  public exportSnapshot(): Promise<void> {
    if (this.writePromise) {
      this.pendingWrite = true;
      return this.writePromise.then(async () => {
        if (this.pendingWrite) {
          this.pendingWrite = false;
          return this.exportSnapshot();
        }
      });
    }

    this.writePromise = Promise.resolve().then(async () => {
      try {
        const payload = this.generatePayload();
        await writeAtomicJson(this.stateFilePath, payload);
      } finally {
        this.writePromise = null;
      }
    });

    return this.writePromise;
  }
}

export const telemetryBridge = TelemetryBridge.getInstance();
