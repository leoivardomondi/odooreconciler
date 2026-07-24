import fs from 'fs';
import path from 'path';
import { env } from '../src/utils/env';

const sqlitePath = path.resolve(env.SQLITE_PATH);
const outputPath = path.resolve('storage/mysql-import.sql');
type SqliteDatabase = {
  all(
    sql: string,
    params: unknown[],
    callback: (error: Error | null, rows: unknown[]) => void,
  ): void;
  get(
    sql: string,
    params: unknown[],
    callback: (error: Error | null, row: unknown) => void,
  ): void;
};

function getSqlite3Module(): {
  Database: new (
    filename: string,
    callback?: (error: Error | null) => void,
  ) => SqliteDatabase;
} {
  try {
    return require('sqlite3') as {
      Database: new (
        filename: string,
        callback?: (error: Error | null) => void,
      ) => SqliteDatabase;
    };
  } catch (error) {
    throw new Error(
      'The sqlite3 runtime could not be loaded for export. Install a compatible sqlite3 build first.',
      { cause: error },
    );
  }
}

function openSqliteDatabase(databasePath: string): Promise<SqliteDatabase> {
  return new Promise((resolve, reject) => {
    const { Database } = getSqlite3Module();
    const db = new Database(databasePath, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function sqliteAll<T extends Record<string, unknown>>(
  db: SqliteDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve((rows || []) as T[]);
    });
  });
}

function sqliteGet<T extends Record<string, unknown>>(
  db: SqliteDatabase,
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row as T | undefined);
    });
  });
}

function normalizeMysqlDateTime(value: string): string {
  const isoUtcMatch = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?Z$/,
  );
  if (isoUtcMatch) {
    return `${isoUtcMatch[1]} ${isoUtcMatch[2]}`;
  }

  const isoOffsetMatch = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,6})?[+-]\d{2}:\d{2}$/,
  );
  if (isoOffsetMatch) {
    return `${isoOffsetMatch[1]} ${isoOffsetMatch[2]}`;
  }

  return value;
}

function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  const normalizedValue =
    typeof value === 'string' ? normalizeMysqlDateTime(value) : String(value);

  return `'${normalizedValue
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u0000/g, '')}'`;
}

async function getTableColumns(db: SqliteDatabase, tableName: string): Promise<string[]> {
  const rows = await sqliteAll<{ name: string }>(db, `PRAGMA table_info(${tableName})`);
  return rows.map((row) => row.name);
}

async function tableExists(db: SqliteDatabase, tableName: string): Promise<boolean> {
  const row = await sqliteGet<{ name?: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    [tableName],
  );
  return Boolean(row?.name);
}

async function exportTable(db: SqliteDatabase, tableName: string): Promise<string[]> {
  if (!(await tableExists(db, tableName))) {
    return [];
  }

  const columns = await getTableColumns(db, tableName);
  const rows = await sqliteAll<Record<string, unknown>>(db, `SELECT * FROM ${tableName}`);

  if (rows.length === 0) {
    return [];
  }

  const insertPrefix = `INSERT INTO \`${tableName}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES`;
  return rows.map((row) => {
    const values = columns.map((column) => escapeSqlValue(row[column]));
    return `${insertPrefix} (${values.join(', ')});`;
  });
}

