import {
  claimNextPoBillManualJob,
  completePoBillManualJob,
  getSettings,
  reclaimStalePoBillManualJobs,
  touchPoBillManualJob,
} from '../models/repositories';
import { runPoBillAutomation } from './poBillAutomationService';
import { OdooClient } from './odooClient';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';
import { logEvent } from './logService';

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;

function reportWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[po-bill-manual-worker] Poll failed:', message);
  void logEvent('error', 'PO bill manual worker poll failed', { error: message }).catch(() => undefined);
}

async function processNextPoBillManualJob() {
  if (processing) return;
  processing = true;
  try {
    await reclaimStalePoBillManualJobs();
    const job = await claimNextPoBillManualJob();
    if (!job) return;

    const heartbeat = setInterval(() => {
      void touchPoBillManualJob(job.id).catch(() => undefined);
    }, 15000);
    try {
      const settings = await getSettings();
      if (!hasOdooConfiguration(settings)) throw new Error('Odoo is not configured yet. Complete setup first.');
      const client = new OdooClient({
        baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
        database: settings.odoo.database,
        username: settings.odoo.username,
        apiKey: settings.odoo.apiKey,
      });
      const result = await runPoBillAutomation(client, {
        attachmentId: job.attachmentId,
        purchaseOrderSearch: job.purchaseOrderSearch,
        mode: job.mode,
        aiConfig: settings.ai,
      });
      await completePoBillManualJob({ id: job.id, status: 'completed', result });
    } catch (error) {
      await completePoBillManualJob({
        id: job.id,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    processing = false;
  }
}

export function startPoBillManualJobWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => void processNextPoBillManualJob().catch(reportWorkerError), 2000);
  void processNextPoBillManualJob().catch(reportWorkerError);
}

export function wakePoBillManualJobWorker() {
  void processNextPoBillManualJob().catch(reportWorkerError);
}

export function stopPoBillManualJobWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
