"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRuntimeDatabaseConfig = getRuntimeDatabaseConfig;
exports.isDatabaseInstallerEnabled = isDatabaseInstallerEnabled;
exports.saveRuntimeDatabaseConfig = saveRuntimeDatabaseConfig;
exports.getDatabaseDialect = getDatabaseDialect;
exports.ensureDatabase = ensureDatabase;
exports.queryAll = queryAll;
exports.queryOne = queryOne;
exports.execute = execute;
exports.ensureDatabaseIndexes = ensureDatabaseIndexes;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const promise_1 = __importDefault(require("mysql2/promise"));
const env_1 = require("../utils/env");
const crypto_1 = require("../utils/crypto");
const runtimeConfigPath = env_1.env.APP_RUNTIME_CONFIG_PATH;
let sqliteDb = null;
let mysqlPool = null;
let ensuredDialect = null;
let ensureDatabasePromise = null;
function getDatabaseInitTimeoutMs() {
    const configured = Number(env_1.env.DB_INIT_TIMEOUT_MS || 30000);
    return Number.isFinite(configured) && configured > 0 ? configured : 30000;
}
async function withDatabaseOperationTimeout(label, operation, timeoutMs = getDatabaseInitTimeoutMs()) {
    let timeoutHandle = null;
    try {
        return await Promise.race([
            operation(),
            new Promise((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`${label} did not finish within ${timeoutMs}ms.`));
                }, timeoutMs);
            }),
        ]);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} failed: ${detail}`, { cause: error });
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
function describeDatabaseConfig(config) {
    if (config.driver === 'sqlite') {
        return `driver=sqlite sqlitePath=${config.sqlitePath}`;
    }
    return [
        'driver=mysql',
        `host=${config.mysqlHost || '[missing]'}`,
        `port=${config.mysqlPort || '[missing]'}`,
        `database=${config.mysqlDatabase || '[missing]'}`,
        `user=${config.mysqlUser || '[missing]'}`,
        `connectionLimit=${config.mysqlConnectionLimit || '[missing]'}`,
    ].join(' ');
}
function describeDatabaseError(error) {
    if (!error || typeof error !== 'object') {
        return String(error || '');
    }
    const detail = error;
    return [
        detail.code ? `code=${detail.code}` : '',
        detail.errno ? `errno=${detail.errno}` : '',
        detail.sqlState ? `sqlState=${detail.sqlState}` : '',
        detail.sqlMessage ? `sqlMessage=${detail.sqlMessage}` : '',
        detail.message ? `message=${detail.message}` : '',
    ].filter(Boolean).join(' ');
}
function validateDatabaseConfig(config) {
    if (config.driver === 'mysql') {
        const missing = [
            ['DB_HOST', config.mysqlHost],
            ['DB_USER', config.mysqlUser],
            ['DB_NAME', config.mysqlDatabase],
        ]
            .filter(([, value]) => !String(value || '').trim())
            .map(([label]) => label);
        if (missing.length > 0) {
            throw new Error(`MySQL is selected but required environment variable(s) are missing: ${missing.join(', ')}. ` +
                'Set DB_CLIENT=mysql, DB_HOST, DB_PORT, DB_NAME, DB_USER, and DB_PASSWORD in cPanel.');
        }
        const port = Number(config.mysqlPort || 3306);
        if (!Number.isInteger(port) || port <= 0) {
            throw new Error(`DB_PORT/MYSQL_PORT must be a positive integer. Received "${config.mysqlPort}".`);
        }
    }
    if (config.driver === 'sqlite' && !config.sqlitePath.trim()) {
        throw new Error('SQLite is selected but SQLITE_PATH is missing.');
    }
}
function getSqlite3Module() {
    try {
        return require('sqlite3');
    }
    catch (error) {
        throw new Error('SQLite mode is selected, but the sqlite3 runtime could not be loaded on this server. Use DB_CLIENT=mysql on this host or install a compatible sqlite3 build.', { cause: error });
    }
}
function readRuntimeConfigFile() {
    if (!fs_1.default.existsSync(runtimeConfigPath)) {
        return null;
    }
    const raw = fs_1.default.readFileSync(runtimeConfigPath, 'utf8').trim();
    if (!raw) {
        return null;
    }
    return JSON.parse(raw);
}
function buildRuntimeDatabaseConfig() {
    const fileConfig = readRuntimeConfigFile()?.database;
    const mysqlHost = env_1.env.MYSQL_HOST.trim() || fileConfig?.mysqlHost || '';
    const mysqlPort = env_1.env.MYSQL_PORT.trim() || fileConfig?.mysqlPort || '3306';
    const mysqlUser = env_1.env.MYSQL_USER.trim() || fileConfig?.mysqlUser || '';
    let mysqlPassword = env_1.env.MYSQL_PASSWORD;
    if (!mysqlPassword && fileConfig?.mysqlPasswordEncrypted) {
        try {
            mysqlPassword = (0, crypto_1.decryptSecret)(fileConfig.mysqlPasswordEncrypted);
        }
        catch (error) {
            throw new Error('Stored runtime MySQL password could not be decrypted. Set DB_PASSWORD in .env/cPanel environment variables with the current password, or delete storage/runtime-config.json and restart the app.', { cause: error });
        }
    }
    const mysqlDatabase = env_1.env.MYSQL_DATABASE.trim() || fileConfig?.mysqlDatabase || '';
    const mysqlConnectionLimit = env_1.env.MYSQL_CONNECTION_LIMIT.trim() || fileConfig?.mysqlConnectionLimit || '10';
    const sqlitePath = env_1.env.SQLITE_PATH || fileConfig?.sqlitePath || env_1.env.SQLITE_PATH;
    const requestedDriver = (env_1.env.DB_CLIENT || fileConfig?.driver || 'mysql').trim().toLowerCase();
    const driver = requestedDriver === 'mysql' ? 'mysql' : 'sqlite';
    return {
        driver,
        sqlitePath,
        mysqlHost,
        mysqlPort,
        mysqlUser,
        mysqlPassword,
        mysqlDatabase,
        mysqlConnectionLimit,
    };
}
function getRuntimeDatabaseConfig() {
    return buildRuntimeDatabaseConfig();
}
function isDatabaseInstallerEnabled() {
    return env_1.env.ENABLE_DATABASE_INSTALLER === 'true';
}
function saveRuntimeDatabaseConfig(input) {
    const payload = {
        database: {
            driver: input.driver,
            sqlitePath: input.sqlitePath,
            mysqlHost: input.mysqlHost,
            mysqlPort: input.mysqlPort,
            mysqlUser: input.mysqlUser,
            mysqlPasswordEncrypted: input.mysqlPassword ? (0, crypto_1.encryptSecret)(input.mysqlPassword) : '',
            mysqlDatabase: input.mysqlDatabase,
            mysqlConnectionLimit: input.mysqlConnectionLimit,
        },
    };
    fs_1.default.mkdirSync(path_1.default.dirname(runtimeConfigPath), { recursive: true });
    fs_1.default.writeFileSync(runtimeConfigPath, JSON.stringify(payload, null, 2), 'utf8');
    ensuredDialect = null;
    if (mysqlPool) {
        void mysqlPool.end();
        mysqlPool = null;
    }
    sqliteDb = null;
}
function normalizeSqliteParams(params) {
    return params.map((value) => typeof value === 'boolean' ? (value ? 1 : 0) : value);
}
function openSqliteDatabase(databasePath) {
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
function sqliteExec(db, sql) {
    return new Promise((resolve, reject) => {
        db.exec(sql, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}
function sqliteAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, normalizeSqliteParams(params), (error, rows) => {
            if (error) {
                reject(error);
                return;
            }
            resolve((rows || []));
        });
    });
}
function sqliteRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, normalizeSqliteParams(params), function (error) {
            if (error) {
                reject(error);
                return;
            }
            resolve({
                affectedRows: this.changes ?? 0,
                insertId: typeof this.lastID === 'number' ? this.lastID : null,
            });
        });
    });
}
async function getSqliteDb(config = getRuntimeDatabaseConfig()) {
    if (!sqliteDb) {
        const databasePath = path_1.default.resolve(config.sqlitePath);
        fs_1.default.mkdirSync(path_1.default.dirname(databasePath), { recursive: true });
        sqliteDb = await openSqliteDatabase(databasePath);
        await sqliteExec(sqliteDb, 'PRAGMA foreign_keys = ON;');
    }
    return sqliteDb;
}
async function getMysqlPool(config = getRuntimeDatabaseConfig()) {
    if (!mysqlPool) {
        mysqlPool = promise_1.default.createPool({
            host: config.mysqlHost,
            port: Number(config.mysqlPort || 3306),
            user: config.mysqlUser,
            password: config.mysqlPassword,
            database: config.mysqlDatabase,
            waitForConnections: true,
            connectionLimit: Math.max(1, Number(config.mysqlConnectionLimit || 10)),
            // Keep idle connections alive and recycle them before MariaDB kills them.
            // MariaDB wait_timeout is typically 28800s (8h); we ping every 60s to
            // prevent the server from closing idle sockets unexpectedly, which would
            // cause the next query on that connection to hang until connectTimeout.
            enableKeepAlive: true,
            keepAliveInitialDelay: 10000, // First keepalive after 10s of inactivity
            // Retire connections that have sat idle in the pool too long.
            // Must be well below MariaDB wait_timeout (28800s) so the pool
            // re-establishes a fresh connection instead of reusing a dead one.
            idleTimeout: 60000, // Release connections idle > 60s
            maxIdle: Math.max(1, Math.floor(Math.max(1, Number(config.mysqlConnectionLimit || 10)) / 2)),
            charset: 'utf8mb4',
            connectTimeout: 10000,
        });
    }
    return mysqlPool;
}
function getDatabaseDialect() {
    return getRuntimeDatabaseConfig().driver;
}
async function mysqlQuery(pool, label, sql, params) {
    return withDatabaseOperationTimeout(label, () => (params ? pool.query(sql, params) : pool.query(sql)));
}
async function mysqlExecute(pool, label, sql, params) {
    return withDatabaseOperationTimeout(label, () => (params ? pool.execute(sql, params) : pool.execute(sql)));
}
async function hasColumnSqlite(db, tableName, columnName) {
    const rows = await sqliteAll(db, `PRAGMA table_info(${tableName})`);
    return rows.some((row) => row.name === columnName);
}
async function ensureColumnSqlite(db, tableName, columnName, definition) {
    if (!(await hasColumnSqlite(db, tableName, columnName))) {
        await sqliteExec(db, `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}
