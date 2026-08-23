"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMpesaExtractionJobWorkerStatus = getMpesaExtractionJobWorkerStatus;
exports.startMpesaExtractionJobWorker = startMpesaExtractionJobWorker;
exports.wakeMpesaExtractionJobWorker = wakeMpesaExtractionJobWorker;
exports.stopMpesaExtractionJobWorker = stopMpesaExtractionJobWorker;
const promises_1 = __importDefault(require("fs/promises"));
const repositories_1 = require("../models/repositories");
const mpesaReconciliationService_1 = require("./mpesaReconciliationService");
const odooClient_1 = require("./odooClient");
const helpers_1 = require("../utils/helpers");
const paths_1 = require("../utils/paths");
const logService_1 = require("./logService");
let workerTimer = null;
let processing = false;
let lastPollAt = null;
let lastErrorAt = null;
let lastErrorMessage = null;
function getMpesaExtractionJobWorkerStatus() {
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
function reportWorkerError(error) {
    const message = error instanceof Error ? error.message : String(error);
    lastErrorAt = new Date().toISOString();
    lastErrorMessage = message;
    console.error('[mpesa-extraction-worker] Poll failed:', message);
    void (0, logService_1.logEvent)('error', 'M-Pesa extraction worker poll failed', { error: message }).catch(() => undefined);
}
function resolveStoredFile(filename) {
    return (0, paths_1.resolveProjectFile)(`${process.env.UPLOAD_DIR || 'uploads'}/mpesa/${filename}`, 'uploads/mpesa');
}
async function deleteStoredFile(filename) {
    if (!filename)
        return;
    await promises_1.default.unlink(resolveStoredFile(filename)).catch(() => undefined);
}
async function processNextMpesaExtractionJob() {
    lastPollAt = new Date().toISOString();
    if (processing)
        return;
    processing = true;
    try {
        await (0, repositories_1.reclaimStaleMpesaExtractionJobs)();
        const job = await (0, repositories_1.claimNextMpesaExtractionJob)();
        if (!job)
            return;
        const heartbeat = setInterval(() => {
            void (0, repositories_1.touchMpesaExtractionJob)(job.id).catch(() => undefined);
        }, 15000);
        try {
            const settings = await (0, repositories_1.getSettings)();
            const client = (0, helpers_1.hasOdooConfiguration)(settings)
                ? new odooClient_1.OdooClient({
                    baseUrl: (0, helpers_1.sanitizeBaseUrl)(settings.odoo.baseUrl),
                    database: settings.odoo.database,
                    username: settings.odoo.username,
                    apiKey: settings.odoo.apiKey,
                })
                : null;
            const extraction = await (0, mpesaReconciliationService_1.extractMpesaStatement)({
                filePath: resolveStoredFile(job.storedFilename),
                originalFilename: job.originalFilename,
                aiConfig: settings.ai,
                // Persist the OCR/table extraction before any Odoo lookups. Matching
                // must never prevent a completed statement from becoming reviewable.
                odooClient: null,
                matchCandidates: false,
            });
            const extractionStatus = extraction.pageCount > 0 && extraction.transactions.length > 0
                ? 'needs_review'
                : 'failed';
            await (0, repositories_1.replaceMpesaStatementBatchExtraction)(job.batchId, {
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
            await (0, repositories_1.completeMpesaExtractionJob)({
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
                    const matchedTransactions = await (0, mpesaReconciliationService_1.matchMpesaStatementTransactions)(extraction.transactions, client, matchingWarnings);
                    await (0, repositories_1.replaceMpesaStatementBatchExtraction)(job.batchId, {
                        originalFilename: job.originalFilename,
                        storedFilename: job.storedFilename,
                        status: extractionStatus,
                        warnings: matchingWarnings,
                        rawTextPreview: extraction.rawTextPreview,
                        transactions: matchedTransactions,
                    });
                }
                catch (error) {
                    const matchingMessage = error instanceof Error ? error.message : String(error);
                    await (0, repositories_1.replaceMpesaStatementBatchExtraction)(job.batchId, {
                        originalFilename: job.originalFilename,
                        storedFilename: job.storedFilename,
                        status: extractionStatus,
                        warnings: [...extraction.warnings, `Post-extraction matching skipped: ${matchingMessage}`],
                        rawTextPreview: extraction.rawTextPreview,
                        transactions: extraction.transactions,
                    }).catch(() => undefined);
                }
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await (0, repositories_1.markMpesaStatementBatchExtractionFailed)(job.batchId, message).catch(() => undefined);
            await (0, repositories_1.scheduleMpesaExtractionJobRetry)({ id: job.id, errorMessage: message }).catch(() => undefined);
            if (job.jobType === 'reupload' && job.retryCount + 1 >= 3) {
                await deleteStoredFile(job.storedFilename);
            }
        }
        finally {
            clearInterval(heartbeat);
        }
    }
    finally {
        processing = false;
    }
}
function startMpesaExtractionJobWorker() {
    if (workerTimer)
        return;
    workerTimer = setInterval(() => {
        void processNextMpesaExtractionJob().catch(reportWorkerError);
    }, 2000);
    void processNextMpesaExtractionJob().catch(reportWorkerError);
}
function wakeMpesaExtractionJobWorker() {
    void processNextMpesaExtractionJob().catch(reportWorkerError);
}
function stopMpesaExtractionJobWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}
