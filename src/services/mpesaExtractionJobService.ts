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
import { extractMpesaStatement, matchMpesaStatementTransactions } from './mpesaReconciliationService';
import { OdooClient } from './odooClient';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';
import { resolveProjectFile } from '../utils/paths';
import { logEvent } from './logService';

let workerTimer: NodeJS.Timeout | null = null;
let processing = false;
let lastPollAt: string | null = null;
let lastErrorAt: string | null = null;
let lastErrorMessage: string | null = null;

export function getMpesaExtractionJobWorkerStatus() {
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
  lastPollAt = new Date().toISOString();
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
        // Persist the OCR/table extraction before any Odoo lookups. Matching
        // must never prevent a completed statement from becoming reviewable.
        odooClient: null,
        matchCandidates: false,
      });

      const extractionStatus = extraction.pageCount > 0 && extraction.transactions.length > 0
        ? 'needs_review' as const
        : 'failed' as const;
      await replaceMpesaStatementBatchExtraction(job.batchId, {
        originalFilename: job.originalFilename,
        storedFilename: job.storedFilename,
        status: extractionStatus,
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

      // Matching is deliberately a second phase. The extraction is already
      // saved and visible even if Odoo is slow, unavailable, or has a
      // different account.payment schema.
      if (extractionStatus === 'needs_review' && client) {
        try {
          const matchingWarnings = [...extraction.warnings];
          const matchedTransactions = await matchMpesaStatementTransactions(
            extraction.transactions,
            client,
            matchingWarnings,
          );
          await replaceMpesaStatementBatchExtraction(job.batchId, {
            originalFilename: job.originalFilename,
            storedFilename: job.storedFilename,
            status: extractionStatus,
            warnings: matchingWarnings,
            rawTextPreview: extraction.rawTextPreview,
            transactions: matchedTransactions,
          });
        } catch (error) {
          const matchingMessage = error instanceof Error ? error.message : String(error);
          await replaceMpesaStatementBatchExtraction(job.batchId, {
            originalFilename: job.originalFilename,
            storedFilename: job.storedFilename,
            status: extractionStatus,
            warnings: [...extraction.warnings, `Post-extraction matching skipped: ${matchingMessage}`],
            rawTextPreview: extraction.rawTextPreview,
            transactions: extraction.transactions,
          }).catch(() => undefined);
        }
      }
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
