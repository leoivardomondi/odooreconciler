"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInvoiceExtractionJobWorkerStatus = getInvoiceExtractionJobWorkerStatus;
exports.startInvoiceExtractionJobWorker = startInvoiceExtractionJobWorker;
exports.wakeInvoiceExtractionJobWorker = wakeInvoiceExtractionJobWorker;
exports.stopInvoiceExtractionJobWorker = stopInvoiceExtractionJobWorker;
const promises_1 = __importDefault(require("fs/promises"));
const repositories_1 = require("../models/repositories");
const invoice_parser_1 = require("../invoice-parser");
const paths_1 = require("../utils/paths");
const logService_1 = require("./logService");
let workerTimer = null;
let processing = false;
let lastPollAt = null;
let lastErrorAt = null;
let lastErrorMessage = null;
function getInvoiceExtractionJobWorkerStatus() {
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
    console.error('[invoice-extraction-worker] Poll failed:', message);
    void (0, logService_1.logEvent)('error', 'Invoice extraction worker poll failed', { error: message }).catch(() => undefined);
}
function resolveStoredFile(filename) {
    return (0, paths_1.resolveProjectFile)(`${process.env.UPLOAD_DIR || 'uploads'}/${filename}`, 'uploads');
}
async function deleteStoredFile(filename) {
    await promises_1.default.unlink(resolveStoredFile(filename)).catch(() => undefined);
}
async function processNextInvoiceExtractionJob() {
    lastPollAt = new Date().toISOString();
    if (processing)
        return;
    processing = true;
    try {
        await (0, repositories_1.reclaimStaleInvoiceExtractionJobs)();
        const job = await (0, repositories_1.claimNextInvoiceExtractionJob)();
        if (!job)
            return;
        const heartbeat = setInterval(() => {
            void (0, repositories_1.touchInvoiceExtractionJob)(job.id).catch(() => undefined);
        }, 15000);
        try {
            await (0, repositories_1.updateInvoiceExtractionJobProgress)({ id: job.id, stage: 'loading_settings', progress: 10 });
            const settings = await (0, repositories_1.getSettings)();
            await (0, repositories_1.updateInvoiceExtractionJobProgress)({ id: job.id, stage: 'extracting_invoice', progress: 20 });
            const result = await (0, invoice_parser_1.parseSupplierInvoice)({
                filePath: resolveStoredFile(job.storedFilename),
                originalFilename: job.originalFilename,
                preferredOcr: job.preferredOcr,
                aiConfig: settings.ai,
            });
            await (0, repositories_1.updateInvoiceExtractionJobProgress)({ id: job.id, stage: 'saving_result', progress: 95 });
            await (0, repositories_1.completeInvoiceExtractionJob)({ id: job.id, status: 'completed', result });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await (0, repositories_1.scheduleInvoiceExtractionJobRetry)({ id: job.id, errorMessage: message }).catch(() => undefined);
        }
        finally {
            clearInterval(heartbeat);
            if (job.retryCount + 1 >= 3) {
                await deleteStoredFile(job.storedFilename);
            }
        }
    }
    finally {
        processing = false;
    }
}
function startInvoiceExtractionJobWorker() {
    if (workerTimer)
        return;
    workerTimer = setInterval(() => {
        void processNextInvoiceExtractionJob().catch(reportWorkerError);
    }, 2000);
    void processNextInvoiceExtractionJob().catch(reportWorkerError);
}
function wakeInvoiceExtractionJobWorker() {
    void processNextInvoiceExtractionJob().catch(reportWorkerError);
}
function stopInvoiceExtractionJobWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}
