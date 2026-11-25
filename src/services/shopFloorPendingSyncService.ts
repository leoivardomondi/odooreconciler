import {
  getSettings,
  upsertPendingShopFloorProcesses,
  deleteStaleCompletedProcesses,
  pruneStalePendingProcessesForActiveMos,
  getActiveBoardIntakeLogs,
  markPendingShopFloorProcessesLoaded,
  deleteShopFloorSharedCachePrefix,
  getShopFloorSharedCache,
  saveShopFloorSharedCache,
} from '../models/repositories';
import { queryAll, execute } from '../models/db';
import { OdooClient, isOdooTrafficPaused, isSchedulerRunActive } from './odooClient';
import {
  isBoardProductName,
  normalizeBoardProductName,
  extractBoardAttributes,
  areSameColorFamily,
} from './boardProductClassifier';
import { extractSoNameFromOrigin } from './poJobSummaryAuditService';
import { PendingShopFloorProcess } from '../models/types';
import { logEvent } from './logService';
import { escapeHtml, reconcileRetroactiveBoardLogsForLinkedPos, reconcileStuckBoardIntakeReceipts } from './boardIntakeSyncService';
import { shopFloorCache } from '../routes/shopFloor';
import { filterSingleBoardComponentForCuttingMo } from './cuttingBoMReconciliationService';
import { isCuttingProductOrWorkOrder } from './workOrderQuantityReconciliationService';

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
      product_id?: [number, string] | false;
      product_qty?: number;
      qty_producing?: number;
      create_date?: string;
      write_date?: string;
    }>('mrp.production', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', 'in', ['confirmed', 'progress', 'to_close']],
      ],
      fields: ['id', 'name', 'state', 'origin', 'product_id', 'product_qty', 'qty_producing', 'create_date', 'write_date'],
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
      product_id?: [number, string] | false;
      product_qty?: number;
      qty_producing?: number;
      write_date?: string;
    }>('mrp.production', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', '=', 'done'],
        ['write_date', '>=', closedCutoffDate],
      ],
      fields: ['id', 'name', 'state', 'origin', 'product_id', 'product_qty', 'qty_producing', 'write_date'],
      limit: 200,
      order: 'write_date desc, id desc',
    }).catch(() => []);

    const recentlyClosedMOs = rawRecentlyClosedMOs.filter(
      (mo) => !String(mo.name || '').toUpperCase().startsWith('VA/')
    );

    const allMOs = [...activeMOs, ...recentlyClosedMOs];

    // 1c. Identify any MOs currently pending in shop_floor_pending_processes that were cancelled in Odoo
    const existingPendingMoRows = await queryAll<{ mo_id: number }>(
      `SELECT DISTINCT mo_id FROM shop_floor_pending_processes WHERE status = 'pending'`,
    );
    const existingMoIds = existingPendingMoRows
      .map((r) => r.mo_id)
      .filter((id): id is number => typeof id === 'number' && id > 0);

    const allMoIdSet = new Set(allMOs.map((mo) => mo.id));
    const unmappedMoIds = existingMoIds.filter((id) => !allMoIdSet.has(id));
    const cancelledMoIds: number[] = [];

    if (unmappedMoIds.length > 0) {
      try {
        const checkedOdooMos = await client.searchReadRecords<{
          id: number;
          state: string;
          name: string;
        }>('mrp.production', {
          domain: [['id', 'in', unmappedMoIds]],
          fields: ['id', 'state', 'name'],
          limit: 500,
        });

        const checkedMap = new Map<number, string>();
        for (const c of checkedOdooMos) {
          checkedMap.set(c.id, c.state);
        }

        for (const checkId of unmappedMoIds) {
          const st = checkedMap.get(checkId);
          // If state is cancel, or MO was deleted from Odoo entirely, it must NOT need stock
          if (!st || st === 'cancel') {
            cancelledMoIds.push(checkId);
          }
        }
      } catch (checkErr) {
        console.warn('[ShopFloorPendingSyncService] Error checking cancelled MOs in Odoo:', checkErr);
      }
    }

    if (cancelledMoIds.length > 0) {
      const placeholders = cancelledMoIds.map(() => '?').join(', ');
      await execute(
        `DELETE FROM shop_floor_pending_processes WHERE mo_id IN (${placeholders})`,
        cancelledMoIds,
      );
    }

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

          // Find incoming pickings (both open deliveries expected in /shop-floor/receipts and done receipts already received into stock)
          const incomingPickings = await client.searchReadRecords<{
            id: number;
            origin: string | false;
            state: string;
          }>('stock.picking', {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['picking_type_code', '=', 'incoming'],
              ['state', 'in', ['waiting', 'confirmed', 'assigned', 'done']],
              '|',
              ['origin', 'in', poNames],
              ['origin', 'in', relevantOriginNames],
            ],
            fields: ['id', 'origin', 'state'],
            limit: 500,
            timeoutMs: 35000,
          }).catch(() => []);

          const openIncomingOrigins = new Set<string>();
          const doneIncomingOrigins = new Set<string>();
          for (const pick of incomingPickings) {
            if (pick.origin) {
              const origStr = String(pick.origin).trim();
              const targetSet = pick.state === 'done' ? doneIncomingOrigins : openIncomingOrigins;
              targetSet.add(origStr);
              const extracted = extractSoNameFromOrigin(origStr);
              if (extracted) targetSet.add(extracted);
              if (origStr.includes(':')) {
                origStr.split(':').forEach(part => {
                  const p = part.trim();
                  if (p) targetSet.add(p);
                });
              }
            }
          }

          // A PO covers the board requirement if:
          // 1. It is active or approved/done (state in 'to approve', 'purchase', 'done', or has pickings)
          // 2. Either it was ALREADY RECEIVED (receipt state = 'done' or line qty_received > 0),
          //    OR it is an open incoming delivery pending validation in Receipts (/shop-floor/receipts).
          // CRITICAL ANTI-DOUBLE-LOGGING RULE:
          // When a PO was received, boards were already logged in Odoo inventory via PO receipt (WH/IN/...).
          // Adding them to "Stock Needed — No Purchase Orders" would prompt operators to log them again at the gate,
          // causing duplicate stock in Odoo.
          // Likewise, if a PO is active and pending, stock is coming via PO receipt, NOT manual gate log!
          const validPoIds = new Set<number>();
          for (const po of purchaseOrders) {
            const hasOpenReceipt = openIncomingOrigins.has(po.name) ||
              (po.origin && (
                openIncomingOrigins.has(po.origin) ||
                (extractSoNameFromOrigin(po.origin) && openIncomingOrigins.has(extractSoNameFromOrigin(po.origin)!))
              ));
            const hasDoneReceipt = doneIncomingOrigins.has(po.name) ||
              (po.origin && (
                doneIncomingOrigins.has(po.origin) ||
                (extractSoNameFromOrigin(po.origin) && doneIncomingOrigins.has(extractSoNameFromOrigin(po.origin)!))
              ));
            const isPoApprovedOrDone = po.state === 'purchase' || po.state === 'done' || po.state === 'to approve';

            if (hasOpenReceipt || hasDoneReceipt || isPoApprovedOrDone) {
              validPoIds.add(po.id);
            }
          }

          const poLines = await client.searchReadRecords<{
            id: number;
            order_id: [number, string];
            product_id: [number, string] | false;
            name: string;
            product_qty?: number;
            qty_received?: number;
          }>('purchase.order.line', {
            domain: [['order_id', 'in', poIds]],
            fields: ['id', 'order_id', 'product_id', 'name', 'product_qty', 'qty_received'],
            limit: 1000,
            timeoutMs: 35000,
          });

          const poOriginMap = new Map<number, string[]>();
          for (const po of purchaseOrders) {
            const keys = [po.name];
            if (po.origin) {
              keys.push(po.origin.trim());
              const extracted = extractSoNameFromOrigin(po.origin);
              if (extracted) keys.push(extracted.trim());
              if (po.origin.includes(':')) {
                po.origin.split(':').forEach(part => {
                  const p = part.trim();
                  if (p) keys.push(p);
                });
              }
            }
            poOriginMap.set(po.id, [...new Set(keys)]);
          }

          for (const line of poLines) {
            const poId = Array.isArray(line.order_id) ? line.order_id[0] : 0;
            if (!validPoIds.has(poId)) continue;
            const productId = Array.isArray(line.product_id) ? line.product_id[0] : 0;
            const productName = line.name || (Array.isArray(line.product_id) ? line.product_id[1] : '');
            const normalizedPoProdName = normalizeBoardProductName(productName);
            const isBoardLine = isBoardProductName(productName);
            if (!isBoardLine && !productId) continue;

            const origins = poOriginMap.get(poId) || [];
            for (const orig of origins) {
              if (productId) {
                originProductPOKeys.add(`${orig}_${productId}`);
                originProductPOKeys.add(`${orig.toUpperCase()}_${productId}`);
              }
              if (normalizedPoProdName) {
                originProductPOKeys.add(`${orig}_${normalizedPoProdName}`);
                originProductPOKeys.add(`${orig.toUpperCase()}_${normalizedPoProdName}`);
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

    // Group board component moves by MO ID to evaluate single board component rules for cutting operations
    const boardMovesByMoId = new Map<number, typeof boardMoves>();
    for (const move of boardMoves) {
      const rmId = Array.isArray(move.raw_material_production_id)
        ? move.raw_material_production_id[0]
        : move.raw_material_production_id;
      if (!rmId) continue;
      const list = boardMovesByMoId.get(rmId) || [];
      list.push(move);
      boardMovesByMoId.set(rmId, list);
    }

    const filteredBoardMoves: typeof boardMoves = [];

    for (const [rmId, moMoves] of boardMovesByMoId.entries()) {
      const mo = moMap.get(rmId);
      if (!mo || String(mo.name || '').toUpperCase().startsWith('VA/')) continue;

      const moProductName = Array.isArray((mo as any).product_id) ? (mo as any).product_id[1] : '';
      const isCutting = isCuttingProductOrWorkOrder(moProductName, mo.name);

      if (isCutting && moMoves.length > 1) {
        // Enforce single board component rule for cutting BoMs to prevent double stock requirements
        const singleMoves = await filterSingleBoardComponentForCuttingMo({
          mo: {
            id: mo.id,
            name: mo.name,
            origin: mo.origin,
            product_id: (mo as any).product_id,
            product_qty: (mo as any).product_qty,
          },
          boardMoves: moMoves,
          client,
          settings,
        });
        filteredBoardMoves.push(...(singleMoves as any));
      } else {
        filteredBoardMoves.push(...moMoves);
      }
    }

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

    for (const move of filteredBoardMoves) {
      const moId = Array.isArray(move.raw_material_production_id)
        ? move.raw_material_production_id[0]
        : move.raw_material_production_id;
      const mo = moMap.get(moId);
      if (!mo || String(mo.name || '').toUpperCase().startsWith('VA/')) continue;

      const productId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
      const productName = Array.isArray(move.product_id) ? move.product_id[1] : '';
      const normalizedMoveProdName = normalizeBoardProductName(productName);
      const soOrigin = mo.origin ? extractSoNameFromOrigin(mo.origin) : null;

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

      const moProductName = Array.isArray((mo as any).product_id) ? (mo as any).product_id[1] : '';
      const isCutting = isCuttingProductOrWorkOrder(moProductName, mo.name);

      let rawQty = Number(move.product_uom_qty || 0);
      // If work order / MO quantity was edited in Odoo (e.g. reduced from 10 to 5):
      // In cutting operations, 1 sheet = 1 cutting unit. Align needed quantity with mo.product_qty
      if (isCutting && typeof (mo as any).product_qty === 'number' && (mo as any).product_qty > 0) {
        rawQty = (mo as any).product_qty;
      }

      const qtyNeeded = rawQty;
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
    const logClaimMap = new Map<string, { soName?: string; moId?: number; moName?: string }>();
    for (const log of activeLogs) {
      logPool.set(log.id, Number(log.quantity || 0));
      const existingClaim = await getShopFloorSharedCache<{ soName?: string; moId?: number; moName?: string }>(
        `retro-log-claimed:${log.id}`,
      ).catch(() => null);
      if (existingClaim?.data) {
        logClaimMap.set(log.id, existingClaim.data);
      }
    }

    // Sort aggregatedMoves chronologically (oldest MO first) so earlier Sales Orders claim their board logs first
    // and once a log ID is bound to a Sales Order it cannot be reused by a later Sales Order.
    const sortedAggregatedEntries = [...aggregatedMoves.entries()].sort(([, a], [, b]) => {
      const moA = moMap.get(a.moId);
      const moB = moMap.get(b.moId);
      const timeA = (moA as any)?.create_date ? new Date((moA as any).create_date).getTime() : 0;
      const timeB = (moB as any)?.create_date ? new Date((moB as any).create_date).getTime() : 0;
      if (timeA !== timeB && timeA > 0 && timeB > 0) return timeA - timeB;
      return a.moId - b.moId;
    });

    for (const [key, agg] of sortedAggregatedEntries) {
      const cleanCustomer = String(agg.partnerName || '').trim().toLowerCase();
      const cleanProduct = String(agg.productName || '').trim().toLowerCase();
      const aggSoName = (extractSoNameFromOrigin(agg.origin) || agg.origin || agg.moName || '').trim().toUpperCase();

      // Allocate from available active non-reverted intake logs
      let allocatedFromLogs = 0;
      let remainingNeeded = agg.qtyNeeded;

      for (const log of activeLogs) {
        if (remainingNeeded <= 0) break;
        const availableInLog = logPool.get(log.id) || 0;
        if (availableInLog <= 0) continue;

        // If this log ID was already matched to a DIFFERENT Sales Order, it cannot be reused
        const existingClaim = logClaimMap.get(log.id);
        if (existingClaim?.soName && aggSoName && existingClaim.soName.trim().toUpperCase() !== aggSoName) {
          continue;
        }

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
          const mo = moMap.get(agg.moId);
          const isMoClosed = mo ? (mo.state === 'done' || mo.state === 'to_close') : false;
          // If an already-closed earlier MO consumed this log, bind the log ID to that Sales Order
          // so a newer Sales Order cannot reuse the same historical log ID.
          if (!existingClaim && isMoClosed && aggSoName) {
            const claimData = {
              moId: agg.moId,
              moName: agg.moName,
              soName: aggSoName,
              boardLogId: log.id,
              matchedAt: new Date().toISOString(),
            };
            logClaimMap.set(log.id, claimData);
            await saveShopFloorSharedCache(`retro-log-claimed:${log.id}`, claimData).catch(() => null);
          }
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

    // 8. Prune stale pending rows for active and closed MOs if components were removed or MO was cancelled
    // Cancelled MOs are explicitly purged so they do not linger in the Add Stock area
    await pruneStalePendingProcessesForActiveMos(
      allMOs.map((mo) => mo.id),
      recordsToUpsert.map((r) => r.id),
      [],
      cancelledMoIds,
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

    // 11. Retroactively validate any prior manual board intake logs whose connected MO now has a linked PO
    void reconcileRetroactiveBoardLogsForLinkedPos(client).catch((err) => {
      console.warn('[ShopFloorPendingSyncService] Failed checking retroactive PO fulfillment:', err);
    });

    // 12. Auto-heal any stuck purchase receipts where board intake was logged but receipt awaited backorder confirmation
    void reconcileStuckBoardIntakeReceipts(client).catch((err) => {
      console.warn('[ShopFloorPendingSyncService] Failed checking stuck board intake receipts:', err);
    });

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

  // Sort moves chronologically by MO creation date / ID (oldest first) so that if multiple Sales Orders exist,
  // the earliest matching Sales Order claims the board log ID and prevents later Sales Orders from reusing it.
  const sortedBoardMoves = [...boardMoves].sort((a, b) => {
    const moIdA = Array.isArray(a.raw_material_production_id) ? a.raw_material_production_id[0] : a.raw_material_production_id;
    const moIdB = Array.isArray(b.raw_material_production_id) ? b.raw_material_production_id[0] : b.raw_material_production_id;
    const moA = moMap.get(moIdA);
    const moB = moMap.get(moIdB);
    const timeA = moA?.create_date ? new Date(moA.create_date).getTime() : 0;
    const timeB = moB?.create_date ? new Date(moB.create_date).getTime() : 0;
    if (timeA !== timeB && timeA > 0 && timeB > 0) return timeA - timeB;
    return moIdA - moIdB;
  });

  // Track which Sales Order / MO has claimed each log ID in this run: once matched, a log ID cannot be reused by another SO.
  const claimedLogByIdInRun = new Map<string, { soKey: string; moId: number }>();

  for (const move of sortedBoardMoves) {
    const moId = Array.isArray(move.raw_material_production_id)
      ? move.raw_material_production_id[0]
      : move.raw_material_production_id;
    const mo = moMap.get(moId);
    if (!mo || String(mo.name || '').toUpperCase().startsWith('VA/')) continue;

    const productId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
    const productName = Array.isArray(move.product_id) ? move.product_id[1] : '';
    const normalizedMoveProdName = normalizeBoardProductName(productName);
    const soOrigin = mo.origin ? extractSoNameFromOrigin(mo.origin) : null;
    const currentSoKey = (soOrigin || mo.origin || mo.name || `MO-${mo.id}`).trim().toUpperCase();

    // Skip moves covered by an active or received Purchase Order
    const candidateOrigins = [mo.origin, soOrigin, mo.name].filter(Boolean) as string[];
    const isCoveredByPo = candidateOrigins.some(
      (orig) =>
        (productId > 0 && (originProductPOKeys.has(`${orig}_${productId}`) || originProductPOKeys.has(`${orig.toUpperCase()}_${productId}`))) ||
        (normalizedMoveProdName && (originProductPOKeys.has(`${orig}_${normalizedMoveProdName}`) || originProductPOKeys.has(`${orig.toUpperCase()}_${normalizedMoveProdName}`))),
    );
    if (isCoveredByPo) continue;

    const partnerInfo = mo.origin ? (soPartnerMap.get(mo.origin) || (soOrigin ? soPartnerMap.get(soOrigin) : null)) : null;
    const partnerId = partnerInfo?.partnerId || 0;
    const partnerName = partnerInfo?.partnerName || '';
    if (partnerId <= 0 || partnerId === 350) continue;

    const moveQtyNeeded = Number(move.product_uom_qty || 0);
    const moveAttr = extractBoardAttributes(productName);

    for (const log of activeLogs) {
      const inRunClaim = claimedLogByIdInRun.get(log.id);
      if (inRunClaim) {
        // Already claimed by this or another Sales Order in this run — cannot be reused
        continue;
      }

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

      // 4. Logged before or right around when MO was created (no 72-hour cutoff; relies on 1-to-1 log ID -> Sales Order binding)
      const moCreateTime = mo.create_date ? new Date(mo.create_date).getTime() : Date.now();
      const logCreateTime = log.created_at ? new Date(log.created_at).getTime() : 0;
      const loggedBeforeMo = logCreateTime > 0 && logCreateTime <= moCreateTime + 15 * 60 * 1000;
      if (!loggedBeforeMo) continue;

      // 5. Persistent + in-memory 1-to-1 Log ID -> Sales Order binding:
      // Once a board log ID is matched to a Sales Order / MO, it cannot be repeated on that SO or reused by a different SO.
      const dedupKey = `retro-mo-match:${mo.id}:${log.id}`;
      const logClaimKey = `retro-log-claimed:${log.id}`;
      if (shopFloorCache.get(dedupKey)) {
        claimedLogByIdInRun.set(log.id, { soKey: currentSoKey, moId: mo.id });
        continue;
      }

      const [persistedPair, persistedClaim] = await Promise.all([
        getShopFloorSharedCache<{ moId: number; soName?: string }>(dedupKey).catch(() => null),
        getShopFloorSharedCache<{ moId: number; soName?: string }>(logClaimKey).catch(() => null),
      ]);
      if (persistedPair?.data || persistedClaim?.data) {
        const claimedSo = (persistedClaim?.data?.soName || persistedPair?.data?.soName || currentSoKey).trim().toUpperCase();
        const claimedMoId = persistedClaim?.data?.moId || persistedPair?.data?.moId || mo.id;
        shopFloorCache.set(dedupKey, true, 30 * 24 * 3600);
        claimedLogByIdInRun.set(log.id, { soKey: claimedSo, moId: claimedMoId });
        continue;
      }

      shopFloorCache.set(dedupKey, true, 30 * 24 * 3600); // Cache in memory for 30 days
      claimedLogByIdInRun.set(log.id, { soKey: currentSoKey, moId: mo.id });
      const matchedMetadata = {
        moId: mo.id,
        moName: mo.name,
        soName: currentSoKey,
        boardLogId: log.id,
        matchedAt: new Date().toISOString(),
      };
      await Promise.all([
        saveShopFloorSharedCache(dedupKey, matchedMetadata).catch(() => null),
        saveShopFloorSharedCache(logClaimKey, matchedMetadata).catch(() => null),
      ]);

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

      // Post on mrp.production with skipSoSync: true (since we post a dedicated Sales Order summary note below)
      // and checkExisting: true so Odoo chatter is checked against duplicates even if caches are cleared.
      await client.postModelChatterMessage('mrp.production', mo.id, moChatterHtml, undefined, {
        skipSoSync: true,
        dedupeSnippet: `Board Log #${log.id}`,
        checkExisting: true,
        dedupeWindowMs: 30 * 24 * 3600 * 1000,
      }).catch(() => null);

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
          await client.postModelChatterMessage('sale.order', soRecords[0].id, soChatterHtml, undefined, {
            skipSoSync: true,
            dedupeSnippet: `Prior Gate Board Log Matched to Manufacturing Order ${mo.name}`,
            checkExisting: true,
            dedupeWindowMs: 30 * 24 * 3600 * 1000,
          }).catch(() => null);
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
    if (isSchedulerRunActive()) return;
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
