import {
  getSettings,
  upsertPendingShopFloorProcesses,
  deleteStaleCompletedProcesses,
  pruneStalePendingProcessesForActiveMos,
  getActiveBoardIntakeLogs,
} from '../models/repositories';
import { OdooClient, isOdooTrafficPaused } from './odooClient';
import { isBoardProductName, normalizeBoardProductName } from './boardProductClassifier';
import { extractSoNameFromOrigin } from './poJobSummaryAuditService';
import { PendingShopFloorProcess } from '../models/types';
import { logEvent } from './logService';

let syncInProgress = false;
let lastSyncTimestamp = 0;
const MIN_SYNC_INTERVAL_MS = 60 * 1000; // Throttle to at most once per 60 seconds unless forced

export interface SyncPendingProcessesResult {
  ok: boolean;
  syncedCount: number;
  message?: string;
  error?: string;
  durationMs?: number;
}

/**
 * Ingests active MO board requirements from Odoo and stores them in MySQL (shop_floor_pending_processes).
 * Preserves locally 'loaded' items so that items logged by operators do not reappear as pending.
 */
export async function syncPendingProcessesFromOdoo(force = false): Promise<SyncPendingProcessesResult> {
  const now = Date.now();
  if (!force && (now - lastSyncTimestamp < MIN_SYNC_INTERVAL_MS)) {
    return { ok: true, syncedCount: 0, message: 'Sync skipped (throttled)' };
  }

  if (syncInProgress) {
    return { ok: true, syncedCount: 0, message: 'Sync already in progress' };
  }

  if (isOdooTrafficPaused()) {
    return { ok: false, syncedCount: 0, message: 'Odoo traffic is currently paused' };
  }

  syncInProgress = true;
  const startTime = Date.now();

  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);

    const targetCompanyId = await client.getTargetCompanyIdValue();

    // 1. Fetch active MOs strictly belonging to target company (excluding URBAN VIBE 2)
    const rawActiveMOs = await client.searchReadRecords<{
      id: number;
      name: string;
      state: string;
      origin: string | null;
    }>('mrp.production', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', 'in', ['confirmed', 'progress', 'to_close']],
      ],
      fields: ['id', 'name', 'state', 'origin'],
      limit: 250,
      order: 'create_date desc, id desc',
    });

    const activeMOs = rawActiveMOs.filter(
      (mo) => !String(mo.name || '').toUpperCase().startsWith('VA/')
    );

    if (!activeMOs.length) {
      await deleteStaleCompletedProcesses(7);
      lastSyncTimestamp = Date.now();
      return { ok: true, syncedCount: 0, message: 'No active MOs found in Odoo', durationMs: Date.now() - startTime };
    }

    // 2. Fetch origin SO partners in bulk for target company
    const originNames = [...new Set(
      activeMOs.flatMap(mo => [
        mo.origin,
        extractSoNameFromOrigin(mo.origin),
        mo.name,
      ]).filter(Boolean) as string[]
    )];
    const soPartnerMap = new Map<string, { partnerId: number; partnerName: string }>();

    if (originNames.length > 0) {
      const soRecords = await client.searchReadRecords<{
        name: string;
        partner_id: [number, string] | false;
      }>('sale.order', {
        domain: [
          ['company_id', '=', targetCompanyId],
          ['name', 'in', originNames],
        ],
        fields: ['name', 'partner_id'],
        limit: 500,
      });

      for (const so of soRecords) {
        if (so.partner_id && Array.isArray(so.partner_id)) {
          const pId = so.partner_id[0];
          const pName = so.partner_id[1];
          if (pId !== 350 && pName.toUpperCase() !== 'URBAN VIBE 2') {
            soPartnerMap.set(so.name, {
              partnerId: pId,
              partnerName: pName,
            });
          }
        }
      }
    }

    // 3. Fetch raw component moves for all active MOs
    const moIds = activeMOs.map(mo => mo.id);
    const rawMoves = await client.getBulkManufacturingOrderComponents(moIds);

    // 4. Filter to board components
    const boardMoves = rawMoves.filter(m => {
      const productName = Array.isArray(m.product_id) ? m.product_id[1] : '';
      return isBoardProductName(productName);
    });

    if (!boardMoves.length) {
      await deleteStaleCompletedProcesses(7);
      lastSyncTimestamp = Date.now();
      return { ok: true, syncedCount: 0, message: 'No board components needed', durationMs: Date.now() - startTime };
    }

    const moMap = new Map<number, typeof activeMOs[0]>();
    for (const mo of activeMOs) {
      moMap.set(mo.id, mo);
    }

    // 5. Exclude components that have active purchase orders (state != 'cancel') in target company
    // Any active PO in draft, sent, to approve, purchase, or done indicates stock is expected from vendor delivery
    const relevantOriginNames = [...new Set(
      boardMoves.flatMap(m => {
        const rmId = Array.isArray(m.raw_material_production_id) ? m.raw_material_production_id[0] : m.raw_material_production_id;
        const mo = moMap.get(rmId);
        if (!mo) return [];
        return [mo.origin, extractSoNameFromOrigin(mo.origin), mo.name].filter(Boolean) as string[];
      })
    )];

    const originProductPOKeys = new Set<string>();
    const poCoveredKeys = new Set<string>();

    if (relevantOriginNames.length > 0) {
      try {
        const purchaseOrders = await client.searchReadRecords<{
          id: number;
          name: string;
          origin: string | false;
          state: string;
        }>('purchase.order', {
          domain: [
            ['company_id', '=', targetCompanyId],
            ['state', '!=', 'cancel'],
            ['origin', 'in', relevantOriginNames],
          ],
          fields: ['id', 'name', 'origin', 'state'],
          limit: 300,
          timeoutMs: 35000,
        });

        if (purchaseOrders.length > 0) {
          const poIds = purchaseOrders.map(po => po.id);
          const poLines = await client.searchReadRecords<{
            order_id: [number, string];
            product_id: [number, string] | false;
            name: string;
          }>('purchase.order.line', {
            domain: [['order_id', 'in', poIds]],
            fields: ['order_id', 'product_id', 'name'],
            limit: 1000,
            timeoutMs: 35000,
          });

          const poOriginMap = new Map<number, string[]>();
          for (const po of purchaseOrders) {
            if (po.origin) {
              const keys = [po.origin];
              const extracted = extractSoNameFromOrigin(po.origin);
              if (extracted) keys.push(extracted);
              if (po.origin.includes(':')) {
                po.origin.split(':').forEach(part => {
                  const p = part.trim();
                  if (p) keys.push(p);
                });
              }
              poOriginMap.set(po.id, keys);
            }
          }

          for (const line of poLines) {
            const poId = Array.isArray(line.order_id) ? line.order_id[0] : 0;
            const productId = Array.isArray(line.product_id) ? line.product_id[0] : 0;
            const productName = line.name || (Array.isArray(line.product_id) ? line.product_id[1] : '');
            const normalizedPoProdName = normalizeBoardProductName(productName);
            const isBoardLine = isBoardProductName(productName);
            if (!isBoardLine && !productId) continue;

            const origins = poOriginMap.get(poId) || [];
            for (const orig of origins) {
              if (productId) {
                originProductPOKeys.add(`${orig}_${productId}`);
              }
              if (normalizedPoProdName) {
                originProductPOKeys.add(`${orig}_${normalizedPoProdName}`);
              }
            }
          }
        }
      } catch (poError) {
        void logEvent('warn', 'Could not query purchase orders during pending MO sync (continuing without PO exclusion)', {
          error: poError instanceof Error ? poError.message : String(poError),
        }).catch(() => null);
      }
    }

    // 6. Build requirement records
    const recordsToUpsert: PendingShopFloorProcess[] = [];
    const activeLogs = await getActiveBoardIntakeLogs();

    const aggregatedMoves = new Map<string, {
      moId: number;
      moName: string;
      origin: string | null;
      partnerId: number;
      partnerName: string;
      productId: number;
      productName: string;
      qtyNeeded: number;
      qtyReserved: number;
    }>();

    for (const move of boardMoves) {
      const moId = Array.isArray(move.raw_material_production_id)
        ? move.raw_material_production_id[0]
        : move.raw_material_production_id;
      const mo = moMap.get(moId);
      if (!mo || String(mo.name || '').toUpperCase().startsWith('VA/')) continue;

      const productId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
      const productName = Array.isArray(move.product_id) ? move.product_id[1] : '';
      const normalizedMoveProdName = normalizeBoardProductName(productName);

      // If an active PO exists for this origin/MO and product, exclude it (procured via vendor delivery, not gate log)
      const soOrigin = mo.origin ? extractSoNameFromOrigin(mo.origin) : null;
      const poCovered = Boolean(
        (mo.origin && (originProductPOKeys.has(`${mo.origin}_${productId}`) || originProductPOKeys.has(`${mo.origin}_${normalizedMoveProdName}`))) ||
        (soOrigin && (originProductPOKeys.has(`${soOrigin}_${productId}`) || originProductPOKeys.has(`${soOrigin}_${normalizedMoveProdName}`))) ||
        originProductPOKeys.has(`${mo.name}_${productId}`) ||
        originProductPOKeys.has(`${mo.name}_${normalizedMoveProdName}`)
      );

      if (poCovered) {
        poCoveredKeys.add(`${moId}_${productId}`);
        continue;
      }

      const partnerInfo = mo.origin ? (soPartnerMap.get(mo.origin) || (soOrigin ? soPartnerMap.get(soOrigin) : null)) : null;
      const partnerId = partnerInfo?.partnerId || 0;
      const partnerName = partnerInfo?.partnerName || 'Unknown Customer';
      if (partnerId === 350 || partnerName.toUpperCase() === 'URBAN VIBE 2') {
        continue;
      }

      const qtyNeeded = Number(move.product_uom_qty || 0);
      const qtyReserved = Number(move.quantity || 0);
      const key = `${moId}_${productId}`;

      const existing = aggregatedMoves.get(key);
      if (existing) {
        existing.qtyNeeded += qtyNeeded;
        existing.qtyReserved += qtyReserved;
      } else {
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
      const cleanCustomer = String(agg.partnerName || '').trim().toLowerCase();
      const cleanProduct = String(agg.productName || '').trim().toLowerCase();

      const matchingLogs = activeLogs.filter((log) => {
        const logPid = Number(log.partner_id || 0);
        const logProdId = Number(log.product_id || 0);
        const logCust = String(log.customer_name || '').trim().toLowerCase();
        const logProd = String(log.product_name || '').trim().toLowerCase();

        const custMatch = Boolean(
          (agg.partnerId > 0 && logPid > 0 && agg.partnerId === logPid) ||
          (cleanCustomer && (logCust.includes(cleanCustomer) || cleanCustomer.includes(logCust)))
        );
        const prodMatch = Boolean(
          (agg.productId > 0 && logProdId > 0 && agg.productId === logProdId) ||
          (cleanProduct && (logProd.includes(cleanProduct) || cleanProduct.includes(logProd)))
        );
        return custMatch && prodMatch;
      });

      const totalLogged = matchingLogs.reduce((sum, l) => sum + Number(l.quantity || 0), 0);
      const isFulfilledByHistoryLog = totalLogged >= agg.qtyNeeded;

      // RULE: "make sure that a board log request under add stock area only disappears if a history log that matches it appears"
      // Even if Odoo shop floor closed the job or reserved someone else's stock (agg.qtyReserved >= agg.qtyNeeded),
      // if NO history log exists for this customer and product, the customer's boards have NOT been logged at the gate!
      const qtyMissing = isFulfilledByHistoryLog ? 0 : Math.max(0, agg.qtyNeeded - totalLogged);

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
          qty_reserved: totalLogged,
          qty_missing: qtyMissing,
          status: 'pending',
          loaded_at: null,
          loaded_by: null,
          last_synced_at: new Date().toISOString(),
        });
      }
    }

    // 7. Upsert into MySQL table (preserves locally loaded items)
    await upsertPendingShopFloorProcesses(recordsToUpsert);

    // 8. Prune stale pending rows for active MOs if components were removed or corrected in Odoo
    // Any PO-covered keys are explicitly purged so they do not linger in the Add Stock area
    await pruneStalePendingProcessesForActiveMos(
      activeMOs.map((mo) => mo.id),
      recordsToUpsert.map((r) => r.id),
      Array.from(poCoveredKeys),
    );

    // 9. Clean up stale completed items older than 7 days
    await deleteStaleCompletedProcesses(7);

    lastSyncTimestamp = Date.now();
    const durationMs = Date.now() - startTime;

    void logEvent('info', 'Synced pending MO board requirements from Odoo to MySQL', {
      syncedCount: recordsToUpsert.length,
      durationMs,
    }).catch(() => null);

    return {
      ok: true,
      syncedCount: recordsToUpsert.length,
      message: `Successfully synchronized ${recordsToUpsert.length} pending board requirement(s) from Odoo.`,
      durationMs,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    void logEvent('warn', 'Failed to sync pending MO board requirements from Odoo', {
      error: errorMsg,
    }).catch(() => null);
    return {
      ok: false,
      syncedCount: 0,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    };
  } finally {
    syncInProgress = false;
  }
}

let syncIntervalTimer: NodeJS.Timeout | null = null;
const SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

export function startShopFloorPendingSyncInterval() {
  if (syncIntervalTimer) return;
  // Trigger initial sync shortly after boot
  setTimeout(() => {
    void syncPendingProcessesFromOdoo(true).catch(() => undefined);
  }, 3000);

  syncIntervalTimer = setInterval(() => {
    void syncPendingProcessesFromOdoo(false).catch(() => undefined);
  }, SYNC_INTERVAL_MS);
  syncIntervalTimer.unref?.();
}

export function stopShopFloorPendingSyncInterval() {
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
    syncIntervalTimer = null;
  }
}
