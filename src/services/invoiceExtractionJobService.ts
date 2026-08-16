import fs from 'fs/promises';
import {
  claimNextInvoiceExtractionJob,
  completeInvoiceExtractionJob,
  getSettings,
  reclaimStaleInvoiceExtractionJobs,
  scheduleInvoiceExtractionJobRetry,
  touchInvoiceExtractionJob,
  updateInvoiceExtractionJobProgress,
} from '../models/repositories';
import { parseSupplierInvoice } from '../invoice-parser';
import { resolveProjectFile } from '../utils/paths';
import { logEvent } from './logService';

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;
let lastPollAt: string | null = null;
let lastErrorAt: string | null = null;
let lastErrorMessage: string | null = null;

export function getInvoiceExtractionJobWorkerStatus() {
  return { running: Boolean(workerTimer), lastPollAt, lastErrorAt, lastErrorMessage };
}

function reportWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  lastErrorAt = new Date().toISOString();
  lastErrorMessage = message;
  console.error('[invoice-extraction-worker] Poll failed:', message);
  void logEvent('error', 'Invoice extraction worker poll failed', { error: message }).catch(() => undefined);
}

function resolveStoredFile(filename: string) {
  return resolveProjectFile(`${process.env.UPLOAD_DIR || 'uploads'}/${filename}`, 'uploads');
}

async function deleteStoredFile(filename: string) {
  await fs.unlink(resolveStoredFile(filename)).catch(() => undefined);
}

async function processNextInvoiceExtractionJob() {
  lastPollAt = new Date().toISOString();
  if (processing) return;
  processing = true;

  try {
    await reclaimStaleInvoiceExtractionJobs();
    const job = await claimNextInvoiceExtractionJob();
    if (!job) return;

    const heartbeat = setInterval(() => {
      void touchInvoiceExtractionJob(job.id).catch(() => undefined);
    }, 15000);
    try {
      await updateInvoiceExtractionJobProgress({ id: job.id, stage: 'loading_settings', progress: 10 });
      const settings = await getSettings();
      await updateInvoiceExtractionJobProgress({ id: job.id, stage: 'extracting_invoice', progress: 20 });
      const result = await parseSupplierInvoice({
        filePath: resolveStoredFile(job.storedFilename),
        originalFilename: job.originalFilename,
        preferredOcr: job.preferredOcr as Parameters<typeof parseSupplierInvoice>[0]['preferredOcr'],
        aiConfig: settings.ai,
      });

      await updateInvoiceExtractionJobProgress({ id: job.id, stage: 'saving_result', progress: 95 });
      await completeInvoiceExtractionJob({ id: job.id, status: 'completed', result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await scheduleInvoiceExtractionJobRetry({ id: job.id, errorMessage: message }).catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      if (job.retryCount + 1 >= 3) {
        await deleteStoredFile(job.storedFilename);
      }
    }
  } finally {
    processing = false;
  }
}

export function startInvoiceExtractionJobWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void processNextInvoiceExtractionJob().catch(reportWorkerError);
  }, 2000);
  void processNextInvoiceExtractionJob().catch(reportWorkerError);
}

export function wakeInvoiceExtractionJobWorker() {
  void processNextInvoiceExtractionJob().catch(reportWorkerError);
}

export function stopInvoiceExtractionJobWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
