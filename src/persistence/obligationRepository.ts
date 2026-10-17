import { DatabaseSync, StatementSync } from 'node:sqlite';
import {
  type IObligationRepository,
  type ObligationRecord,
  type ObligationState,
  type ObligationQueryFilter,
  type CollateralPosition,
  type DebtPosition,
  type ProtocolType,
} from '../types/index.js';
import { createDatabaseSync, runInTransaction } from './database.js';
import { initSchema } from './schema.js';

/**
 * Converts ObligationState to database ObligationRecord
 */
export function stateToRecord(state: ObligationState): ObligationRecord {
  const metadata = {
    scallopObligationKey: state.scallopObligationKey,
    liquidateLocked: state.liquidateLocked,
    naviAccountCap: state.naviAccountCap,
    liquidationThresholdCollateralUsd: state.liquidationThresholdCollateralUsd,
  };

  return {
    obligationId: state.obligationId,
    protocol: state.protocol,
    ownerAddress: state.ownerAddress,
    collateralsJson: JSON.stringify(state.collaterals, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ),
    debtsJson: JSON.stringify(state.debts, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    ),
    totalCollateralUsd: state.totalCollateralUsd,
    totalDebtUsd: state.totalDebtUsd,
    healthFactor: state.healthFactor,
    isLiquidatable: state.isLiquidatable,
    lastUpdatedMs: state.lastUpdatedMs,
    metadataJson: JSON.stringify(metadata),
  };
}

/**
 * Converts database ObligationRecord back to in-memory ObligationState
 */
export function recordToState(record: ObligationRecord): ObligationState {
  let collaterals: CollateralPosition[] = [];
  try {
    const rawCols = JSON.parse(record.collateralsJson || '[]');
    collaterals = rawCols.map((c: any) => ({
      coinType: String(c.coinType),
      symbol: String(c.symbol),
      amount: BigInt(c.amount ?? 0),
      decimals: Number(c.decimals ?? 9),
      valueUsd: Number(c.valueUsd ?? 0),
      liquidationThreshold: Number(c.liquidationThreshold ?? 0),
    }));
  } catch {
    collaterals = [];
  }

  let debts: DebtPosition[] = [];
  try {
    const rawDebts = JSON.parse(record.debtsJson || '[]');
    debts = rawDebts.map((d: any) => ({
      coinType: String(d.coinType),
      symbol: String(d.symbol),
      amount: BigInt(d.amount ?? 0),
      decimals: Number(d.decimals ?? 9),
      valueUsd: Number(d.valueUsd ?? 0),
    }));
  } catch {
    debts = [];
  }

  let metadata: any = {};
  try {
    if (record.metadataJson) {
      metadata = JSON.parse(record.metadataJson);
    }
  } catch {
    metadata = {};
  }

  return {
    protocol: record.protocol,
    obligationId: record.obligationId,
    ownerAddress: record.ownerAddress,
    collaterals,
    debts,
    totalCollateralUsd: record.totalCollateralUsd,
    totalDebtUsd: record.totalDebtUsd,
    liquidationThresholdCollateralUsd: Number(metadata.liquidationThresholdCollateralUsd ?? 0),
    healthFactor: record.healthFactor,
    isLiquidatable: record.isLiquidatable,
    lastUpdatedMs: record.lastUpdatedMs,
    scallopObligationKey: metadata.scallopObligationKey,
    liquidateLocked: metadata.liquidateLocked,
    naviAccountCap: metadata.naviAccountCap,
  };
}

function rowToObligationRecord(row: any): ObligationRecord {
  return {
    obligationId: String(row.obligation_id),
    protocol: row.protocol as ProtocolType,
    ownerAddress: String(row.borrower || row.owner_address),
    collateralsJson: String(row.collaterals_json || '[]'),
    debtsJson: String(row.debts_json || '[]'),
    totalCollateralUsd: Number(row.collateral_usd),
    totalDebtUsd: Number(row.debt_usd),
    healthFactor: Number(row.health_factor),
    isLiquidatable: Boolean(row.is_liquidatable),
    lastUpdatedMs: Number(row.updated_at),
    metadataJson: row.metadata_json ? String(row.metadata_json) : undefined,
  };
}

/**
 * Concrete SQLite implementation of IObligationRepository using Node.js built-in node:sqlite
 */
export class ObligationRepository implements IObligationRepository {
  private db: DatabaseSync;
  private isInitialized = false;

