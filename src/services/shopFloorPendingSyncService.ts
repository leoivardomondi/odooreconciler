import {
  getSettings,
  upsertPendingShopFloorProcesses,
  deleteStaleCompletedProcesses,
  pruneStalePendingProcessesForActiveMos,
  getActiveBoardIntakeLogs,
  markPendingShopFloorProcessesLoaded,
  deleteShopFloorSharedCachePrefix,
} from '../models/repositories';
import { OdooClient, isOdooTrafficPaused } from './odooClient';
import {
  isBoardProductName,
  normalizeBoardProductName,
  extractBoardAttributes,
  areSameColorFamily,
} from './boardProductClassifier';
import { extractSoNameFromOrigin } from './poJobSummaryAuditService';
import { PendingShopFloorProcess } from '../models/types';
import { logEvent } from './logService';
import { escapeHtml } from './boardIntakeSyncService';
import { shopFloorCache } from '../routes/shopFloor';

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
      create_date?: string;
    }>('mrp.production', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', 'in', ['confirmed', 'progress', 'to_close']],
      ],
      fields: ['id', 'name', 'state', 'origin', 'create_date'],
      limit: 250,
      order: 'create_date desc, id desc',
    });

    const activeMOs = rawActiveMOs.filter(
      (mo) => !String(mo.name || '').toUpperCase().startsWith('VA/')
    );

    // 1b. Fetch recently completed MOs (since October 19th, 2026 or last 7 days) to detect any work orders closed without stock logged
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const closedCutoffDate = '2026-10-19 00:00:00' < sevenDaysAgo ? '2026-10-19 00:00:00' : sevenDaysAgo;
    const rawRecentlyClosedMOs = await client.searchReadRecords<{
      id: number;
      name: string;
      state: string;
      origin: string | null;
    }>('mrp.production', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', '=', 'done'],
        ['write_date', '>=', closedCutoffDate],
      ],
      fields: ['id', 'name', 'state', 'origin'],
      limit: 200,
      order: 'write_date desc, id desc',
    }).catch(() => []);

    const recentlyClosedMOs = rawRecentlyClosedMOs.filter(
      (mo) => !String(mo.name || '').toUpperCase().startsWith('VA/')
    );

    const allMOs = [...activeMOs, ...recentlyClosedMOs];

    if (!allMOs.length) {
      await deleteStaleCompletedProcesses(7);
      lastSyncTimestamp = Date.now();
      return { ok: true, syncedCount: 0, message: 'No active or recently closed MOs found in Odoo', durationMs: Date.now() - startTime };
    }

    // 2. Fetch origin SO partners in bulk for target company
    const originNames = [...new Set(
      allMOs.flatMap(mo => [
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
            const entry = {
              partnerId: pId,
              partnerName: pName,
            };
            soPartnerMap.set(so.name, entry);
            soPartnerMap.set(so.name.trim(), entry);
            soPartnerMap.set(so.name.trim().toUpperCase(), entry);
            const cleanSo = extractSoNameFromOrigin(so.name);
            if (cleanSo) {
              soPartnerMap.set(cleanSo, entry);
              soPartnerMap.set(cleanSo.trim().toUpperCase(), entry);
            }
          }
        }
      }
    }

    // 3. Fetch raw component moves for all active and recently closed MOs
    const moIds = allMOs.map(mo => mo.id);
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

    const moMap = new Map<number, (typeof allMOs)[0]>();
    for (const mo of allMOs) {
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
          const poNames = purchaseOrders.map(po => po.name).filter(Boolean);

          // Find open incoming pickings (deliveries actually still expected from vendor in /shop-floor/receipts)
          const openIncomingPickings = await client.searchReadRecords<{
            id: number;
            origin: string | false;
            state: string;
          }>('stock.picking', {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['picking_type_code', '=', 'incoming'],
              ['state', 'in', ['waiting', 'confirmed', 'assigned']],
              '|',
              ['origin', 'in', poNames],
              ['origin', 'in', relevantOriginNames],
            ],
            fields: ['id', 'origin', 'state'],
            limit: 500,
            timeoutMs: 35000,
          }).catch(() => []);

          const activeIncomingOrigins = new Set<string>();
          for (const pick of openIncomingPickings) {
            if (pick.origin) {
              const origStr = String(pick.origin).trim();
              activeIncomingOrigins.add(origStr);
              const extracted = extractSoNameFromOrigin(origStr);
              if (extracted) activeIncomingOrigins.add(extracted);
              if (origStr.includes(':')) {
                origStr.split(':').forEach(part => {
                  const p = part.trim();
                  if (p) activeIncomingOrigins.add(p);
                });
              }
            }
          }

          // A PO only covers a requirement if it actually has an active incoming receipt pending reception in /shop-floor/receipts.
          // If all receipts are already done or returned to vendor, the MO shortage is NOT covered and must appear under Stock Needed!
          const activePoIds = new Set<number>();
          for (const po of purchaseOrders) {
            const hasOpenReceipt = activeIncomingOrigins.has(po.name) ||
              (po.origin && (
                activeIncomingOrigins.has(po.origin) ||
                (extractSoNameFromOrigin(po.origin) && activeIncomingOrigins.has(extractSoNameFromOrigin(po.origin)!))
              ));
            if (hasOpenReceipt) {
              activePoIds.add(po.id);
            }
          }

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
            if (!activePoIds.has(poId)) continue;
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

      const originKey = mo.origin ? mo.origin.trim() : '';
      const partnerInfo = originKey
        ? (soPartnerMap.get(originKey) ||
           soPartnerMap.get(originKey.toUpperCase()) ||
           (soOrigin ? (soPartnerMap.get(soOrigin) || soPartnerMap.get(soOrigin.trim().toUpperCase())) : null) ||
           soPartnerMap.get(mo.name) ||
           soPartnerMap.get(mo.name.trim().toUpperCase()))
        : (soPartnerMap.get(mo.name) || soPartnerMap.get(mo.name.trim().toUpperCase()) || null);
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

    // Create a pool of available quantities from active non-reverted board intake logs
    const logPool = new Map<string, number>();
    for (const log of activeLogs) {
      logPool.set(log.id, Number(log.quantity || 0));
    }

    for (const [key, agg] of aggregatedMoves.entries()) {
      const cleanCustomer = String(agg.partnerName || '').trim().toLowerCase();
      const cleanProduct = String(agg.productName || '').trim().toLowerCase();

      // Allocate from available active non-reverted intake logs
      let allocatedFromLogs = 0;
      let remainingNeeded = agg.qtyNeeded;

      for (const log of activeLogs) {
        if (remainingNeeded <= 0) break;
        const availableInLog = logPool.get(log.id) || 0;
        if (availableInLog <= 0) continue;

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

        if (custMatch && prodMatch) {
          const toAllocate = Math.min(remainingNeeded, availableInLog);
          allocatedFromLogs += toAllocate;
          remainingNeeded -= toAllocate;
          logPool.set(log.id, availableInLog - toAllocate);
        }
      }

      // RULE: "make sure that a board log request under add stock area only disappears if a history log that matches it appears"
      // Even if Odoo shop floor closed the job or reserved someone else's stock (agg.qtyReserved >= agg.qtyNeeded),
      // if NO non-reverted history log exists for this customer and product, the customer's boards have NOT been logged at the gate!
      const qtyMissing = Math.max(0, agg.qtyNeeded - allocatedFromLogs);
      const mo = moMap.get(agg.moId);
      const isMoClosed = mo ? (mo.state === 'done' || mo.state === 'to_close') : false;

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
        qty_reserved: Math.min(agg.qtyNeeded, allocatedFromLogs),
        qty_missing: qtyMissing,
        status: qtyMissing > 0 ? 'pending' : 'loaded',
        loaded_at: qtyMissing > 0 ? null : new Date().toISOString(),
        loaded_by: qtyMissing > 0 ? null : 'Automated Sync',
        is_mo_closed: isMoClosed,
        last_synced_at: new Date().toISOString(),
      });
    }

    // 7. Upsert into MySQL table (preserves locally loaded items unless shortage reoccurs)
    await upsertPendingShopFloorProcesses(recordsToUpsert);

    // 7b. Check and match prior board intake logs for newly created MOs (boards logged before MO creation)
    await matchRetroactiveBoardLogsForActiveMos(
      client,
      activeMOs,
      boardMoves,
      soPartnerMap,
      originProductPOKeys,
      activeLogs,
    ).catch((err) => {
      console.error('[ShopFloorPendingSyncService] Error matching retroactive board logs:', err);
    });

    // 8. Prune stale pending rows for active MOs if components were removed or corrected in Odoo
    // Any PO-covered keys are explicitly purged so they do not linger in the Add Stock area
    await pruneStalePendingProcessesForActiveMos(
      activeMOs.map((mo) => mo.id),
      recordsToUpsert.map((r) => r.id),
      Array.from(poCoveredKeys),
    );

    // 9. Clean up stale completed items older than 7 days
    await deleteStaleCompletedProcesses(7);

    // 10. Invalidate RAM cache and stale board registration cache so the UI sees up-to-date counts immediately
    try {
      shopFloorCache.clearPrefix('shop-floor-dashboard:');
      await deleteShopFloorSharedCachePrefix('shop-floor:shared-board-reg:').catch(() => null);
    } catch (_cacheErr) {
      // Non-fatal cache invalidation
    }

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

