import fs from 'fs/promises';
import {
  claimNextMpesaExtractionJob,
  completeMpesaExtractionJob,
  getSettings,
  markMpesaStatementBatchExtractionFailed,
  reclaimStaleMpesaExtractionJobs,
  replaceMpesaStatementBatchExtraction,
  scheduleMpesaExtractionJobRetry,
  touchMpesaExtractionJob,
} from '../models/repositories';
import { extractMpesaStatement } from './mpesaReconciliationService';
import { OdooClient } from './odooClient';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';
import { resolveProjectFile } from '../utils/paths';
import { logEvent } from './logService';

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;

function reportWorkerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[mpesa-extraction-worker] Poll failed:', message);
  void logEvent('error', 'M-Pesa extraction worker poll failed', { error: message }).catch(() => undefined);
}

function resolveStoredFile(filename: string) {
  return resolveProjectFile(`${process.env.UPLOAD_DIR || 'uploads'}/mpesa/${filename}`, 'uploads/mpesa');
}

async function deleteStoredFile(filename: string | null | undefined) {
  if (!filename) return;
  await fs.unlink(resolveStoredFile(filename)).catch(() => undefined);
}

async function processNextMpesaExtractionJob() {
  if (processing) return;
  processing = true;

  try {
    await reclaimStaleMpesaExtractionJobs();
    const job = await claimNextMpesaExtractionJob();
    if (!job) return;

    const heartbeat = setInterval(() => {
      void touchMpesaExtractionJob(job.id).catch(() => undefined);
    }, 15000);
    try {
      const settings = await getSettings();
      const client = hasOdooConfiguration(settings)
        ? new OdooClient({
            baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
            database: settings.odoo.database,
            username: settings.odoo.username,
            apiKey: settings.odoo.apiKey,
          })
        : null;
      const extraction = await extractMpesaStatement({
        filePath: resolveStoredFile(job.storedFilename),
        originalFilename: job.originalFilename,
        aiConfig: settings.ai,
        odooClient: client,
      });

      await replaceMpesaStatementBatchExtraction(job.batchId, {
        originalFilename: job.originalFilename,
        storedFilename: job.storedFilename,
        status: extraction.transactions.length > 0 ? 'needs_review' : 'failed',
        warnings: extraction.warnings,
        rawTextPreview: extraction.rawTextPreview,
        transactions: extraction.transactions,
      });

      if (job.previousStoredFilename && job.previousStoredFilename !== job.storedFilename) {
        await deleteStoredFile(job.previousStoredFilename);
      }

      await completeMpesaExtractionJob({
        id: job.id,
        status: 'completed',
        transactionCount: extraction.transactions.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markMpesaStatementBatchExtractionFailed(job.batchId, message).catch(() => undefined);
      await scheduleMpesaExtractionJobRetry({ id: job.id, errorMessage: message }).catch(() => undefined);
      if (job.jobType === 'reupload' && job.retryCount + 1 >= 3) {
        await deleteStoredFile(job.storedFilename);
      }
    } finally {
      clearInterval(heartbeat);
    }
  } finally {
    processing = false;
  }
}

export function startMpesaExtractionJobWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void processNextMpesaExtractionJob().catch(reportWorkerError);
  }, 2000);
  void processNextMpesaExtractionJob().catch(reportWorkerError);
}

export function wakeMpesaExtractionJobWorker() {
  void processNextMpesaExtractionJob().catch(reportWorkerError);
}

export function stopMpesaExtractionJobWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
