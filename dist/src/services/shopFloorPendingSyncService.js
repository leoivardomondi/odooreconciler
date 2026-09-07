"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncPendingProcessesFromOdoo = syncPendingProcessesFromOdoo;
exports.startShopFloorPendingSyncInterval = startShopFloorPendingSyncInterval;
exports.stopShopFloorPendingSyncInterval = stopShopFloorPendingSyncInterval;
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("./odooClient");
const boardProductClassifier_1 = require("./boardProductClassifier");
const logService_1 = require("./logService");
let syncInProgress = false;
let lastSyncTimestamp = 0;
const MIN_SYNC_INTERVAL_MS = 60 * 1000; // Throttle to at most once per 60 seconds unless forced
/**
 * Ingests active MO board requirements from Odoo and stores them in MySQL (shop_floor_pending_processes).
 * Preserves locally 'loaded' items so that items logged by operators do not reappear as pending.
 */
async function syncPendingProcessesFromOdoo(force = false) {
    const now = Date.now();
    if (!force && (now - lastSyncTimestamp < MIN_SYNC_INTERVAL_MS)) {
        return { ok: true, syncedCount: 0, message: 'Sync skipped (throttled)' };
    }
    if (syncInProgress) {
        return { ok: true, syncedCount: 0, message: 'Sync already in progress' };
    }
    if ((0, odooClient_1.isOdooTrafficPaused)()) {
        return { ok: false, syncedCount: 0, message: 'Odoo traffic is currently paused' };
    }
    syncInProgress = true;
    const startTime = Date.now();
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        // 1. Fetch active MOs
        const activeMOs = await client.searchReadRecords('mrp.production', {
            domain: [['state', 'in', ['confirmed', 'progress']]],
            fields: ['id', 'name', 'state', 'origin'],
            limit: 250,
            order: 'create_date desc, id desc',
        });
        if (!activeMOs.length) {
            await (0, repositories_1.deleteStaleCompletedProcesses)(7);
            lastSyncTimestamp = Date.now();
            return { ok: true, syncedCount: 0, message: 'No active MOs found in Odoo', durationMs: Date.now() - startTime };
        }
        // 2. Fetch origin SO partners in bulk
        const originNames = [...new Set(activeMOs.map(mo => mo.origin).filter(Boolean))];
        const soPartnerMap = new Map();
        if (originNames.length > 0) {
            const soRecords = await client.searchReadRecords('sale.order', {
                domain: [['name', 'in', originNames]],
                fields: ['name', 'partner_id'],
                limit: 500,
            });
            for (const so of soRecords) {
                if (so.partner_id && Array.isArray(so.partner_id)) {
                    soPartnerMap.set(so.name, {
                        partnerId: so.partner_id[0],
                        partnerName: so.partner_id[1],
                    });
                }
            }
        }
        // 3. Fetch raw component moves for all active MOs
        const moIds = activeMOs.map(mo => mo.id);
        const rawMoves = await client.getBulkManufacturingOrderComponents(moIds);
        // 4. Filter to board components
        const boardMoves = rawMoves.filter(m => {
            const productName = Array.isArray(m.product_id) ? m.product_id[1] : '';
            return (0, boardProductClassifier_1.isBoardProductName)(productName);
        });
        if (!boardMoves.length) {
            await (0, repositories_1.deleteStaleCompletedProcesses)(7);
            lastSyncTimestamp = Date.now();
            return { ok: true, syncedCount: 0, message: 'No board components needed', durationMs: Date.now() - startTime };
        }
        // 5. Exclude components that already have purchase orders for this SO origin
        const purchaseOrders = originNames.length > 0
            ? await client.searchReadRecords('purchase.order', {
                domain: [['origin', 'in', originNames]],
                fields: ['id', 'origin'],
                limit: 500,
            })
            : [];
        const originProductPOKeys = new Set();
        if (purchaseOrders.length > 0) {
            const poIds = purchaseOrders.map(po => po.id);
            const poLines = await client.searchReadRecords('purchase.order.line', {
                domain: [['order_id', 'in', poIds]],
                fields: ['order_id', 'product_id'],
                limit: 2000,
            });
            const poOriginMap = new Map();
            for (const po of purchaseOrders) {
                if (po.origin)
                    poOriginMap.set(po.id, po.origin);
            }
            for (const line of poLines) {
                const poId = Array.isArray(line.order_id) ? line.order_id[0] : 0;
                const productId = Array.isArray(line.product_id) ? line.product_id[0] : 0;
                const origin = poOriginMap.get(poId);
                if (origin && productId) {
                    originProductPOKeys.add(`${origin}_${productId}`);
                }
            }
        }
        // 6. Build requirement records
        const recordsToUpsert = [];
        const moMap = new Map();
        for (const mo of activeMOs) {
            moMap.set(mo.id, mo);
        }
        const aggregatedMoves = new Map();
        for (const move of boardMoves) {
            const moId = Array.isArray(move.raw_material_production_id)
                ? move.raw_material_production_id[0]
                : move.raw_material_production_id;
            const mo = moMap.get(moId);
            if (!mo)
                continue;
            const productId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
            const productName = Array.isArray(move.product_id) ? move.product_id[1] : '';
            // If a PO exists for this origin and product, exclude it (procurement handled via PO)
            if (mo.origin && originProductPOKeys.has(`${mo.origin}_${productId}`)) {
                continue;
            }
            const partnerInfo = mo.origin ? soPartnerMap.get(mo.origin) : null;
            const partnerId = partnerInfo?.partnerId || 0;
            const partnerName = partnerInfo?.partnerName || 'Unknown Customer';
            const qtyNeeded = Number(move.product_uom_qty || 0);
            const qtyReserved = Number(move.quantity || 0);
            const key = `${moId}_${productId}`;
            const existing = aggregatedMoves.get(key);
            if (existing) {
                existing.qtyNeeded += qtyNeeded;
                existing.qtyReserved += qtyReserved;
            }
            else {
                aggregatedMoves.set(key, {
                    moId: mo.id,
                    moName: mo.name,
                    origin: mo.origin,
                    partnerId,
                    partnerName,
                    productId,
                    productName,
                    qtyNeeded,
                    qtyReserved,
                });
            }
        }
        for (const [key, agg] of aggregatedMoves.entries()) {
            const qtyMissing = Math.max(0, agg.qtyNeeded - agg.qtyReserved);
            if (qtyMissing > 0) {
                recordsToUpsert.push({
                    id: key,
                    process_type: 'board_intake',
                    mo_id: agg.moId,
                    mo_name: agg.moName,
                    origin: agg.origin,
                    partner_id: agg.partnerId,
                    partner_name: agg.partnerName,
                    product_id: agg.productId,
                    product_name: agg.productName,
                    qty_needed: agg.qtyNeeded,
                    qty_reserved: agg.qtyReserved,
                    qty_missing: qtyMissing,
                    status: 'pending',
                    loaded_at: null,
                    loaded_by: null,
                    last_synced_at: new Date().toISOString(),
                });
            }
        }
        // 7. Upsert into MySQL table (preserves locally loaded items)
        await (0, repositories_1.upsertPendingShopFloorProcesses)(recordsToUpsert);
        // 8. Prune stale pending rows for active MOs if components were removed or corrected in Odoo
        await (0, repositories_1.pruneStalePendingProcessesForActiveMos)(activeMOs.map((mo) => mo.id), recordsToUpsert.map((r) => r.id));
        // 9. Clean up stale completed items older than 7 days
        await (0, repositories_1.deleteStaleCompletedProcesses)(7);
        lastSyncTimestamp = Date.now();
        const durationMs = Date.now() - startTime;
        void (0, logService_1.logEvent)('info', 'Synced pending MO board requirements from Odoo to MySQL', {
            syncedCount: recordsToUpsert.length,
            durationMs,
        }).catch(() => null);
        return {
            ok: true,
            syncedCount: recordsToUpsert.length,
            message: `Successfully synchronized ${recordsToUpsert.length} pending board requirement(s) from Odoo.`,
            durationMs,
        };
    }
    catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        void (0, logService_1.logEvent)('warn', 'Failed to sync pending MO board requirements from Odoo', {
            error: errorMsg,
        }).catch(() => null);
        return {
            ok: false,
            syncedCount: 0,
            error: errorMsg,
            durationMs: Date.now() - startTime,
        };
    }
    finally {
        syncInProgress = false;
    }
}
let syncIntervalTimer = null;
const SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
function startShopFloorPendingSyncInterval() {
    if (syncIntervalTimer)
        return;
    // Trigger initial sync shortly after boot
    setTimeout(() => {
        void syncPendingProcessesFromOdoo(true).catch(() => undefined);
    }, 3000);
    syncIntervalTimer = setInterval(() => {
        void syncPendingProcessesFromOdoo(false).catch(() => undefined);
    }, SYNC_INTERVAL_MS);
    syncIntervalTimer.unref?.();
}
function stopShopFloorPendingSyncInterval() {
    if (syncIntervalTimer) {
        clearInterval(syncIntervalTimer);
        syncIntervalTimer = null;
    }
}