  private stmtUpsertObligation?: StatementSync;
  private stmtDeleteCollaterals?: StatementSync;
  private stmtInsertCollateral?: StatementSync;
  private stmtDeleteDebts?: StatementSync;
  private stmtInsertDebt?: StatementSync;
  private stmtSelectById?: StatementSync;
  private stmtSelectAllActive?: StatementSync;
  private stmtDeleteObligation?: StatementSync;

  constructor(dbOrPath?: DatabaseSync | string) {
    if (dbOrPath instanceof DatabaseSync) {
      this.db = dbOrPath;
    } else {
      this.db = createDatabaseSync(dbOrPath);
    }
    this.initialize();
  }

  public initialize(): void {
    if (this.isInitialized) return;
    initSchema(this.db);
    this.prepareStatements();
    this.isInitialized = true;
  }

  private prepareStatements(): void {
    this.stmtUpsertObligation = this.db.prepare(`
      INSERT INTO obligations (
        id, protocol, borrower, obligation_id, health_factor,
        collateral_usd, debt_usd, updated_at, is_active,
        owner_address, lt_collateral_usd, is_liquidatable,
        collaterals_json, debts_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        protocol = excluded.protocol,
        borrower = excluded.borrower,
        obligation_id = excluded.obligation_id,
        health_factor = excluded.health_factor,
        collateral_usd = excluded.collateral_usd,
        debt_usd = excluded.debt_usd,
        updated_at = excluded.updated_at,
        is_active = excluded.is_active,
        owner_address = excluded.owner_address,
        lt_collateral_usd = excluded.lt_collateral_usd,
        is_liquidatable = excluded.is_liquidatable,
        collaterals_json = excluded.collaterals_json,
        debts_json = excluded.debts_json,
        metadata_json = excluded.metadata_json
    `);

    this.stmtDeleteCollaterals = this.db.prepare(`
      DELETE FROM collaterals WHERE obligation_id = ?
    `);

    this.stmtInsertCollateral = this.db.prepare(`
      INSERT INTO collaterals (
        obligation_id, coin_type, symbol, amount, decimals,
        value_usd, liquidation_threshold, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(obligation_id, coin_type) DO UPDATE SET
        symbol = excluded.symbol,
        amount = excluded.amount,
        decimals = excluded.decimals,
        value_usd = excluded.value_usd,
        liquidation_threshold = excluded.liquidation_threshold,
        updated_at = excluded.updated_at
    `);

    this.stmtDeleteDebts = this.db.prepare(`
      DELETE FROM debts WHERE obligation_id = ?
    `);

    this.stmtInsertDebt = this.db.prepare(`
      INSERT INTO debts (
        obligation_id, coin_type, symbol, amount, decimals,
        value_usd, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(obligation_id, coin_type) DO UPDATE SET
        symbol = excluded.symbol,
        amount = excluded.amount,
        decimals = excluded.decimals,
        value_usd = excluded.value_usd,
        updated_at = excluded.updated_at
    `);

    this.stmtSelectById = this.db.prepare(`
      SELECT * FROM obligations
      WHERE id = ? OR obligation_id = ? OR id = ? OR obligation_id = ?
      LIMIT 1
    `);

    this.stmtSelectAllActive = this.db.prepare(`
      SELECT * FROM obligations
      WHERE is_active = 1
      ORDER BY health_factor ASC
    `);

    this.stmtDeleteObligation = this.db.prepare(`
      DELETE FROM obligations
      WHERE id = ? OR obligation_id = ? OR id = ? OR obligation_id = ?
    `);
  }

  private getCompositeKey(protocol: ProtocolType, obligationId: string): string {
    const cleanId = obligationId.toLowerCase();
    const cleanProto = protocol.toLowerCase();
    return cleanId.startsWith(`${cleanProto}:`) ? cleanId : `${cleanProto}:${cleanId}`;
  }

