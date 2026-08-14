import fs from 'fs/promises';
import {
  claimNextMpesaExtractionJob,
  completeMpesaExtractionJob,
  getSettings,
  markMpesaStatementBatchExtractionFailed,
  replaceMpesaStatementBatchExtraction,
} from '../models/repositories';
import { extractMpesaStatement } from './mpesaReconciliationService';
import { OdooClient } from './odooClient';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';
import { resolveProjectFile } from '../utils/paths';

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;

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
    const job = await claimNextMpesaExtractionJob();
    if (!job) return;

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
      await completeMpesaExtractionJob({
        id: job.id,
        status: 'failed',
        errorMessage: message,
      }).catch(() => undefined);
      if (job.jobType === 'reupload') {
        await deleteStoredFile(job.storedFilename);
      }
    }
  } finally {
    processing = false;
  }
}

export function startMpesaExtractionJobWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void processNextMpesaExtractionJob().catch(() => undefined);
  }, 2000);
  void processNextMpesaExtractionJob().catch(() => undefined);
}

export function wakeMpesaExtractionJobWorker() {
  void processNextMpesaExtractionJob().catch(() => undefined);
}
