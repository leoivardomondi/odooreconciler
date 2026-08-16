"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const app_1 = __importDefault(require("./app"));
const db_1 = require("./src/models/db");
const env_1 = require("./src/utils/env");
const logService_1 = require("./src/services/logService");
const schedulerService_1 = require("./src/services/schedulerService");
const emailAutomationService_1 = require("./src/services/emailAutomationService");
const stockMirrorService_1 = require("./src/services/stockMirrorService");
const userProfileSyncService_1 = require("./src/services/userProfileSyncService");
const shopFloorOperatorAccessSyncService_1 = require("./src/services/shopFloorOperatorAccessSyncService");
const boardIntakeSyncService_1 = require("./src/services/boardIntakeSyncService");
const mpesaExtractionJobService_1 = require("./src/services/mpesaExtractionJobService");
const invoiceExtractionJobService_1 = require("./src/services/invoiceExtractionJobService");
const poBillManualJobService_1 = require("./src/services/poBillManualJobService");
const startupState_1 = require("./src/services/startupState");
const paths_1 = require("./src/utils/paths");
const configuredStartupStepTimeoutMs = Number(env_1.env.STARTUP_STEP_TIMEOUT_MS || 30000);
const configuredStartupDbRetryMs = Number(env_1.env.STARTUP_DB_RETRY_MS || 2000);
const MAX_STARTUP_LOG_BYTES = 10 * 1024 * 1024;
const STARTUP_STEP_TIMEOUT_MS = Number.isFinite(configuredStartupStepTimeoutMs) && configuredStartupStepTimeoutMs > 0
    ? configuredStartupStepTimeoutMs
    : 30000;
const STARTUP_DB_RETRY_MS = Number.isFinite(configuredStartupDbRetryMs) && configuredStartupDbRetryMs > 0
    ? configuredStartupDbRetryMs
    : 2000;
function writeStartupLog(message, error) {
    try {
        fs_1.default.mkdirSync(paths_1.storageDirectoryPath, { recursive: true });
        const startupLogPath = path_1.default.join(paths_1.storageDirectoryPath, 'startup.log');
        if (fs_1.default.existsSync(startupLogPath) && fs_1.default.statSync(startupLogPath).size > MAX_STARTUP_LOG_BYTES) {
            fs_1.default.truncateSync(startupLogPath, 0);
        }
        const details = error instanceof Error
            ? `\n${error.stack || error.message}`
            : error
                ? `\n${typeof error === 'object' ? JSON.stringify(error) : String(error)}`
                : '';
        fs_1.default.appendFileSync(path_1.default.join(paths_1.storageDirectoryPath, 'startup.log'), `[${new Date().toISOString()}] ${message}${details}\n`, 'utf8');
    }
    catch (logError) {
        console.warn('[startup] Could not write startup.log:', logError);
    }
}
async function withStartupTimeout(label, operation) {
    let timeoutHandle = null;
    try {
        return await Promise.race([
            operation(),
            new Promise((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new Error(`${label} did not finish within ${STARTUP_STEP_TIMEOUT_MS}ms.`));
                }, STARTUP_STEP_TIMEOUT_MS);
            }),
        ]);
    }
    finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