  private internalUpsert(obligation: ObligationRecord): void {
    if (!this.stmtUpsertObligation || !this.stmtDeleteCollaterals || !this.stmtInsertCollateral || !this.stmtDeleteDebts || !this.stmtInsertDebt) {
      this.prepareStatements();
    }

    const key = this.getCompositeKey(obligation.protocol, obligation.obligationId);
    let ltCollateralUsd = 0;
    if (obligation.metadataJson) {
      try {
        const meta = JSON.parse(obligation.metadataJson);
        ltCollateralUsd = Number(meta.liquidationThresholdCollateralUsd ?? 0);
      } catch {
        ltCollateralUsd = 0;
      }
    }

    const isActive = 1;
    const now = Date.now();

    this.stmtUpsertObligation!.run(
      key,
      obligation.protocol,
      obligation.ownerAddress,
      obligation.obligationId,
      obligation.healthFactor,
      obligation.totalCollateralUsd,
      obligation.totalDebtUsd,
      obligation.lastUpdatedMs,
      isActive,
      obligation.ownerAddress,
      ltCollateralUsd,
      obligation.isLiquidatable ? 1 : 0,
      obligation.collateralsJson,
      obligation.debtsJson,
      obligation.metadataJson ?? null,
      now
    );

    // Synchronize normalized collaterals table
    this.stmtDeleteCollaterals!.run(key);
    if (obligation.collateralsJson) {
      try {
        const collaterals = JSON.parse(obligation.collateralsJson);
        for (const col of collaterals) {
          this.stmtInsertCollateral!.run(
            key,
            String(col.coinType),
            String(col.symbol),
            String(col.amount),
            Number(col.decimals ?? 9),
            Number(col.valueUsd ?? 0),
            Number(col.liquidationThreshold ?? 0),
            obligation.lastUpdatedMs
          );
        }
      } catch {
        // Skip unparseable positions
      }
    }

    // Synchronize normalized debts table
    this.stmtDeleteDebts!.run(key);
    if (obligation.debtsJson) {
      try {
        const debts = JSON.parse(obligation.debtsJson);
        for (const debt of debts) {
          this.stmtInsertDebt!.run(
            key,
            String(debt.coinType),
            String(debt.symbol),
            String(debt.amount),
            Number(debt.decimals ?? 9),
            Number(debt.valueUsd ?? 0),
            obligation.lastUpdatedMs
          );
        }
      } catch {
        // Skip unparseable positions
      }
    }
  }

  public upsertObligation(obligation: ObligationRecord): void {
    runInTransaction(this.db, () => {
      this.internalUpsert(obligation);
    });
  }

  public upsertObligations(obligations: ObligationRecord[]): void {
    runInTransaction(this.db, () => {
      for (const obligation of obligations) {
        this.internalUpsert(obligation);
      }
    });
  }

  public upsertState(state: ObligationState): void {
    this.upsertObligation(stateToRecord(state));
  }

  public upsertStates(states: ObligationState[]): void {
    const records = states.map(stateToRecord);
    this.upsertObligations(records);
  }

  public getObligation(id: string): ObligationRecord | null {
    if (!this.stmtSelectById) this.prepareStatements();
    const cleanId = id.toLowerCase();
    const row = this.stmtSelectById!.get(id, id, cleanId, cleanId);
    if (!row) return null;
    return rowToObligationRecord(row);
  }

  public getObligationState(id: string): ObligationState | null {
    const record = this.getObligation(id);
    if (!record) return null;
    return recordToState(record);
  }

  public getAllActiveObligations(): ObligationRecord[] {
    if (!this.stmtSelectAllActive) this.prepareStatements();
    const rows = this.stmtSelectAllActive!.all();
    return rows.map(rowToObligationRecord);
  }

  public getAllActiveStates(): ObligationState[] {
    return this.getAllActiveObligations().map(recordToState);
  }

  public deleteObligation(id: string): void {
    if (!this.stmtDeleteObligation) this.prepareStatements();
    const cleanId = id.toLowerCase();
    runInTransaction(this.db, () => {
      this.stmtDeleteObligation!.run(id, id, cleanId, cleanId);
    });
  }

  public query(filter?: ObligationQueryFilter): ObligationRecord[] {
    let sql = 'SELECT * FROM obligations WHERE 1=1';
    const params: (string | number)[] = [];

    if (filter?.protocol) {
      sql += ' AND protocol = ?';
      params.push(filter.protocol);
    }
    if (filter?.isActive !== undefined) {
      sql += ' AND is_active = ?';
      params.push(filter.isActive ? 1 : 0);
    }
    if (filter?.isLiquidatable !== undefined) {
      sql += ' AND is_liquidatable = ?';
      params.push(filter.isLiquidatable ? 1 : 0);
    }
    if (filter?.maxHealthFactor !== undefined) {
      sql += ' AND health_factor <= ?';
      params.push(filter.maxHealthFactor);
    }
    if (filter?.minDebtUsd !== undefined) {
      sql += ' AND debt_usd >= ?';
      params.push(filter.minDebtUsd);
    }

    sql += ' ORDER BY health_factor ASC';

    if (filter?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
      if (filter?.offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(filter.offset);
      }
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);
    return rows.map(rowToObligationRecord);
  }

  public queryStates(filter?: ObligationQueryFilter): ObligationState[] {
    return this.query(filter).map(recordToState);
  }

  public getRawDatabase(): DatabaseSync {
    return this.db;
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore if already closed
    }
  }
}
