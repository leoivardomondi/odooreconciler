"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShopFloorValidationJobWorkerStatus = getShopFloorValidationJobWorkerStatus;
exports.processNextShopFloorValidationJob = processNextShopFloorValidationJob;
exports.startShopFloorValidationJobWorker = startShopFloorValidationJobWorker;
exports.wakeShopFloorValidationJobWorker = wakeShopFloorValidationJobWorker;
exports.stopShopFloorValidationJobWorker = stopShopFloorValidationJobWorker;
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("./odooClient");
const helpers_1 = require("../utils/helpers");
const logService_1 = require("./logService");
const shopFloor_1 = require("../routes/shopFloor");
const stockMirrorService_1 = require("./stockMirrorService");
let workerTimer = null;
let processing = false;
let lastPollAt = null;
let lastErrorAt = null;
let lastErrorMessage = null;
function getShopFloorValidationJobWorkerStatus() {
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
    console.error('[shop-floor-validation-worker] Poll failed:', message);
    void (0, logService_1.logEvent)('error', 'Shop floor validation worker poll failed', { error: message }).catch(() => undefined);
}
async function processNextShopFloorValidationJob() {
    lastPollAt = new Date().toISOString();
    if (processing)
        return;
    processing = true;
    try {
        await (0, repositories_1.reclaimStaleShopFloorValidationJobs)(15);
        const job = await (0, repositories_1.claimNextShopFloorValidationJob)();
        if (!job)
            return;
        const heartbeat = setInterval(() => {
            void (0, repositories_1.touchShopFloorValidationJob)(job.id).catch(() => undefined);
        }, 10000);
        try {
            const settings = await (0, repositories_1.getSettings)();
            if (!(0, helpers_1.hasOdooConfiguration)(settings)) {
                throw new Error('Odoo is not configured yet. Complete setup first.');
            }
            const warehouseId = Number(settings.stock.warehouseId || 0);
            if (!warehouseId) {
                throw new Error('The Urban Vibe warehouse ID is not configured.');
            }
            const client = new odooClient_1.OdooClient({
                baseUrl: (0, helpers_1.sanitizeBaseUrl)(settings.odoo.baseUrl),
                database: settings.odoo.database,
                username: settings.odoo.username,
                apiKey: settings.odoo.apiKey,
            });
            if (job.jobType === 'receipt') {
                await client.validateBoardReceipt(job.pickingId, job.actorName || job.actorEmail, warehouseId);
                shopFloor_1.shopFloorCache.clearPrefix('shop-floor-dashboard:');
                shopFloor_1.shopFloorCache.clearPrefix('shop-floor:receipts:');
                await Promise.allSettled([
                    (0, repositories_1.deleteShopFloorSharedCachePrefix)('shop-floor:receipts:'),
                    (0, repositories_1.deleteShopFloorDashboardSnapshot)(),
                ]);
                void (0, stockMirrorService_1.refreshStockMirror)();
                await (0, logService_1.logEvent)('info', 'Odoo board receipt validated in background FIFO', {
                    pickingId: job.pickingId,
                    actor: job.actorName,
                    actorEmail: job.actorEmail,
                    jobId: job.id,
                });
            }
            else if (job.jobType === 'delivery') {
                await client.validateDelivery(job.pickingId, job.actorName || job.actorEmail, warehouseId);
                shopFloor_1.shopFloorCache.clearPrefix('shop-floor-dashboard:');
                shopFloor_1.shopFloorCache.clearPrefix('shop-floor:deliveries:');
                await Promise.allSettled([
                    (0, repositories_1.deleteShopFloorSharedCachePrefix)('shop-floor:deliveries:'),
                    (0, repositories_1.deleteShopFloorDashboardSnapshot)(),
                ]);
                await (0, logService_1.logEvent)('info', 'Odoo delivery validated in background FIFO', {
                    pickingId: job.pickingId,
                    actor: job.actorName,
                    actorEmail: job.actorEmail,
                    jobId: job.id,
                });
            }
            else {
                throw new Error(`Unsupported validation job type: ${job.jobType}`);
            }
            await (0, repositories_1.completeShopFloorValidationJob)({ id: job.id, status: 'completed' });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[shop-floor-validation-worker] Job ${job.id} for picking ${job.pickingId} failed:`, errorMessage);
            await (0, repositories_1.completeShopFloorValidationJob)({
                id: job.id,
                status: 'failed',
                errorMessage,
            }).catch(() => undefined);
            await (0, logService_1.logEvent)('warn', 'Odoo validation job failed in background', {
                jobId: job.id,
                jobType: job.jobType,
                pickingId: job.pickingId,
                error: errorMessage,
            }).catch(() => undefined);
        }
        finally {
            clearInterval(heartbeat);
        }
        // Immediately drain the next job in FIFO queue without waiting for the timer
        setImmediate(() => {
            void processNextShopFloorValidationJob().catch(reportWorkerError);
        });
    }
    finally {
        processing = false;
    }
}
function startShopFloorValidationJobWorker() {
    if (workerTimer)
        return;
    workerTimer = setInterval(() => void processNextShopFloorValidationJob().catch(reportWorkerError), 2500);
    void processNextShopFloorValidationJob().catch(reportWorkerError);
}
function wakeShopFloorValidationJobWorker() {
    void processNextShopFloorValidationJob().catch(reportWorkerError);
}
function stopShopFloorValidationJobWorker() {
    if (workerTimer) {
        clearInterval(workerTimer);
        workerTimer = null;
    }
}
