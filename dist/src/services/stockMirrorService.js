"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockMirrorAgeMs = stockMirrorAgeMs;
exports.refreshStockMirror = refreshStockMirror;
exports.getStockMirrorForPage = getStockMirrorForPage;
exports.recordExactStockQuantity = recordExactStockQuantity;
exports.recordOptimisticStockAddition = recordOptimisticStockAddition;
exports.startStockMirrorInterval = startStockMirrorInterval;
const repositories_1 = require("../models/repositories");
const env_1 = require("../utils/env");
const helpers_1 = require("../utils/helpers");
const dateTime_1 = require("../utils/dateTime");
const logService_1 = require("./logService");
const odooClient_1 = require("./odooClient");
const FRESH_MS = 5 * 60 * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_REFRESH_WAIT_MS = 10 * 1000;
let refreshPromise = null;
let intervalHandle = null;
function timestampMs(value) {
    if (!value)
        return 0;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T') + '+03:00';
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}
function isOperatingTime() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    if (weekday === 'Sun')
        return false;
    return weekday === 'Sat' ? hour >= 8 && hour < 14 : hour >= 8 && hour < 17;
}
function stockMirrorAgeMs(entries) {
    return entries.length ? Math.max(0, Date.now() - Math.max(...entries.map((entry) => timestampMs(entry.syncedAt)))) : Number.POSITIVE_INFINITY;
}
async function refreshStockMirror() {
    if (refreshPromise)
        return refreshPromise;
    refreshPromise = (async () => {
        try {
            const settings = await (0, repositories_1.getSettings)();
            if (!(0, helpers_1.hasOdooConfiguration)(settings))
                return (0, repositories_1.getStockProductMirror)();
            const warehouseId = Number(settings.stock.warehouseId || 0) || undefined;
            const products = await new odooClient_1.OdooClient(settings.odoo).getBoardProducts(warehouseId);
            const syncedAt = (0, dateTime_1.appDateTime)();
            await (0, repositories_1.upsertStockProductMirror)(products.map((product) => ({
                productId: product.id, productName: product.name, availableQty: product.qty_available,
                freeQty: product.free_qty, forecastQty: product.virtual_available,
                incomingQty: product.incoming_qty, outgoingQty: product.outgoing_qty,
                warehouseId: warehouseId || null, syncedAt,
                syncStatus: 'current', syncError: null,
            })));
            return (0, repositories_1.getStockProductMirror)();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await (0, repositories_1.markStockProductMirrorSyncFailed)(message).catch(() => undefined);
            await (0, logService_1.logEvent)('error', 'Stock mirror refresh failed', { error: message }).catch(() => undefined);
            return (0, repositories_1.getStockProductMirror)();
        }
        finally {
            refreshPromise = null;
        }
    })();
    return refreshPromise;
}
async function getStockMirrorForPage(forceRefresh = false) {
    let entries = await (0, repositories_1.getStockProductMirror)();
    const ageMs = stockMirrorAgeMs(entries);
    if (!entries.length) {
        entries = await refreshStockMirror();
    }
    else if (forceRefresh) {
        entries = await Promise.race([
            refreshStockMirror(),
            new Promise((resolve) => {
                setTimeout(() => resolve(entries), PAGE_REFRESH_WAIT_MS);
            }),
        ]);
    }
    else if (ageMs > FRESH_MS) {
        void refreshStockMirror();
    }
    const finalAgeMs = stockMirrorAgeMs(entries);
    return {
        products: entries.map((entry) => ({
            id: entry.productId, name: entry.productName, qty_available: entry.availableQty,
            free_qty: entry.freeQty, virtual_available: entry.forecastQty,
            incoming_qty: entry.incomingQty, outgoing_qty: entry.outgoingQty,
            stock_sync_status: entry.syncStatus,
            stock_availability: entry.freeQty > 0 ? 'available' : entry.incomingQty > 0 ? 'incoming' : 'missing',
        })),
        syncedAt: entries.map((entry) => entry.syncedAt).filter(Boolean).sort().at(-1) || null,
        isFresh: finalAgeMs <= FRESH_MS && entries.every((entry) => entry.syncStatus !== 'failed'),
        isRefreshing: Boolean(refreshPromise),
    };
}
async function recordExactStockQuantity(productId, productName, quantity, addedQuantity = 0) {
    const existing = (await (0, repositories_1.getStockProductMirror)()).find((entry) => entry.productId === productId);
    if (existing) {
        await (0, repositories_1.upsertStockProductMirror)([{
                ...existing, productName, availableQty: quantity,
                freeQty: Math.max(0, existing.freeQty + addedQuantity),
                forecastQty: existing.forecastQty + addedQuantity,
                syncedAt: (0, dateTime_1.appDateTime)(), syncStatus: 'current', syncError: null,
            }]);
        return;
    }
    await (0, repositories_1.upsertStockProductMirror)([{
            productId, productName, availableQty: quantity, freeQty: quantity, forecastQty: quantity,
            incomingQty: 0, outgoingQty: 0, warehouseId: null, syncedAt: (0, dateTime_1.appDateTime)(),
            syncStatus: 'current', syncError: null,
        }]);
}
async function recordOptimisticStockAddition(productId, productName, quantity) {
    const existing = (await (0, repositories_1.getStockProductMirror)()).find((entry) => entry.productId === productId);
    await (0, repositories_1.upsertStockProductMirror)([{
            productId, productName,
            availableQty: (existing?.availableQty || 0) + quantity,
            freeQty: (existing?.freeQty || 0) + quantity,
            forecastQty: (existing?.forecastQty || 0) + quantity,
            incomingQty: existing?.incomingQty || 0,
            outgoingQty: existing?.outgoingQty || 0,
            warehouseId: existing?.warehouseId || null,
            syncedAt: existing?.syncedAt || (0, dateTime_1.appDateTime)(),
            syncStatus: 'pending', syncError: null,
        }]);
}
function startStockMirrorInterval() {
    if (intervalHandle)
        return;
    void refreshStockMirror();
    intervalHandle = setInterval(() => {
        if (isOperatingTime())
            void refreshStockMirror();
    }, REFRESH_INTERVAL_MS);
    intervalHandle.unref();
}
