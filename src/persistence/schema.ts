import type { DatabaseSync } from 'node:sqlite';

/**
 * SQL DDL Statements for Schema Initialization and Migrations
 */
export const SCHEMA_DDL = `
-- Main Obligations Table
CREATE TABLE IF NOT EXISTS obligations (
    id TEXT PRIMARY KEY,
    protocol TEXT NOT NULL CHECK (protocol IN ('scallop', 'navi')),
    borrower TEXT NOT NULL,
    obligation_id TEXT NOT NULL,
    health_factor REAL NOT NULL DEFAULT 999.0,
    collateral_usd REAL NOT NULL DEFAULT 0.0,
    debt_usd REAL NOT NULL DEFAULT 0.0,
    updated_at INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    owner_address TEXT,
    lt_collateral_usd REAL NOT NULL DEFAULT 0.0,
    is_liquidatable INTEGER NOT NULL DEFAULT 0,
    collaterals_json TEXT,
    debts_json TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL
);

-- Indices on obligations
CREATE INDEX IF NOT EXISTS idx_obligations_protocol ON obligations(protocol);
CREATE INDEX IF NOT EXISTS idx_obligations_hf ON obligations(health_factor);
CREATE INDEX IF NOT EXISTS idx_obligations_is_active ON obligations(is_active);
CREATE INDEX IF NOT EXISTS idx_obligations_borrower ON obligations(borrower);
CREATE INDEX IF NOT EXISTS idx_obligations_obligation_id ON obligations(obligation_id);
CREATE INDEX IF NOT EXISTS idx_obligations_updated_at ON obligations(updated_at);

-- Normalized Collaterals Table
CREATE TABLE IF NOT EXISTS collaterals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obligation_id TEXT NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
    coin_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    amount TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    value_usd REAL NOT NULL,
    liquidation_threshold REAL NOT NULL DEFAULT 0.0,
    updated_at INTEGER NOT NULL,
    UNIQUE(obligation_id, coin_type)
);

CREATE INDEX IF NOT EXISTS idx_collaterals_obligation_id ON collaterals(obligation_id);
CREATE INDEX IF NOT EXISTS idx_collaterals_coin_type ON collaterals(coin_type);

-- Normalized Debts Table
CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obligation_id TEXT NOT NULL REFERENCES obligations(id) ON DELETE CASCADE,
    coin_type TEXT NOT NULL,
    symbol TEXT NOT NULL,
    amount TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    value_usd REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(obligation_id, coin_type)
);

CREATE INDEX IF NOT EXISTS idx_debts_obligation_id ON debts(obligation_id);
CREATE INDEX IF NOT EXISTS idx_debts_coin_type ON debts(coin_type);
`;

/**
 * Initializes the SQLite database schema
 */
export function initSchema(db: DatabaseSync): void {
  db.exec(SCHEMA_DDL);
}
