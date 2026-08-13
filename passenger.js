const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const startupLogPath = path.join(projectRoot, 'storage', 'startup.log');
const compiledServerPath = path.join(projectRoot, 'dist', 'server.js');
const MAX_STARTUP_LOG_BYTES = 10 * 1024 * 1024;

function writeStartupLog(message, error) {
  try {
    fs.mkdirSync(path.dirname(startupLogPath), { recursive: true });
    if (fs.existsSync(startupLogPath) && fs.statSync(startupLogPath).size > MAX_STARTUP_LOG_BYTES) {
      fs.truncateSync(startupLogPath, 0);
    }
    const timestamp = new Date().toISOString();
    const detail = error
      ? `\n${error && error.stack ? error.stack : String(error)}`
      : '';
    fs.appendFileSync(startupLogPath, `[${timestamp}] ${message}${detail}\n`, 'utf8');
  } catch (logError) {
    console.error('[passenger] Failed to write startup log:', logError);
  }
}

process.on('uncaughtException', (error) => {
  writeStartupLog('Uncaught exception during startup/runtime.', error);
  console.error('[passenger] Uncaught exception during startup/runtime:', error);
});

process.on('unhandledRejection', (error) => {
  writeStartupLog('Unhandled rejection during startup/runtime.', error);
  console.error('[passenger] Unhandled rejection during startup/runtime:', error);
});

writeStartupLog('Passenger bootstrap starting.', null);

let startServer;
try {
  if (!fs.existsSync(compiledServerPath)) {
    throw new Error(
      'Missing dist/server.js. Upload the prebuilt dist folder or build the project before starting the app.',
    );
  }
  ({ startServer } = require('./dist/server'));
  writeStartupLog('Loaded dist/server successfully.', null);
} catch (error) {
  writeStartupLog('Failed to require dist/server.', error);
  throw error;
}

startServer().catch((error) => {
  writeStartupLog('Failed to start application.', error);
  console.error('[passenger] Failed to start application:', error);
  process.exitCode = 1;
});
