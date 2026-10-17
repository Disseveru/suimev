import { DatabaseSync, type DatabaseSyncOptions } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export interface DatabaseConfig {
  dbPath?: string;
  foreignKeys?: boolean;
  journalMode?: 'WAL' | 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'OFF';
  busyTimeoutMs?: number;
  openOptions?: DatabaseSyncOptions;
}

export const DEFAULT_DB_PATH = process.env.SQLITE_DB_PATH || './data/liquidator.db';
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * Creates and initializes a DatabaseSync instance with mandated SQLite pragmas:
 * - foreign_keys = ON
 * - journal_mode = WAL
 * - busy_timeout = 5000
 */
export function createDatabaseSync(config?: DatabaseConfig | string): DatabaseSync {
  const dbPath = typeof config === 'string' ? config : (config?.dbPath ?? (process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH));
  const foreignKeys = typeof config === 'object' && config.foreignKeys !== undefined ? config.foreignKeys : true;
  const journalMode = (typeof config === 'object' && config?.journalMode) || 'WAL';
  const busyTimeoutMs = (typeof config === 'object' && config?.busyTimeoutMs) || DEFAULT_BUSY_TIMEOUT_MS;
  const openOptions = typeof config === 'object' ? config.openOptions : undefined;

  // If path is a file path (not :memory:), ensure parent directory exists
  if (dbPath !== ':memory:') {
    const parentDir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath, {
    enableForeignKeyConstraints: foreignKeys,
    timeout: busyTimeoutMs,
    ...openOptions,
  });

  // Apply SQLite pragmas explicitly
  if (foreignKeys) {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  db.exec(`PRAGMA journal_mode = ${journalMode};`);
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);

  return db;
}

/**
 * Helper to execute a callback inside a SQLite transaction (BEGIN IMMEDIATE / COMMIT / ROLLBACK)
 */
export function runInTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback failure if transaction was already aborted
    }
    throw err;
  }
}

/**
 * Database connection manager for lifecycle management
 */
export class DatabaseManager {
  private db: DatabaseSync | null = null;
  private readonly config: DatabaseConfig;

  constructor(config?: DatabaseConfig | string) {
    if (typeof config === 'string') {
      this.config = { dbPath: config };
    } else {
      this.config = config ?? {};
    }
  }

  public getDatabase(): DatabaseSync {
    if (!this.db) {
      this.db = createDatabaseSync(this.config);
    }
    return this.db;
  }

  public isConnected(): boolean {
    return this.db !== null;
  }

  public close(): void {
    if (this.db) {
      try {
        this.db.close();
      } finally {
        this.db = null;
      }
    }
  }

  public transaction<T>(fn: () => T): T {
    return runInTransaction(this.getDatabase(), fn);
  }
}
