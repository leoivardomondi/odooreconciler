"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
function reportWorkerError(error) {
    const message = error instanceof Error ? error.message : String(error);
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
                odooClient: client,
            });
            await (0, repositories_1.replaceMpesaStatementBatchExtraction)(job.batchId, {
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
            await (0, repositories_1.completeMpesaExtractionJob)({
                id: job.id,
                status: 'completed',
                transactionCount: extraction.transactions.length,
            });
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