export async function matchRetroactiveBoardLogsForActiveMos(
  client: OdooClient,
  activeMOs: Array<{ id: number; name: string; state: string; origin: string | null; create_date?: string }>,
  boardMoves: Array<{
    id: number;
    raw_material_production_id: [number, string] | number;
    product_id: [number, string] | false;
    product_uom_qty: number;
    quantity: number;
  }>,
  soPartnerMap: Map<string, { partnerId: number; partnerName: string }>,
  originProductPOKeys: Set<string>,
  activeLogs: Awaited<ReturnType<typeof getActiveBoardIntakeLogs>>,
): Promise<number> {
  let matchedCount = 0;
  if (!activeMOs.length || !boardMoves.length || !activeLogs.length) return matchedCount;

  const moMap = new Map<number, (typeof activeMOs)[0]>();
  for (const mo of activeMOs) {
    moMap.set(mo.id, mo);
  }

  for (const move of boardMoves) {
    const moId = Array.isArray(move.raw_material_production_id)
      ? move.raw_material_production_id[0]
      : move.raw_material_production_id;
    const mo = moMap.get(moId);
    if (!mo || String(mo.name || '').toUpperCase().startsWith('VA/')) continue;

    const productId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
    const productName = Array.isArray(move.product_id) ? move.product_id[1] : '';
    const normalizedMoveProdName = normalizeBoardProductName(productName);

    // Rule: "no purchase order"
    const soOrigin = mo.origin ? extractSoNameFromOrigin(mo.origin) : null;
    const poCovered = Boolean(
      (mo.origin && (originProductPOKeys.has(`${mo.origin}_${productId}`) || originProductPOKeys.has(`${mo.origin}_${normalizedMoveProdName}`))) ||
      (soOrigin && (originProductPOKeys.has(`${soOrigin}_${productId}`) || originProductPOKeys.has(`${soOrigin}_${normalizedMoveProdName}`))) ||
      originProductPOKeys.has(`${mo.name}_${productId}`) ||
      originProductPOKeys.has(`${mo.name}_${normalizedMoveProdName}`)
    );
    if (poCovered) continue;

    const partnerInfo = mo.origin ? (soPartnerMap.get(mo.origin) || (soOrigin ? soPartnerMap.get(soOrigin) : null)) : null;
    const partnerId = partnerInfo?.partnerId || 0;
    const partnerName = partnerInfo?.partnerName || '';
    if (partnerId <= 0 || partnerId === 350) continue;

    const moveQtyNeeded = Number(move.product_uom_qty || 0);
    const moveAttr = extractBoardAttributes(productName);

    for (const log of activeLogs) {
      const logPid = Number(log.partner_id || 0);
      const logProdId = Number(log.product_id || 0);
      const logQty = Number(log.quantity || 0);

      // 1. Owner / Client match
      const ownerMatch = logPid === partnerId || (partnerName && String(log.customer_name || '').toLowerCase().includes(partnerName.toLowerCase()));
      if (!ownerMatch) continue;

      // 2. Component attribute match: substrate, thickness, color
      const logAttr = extractBoardAttributes(log.product_name);

      const thicknessMatch = (moveAttr.thicknessMm !== null && logAttr.thicknessMm !== null)
        ? moveAttr.thicknessMm === logAttr.thicknessMm
        : true;
      if (!thicknessMatch) continue;

      const substrateMatch = (moveAttr.substrate !== 'other' && logAttr.substrate !== 'other')
        ? moveAttr.substrate === logAttr.substrate
        : true;
      if (!substrateMatch) continue;

      const colorMatch = areSameColorFamily(moveAttr.colorFamily, logAttr.colorFamily) ||
        (productId > 0 && logProdId > 0 && productId === logProdId) ||
        normalizeBoardProductName(productName).includes(normalizeBoardProductName(log.product_name)) ||
        normalizeBoardProductName(log.product_name).includes(normalizeBoardProductName(productName));
      if (!colorMatch) continue;

      // 3. Quantity closeness: "quantity is very close"
      const diff = Math.abs(logQty - moveQtyNeeded);
      const qtyVeryClose = diff <= 2 || (logQty >= moveQtyNeeded * 0.8 && logQty <= moveQtyNeeded * 1.5);
      if (!qtyVeryClose) continue;

      // 4. Logged before or right around when MO was created
      const moCreateTime = mo.create_date ? new Date(mo.create_date).getTime() : Date.now();
      const logCreateTime = log.created_at ? new Date(log.created_at).getTime() : 0;
      const loggedBeforeMo = logCreateTime <= moCreateTime + 15 * 60 * 1000;
      if (!loggedBeforeMo) continue;

      // 5. Deduplication check: only post once per MO + log
      const dedupKey = `retro-mo-match:${mo.id}:${log.id}`;
      if (shopFloorCache.get(dedupKey)) continue;

      shopFloorCache.set(dedupKey, true, 30 * 24 * 3600); // Cache for 30 days

      const logDateStr = log.arrival_date || (log.created_at ? log.created_at.slice(0, 10) : 'Earlier');
      const logTimeStr = log.arrival_time ? ` at ${log.arrival_time}` : '';
      const loggedAtFormatted = `${logDateStr}${logTimeStr}`;

      const safeOperator = escapeHtml(log.actor_name || log.actor_email || 'Operator');
      const safeProd = escapeHtml(log.product_name);
      const safeGate = escapeHtml(log.gate || 'Gate');
      const safeVehicle = escapeHtml(log.vehicle_registration || '—');

      const moChatterHtml = [
        `<div style="padding:12px 14px;background:#f0fdf4;border-left:5px solid #22c55e;color:#166534;border-radius:4px;line-height:1.6;">`,
        `<strong>📦 Found Matching Prior Board Log History</strong><br/>`,
        `• <strong>Board Component:</strong> ${safeProd}<br/>`,
        `• <strong>Quantity Logged:</strong> ${logQty} sheet${logQty === 1 ? '' : 's'} <em>(MO requires: ${moveQtyNeeded} sheets)</em><br/>`,
        `• <strong>Responsible Operator:</strong> <strong>${safeOperator}</strong><br/>`,
        `• <strong>When Logged:</strong> ${escapeHtml(loggedAtFormatted)} <em>(Logged before this MO was created)</em><br/>`,
        `• <strong>Gate & Vehicle:</strong> ${safeGate} · ${safeVehicle}<br/>`,
        `• <strong>Log Reference:</strong> Board Log #${log.id}<br/>`,
        `<br/>`,
        `<em>These boards arrived and were logged at the gate before this Manufacturing Order was created. Stock has been allocated and assigned.</em>`,
        `</div>`,
      ].join('\n');

      // Post on mrp.production
      await client.postModelChatterMessage('mrp.production', mo.id, moChatterHtml).catch(() => null);

      // Post on sale.order if linked
      if (soOrigin) {
        const targetCompanyId = await client.getTargetCompanyIdValue().catch(() => 1);
        const soRecords = await client.searchReadRecords<{ id: number }>('sale.order', {
          domain: [['name', '=', soOrigin], ['company_id', '=', targetCompanyId]],
          fields: ['id'],
          limit: 1,
        }).catch(() => []);
        if (soRecords.length > 0) {
          const soChatterHtml = [
            `<div style="padding:10px 12px;background:#f0fdf4;border-left:4px solid #22c55e;color:#166534;border-radius:4px;line-height:1.5;">`,
            `<strong>📦 Prior Gate Board Log Matched to Manufacturing Order ${escapeHtml(mo.name)}</strong><br/>`,
            `• <strong>Board:</strong> ${safeProd} (${logQty} sheets)<br/>`,
            `• <strong>Logged By:</strong> ${safeOperator} on ${escapeHtml(loggedAtFormatted)}<br/>`,
            `<em>Boards were already received at the gate before the MO was created, and have now been assigned.</em>`,
            `</div>`,
          ].join('\n');
          await client.postModelChatterMessage('sale.order', soRecords[0].id, soChatterHtml).catch(() => null);
        }
      }

      // Assign stock to the MO
      await client.callRecordMethod('mrp.production', 'action_assign', [mo.id]).catch(() => null);

      // Mark requirement as loaded in MySQL
      await markPendingShopFloorProcessesLoaded({
        partnerId,
        productId,
        customerName: partnerName,
        productName,
        loadedBy: log.actor_name || log.actor_email || 'Operator',
        quantity: logQty,
      }).catch(() => null);

      await logEvent('info', 'Retroactive board intake matched to newly created MO', {
        moId: mo.id,
        moName: mo.name,
        boardLogId: log.id,
        productName,
        quantity: logQty,
        operator: safeOperator,
      }).catch(() => null);

      matchedCount++;
      break; // Matched this move
    }
  }

  return matchedCount;
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
