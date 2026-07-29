"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncBoardIntakeEntry = syncBoardIntakeEntry;
exports.retryDueBoardIntakeEntries = retryDueBoardIntakeEntries;
exports.startBoardIntakeSyncInterval = startBoardIntakeSyncInterval;
const repositories_1 = require("../models/repositories");
const repositories_2 = require("../models/repositories");
const stockMirrorService_1 = require("./stockMirrorService");
const logService_1 = require("./logService");
const odooClient_1 = require("./odooClient");
const boardProductClassifier_1 = require("./boardProductClassifier");
const AUTO_RETRY_INTERVAL_MS = 2 * 60 * 1000;
let intervalHandle = null;
let batchPromise = null;
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
async function syncBoardIntakeEntry(id) {
    let entry = await (0, repositories_1.getBoardIntakeQueueEntry)(id);
    if (!entry)
        throw new Error('Board log was not found.');
    if (entry.status === 'synced')
        return { alreadySynced: true, stockQuantity: entry.odoo_stock_quantity };
    if (entry.status === 'processing') {
        throw new Error('This board log is already synchronizing with Odoo.');
    }
    if (!await (0, repositories_1.claimBoardIntakeQueueEntry)(id)) {
        throw new Error('This board log was claimed by another synchronization attempt.');
    }
    try {
        entry = (await (0, repositories_1.getBoardIntakeQueueEntry)(id));
        const settings = await (0, repositories_2.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        // Persist this checkpoint immediately. If a later Odoo request fails, the
        // retry skips the inventory addition and cannot double-add the boards.
        let stockQuantity = entry.odoo_stock_quantity;
        if (stockQuantity == null) {
            if (!(0, boardProductClassifier_1.isBoardProductName)(entry.product_name)) {
                throw new Error(`${entry.product_name} is not recognized as a physical board. Services and non-board products cannot receive stock quantities.`);
            }
            const stockable = await client.ensureBoardProductIsStockable(Number(entry.product_id));
            if (stockable.changed) {
                await (0, logService_1.logEvent)('warn', 'Odoo board product changed from consumable to stockable', {
                    boardIntakeId: id,
                    productId: entry.product_id,
                    productTemplateId: stockable.templateId,
                    productName: stockable.productName,
                }).catch(() => undefined);
            }
            const stockResult = await client.addBoardsToStock({
                productId: Number(entry.product_id),
                quantity: Number(entry.quantity),
            });
            stockQuantity = stockResult.newQty;
            await (0, repositories_1.updateBoardIntakeQueueEntry)(id, {
                status: 'processing',
                stockQuantity,
            });
            await (0, stockMirrorService_1.recordExactStockQuantity)(Number(entry.product_id), entry.product_name, stockQuantity);
        }
        const matchingMOs = await client.findMOsForBoardIntake({
            productId: Number(entry.product_id),
            partnerId: Number(entry.partner_id),
        });
        if (matchingMOs.length) {
            const reportDate = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Africa/Nairobi',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(new Date());
            const note = `<p><strong>Boards logged in Shop Flow</strong><br/>User: ${escapeHtml(entry.actor_name)}<br/>Client: ${escapeHtml(entry.customer_name)}<br/>Board: ${escapeHtml(entry.product_name)}<br/>Quantity: ${Number(entry.quantity)}<br/>Date: ${reportDate}</p>`;
            await Promise.all(matchingMOs.map((mo) => client.postModelChatterMessage('mrp.production', mo.moId, note).catch(() => null)));
            await client.reserveStockOnMOs(matchingMOs.map((mo) => mo.moId));
        }
        await (0, repositories_1.updateBoardIntakeQueueEntry)(id, { status: 'synced', stockQuantity });
        void (0, stockMirrorService_1.refreshStockMirror)();
        await (0, logService_1.logEvent)('info', 'Board intake synchronized with Odoo', {
            boardIntakeId: id,
            productId: entry.product_id,
            partnerId: entry.partner_id,
            quantity: entry.quantity,
            retryCount: entry.retry_count,
            matchingMoCount: matchingMOs.length,
        }).catch(() => undefined);
        return { alreadySynced: false, stockQuantity, matchingMoCount: matchingMOs.length };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await (0, repositories_1.updateBoardIntakeQueueEntry)(id, { status: 'failed', errorMessage: message }).catch(() => undefined);
        await (0, logService_1.logEvent)('error', 'Board intake Odoo synchronization failed', {
            boardIntakeId: id,
            error: message,
        }).catch(() => undefined);
        throw error;
    }
}
async function retryDueBoardIntakeEntries() {
    if (batchPromise)
        return batchPromise;
    batchPromise = (async () => {
        const due = await (0, repositories_1.getDueBoardIntakeQueueEntries)(5);
        for (const entry of due) {
            if (entry.status === 'processing') {
                await (0, repositories_1.releaseStaleBoardIntakeQueueEntry)(entry.id);
            }
            await syncBoardIntakeEntry(entry.id).catch(() => undefined);
        }
    })().finally(() => {
        batchPromise = null;
    });
    return batchPromise;
}
function startBoardIntakeSyncInterval() {
    if (intervalHandle)
        return;
    setTimeout(() => void retryDueBoardIntakeEntries(), 10_000).unref();
    intervalHandle = setInterval(() => void retryDueBoardIntakeEntries(), AUTO_RETRY_INTERVAL_MS);
    intervalHandle.unref();
}
