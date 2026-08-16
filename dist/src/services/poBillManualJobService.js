"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPoBillManualJobWorkerStatus = getPoBillManualJobWorkerStatus;
exports.startPoBillManualJobWorker = startPoBillManualJobWorker;
exports.wakePoBillManualJobWorker = wakePoBillManualJobWorker;
exports.stopPoBillManualJobWorker = stopPoBillManualJobWorker;
const repositories_1 = require("../models/repositories");
const poBillAutomationService_1 = require("./poBillAutomationService");
const odooClient_1 = require("./odooClient");
const helpers_1 = require("../utils/helpers");
const logService_1 = require("./logService");
let workerTimer = null;
let processing = false;
let lastPollAt = null;
let lastErrorAt = null;
let lastErrorMessage = null;
function getPoBillManualJobWorkerStatus() {
    return { running: Boolean(workerTimer), lastPollAt, lastErrorAt, lastErrorMessage };
}
function reportWorkerError(error) {
    const message = error instanceof Error ? error.message : String(error);
    lastErrorAt = new Date().toISOString();
    lastErrorMessage = message;
    console.error('[po-bill-manual-worker] Poll failed:', message);
    void (0, logService_1.logEvent)('error', 'PO bill manual worker poll failed', { error: message }).catch(() => undefined);
}
async function processNextPoBillManualJob() {
    lastPollAt = new Date().toISOString();
    if (processing)
        return;
    processing = true;
    try {
        await (0, repositories_1.reclaimStalePoBillManualJobs)();
        const job = await (0, repositories_1.claimNextPoBillManualJob)();
        if (!job)
            return;
        const heartbeat = setInterval(() => {
            void (0, repositories_1.touchPoBillManualJob)(job.id).catch(() => undefined);
        }, 15000);
        try {
            const settings = await (0, repositories_1.getSettings)();
            if (!(0, helpers_1.hasOdooConfiguration)(settings))
                throw new Error('Odoo is not configured yet. Complete setup first.');
            const client = new odooClient_1.OdooClient({
                baseUrl: (0, helpers_1.sanitizeBaseUrl)(settings.odoo.baseUrl),
                database: settings.odoo.database,
                username: settings.odoo.username,
                apiKey: settings.odoo.apiKey,
            });
            const result = await (0, poBillAutomationService_1.runPoBillAutomation)(client, {
                attachmentId: job.attachmentId,
                purchaseOrderSearch: job.purchaseOrderSearch,
                mode: job.mode,
                aiConfig: settings.ai,
            });
            await (0, repositories_1.completePoBillManualJob)({ id: job.id, status: 'completed', result });
        }
        catch (error) {
            await (0, repositories_1.completePoBillManualJob)({
                id: job.id,
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : String(error),
            }).catch(() => undefined);
        }
        finally {
            clearInterval(heartbeat);
        }
    }
    finally {
        processing = false;
    }
}
function startPoBillManualJobWorker() {
    if (workerTimer)
        return;
    workerTimer = setInterval(() => void processNextPoBillManualJob().catch(reportWorkerError), 2000);
    void processNextPoBillManualJob().catch(reportWorkerError);
}
function wakePoBillManualJobWorker() {
    void processNextPoBillManualJob().catch(reportWorkerError);
}
function stopPoBillManualJobWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}
