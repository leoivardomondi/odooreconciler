import http from 'http';
import fs from 'fs';
import path from 'path';
import app from './app';
import { ensureDatabase, getRuntimeDatabaseConfig } from './src/models/db';
import { env } from './src/utils/env';
import { logEvent } from './src/services/logService';
import { startSchedulerInterval } from './src/services/schedulerService';
import { startEmailAutomationInterval } from './src/services/emailAutomationService';
import { startStockMirrorInterval } from './src/services/stockMirrorService';
import { startUserProfileSyncInterval } from './src/services/userProfileSyncService';
import { startShopFloorOperatorAccessSyncInterval } from './src/services/shopFloorOperatorAccessSyncService';
import { markStartupFailed, markStartupReady, markStartupStep } from './src/services/startupState';
import { storageDirectoryPath } from './src/utils/paths';

type PhusionPassengerGlobal = {
  configure?: (options: { autoInstall?: boolean }) => void;
};

const configuredStartupStepTimeoutMs = Number(env.STARTUP_STEP_TIMEOUT_MS || 30000);
const configuredStartupDbRetryMs = Number(env.STARTUP_DB_RETRY_MS || 2000);
const STARTUP_STEP_TIMEOUT_MS =
  Number.isFinite(configuredStartupStepTimeoutMs) && configuredStartupStepTimeoutMs > 0
    ? configuredStartupStepTimeoutMs
    : 30000;
const STARTUP_DB_RETRY_MS =
  Number.isFinite(configuredStartupDbRetryMs) && configuredStartupDbRetryMs > 0
    ? configuredStartupDbRetryMs
    : 2000;

function writeStartupLog(message: string, error?: unknown) {
  try {
    fs.mkdirSync(storageDirectoryPath, { recursive: true });
    const details =
      error instanceof Error
        ? `\n${error.stack || error.message}`
        : error
          ? `\n${typeof error === 'object' ? JSON.stringify(error) : String(error)}`
          : '';
    fs.appendFileSync(
      path.join(storageDirectoryPath, 'startup.log'),
      `[${new Date().toISOString()}] ${message}${details}\n`,
      'utf8',
    );
  } catch (logError) {
    console.warn('[startup] Could not write startup.log:', logError);
  }
}

async function withStartupTimeout<T>(label: string, operation: () => Promise<T>): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`${label} did not finish within ${STARTUP_STEP_TIMEOUT_MS}ms.`));
        }, STARTUP_STEP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getStartupDatabaseRetryMs(): number {
  return Number.isFinite(STARTUP_DB_RETRY_MS) && STARTUP_DB_RETRY_MS > 0
    ? STARTUP_DB_RETRY_MS
    : 2000;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function ensureDatabaseWithRetry(): Promise<void> {
  const retryMs = getStartupDatabaseRetryMs();
  const startedAt = Date.now();
  const deadline = startedAt + STARTUP_STEP_TIMEOUT_MS;
  let attempt = 0;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    attempt += 1;

    try {
      await ensureDatabase();
      if (attempt > 1) {
        writeStartupLog(`Database initialization succeeded on attempt ${attempt}.`);
      }
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const remainingMs = deadline - Date.now();

      if (remainingMs <= 0) {
        break;
      }

      console.warn(
        `[startup] Database initialization attempt ${attempt} failed; retrying in ${retryMs}ms:`,
        message,
      );
      writeStartupLog(
        `Database initialization attempt ${attempt} failed; retrying in ${retryMs}ms: ${message}`,
        error,
      );
      await wait(Math.min(retryMs, remainingMs));
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError || 'unknown error');
  throw new Error(
    `Database initialization did not complete after ${Date.now() - startedAt}ms. Last error: ${detail}`,
    { cause: lastError },
  );
}

export async function startServer() {
  const dbConfig = getRuntimeDatabaseConfig();
  const phusionPassenger = (globalThis as typeof globalThis & {
    PhusionPassenger?: PhusionPassengerGlobal;
  }).PhusionPassenger;
  const isPassengerRuntime = typeof phusionPassenger !== 'undefined';

  if (isPassengerRuntime && typeof phusionPassenger.configure === 'function') {
    phusionPassenger.configure({ autoInstall: false });
  }

  console.log('[startup] Boot configuration', {
    nodeEnv: env.NODE_ENV,
    dbDriver: dbConfig.driver,
    mysqlHost: dbConfig.mysqlHost ? '[set]' : '[missing]',
    mysqlDatabase: dbConfig.mysqlDatabase ? '[set]' : '[missing]',
    sqlitePath: dbConfig.driver === 'sqlite' ? dbConfig.sqlitePath : '[not-used]',
    port: env.PORT,
    passengerRuntime: isPassengerRuntime,
  });
  writeStartupLog('Boot configuration loaded.', {
    nodeEnv: env.NODE_ENV,
    dbDriver: dbConfig.driver,
    mysqlHost: dbConfig.mysqlHost ? '[set]' : '[missing]',
    mysqlDatabase: dbConfig.mysqlDatabase ? '[set]' : '[missing]',
    passengerRuntime: isPassengerRuntime,
  });

  const port = Number(env.PORT || 3000);
  const listenTarget = isPassengerRuntime ? 'passenger' : port;
  const server = http.createServer(app);

  server.on('error', (error) => {
    console.error('[startup] HTTP server failed to start:', error);
  });

  server.listen(listenTarget, () => {
    writeStartupLog(`HTTP server listening on ${isPassengerRuntime ? 'Passenger socket' : port}.`);
    console.log(
      isPassengerRuntime
        ? 'Server listening on Passenger socket'
        : `Server listening on port ${port}`,
    );
  });

  void (async () => {
    try {
      markStartupStep('initializing database');
      writeStartupLog('Database initialization starting.');
      await withStartupTimeout('Database initialization', () => ensureDatabaseWithRetry());
      writeStartupLog('Database initialization completed.');
      markStartupStep('initializing scheduler');
      await withStartupTimeout('Scheduler initialization', () => startSchedulerInterval());
      startEmailAutomationInterval();
      startStockMirrorInterval();
      startUserProfileSyncInterval();
      startShopFloorOperatorAccessSyncInterval();
      markStartupReady();
      console.log('[startup] Application initialization completed successfully.');
      writeStartupLog('Application initialization completed successfully.');
      void logEvent('info', 'Server started', {
        listenTarget: isPassengerRuntime ? 'passenger' : port,
        environment: env.NODE_ENV,
      }).catch((error) => {
        console.warn(
          '[startup] Server-start database log failed after startup completed:',
          error instanceof Error ? error.message : error,
        );
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown startup initialization failure.';
      markStartupFailed(message);
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