async function hasColumnMysql(pool, tableName, columnName, schemaName) {
    const [rows] = await mysqlQuery(pool, `Checking MySQL column ${tableName}.${columnName}`, `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ?
      LIMIT 1
    `, [schemaName, tableName, columnName]);
    return Array.isArray(rows) && rows.length > 0;
}
async function ensureColumnMysql(pool, tableName, columnName, definition, schemaName) {
    if (!(await hasColumnMysql(pool, tableName, columnName, schemaName))) {
        await mysqlExecute(pool, `Adding MySQL column ${tableName}.${columnName}`, `ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
    }
}
async function ensureSqliteDatabase(config) {
    const db = await getSqliteDb(config);
    await sqliteExec(db, `
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      odoo_base_url TEXT NOT NULL DEFAULT '',
      odoo_database TEXT NOT NULL DEFAULT '',
      odoo_username TEXT NOT NULL DEFAULT '',
      odoo_api_key_encrypted TEXT NOT NULL DEFAULT '',
      odoo_shop_floor_password_encrypted TEXT NOT NULL DEFAULT '',
      field_mapping_json TEXT NOT NULL DEFAULT '{}',
      parser_config_json TEXT NOT NULL DEFAULT '{}',
      ai_config_json TEXT NOT NULL DEFAULT '{}',
      scheduler_config_json TEXT NOT NULL DEFAULT '{}',
      stock_config_json TEXT NOT NULL DEFAULT '{}',
      mail_config_json TEXT NOT NULL DEFAULT '{}',
      payroll_bridge_config_json TEXT NOT NULL DEFAULT '{}',
      connection_status TEXT NOT NULL DEFAULT 'not_configured',
      connection_checked_at TEXT,
      connection_message TEXT,
      connection_version TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS shop_floor_feature_flags (
      feature_key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      history_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL,
      order_name TEXT NOT NULL,
      attachment_id INTEGER NOT NULL,
      attachment_name TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      error_message TEXT,
      extracted_result_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS extracted_results (
      id TEXT PRIMARY KEY,
      history_id TEXT NOT NULL,
      order_id INTEGER NOT NULL,
      order_name TEXT NOT NULL,
      attachment_id INTEGER NOT NULL,
      attachment_name TEXT NOT NULL,
      result_json TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pdf_signature TEXT,
      FOREIGN KEY (history_id) REFERENCES history(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS odoo_model_fields_cache (
      model_name TEXT PRIMARY KEY,
      fields_json TEXT NOT NULL DEFAULT '[]',
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scheduler_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      scanned_count INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      error_message TEXT,
      context_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS scheduler_runtime_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lock_run_id TEXT,
      lock_acquired_at TEXT,
      stop_requested_at TEXT,
      last_successful_run_id TEXT,
      last_successful_finished_at TEXT,
      last_checkpoint_at TEXT,
      last_error_run_id TEXT,
      last_error_message TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO scheduler_runtime_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS stock_processed_items (
      id TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL,
      extraction_signature TEXT NOT NULL,
      variant_id INTEGER NOT NULL,
      normalized_color TEXT NOT NULL DEFAULT '',
      quantity_added_meters INTEGER NOT NULL DEFAULT 0,
      history_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_processing_locks (
      lock_key TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL,
      extraction_signature TEXT NOT NULL,
      acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_reversed_items (
      processed_item_id TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL,
      reversed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS po_bill_processing_locks (
      attachment_id INTEGER PRIMARY KEY,
      acquired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS po_bill_unreadable_notifications (
      attachment_id INTEGER PRIMARY KEY,
      attachment_name TEXT NOT NULL DEFAULT '',
      notified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ai_credential_failure_notifications (
      attachment_id INTEGER NOT NULL,
      failure_signature TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      notified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (attachment_id, failure_signature)
    );

    CREATE TABLE IF NOT EXISTS po_bill_processed_documents (
      attachment_id INTEGER PRIMARY KEY,
      attachment_name TEXT NOT NULL DEFAULT '',
      document_id INTEGER,
      folder_name TEXT,
      company_name TEXT,
      purchase_order_id INTEGER,
      purchase_order_name TEXT,
      vendor_bill_id INTEGER,
      vendor_bill_name TEXT,
      invoice_fingerprint TEXT,
      invoice_number TEXT,
      invoice_vendor TEXT,
      invoice_total REAL,
      status TEXT NOT NULL DEFAULT 'processed',
      mode TEXT,
      summary TEXT,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      last_skipped_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mpesa_statement_batches (
      id TEXT PRIMARY KEY,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'needs_review',
      transaction_count INTEGER NOT NULL DEFAULT 0,
      matched_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      raw_text_preview TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS mpesa_transactions (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      row_index INTEGER NOT NULL DEFAULT 0,
      transaction_date TEXT,
      completion_time TEXT,
      receipt_number TEXT,
      details TEXT NOT NULL DEFAULT '',
      paid_in REAL,
      withdrawn REAL,
      balance REAL,
      amount REAL,
      direction TEXT NOT NULL DEFAULT 'unknown',
      counterparty TEXT,
      phone_number TEXT,
      transaction_type TEXT NOT NULL DEFAULT 'unknown',
      matched_po_id INTEGER,
      matched_po_name TEXT,
      match_confidence REAL,
      user_category TEXT,
      user_supplier TEXT,
      review_status TEXT NOT NULL DEFAULT 'new',
      notes TEXT,
      ai_notes TEXT,
      candidates_json TEXT NOT NULL DEFAULT '[]',
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES mpesa_statement_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mpesa_extraction_jobs (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      previous_stored_filename TEXT,
      error_message TEXT,
      transaction_count INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (batch_id) REFERENCES mpesa_statement_batches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mpesa_extraction_jobs_status
      ON mpesa_extraction_jobs(status, created_at);

    CREATE TABLE IF NOT EXISTS mpesa_category_training_rules (
      id TEXT PRIMARY KEY,
      match_scope TEXT NOT NULL DEFAULT 'any',
      match_text TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      sample_text TEXT,
      confidence REAL NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      hit_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(match_scope, match_text, category)
    );

    CREATE TABLE IF NOT EXISTS auth_login_challenges (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      redirect_path TEXT NOT NULL DEFAULT '/dashboard',
      expires_at TEXT NOT NULL,
      attempts_remaining INTEGER NOT NULL DEFAULT 5,
      consumed_at TEXT,
      requested_ip TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      apps TEXT,
      csrf_token TEXT NOT NULL,
      user_agent_hash TEXT NOT NULL DEFAULT '',
      ip_address TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_attempts (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      email TEXT,
      ip_address TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_login_events (
      id TEXT PRIMARY KEY,
      email TEXT,
      role TEXT,
      event_type TEXT NOT NULL,
      auth_method TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT,
      location_label TEXT,
      location_source TEXT,
      user_agent TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_approved_users (
      email TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'user',
      apps TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_user_profiles (
      email TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      odoo_employee_id INTEGER,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_product_mirror (
      product_id INTEGER PRIMARY KEY,
      product_name TEXT NOT NULL,
      available_qty REAL NOT NULL DEFAULT 0,
      free_qty REAL NOT NULL DEFAULT 0,
      forecast_qty REAL NOT NULL DEFAULT 0,
      incoming_qty REAL NOT NULL DEFAULT 0,
      outgoing_qty REAL NOT NULL DEFAULT 0,
      warehouse_id INTEGER,
      synced_at TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      sync_error TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS staff_onboarding_applications (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      personal_email TEXT NOT NULL,
      mobile_phone TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      odoo_applicant_id INTEGER,
      odoo_employee_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS board_intake_queue (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      partner_id INTEGER NOT NULL,
      customer_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      actor_name TEXT NOT NULL,
      actor_email TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      odoo_stock_quantity REAL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      next_retry_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      synced_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_board_intake_queue_status ON board_intake_queue(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_staff_onboarding_status
      ON staff_onboarding_applications(status, submitted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_onboarding_odoo_applicant
      ON staff_onboarding_applications(odoo_applicant_id);

    CREATE INDEX IF NOT EXISTS idx_logs_history_id ON logs(history_id);
    CREATE INDEX IF NOT EXISTS idx_history_order_id ON history(order_id);
    CREATE INDEX IF NOT EXISTS idx_extracted_results_history_id ON extracted_results(history_id);
    CREATE INDEX IF NOT EXISTS idx_scheduler_runs_started_at ON scheduler_runs(started_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_processed_unique
      ON stock_processed_items(order_id, extraction_signature, variant_id);
    CREATE INDEX IF NOT EXISTS idx_stock_processed_order_signature
      ON stock_processed_items(order_id, extraction_signature);
    CREATE INDEX IF NOT EXISTS idx_stock_locks_order_signature
      ON stock_processing_locks(order_id, extraction_signature);
    CREATE INDEX IF NOT EXISTS idx_stock_reversed_order
      ON stock_reversed_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_po_bill_processed_status
      ON po_bill_processed_documents(status, processed_at);
    CREATE INDEX IF NOT EXISTS idx_mpesa_batches_created
      ON mpesa_statement_batches(created_at);
    CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_batch
      ON mpesa_transactions(batch_id, row_index);
    CREATE INDEX IF NOT EXISTS idx_mpesa_transactions_receipt
      ON mpesa_transactions(receipt_number);
    CREATE INDEX IF NOT EXISTS idx_auth_login_challenges_email
      ON auth_login_challenges(email, created_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_email
      ON auth_sessions(email, expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_attempts_scope
      ON auth_attempts(scope, created_at);
    CREATE INDEX IF NOT EXISTS idx_auth_login_events_created
      ON auth_login_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_auth_login_events_email
      ON auth_login_events(email, created_at);
  `);
    await ensureColumnSqlite(db, 'settings', 'scheduler_config_json', `TEXT NOT NULL DEFAULT '{}'`);
    await ensureColumnSqlite(db, 'settings', 'odoo_shop_floor_password_encrypted', `TEXT NOT NULL DEFAULT ''`);
    await ensureColumnSqlite(db, 'settings', 'ai_config_json', `TEXT NOT NULL DEFAULT '{}'`);
    await ensureColumnSqlite(db, 'settings', 'stock_config_json', `TEXT NOT NULL DEFAULT '{}'`);
    await ensureColumnSqlite(db, 'settings', 'mail_config_json', `TEXT NOT NULL DEFAULT '{}'`);
    await ensureColumnSqlite(db, 'settings', 'payroll_bridge_config_json', `TEXT NOT NULL DEFAULT '{}'`);
    await ensureColumnSqlite(db, 'history', 'computed_signature', 'TEXT');
    await ensureColumnSqlite(db, 'history', 'stored_signature', 'TEXT');
    await ensureColumnSqlite(db, 'history', 'signature_comparison', 'TEXT');
    await ensureColumnSqlite(db, 'history', 'send_skipped', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumnSqlite(db, 'history', 'signature_written', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumnSqlite(db, 'extracted_results', 'pdf_signature', 'TEXT');
    await ensureColumnSqlite(db, 'auth_sessions', 'role', `TEXT NOT NULL DEFAULT 'user'`);
    await ensureColumnSqlite(db, 'auth_sessions', 'apps', 'TEXT');
    await ensureColumnSqlite(db, 'auth_approved_users', 'password_hash', 'TEXT');
    await ensureColumnSqlite(db, 'auth_approved_users', 'apps', 'TEXT');
    await ensureColumnSqlite(db, 'scheduler_runtime_state', 'last_checkpoint_at', 'TEXT');
    await ensureColumnSqlite(db, 'scheduler_runtime_state', 'stop_requested_at', 'TEXT');
    await ensureColumnSqlite(db, 'scheduler_runtime_state', 'last_error_run_id', 'TEXT');
    await ensureColumnSqlite(db, 'scheduler_runtime_state', 'last_error_message', 'TEXT');
    await ensureColumnSqlite(db, 'po_bill_processed_documents', 'attempt_count', 'INTEGER NOT NULL DEFAULT 1');
    await ensureColumnSqlite(db, 'po_bill_processed_documents', 'last_skipped_at', 'TEXT');
    await ensureColumnSqlite(db, 'po_bill_processed_documents', 'invoice_fingerprint', 'TEXT');
    await ensureColumnSqlite(db, 'po_bill_processed_documents', 'invoice_number', 'TEXT');
    await ensureColumnSqlite(db, 'po_bill_processed_documents', 'invoice_vendor', 'TEXT');
    await ensureColumnSqlite(db, 'po_bill_processed_documents', 'invoice_total', 'REAL');
    await ensureColumnSqlite(db, 'mpesa_transactions', 'ai_notes', 'TEXT');
    await ensureColumnSqlite(db, 'board_intake_queue', 'retry_count', 'INTEGER NOT NULL DEFAULT 0');
    await ensureColumnSqlite(db, 'board_intake_queue', 'last_attempt_at', 'TEXT');
    await ensureColumnSqlite(db, 'board_intake_queue', 'next_retry_at', 'TEXT');
}
async function ensureMysqlDatabase(config) {
    const pool = await getMysqlPool(config);
    const query = async (label, sql) => {
        await mysqlQuery(pool, `MySQL database initialization: ${label}`, sql);
    };
    await query('connectivity check', 'SELECT 1');
    await query('create settings table', `
    CREATE TABLE IF NOT EXISTS settings (
      id INT PRIMARY KEY,
      odoo_base_url TEXT NOT NULL,
      odoo_database TEXT NOT NULL,
      odoo_username TEXT NOT NULL,
      odoo_api_key_encrypted TEXT NOT NULL,
      odoo_shop_floor_password_encrypted TEXT NOT NULL,
      field_mapping_json LONGTEXT NOT NULL,
      parser_config_json LONGTEXT NOT NULL,
      ai_config_json LONGTEXT NOT NULL,
      scheduler_config_json LONGTEXT NOT NULL,
      stock_config_json LONGTEXT NOT NULL,
      mail_config_json LONGTEXT NULL,
      payroll_bridge_config_json LONGTEXT NULL,
      connection_status VARCHAR(32) NOT NULL DEFAULT 'not_configured',
      connection_checked_at DATETIME NULL,
      connection_message TEXT NULL,
      connection_version TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await ensureColumnMysql(pool, 'settings', 'scheduler_config_json', 'LONGTEXT NOT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'settings', 'odoo_shop_floor_password_encrypted', 'TEXT NOT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'settings', 'ai_config_json', 'LONGTEXT NOT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'settings', 'stock_config_json', 'LONGTEXT NOT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'settings', 'mail_config_json', 'LONGTEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'settings', 'payroll_bridge_config_json', 'LONGTEXT NULL', config.mysqlDatabase);
    await query('insert default settings row', `
    INSERT IGNORE INTO settings (
      id,
      odoo_base_url,
      odoo_database,
      odoo_username,
      odoo_api_key_encrypted,
      odoo_shop_floor_password_encrypted,
      field_mapping_json,
      parser_config_json,
      ai_config_json,
      scheduler_config_json,
      stock_config_json,
      connection_status
    ) VALUES (1, '', '', '', '', '', '{}', '{}', '{}', '{}', '{}', 'not_configured')
  `);
    await query('create shop floor feature flags table', `
    CREATE TABLE IF NOT EXISTS shop_floor_feature_flags (
      feature_key VARCHAR(64) PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
    await query('create logs table', `
    CREATE TABLE IF NOT EXISTS logs (
      id VARCHAR(64) PRIMARY KEY,
      history_id VARCHAR(64) NULL,
      level VARCHAR(16) NOT NULL,
      message TEXT NOT NULL,
      context_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_logs_history_id (history_id)
    )
  `);
    await query('create history table', `
    CREATE TABLE IF NOT EXISTS history (
      id VARCHAR(64) PRIMARY KEY,
      order_id INT NOT NULL,
      order_name TEXT NOT NULL,
      attachment_id INT NOT NULL,
      attachment_name TEXT NOT NULL,
      status VARCHAR(64) NOT NULL,
      summary TEXT NULL,
      error_message TEXT NULL,
      extracted_result_id VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      computed_signature TEXT NULL,
      stored_signature TEXT NULL,
      signature_comparison VARCHAR(32) NULL,
      send_skipped TINYINT(1) NOT NULL DEFAULT 0,
      signature_written TINYINT(1) NOT NULL DEFAULT 0,
      INDEX idx_history_order_id (order_id)
    )
  `);
    await query('create extracted_results table', `
    CREATE TABLE IF NOT EXISTS extracted_results (
      id VARCHAR(64) PRIMARY KEY,
      history_id VARCHAR(64) NOT NULL,
      order_id INT NOT NULL,
      order_name TEXT NOT NULL,
      attachment_id INT NOT NULL,
      attachment_name TEXT NOT NULL,
      result_json LONGTEXT NOT NULL,
      raw_text LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pdf_signature TEXT NULL,
      INDEX idx_extracted_results_history_id (history_id)
    )
  `);
    await query('create odoo_model_fields_cache table', `
    CREATE TABLE IF NOT EXISTS odoo_model_fields_cache (
      model_name VARCHAR(191) PRIMARY KEY,
      fields_json LONGTEXT NOT NULL,
      fetched_at DATETIME NULL
    )
  `);
    await query('create scheduler_runs table', `
    CREATE TABLE IF NOT EXISTS scheduler_runs (
      id VARCHAR(64) PRIMARY KEY,
      status VARCHAR(64) NOT NULL,
      trigger_source VARCHAR(32) NOT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      scanned_count INT NOT NULL DEFAULT 0,
      processed_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      failed_count INT NOT NULL DEFAULT 0,
      summary TEXT NULL,
      error_message TEXT NULL,
      context_json LONGTEXT NOT NULL,
      INDEX idx_scheduler_runs_started_at (started_at)
    )
  `);
    await query('create scheduler_runtime_state table', `
    CREATE TABLE IF NOT EXISTS scheduler_runtime_state (
      id INT PRIMARY KEY,
      lock_run_id VARCHAR(64) NULL,
      lock_acquired_at DATETIME NULL,
      stop_requested_at DATETIME NULL,
      last_successful_run_id VARCHAR(64) NULL,
      last_successful_finished_at DATETIME NULL,
      last_checkpoint_at DATETIME NULL,
      last_error_run_id VARCHAR(64) NULL,
      last_error_message TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await query('insert scheduler_runtime_state row', `
    INSERT IGNORE INTO scheduler_runtime_state (
      id,
      lock_run_id,
      lock_acquired_at,
      last_successful_run_id,
      last_successful_finished_at,
      last_checkpoint_at,
      last_error_run_id,
      last_error_message
    ) VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
  `);
    await query('create stock_processed_items table', `
    CREATE TABLE IF NOT EXISTS stock_processed_items (
      id VARCHAR(64) PRIMARY KEY,
      order_id INT NOT NULL,
      extraction_signature VARCHAR(255) NOT NULL,
      variant_id INT NOT NULL,
      normalized_color VARCHAR(255) NOT NULL DEFAULT '',
      quantity_added_meters INT NOT NULL DEFAULT 0,
      history_id VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY idx_stock_processed_unique (order_id, extraction_signature, variant_id),
      KEY idx_stock_processed_order_signature (order_id, extraction_signature)
    )
  `);
    await query('create stock_processing_locks table', `
    CREATE TABLE IF NOT EXISTS stock_processing_locks (
      lock_key VARCHAR(255) PRIMARY KEY,
      order_id INT NOT NULL,
      extraction_signature VARCHAR(255) NOT NULL,
      acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_stock_locks_order_signature (order_id, extraction_signature)
    )
  `);
    await query('create stock_reversed_items table', `
    CREATE TABLE IF NOT EXISTS stock_reversed_items (
      processed_item_id VARCHAR(64) PRIMARY KEY,
      order_id INT NOT NULL,
      reversed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_stock_reversed_order (order_id)
    )
  `);
    await query('create po_bill_processing_locks table', `
    CREATE TABLE IF NOT EXISTS po_bill_processing_locks (
      attachment_id INT PRIMARY KEY,
      acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await query('create po_bill_unreadable_notifications table', `
    CREATE TABLE IF NOT EXISTS po_bill_unreadable_notifications (
      attachment_id INT PRIMARY KEY,
      attachment_name VARCHAR(1024) NOT NULL DEFAULT '',
      notified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await query('create ai_credential_failure_notifications table', `
    CREATE TABLE IF NOT EXISTS ai_credential_failure_notifications (
      attachment_id INT NOT NULL,
      failure_signature VARCHAR(128) NOT NULL,
      provider VARCHAR(64) NOT NULL DEFAULT '',
      model VARCHAR(255) NOT NULL DEFAULT '',
      notified_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (attachment_id, failure_signature)
    )
  `);
    await query('create po_bill_processed_documents table', `
    CREATE TABLE IF NOT EXISTS po_bill_processed_documents (
      attachment_id INT PRIMARY KEY,
      attachment_name VARCHAR(1024) NOT NULL DEFAULT '',
      document_id INT NULL,
      folder_name VARCHAR(255) NULL,
      company_name VARCHAR(255) NULL,
      purchase_order_id INT NULL,
      purchase_order_name VARCHAR(255) NULL,
      vendor_bill_id INT NULL,
      vendor_bill_name VARCHAR(255) NULL,
      invoice_fingerprint VARCHAR(128) NULL,
      invoice_number VARCHAR(255) NULL,
      invoice_vendor VARCHAR(255) NULL,
      invoice_total DECIMAL(18, 2) NULL,
      status VARCHAR(64) NOT NULL DEFAULT 'processed',
      mode VARCHAR(32) NULL,
      summary LONGTEXT NULL,
      processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      attempt_count INT NOT NULL DEFAULT 1,
      last_skipped_at DATETIME NULL,
      KEY idx_po_bill_processed_status (status, processed_at),
      KEY idx_po_bill_processed_invoice_fingerprint (invoice_fingerprint)
    )
  `);
    await ensureColumnMysql(pool, 'po_bill_processed_documents', 'attempt_count', 'INT NOT NULL DEFAULT 1', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'po_bill_processed_documents', 'last_skipped_at', 'DATETIME NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'po_bill_processed_documents', 'invoice_fingerprint', 'VARCHAR(128) NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'po_bill_processed_documents', 'invoice_number', 'VARCHAR(255) NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'po_bill_processed_documents', 'invoice_vendor', 'VARCHAR(255) NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'po_bill_processed_documents', 'invoice_total', 'DECIMAL(18, 2) NULL', config.mysqlDatabase);
    await query('create mpesa_statement_batches table', `
    CREATE TABLE IF NOT EXISTS mpesa_statement_batches (
      id VARCHAR(64) PRIMARY KEY,
      original_filename VARCHAR(1024) NOT NULL,
      stored_filename VARCHAR(1024) NOT NULL,
      status VARCHAR(64) NOT NULL DEFAULT 'needs_review',
      transaction_count INT NOT NULL DEFAULT 0,
      matched_count INT NOT NULL DEFAULT 0,
      warning_count INT NOT NULL DEFAULT 0,
      warnings_json LONGTEXT NOT NULL,
      raw_text_preview LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_mpesa_batches_created (created_at)
    )
  `);
    await query('create mpesa_transactions table', `
    CREATE TABLE IF NOT EXISTS mpesa_transactions (
      id VARCHAR(64) PRIMARY KEY,
      batch_id VARCHAR(64) NOT NULL,
      row_index INT NOT NULL DEFAULT 0,
      transaction_date DATE NULL,
      completion_time VARCHAR(32) NULL,
      receipt_number VARCHAR(64) NULL,
      details LONGTEXT NOT NULL,
      paid_in DECIMAL(18, 2) NULL,
      withdrawn DECIMAL(18, 2) NULL,
      balance DECIMAL(18, 2) NULL,
      amount DECIMAL(18, 2) NULL,
      direction VARCHAR(16) NOT NULL DEFAULT 'unknown',
      counterparty VARCHAR(512) NULL,
      phone_number VARCHAR(64) NULL,
      transaction_type VARCHAR(64) NOT NULL DEFAULT 'unknown',
      matched_po_id INT NULL,
      matched_po_name VARCHAR(255) NULL,
      match_confidence DECIMAL(7, 2) NULL,
      user_category VARCHAR(255) NULL,
      user_supplier VARCHAR(512) NULL,
      review_status VARCHAR(32) NOT NULL DEFAULT 'new',
      notes LONGTEXT NULL,
      ai_notes LONGTEXT NULL,
      candidates_json LONGTEXT NOT NULL,
      raw_json LONGTEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_mpesa_transactions_batch (batch_id, row_index),
      KEY idx_mpesa_transactions_receipt (receipt_number)
    )
  `);
    await query('create mpesa_category_training_rules table', `
    CREATE TABLE IF NOT EXISTS mpesa_category_training_rules (
      id VARCHAR(64) PRIMARY KEY,
      match_scope VARCHAR(32) NOT NULL DEFAULT 'any',
      match_text VARCHAR(512) NOT NULL,
      category VARCHAR(255) NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'manual',
      sample_text LONGTEXT NULL,
      confidence DECIMAL(7, 4) NOT NULL DEFAULT 1,
      active TINYINT(1) NOT NULL DEFAULT 1,
      hit_count INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_mpesa_category_training_rule (match_scope, match_text, category),
      KEY idx_mpesa_category_training_rules_active (active, updated_at)
    )
  `);
    await query('create auth_login_challenges table', `
    CREATE TABLE IF NOT EXISTS auth_login_challenges (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      redirect_path VARCHAR(1024) NOT NULL,
      expires_at DATETIME NOT NULL,
      attempts_remaining INT NOT NULL DEFAULT 5,
      consumed_at DATETIME NULL,
      requested_ip VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_auth_login_challenges_email (email, created_at)
    )
  `);
    await query('create auth_sessions table', `
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(32) NOT NULL DEFAULT 'user',
      csrf_token VARCHAR(255) NOT NULL,
      user_agent_hash VARCHAR(255) NOT NULL DEFAULT '',
      ip_address VARCHAR(255) NULL,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_auth_sessions_email (email, expires_at)
    )
  `);
    await query('create auth_attempts table', `
    CREATE TABLE IF NOT EXISTS auth_attempts (
      id VARCHAR(64) PRIMARY KEY,
      scope VARCHAR(64) NOT NULL,
      email VARCHAR(255) NULL,
      ip_address VARCHAR(255) NULL,
      success TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_auth_attempts_scope (scope, created_at)
    )
  `);
    await query('create auth_login_events table', `
    CREATE TABLE IF NOT EXISTS auth_login_events (
      id VARCHAR(64) PRIMARY KEY,
      email VARCHAR(255) NULL,
      role VARCHAR(32) NULL,
      event_type VARCHAR(32) NOT NULL,
      auth_method VARCHAR(64) NULL,
      success TINYINT(1) NOT NULL DEFAULT 0,
      ip_address VARCHAR(255) NULL,
      location_label VARCHAR(255) NULL,
      location_source VARCHAR(64) NULL,
      user_agent TEXT NULL,
      detail TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_auth_login_events_created (created_at),
      KEY idx_auth_login_events_email (email, created_at)
    )
  `);
    await query('create auth_approved_users table', `
    CREATE TABLE IF NOT EXISTS auth_approved_users (
      email VARCHAR(255) PRIMARY KEY,
      role VARCHAR(32) NOT NULL DEFAULT 'user',
      apps TEXT NULL,
      active TINYINT(1) NOT NULL DEFAULT 1,
      password_hash VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
    await query('create app user profiles table', `
    CREATE TABLE IF NOT EXISTS app_user_profiles (
      email VARCHAR(255) PRIMARY KEY,
      display_name VARCHAR(255) NOT NULL,
      odoo_employee_id INT NULL,
      synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
    await query('create stock product mirror table', `
    CREATE TABLE IF NOT EXISTS stock_product_mirror (
      product_id INT PRIMARY KEY,
      product_name VARCHAR(255) NOT NULL,
      available_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
      free_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
      forecast_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
      incoming_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
      outgoing_qty DECIMAL(16,4) NOT NULL DEFAULT 0,
      warehouse_id INT NULL,
      synced_at DATETIME NULL,
      sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      sync_error TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_stock_product_mirror_synced (synced_at),
      KEY idx_stock_product_mirror_status (sync_status)
    )
  `);
    await query('create staff onboarding applications table', `
    CREATE TABLE IF NOT EXISTS staff_onboarding_applications (
      id VARCHAR(64) PRIMARY KEY,
      full_name VARCHAR(255) NOT NULL,
      personal_email VARCHAR(255) NOT NULL,
      mobile_phone VARCHAR(80) NOT NULL,
      payload_json LONGTEXT NOT NULL,
      odoo_applicant_id INT NULL,
      odoo_employee_id INT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      error_message TEXT NULL,
      submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewed_by VARCHAR(255) NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY idx_staff_onboarding_odoo_applicant (odoo_applicant_id),
      KEY idx_staff_onboarding_status (status, submitted_at)
    )
  `);
    await query('create board intake queue table', `
    CREATE TABLE IF NOT EXISTS board_intake_queue (
      id VARCHAR(64) PRIMARY KEY,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      partner_id INT NOT NULL,
      customer_name VARCHAR(255) NOT NULL,
      quantity DECIMAL(16,4) NOT NULL,
      actor_name VARCHAR(255) NOT NULL,
      actor_email VARCHAR(255) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      odoo_stock_quantity DECIMAL(16,4) NULL,
      retry_count INT NOT NULL DEFAULT 0,
      last_attempt_at DATETIME NULL,
      next_retry_at DATETIME NULL,
      error_message TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_board_intake_queue_status (status, created_at)
    )
  `);
    await query('create mpesa extraction jobs table', `
    CREATE TABLE IF NOT EXISTS mpesa_extraction_jobs (
      id VARCHAR(64) PRIMARY KEY,
      batch_id VARCHAR(64) NOT NULL,
      job_type VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      original_filename VARCHAR(1024) NOT NULL,
      stored_filename VARCHAR(1024) NOT NULL,
      previous_stored_filename VARCHAR(1024) NULL,
      error_message TEXT NULL,
      transaction_count INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      CONSTRAINT fk_mpesa_extraction_jobs_batch FOREIGN KEY (batch_id) REFERENCES mpesa_statement_batches(id) ON DELETE CASCADE,
      KEY idx_mpesa_extraction_jobs_status (status, created_at)
    )
  `);
    await ensureColumnMysql(pool, 'history', 'computed_signature', 'TEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'history', 'stored_signature', 'TEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'history', 'signature_comparison', 'VARCHAR(32) NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'history', 'send_skipped', 'TINYINT(1) NOT NULL DEFAULT 0', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'history', 'signature_written', 'TINYINT(1) NOT NULL DEFAULT 0', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'extracted_results', 'pdf_signature', 'TEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'auth_sessions', 'role', "VARCHAR(32) NOT NULL DEFAULT 'user'", config.mysqlDatabase);
    await ensureColumnMysql(pool, 'auth_sessions', 'apps', 'TEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'auth_approved_users', 'password_hash', 'VARCHAR(255) NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'auth_approved_users', 'apps', 'TEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'scheduler_runtime_state', 'last_checkpoint_at', 'DATETIME NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'scheduler_runtime_state', 'stop_requested_at', 'DATETIME NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'scheduler_runtime_state', 'last_error_run_id', 'VARCHAR(64) NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'scheduler_runtime_state', 'last_error_message', 'TEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'mpesa_transactions', 'ai_notes', 'LONGTEXT NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'board_intake_queue', 'retry_count', 'INT NOT NULL DEFAULT 0', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'board_intake_queue', 'last_attempt_at', 'DATETIME NULL', config.mysqlDatabase);
    await ensureColumnMysql(pool, 'board_intake_queue', 'next_retry_at', 'DATETIME NULL', config.mysqlDatabase);
}
async function ensureDatabase() {
    const config = getRuntimeDatabaseConfig();
    if (ensuredDialect === config.driver) {
        return;
    }
    if (ensureDatabasePromise) {
        await ensureDatabasePromise;
        return;
    }
    ensureDatabasePromise = withDatabaseOperationTimeout(`Database initialization (${describeDatabaseConfig(config)})`, async () => {
        validateDatabaseConfig(config);
        try {
            console.log('[database] Initializing database', describeDatabaseConfig(config));
            if (config.driver === 'mysql') {
                await ensureMysqlDatabase(config);
            }
            else {
                await ensureSqliteDatabase(config);
            }
            ensuredDialect = config.driver;
            console.log('[database] Database initialized successfully', describeDatabaseConfig(config));
        }
        catch (error) {
            ensuredDialect = null;
            if (mysqlPool) {
                await mysqlPool.end().catch(() => undefined);
                mysqlPool = null;
            }
            const diagnostic = describeDatabaseError(error);
            if (diagnostic) {
                console.error('[database] Initialization error detail', diagnostic);
            }
            throw error;
        }
    }).finally(() => {
        ensureDatabasePromise = null;
    });
    await ensureDatabasePromise;
}
async function queryAll(sql, params = []) {
    await ensureDatabase();
    if (getDatabaseDialect() === 'mysql') {
        const pool = await getMysqlPool();
        const [rows] = await mysqlQuery(pool, 'MySQL query', sql, params);
        return rows;
    }
    const db = await getSqliteDb();
    return sqliteAll(db, sql, params);
}
async function queryOne(sql, params = []) {
    const rows = await queryAll(sql, params);
    return rows[0] || null;
}
async function execute(sql, params = []) {
    await ensureDatabase();
    if (getDatabaseDialect() === 'mysql') {
        const pool = await getMysqlPool();
        const [result] = await mysqlExecute(pool, 'MySQL execute', sql, params);
        const packet = result;
        return {
            affectedRows: packet.affectedRows || 0,
            insertId: packet.insertId ?? null,
        };
    }
    const db = await getSqliteDb();
    return sqliteRun(db, sql, params);
}
async function ensureDatabaseIndexes() {
    await ensureDatabase();
    const dialect = getDatabaseDialect();
    if (dialect === 'mysql') {
        const pool = await getMysqlPool();
        const mysqlIndexes = [
            { table: 'scheduler_runs', name: 'idx_scheduler_runs_started_at', column: 'started_at' },
            { table: 'po_bill_processed_documents', name: 'idx_po_bill_processed_status', column: 'status, processed_at' },
        ];
        for (const idx of mysqlIndexes) {
            try {
                await pool.query(`CREATE INDEX ${idx.name} ON ${idx.table} (${idx.column})`);
            }
            catch {
                // Index already exists in MySQL
            }
        }
    }
    else {
        const db = await getSqliteDb();
        const sqliteIndexes = [
            'CREATE INDEX IF NOT EXISTS idx_scheduler_runs_started_at ON scheduler_runs(started_at)',
            'CREATE INDEX IF NOT EXISTS idx_po_bill_processed_status ON po_bill_processed_documents(status, processed_at)',
        ];
        for (const sql of sqliteIndexes) {
            await sqliteExec(db, sql).catch(() => undefined);
        }
    }
}