function getStartupDatabaseRetryMs() {
    return Number.isFinite(STARTUP_DB_RETRY_MS) && STARTUP_DB_RETRY_MS > 0
        ? STARTUP_DB_RETRY_MS
        : 2000;
}
function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
async function ensureDatabaseWithRetry() {
    const retryMs = getStartupDatabaseRetryMs();
    const startedAt = Date.now();
    const deadline = startedAt + STARTUP_STEP_TIMEOUT_MS;
    let attempt = 0;
    let lastError = null;
    while (Date.now() < deadline) {
        attempt += 1;
        try {
            await (0, db_1.ensureDatabase)();
            if (attempt > 1) {
                writeStartupLog(`Database initialization succeeded on attempt ${attempt}.`);
            }
            return;
        }
        catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                break;
            }
            console.warn(`[startup] Database initialization attempt ${attempt} failed; retrying in ${retryMs}ms:`, message);
            writeStartupLog(`Database initialization attempt ${attempt} failed; retrying in ${retryMs}ms: ${message}`, error);
            await wait(Math.min(retryMs, remainingMs));
        }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError || 'unknown error');
    throw new Error(`Database initialization did not complete after ${Date.now() - startedAt}ms. Last error: ${detail}`, { cause: lastError });
}
async function startServer() {
    const dbConfig = (0, db_1.getRuntimeDatabaseConfig)();
    const phusionPassenger = globalThis.PhusionPassenger;
    const isPassengerRuntime = typeof phusionPassenger !== 'undefined';
    if (isPassengerRuntime && typeof phusionPassenger.configure === 'function') {
        phusionPassenger.configure({ autoInstall: false });
    }
    console.log('[startup] Boot configuration', {
        nodeEnv: env_1.env.NODE_ENV,
        dbDriver: dbConfig.driver,
        mysqlHost: dbConfig.mysqlHost ? '[set]' : '[missing]',
        mysqlDatabase: dbConfig.mysqlDatabase ? '[set]' : '[missing]',
        sqlitePath: dbConfig.driver === 'sqlite' ? dbConfig.sqlitePath : '[not-used]',
        port: env_1.env.PORT,
        passengerRuntime: isPassengerRuntime,
    });
    writeStartupLog('Boot configuration loaded.', {
        nodeEnv: env_1.env.NODE_ENV,
        dbDriver: dbConfig.driver,
        mysqlHost: dbConfig.mysqlHost ? '[set]' : '[missing]',
        mysqlDatabase: dbConfig.mysqlDatabase ? '[set]' : '[missing]',
        passengerRuntime: isPassengerRuntime,
    });
    const port = Number(env_1.env.PORT || 3000);
    const listenTarget = isPassengerRuntime ? 'passenger' : port;
    const server = http_1.default.createServer(app_1.default);
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        console.log(`[shutdown] Received ${signal}; stopping workers and closing resources.`);
        writeStartupLog(`Shutdown requested by ${signal}.`);
        (0, schedulerService_1.stopSchedulerInterval)();
        (0, mpesaExtractionJobService_1.stopMpesaExtractionJobWorker)();
        (0, invoiceExtractionJobService_1.stopInvoiceExtractionJobWorker)();
        (0, poBillManualJobService_1.stopPoBillManualJobWorker)();
        await new Promise((resolve) => {
            server.close(() => resolve());
        }).catch(() => undefined);
        await (0, db_1.closeDatabase)();
        process.exit(0);
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.on('unhandledRejection', (reason) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        console.error('[runtime-error] Unhandled promise rejection:', error);
        writeStartupLog('Unhandled promise rejection.', error);
        void (0, logService_1.logEvent)('error', 'Unhandled promise rejection', {
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack || null,
        }).catch((loggingError) => console.error('[runtime-error] Could not persist rejection:', loggingError));
    });
    process.on('uncaughtException', (error) => {
        console.error('[runtime-error] Uncaught exception:', error);
        writeStartupLog('Uncaught exception.', error);
        void (0, logService_1.logEvent)('error', 'Uncaught exception', {
            errorName: error.name,
            errorMessage: error.message,
            stack: error.stack || null,
        }).catch((loggingError) => console.error('[runtime-error] Could not persist exception:', loggingError));
    });
    server.on('error', (error) => {
        console.error('[startup] HTTP server failed to start:', error);
    });
    server.listen(listenTarget, () => {
        writeStartupLog(`HTTP server listening on ${isPassengerRuntime ? 'Passenger socket' : port}.`);
        console.log(isPassengerRuntime
            ? 'Server listening on Passenger socket'
            : `Server listening on port ${port}`);
    });
    void (async () => {
        try {
            (0, startupState_1.markStartupStep)('initializing database');
            writeStartupLog('Database initialization starting.');
            await withStartupTimeout('Database initialization', () => ensureDatabaseWithRetry());
            writeStartupLog('Database initialization completed.');
            (0, mpesaExtractionJobService_1.startMpesaExtractionJobWorker)();
            (0, invoiceExtractionJobService_1.startInvoiceExtractionJobWorker)();
            (0, poBillManualJobService_1.startPoBillManualJobWorker)();
            (0, startupState_1.markStartupStep)('initializing scheduler');
            await withStartupTimeout('Scheduler initialization', () => (0, schedulerService_1.startSchedulerInterval)());
            (0, emailAutomationService_1.startEmailAutomationInterval)();
            (0, stockMirrorService_1.startStockMirrorInterval)();
            (0, userProfileSyncService_1.startUserProfileSyncInterval)();
            (0, shopFloorOperatorAccessSyncService_1.startShopFloorOperatorAccessSyncInterval)();
            (0, boardIntakeSyncService_1.startBoardIntakeSyncInterval)();
            (0, startupState_1.markStartupReady)();
            console.log('[startup] Application initialization completed successfully.');
            writeStartupLog('Application initialization completed successfully.');
            void (0, logService_1.logEvent)('info', 'Server started', {
                listenTarget: isPassengerRuntime ? 'passenger' : port,
                environment: env_1.env.NODE_ENV,
            }).catch((error) => {
                console.warn('[startup] Server-start database log failed after startup completed:', error instanceof Error ? error.message : error);
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown startup initialization failure.';
            (0, startupState_1.markStartupFailed)(message);
            console.error('[startup] Application initialization failed:', error);
            writeStartupLog('Application initialization failed.', error);
        }
    })();
    return server;
}
if (require.main === module) {
    startServer().catch((error) => {
        console.error('[startup] Server boot failed:', error);
        process.exit(1);
    });
}