function buildSchema(): string {
  return `
CREATE TABLE IF NOT EXISTS \`settings\` (
  \`id\` INT PRIMARY KEY,
  \`odoo_base_url\` TEXT NOT NULL,
  \`odoo_database\` TEXT NOT NULL,
  \`odoo_username\` TEXT NOT NULL,
  \`odoo_api_key_encrypted\` TEXT NOT NULL,
  \`field_mapping_json\` LONGTEXT NOT NULL,
  \`parser_config_json\` LONGTEXT NOT NULL,
  \`scheduler_config_json\` LONGTEXT NOT NULL,
  \`stock_config_json\` LONGTEXT NOT NULL,
  \`connection_status\` VARCHAR(32) NOT NULL DEFAULT 'not_configured',
  \`connection_checked_at\` DATETIME NULL,
  \`connection_message\` TEXT NULL,
  \`connection_version\` TEXT NULL,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`logs\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`history_id\` VARCHAR(64) NULL,
  \`level\` VARCHAR(16) NOT NULL,
  \`message\` TEXT NOT NULL,
  \`context_json\` LONGTEXT NOT NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`history\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`order_id\` INT NOT NULL,
  \`order_name\` TEXT NOT NULL,
  \`attachment_id\` INT NOT NULL,
  \`attachment_name\` TEXT NOT NULL,
  \`status\` VARCHAR(64) NOT NULL,
  \`summary\` TEXT NULL,
  \`error_message\` TEXT NULL,
  \`extracted_result_id\` VARCHAR(64) NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`computed_signature\` TEXT NULL,
  \`stored_signature\` TEXT NULL,
  \`signature_comparison\` VARCHAR(32) NULL,
  \`send_skipped\` TINYINT(1) NOT NULL DEFAULT 0,
  \`signature_written\` TINYINT(1) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS \`extracted_results\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`history_id\` VARCHAR(64) NOT NULL,
  \`order_id\` INT NOT NULL,
  \`order_name\` TEXT NOT NULL,
  \`attachment_id\` INT NOT NULL,
  \`attachment_name\` TEXT NOT NULL,
  \`result_json\` LONGTEXT NOT NULL,
  \`raw_text\` LONGTEXT NOT NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`pdf_signature\` TEXT NULL
);

CREATE TABLE IF NOT EXISTS \`odoo_model_fields_cache\` (
  \`model_name\` VARCHAR(191) PRIMARY KEY,
  \`fields_json\` LONGTEXT NOT NULL,
  \`fetched_at\` DATETIME NULL
);

CREATE TABLE IF NOT EXISTS \`scheduler_runs\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`status\` VARCHAR(64) NOT NULL,
  \`trigger_source\` VARCHAR(32) NOT NULL,
  \`started_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`finished_at\` DATETIME NULL,
  \`scanned_count\` INT NOT NULL DEFAULT 0,
  \`processed_count\` INT NOT NULL DEFAULT 0,
  \`skipped_count\` INT NOT NULL DEFAULT 0,
  \`failed_count\` INT NOT NULL DEFAULT 0,
  \`summary\` TEXT NULL,
  \`error_message\` TEXT NULL,
  \`context_json\` LONGTEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS \`scheduler_runtime_state\` (
  \`id\` INT PRIMARY KEY,
  \`lock_run_id\` VARCHAR(64) NULL,
  \`lock_acquired_at\` DATETIME NULL,
  \`last_successful_run_id\` VARCHAR(64) NULL,
  \`last_successful_finished_at\` DATETIME NULL,
  \`last_checkpoint_at\` DATETIME NULL,
  \`last_error_run_id\` VARCHAR(64) NULL,
  \`last_error_message\` TEXT NULL,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`stock_processed_items\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`order_id\` INT NOT NULL,
  \`extraction_signature\` VARCHAR(255) NOT NULL,
  \`variant_id\` INT NOT NULL,
  \`normalized_color\` VARCHAR(255) NOT NULL DEFAULT '',
  \`quantity_added_meters\` INT NOT NULL DEFAULT 0,
  \`history_id\` VARCHAR(64) NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`stock_processing_locks\` (
  \`lock_key\` VARCHAR(255) PRIMARY KEY,
  \`order_id\` INT NOT NULL,
  \`extraction_signature\` VARCHAR(255) NOT NULL,
  \`acquired_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`stock_reversed_items\` (
  \`processed_item_id\` VARCHAR(64) PRIMARY KEY,
  \`order_id\` INT NOT NULL,
  \`reversed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`auth_login_challenges\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`email\` VARCHAR(255) NOT NULL,
  \`code_hash\` VARCHAR(255) NOT NULL,
  \`redirect_path\` VARCHAR(1024) NOT NULL,
  \`expires_at\` DATETIME NOT NULL,
  \`attempts_remaining\` INT NOT NULL DEFAULT 5,
  \`consumed_at\` DATETIME NULL,
  \`requested_ip\` VARCHAR(255) NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`auth_sessions\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`email\` VARCHAR(255) NOT NULL,
  \`role\` VARCHAR(32) NOT NULL DEFAULT 'user',
  \`csrf_token\` VARCHAR(255) NOT NULL,
  \`user_agent_hash\` VARCHAR(255) NOT NULL DEFAULT '',
  \`ip_address\` VARCHAR(255) NULL,
  \`expires_at\` DATETIME NOT NULL,
  \`revoked_at\` DATETIME NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`last_seen_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`auth_attempts\` (
  \`id\` VARCHAR(64) PRIMARY KEY,
  \`scope\` VARCHAR(64) NOT NULL,
  \`email\` VARCHAR(255) NULL,
  \`ip_address\` VARCHAR(255) NULL,
  \`success\` TINYINT(1) NOT NULL DEFAULT 0,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`auth_approved_users\` (
  \`email\` VARCHAR(255) PRIMARY KEY,
  \`role\` VARCHAR(32) NOT NULL DEFAULT 'user',
  \`active\` TINYINT(1) NOT NULL DEFAULT 1,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`.trim();
}

async function main() {
  const db = await openSqliteDatabase(sqlitePath);

  const tables = [
    'settings',
    'logs',
    'history',
    'extracted_results',
    'odoo_model_fields_cache',
    'scheduler_runs',
    'scheduler_runtime_state',
    'stock_processed_items',
    'stock_processing_locks',
    'stock_reversed_items',
    'auth_login_challenges',
    'auth_sessions',
    'auth_attempts',
    'auth_approved_users',
  ];

  const lines: string[] = [
    '-- MySQL import generated from SQLite app.db',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    buildSchema(),
    ...(
      await Promise.all(
        tables.map(async (table) => [
          `DELETE FROM \`${table}\`;`,
          ...(await exportTable(db, table)),
          '',
        ]),
      )
    ).flat(),
    'SET FOREIGN_KEY_CHECKS = 1;',
    '',
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`MySQL import file written to ${outputPath}`);
}

void main().catch((error) => {
  console.error('MySQL export failed:', error);
  process.exit(1);
});
