/**
 * Test Infrastructure Helpers & Authoritative Contracts
 * Ground truth: PROJECT.md and ORIGINAL_REQUEST.md
 */

import fs from 'node:fs';
import path from 'node:path';

export interface TelemetryOperator {
  address: string;
  gasTankBalanceSui: number;
  gasTankBalanceMist: string;
}

export interface TelemetryFinancials {
  netRealizedPnlUsd: number;
  cumulativeGasSpentSui: number;
  successfulLiquidations: number;
  failedLiquidations: number;
  totalSimulations: number;
}

export interface TelemetryObligations {
  totalMonitored: number;
  naviCount: number;
  scallopCount: number;
  immediateTargetsCount: number;
  hotWatchlistCount: number;
  safeCount: number;
}

export interface TelemetryHotWatchlistItem {
  obligationId: string;
  protocol: 'navi' | 'scallop';
  borrower: string;
  healthFactor: number;
  totalDebtUsd: number;
  totalCollateralUsd: number;
  urgency: 'HOT' | 'CRITICAL';
}

export interface TelemetryRecentLiquidationItem {
  timestamp: string;
  protocol: 'navi' | 'scallop';
  borrower: string;
  debtRepaid: string;
  collateralSeized: string;
  netProfitUsd: number;
  gasCostSui: number;
  txDigest: string;
  txDigestLink: string;
}

export interface TelemetryPayload {
  timestamp: string;
  botStatus: 'ONLINE' | 'PAUSED' | 'ERROR';
  operator: TelemetryOperator;
  financials: TelemetryFinancials;
  obligations: TelemetryObligations;
  hotWatchlist: TelemetryHotWatchlistItem[];
  recentLiquidations: TelemetryRecentLiquidationItem[];
}

/**
 * Validates a telemetry JSON object against the authoritative PROJECT.md schema contract.
 */
export function validateTelemetryPayload(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = data as Partial<TelemetryPayload>;

  // Root fields
  if (!p.timestamp || typeof p.timestamp !== 'string') errors.push('Missing or invalid timestamp');
  if (!p.botStatus || !['ONLINE', 'PAUSED', 'ERROR'].includes(p.botStatus)) {
    errors.push(`Invalid botStatus: ${p.botStatus}`);
  }

  // Operator
  if (!p.operator || typeof p.operator !== 'object') {
    errors.push('Missing operator section');
  } else {
    if (typeof p.operator.address !== 'string' || !p.operator.address.startsWith('0x')) {
      errors.push('Invalid operator address');
    }
    if (typeof p.operator.gasTankBalanceSui !== 'number' || p.operator.gasTankBalanceSui < 0) {
      errors.push('Invalid operator gasTankBalanceSui');
    }
    if (typeof p.operator.gasTankBalanceMist !== 'string') {
      errors.push('Invalid operator gasTankBalanceMist');
    }
  }

  // Financials
  if (!p.financials || typeof p.financials !== 'object') {
    errors.push('Missing financials section');
  } else {
    if (typeof p.financials.netRealizedPnlUsd !== 'number') errors.push('Invalid netRealizedPnlUsd');
    if (typeof p.financials.cumulativeGasSpentSui !== 'number') errors.push('Invalid cumulativeGasSpentSui');
    if (typeof p.financials.successfulLiquidations !== 'number') errors.push('Invalid successfulLiquidations');
    if (typeof p.financials.failedLiquidations !== 'number') errors.push('Invalid failedLiquidations');
    if (typeof p.financials.totalSimulations !== 'number') errors.push('Invalid totalSimulations');
  }

  // Obligations
  if (!p.obligations || typeof p.obligations !== 'object') {
    errors.push('Missing obligations section');
  } else {
    if (typeof p.obligations.totalMonitored !== 'number') errors.push('Invalid totalMonitored');
    if (typeof p.obligations.naviCount !== 'number') errors.push('Invalid naviCount');
    if (typeof p.obligations.scallopCount !== 'number') errors.push('Invalid scallopCount');
    if (typeof p.obligations.immediateTargetsCount !== 'number') errors.push('Invalid immediateTargetsCount');
    if (typeof p.obligations.hotWatchlistCount !== 'number') errors.push('Invalid hotWatchlistCount');
    if (typeof p.obligations.safeCount !== 'number') errors.push('Invalid safeCount');
  }

  // Hot Watchlist
  if (!Array.isArray(p.hotWatchlist)) {
    errors.push('hotWatchlist must be an array');
  } else {
    for (const item of p.hotWatchlist) {
      if (!item.obligationId || !item.protocol || typeof item.healthFactor !== 'number') {
        errors.push(`Invalid hot watchlist item: ${JSON.stringify(item)}`);
      }
    }
  }

  // Recent Liquidations
  if (!Array.isArray(p.recentLiquidations)) {
    errors.push('recentLiquidations must be an array');
  } else {
    for (const item of p.recentLiquidations) {
      if (!item.txDigest || !item.txDigestLink || !item.txDigestLink.startsWith('https://suiscan.xyz/')) {
        errors.push(`Invalid recent liquidation item tx link: ${item.txDigestLink}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 15-event FIFO ring buffer helper for liquidations
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

/**
 * Windows-safe atomic file writer with retry loop (PROJECT.md Architecture 2)
 */
export async function writeAtomicJson(filePath: string, data: unknown, retries = 3): Promise<void> {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${filePath}.tmp`;
  const content = JSON.stringify(data, null, 2);

  await fs.promises.writeFile(tmpPath, content, 'utf8');

  let attempt = 0;
  while (attempt < retries) {
    try {
      await fs.promises.rename(tmpPath, filePath);
      return;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'EBUSY' || code === 'EPERM') {
        attempt++;
        if (attempt >= retries) {
          // Fallback to direct write if rename is persistently locked
          await fs.promises.writeFile(filePath, content, 'utf8');
          try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 15 * attempt));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Strips ANSI color and cursor control codes from output strings
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;?]*[a-zA-Z]/g, '');
}

import { ObligationState, ProtocolType } from '../../../src/config/types.js';

/**
 * Creates a fully typed mock ObligationState with sensible defaults
 */
export function createMockObligation(partial: Partial<ObligationState> & {
  protocol: ProtocolType;
  obligationId: string;
  ownerAddress: string;
}): ObligationState {
  return {
    collaterals: [],
    debts: [],
    totalCollateralUsd: 0,
    totalDebtUsd: 0,
    liquidationThresholdCollateralUsd: 0,
    healthFactor: 1.5,
    isLiquidatable: false,
    lastUpdatedMs: Date.now(),
    ...partial,
  };
}
