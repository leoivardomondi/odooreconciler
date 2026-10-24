import {
  claimNextShopFloorValidationJob,
  completeShopFloorValidationJob,
  deleteShopFloorDashboardSnapshot,
  deleteShopFloorSharedCachePrefix,
  getSettings,
  reclaimStaleShopFloorValidationJobs,
  touchShopFloorValidationJob,
} from '../models/repositories';
import { OdooClient } from './odooClient';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';
import { logEvent } from './logService';
import { shopFloorCache } from '../routes/shopFloor';
import { refreshStockMirror } from './stockMirrorService';

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;
let lastPollAt: string | null = null;
let lastErrorAt: string | null = null;
let lastErrorMessage: string | null = null;

export function getShopFloorValidationJobWorkerStatus() {
  const pollAgeMs = lastPollAt ? Date.now() - Date.parse(lastPollAt) : Number.POSITIVE_INFINITY;
  return {
    running: Boolean(workerTimer),
    processing,
    healthy: Boolean(workerTimer) && (processing || pollAgeMs <= 120000),
    lastPollAt,
    lastErrorAt,
    lastErrorMessage,
  };
}

function reportWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  lastErrorAt = new Date().toISOString();
  lastErrorMessage = message;
  console.error('[shop-floor-validation-worker] Poll failed:', message);
  void logEvent('error', 'Shop floor validation worker poll failed', { error: message }).catch(() => undefined);
}

export async function processNextShopFloorValidationJob() {
  lastPollAt = new Date().toISOString();
  if (processing) return;
  processing = true;

  try {
    await reclaimStaleShopFloorValidationJobs(15);
    const job = await claimNextShopFloorValidationJob();
    if (!job) return;

    const heartbeat = setInterval(() => {
      void touchShopFloorValidationJob(job.id).catch(() => undefined);
    }, 10000);

    try {
      const settings = await getSettings();
      if (!hasOdooConfiguration(settings)) {
        throw new Error('Odoo is not configured yet. Complete setup first.');
      }

      const warehouseId = Number(settings.stock.warehouseId || 0);
      if (!warehouseId) {
        throw new Error('The Urban Vibe warehouse ID is not configured.');
      }

      const client = new OdooClient({
        baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
        database: settings.odoo.database,
        username: settings.odoo.username,
        apiKey: settings.odoo.apiKey,
      });

      if (job.jobType === 'receipt') {
        await client.validateBoardReceipt(job.pickingId, job.actorName || job.actorEmail, warehouseId);
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        shopFloorCache.clearPrefix('shop-floor:receipts:');
        await Promise.allSettled([
          deleteShopFloorSharedCachePrefix('shop-floor:receipts:'),
          deleteShopFloorDashboardSnapshot(),
        ]);
        void refreshStockMirror();
        await logEvent('info', 'Odoo board receipt validated in background FIFO', {
          pickingId: job.pickingId,
          actor: job.actorName,
          actorEmail: job.actorEmail,
          jobId: job.id,
        });
      } else if (job.jobType === 'delivery') {
        await client.validateDelivery(job.pickingId, job.actorName || job.actorEmail, warehouseId);
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        shopFloorCache.clearPrefix('shop-floor:deliveries:');
        await Promise.allSettled([
          deleteShopFloorSharedCachePrefix('shop-floor:deliveries:'),
          deleteShopFloorDashboardSnapshot(),
        ]);
        await logEvent('info', 'Odoo delivery validated in background FIFO', {
          pickingId: job.pickingId,
          actor: job.actorName,
          actorEmail: job.actorEmail,
          jobId: job.id,
        });
      } else {
        throw new Error(`Unsupported validation job type: ${job.jobType}`);
      }

      await completeShopFloorValidationJob({ id: job.id, status: 'completed' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`[shop-floor-validation-worker] Job ${job.id} for picking ${job.pickingId} failed:`, errorMessage);
      await completeShopFloorValidationJob({
        id: job.id,
        status: 'failed',
        errorMessage,
      }).catch(() => undefined);
      await logEvent('warn', 'Odoo validation job failed in background', {
        jobId: job.id,
        jobType: job.jobType,
        pickingId: job.pickingId,
        error: errorMessage,
      }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
    }

    // Immediately drain the next job in FIFO queue without waiting for the timer
    setImmediate(() => {
      void processNextShopFloorValidationJob().catch(reportWorkerError);
    });
  } finally {
    processing = false;
  }
}

export function startShopFloorValidationJobWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => void processNextShopFloorValidationJob().catch(reportWorkerError), 2500);
  void processNextShopFloorValidationJob().catch(reportWorkerError);
}

export function wakeShopFloorValidationJobWorker() {
  void processNextShopFloorValidationJob().catch(reportWorkerError);
}

export function stopShopFloorValidationJobWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
