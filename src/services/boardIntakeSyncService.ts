import {
  claimBoardIntakeQueueEntry,
  claimBoardIntakeRevert,
  finishBoardIntakeRevert,
  getBoardIntakeQueueEntry,
  getDueBoardIntakeQueueEntries,
  releaseStaleBoardIntakeQueueEntry,
  releaseBoardIntakeRevert,
  updateBoardIntakeQueueEntry,
} from '../models/repositories';
import { getSettings } from '../models/repositories';
import { queryAll, getDatabaseDialect } from '../models/db';
import { recordExactStockQuantity, refreshStockMirror } from './stockMirrorService';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';
import { isBoardProductName } from './boardProductClassifier';
import { findOdooUserByTerm, OdooUserStakeholder, extractSoNameFromOrigin } from './poJobSummaryAuditService';

const AUTO_RETRY_INTERVAL_MS = 2 * 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;
let batchPromise: Promise<void> | null = null;

export function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export interface BoardIntakePoFulfillmentResult {
  fulfilledViaReceipt: boolean;
  poId: number;
  poName: string;
  pickingId?: number;
  pickingName?: string;
  qtyFulfilled: number;
  surplusQty: number;
  poState: string;
  autoApproved: boolean;
}

export interface BoardIntakeChatterStakeholder {
  name: string;
  partnerId: number | null;
}

export interface BuildBoardIntakeChatterOptions {
  customerName?: string | null;
  productName?: string | null;
  quantity?: number | string | null;
  moName?: string | null;
  qtyNeeded?: number | null;
  balanceRemaining?: number | null;
  gate?: string | null;
  vehicleRegistration?: string | null;
  arrivalTime?: string | null;
  reportDate?: string | null;
  actorName?: string | null;
  mentionHtml?: string | null;
  hasBoardPo?: boolean | null;
  boardPoNames?: string[] | null;
}

export function buildBoardIntakeChatterHtml(options: BuildBoardIntakeChatterOptions): string {
  const safeCustomerName = escapeHtml(options.customerName);
  const safeProductName = escapeHtml(options.productName);
  const safeGate = options.gate ? escapeHtml(String(options.gate).trim()) : '';
  const safeVehicleReg = options.vehicleRegistration ? escapeHtml(String(options.vehicleRegistration).trim()) : '';
  const safeArrivalTime = options.arrivalTime ? escapeHtml(String(options.arrivalTime).trim()) : '';
  const safeActor = escapeHtml(options.actorName || 'Operator');
  const qtyNum = Number(options.quantity || 0);
  const neededNum = options.qtyNeeded != null && Number.isFinite(Number(options.qtyNeeded)) ? Number(options.qtyNeeded) : null;
  const balanceNum = options.balanceRemaining != null && Number.isFinite(Number(options.balanceRemaining))
    ? Math.max(0, Number(options.balanceRemaining))
    : (neededNum != null ? Math.max(0, neededNum - qtyNum) : null);

  const lines: string[] = [];

  // 1. Start with tagging the responsible sales person or both Candy & Sharon always
  if (options.mentionHtml && options.mentionHtml.trim().length > 0) {
    lines.push(options.mentionHtml.trim());
  }

  // 2. Tree log emoji (🪵) is strictly removed
  lines.push(
    `<strong>Board log completed (Operator Mobile App)</strong>`,
    `• <strong>Client:</strong> ${safeCustomerName}`,
    `• <strong>Board:</strong> ${safeProductName}`,
    `• <strong>Quantity:</strong> ${qtyNum} sheet${qtyNum === 1 ? '' : 's'}`,
  );

  if (neededNum != null && neededNum > 0) {
    lines.push(`• <strong>Total Required:</strong> ${neededNum} sheet${neededNum === 1 ? '' : 's'}`);
    if (balanceNum != null && balanceNum > 0) {
      lines.push(
        `• <strong>Balance Remaining:</strong> <span style="color:#b91c1c;font-weight:bold;">${balanceNum} sheet${balanceNum === 1 ? '' : 's'} needed</span>`,
        `<p style="margin-top:8px;padding:8px 12px;background:#fef2f2;border-left:4px solid #ef4444;color:#991b1b;border-radius:4px;">` +
        `⚠️ <strong>PARTIAL INTAKE:</strong> ${qtyNum} sheet${qtyNum === 1 ? '' : 's'} logged, balance <strong>${balanceNum} sheet${balanceNum === 1 ? '' : 's'}</strong> still required for ${options.moName ? escapeHtml(options.moName) : 'this MO'}. Stock requirement of ${balanceNum} board${balanceNum === 1 ? '' : 's'} remains active before cutting/completion can start.` +
        `</p>`
      );
    } else {
      lines.push(
        `• <strong>Balance Remaining:</strong> <span style="color:#15803d;font-weight:bold;">0 sheets (Fully supplied)</span>`,
        `<p style="margin-top:8px;padding:8px 12px;background:#f0fdf4;border-left:4px solid #22c55e;color:#166534;border-radius:4px;">` +
        `✅ <strong>COMPLETE INTAKE:</strong> All ${neededNum} sheets received and allocated in stock.` +
        `</p>`
      );
    }
  }

  if (options.moName) lines.push(`• <strong>Manufacturing Order:</strong> ${escapeHtml(options.moName)}`);
  if (safeGate && safeGate !== '—') {
    lines.push(`• <strong>Gate:</strong> ${safeGate}`);
  }
  if (safeVehicleReg && safeVehicleReg !== '—') {
    lines.push(`• <strong>Vehicle Reg:</strong> ${safeVehicleReg}`);
  }
  if (safeArrivalTime && safeArrivalTime !== '—') {
    lines.push(`• <strong>Arrival Time:</strong> ${safeArrivalTime}`);
  }
  if (options.reportDate) {
    lines.push(`• <strong>Date:</strong> ${escapeHtml(options.reportDate)}`);
  }
  lines.push(`• <strong>Logged by:</strong> ${safeActor}`);

  // 3. If related sales order has Purchase Order for the same board, add text asking to communicate with operators
  if (options.hasBoardPo) {
    const poRef = options.boardPoNames && options.boardPoNames.length > 0
      ? ` (${options.boardPoNames.map(escapeHtml).join(', ')})`
      : '';
    lines.push(
      `<p style="margin-top:8px;padding:8px 12px;background:#fff7ed;border-left:4px solid #ea580c;color:#9a3412;border-radius:4px;">` +
      `⚠️ <strong>Purchase Order Notice${poRef}:</strong> A Purchase Order exists for this board under this Sales Order. Please communicate with the operators on whether this is a purchase or not.` +
      `</p>`
    );
  }

  return lines.join('<br/>\n');
}

export async function resolveBoardIntakeStakeholders(
  client: OdooClient,
  soUserId?: number | null,
  cachedCandySharon?: Promise<[OdooUserStakeholder | null, OdooUserStakeholder | null]> | null,
): Promise<{
  mentionHtml: string;
  partnerIds: number[];
}> {
  let responsibleSalesperson: BoardIntakeChatterStakeholder | null = null;
  if (soUserId) {
    try {
      const users = await client.readRecords<{
        id: number;
        name: string;
        login: string;
        partner_id?: [number, string] | false | null;
      }>('res.users', [soUserId], ['id', 'name', 'login', 'partner_id']);
      const u = users[0];
      if (u) {
        const pId = Array.isArray(u.partner_id) ? Number(u.partner_id[0]) : null;
        const nameLower = (u.name || '').trim().toLowerCase();
        if (!nameLower.includes('administrator') && !nameLower.includes('odoobot')) {
          responsibleSalesperson = {
            name: u.name,
            partnerId: pId,
          };
        }
      }
    } catch {
      responsibleSalesperson = null;
    }
  }

  const tags: BoardIntakeChatterStakeholder[] = [];
  if (responsibleSalesperson) {
    tags.push(responsibleSalesperson);
  } else {
    // Fall back to tagging both Candy and Sharon always
    const [candy, sharon] = cachedCandySharon
      ? await cachedCandySharon
      : await Promise.all([
          findOdooUserByTerm(client, 'Candy').catch(() => null),
          findOdooUserByTerm(client, 'Sharon').catch(() => null),
        ]);

    if (candy) {
      tags.push({ name: candy.name, partnerId: candy.partnerId });
    } else {
      tags.push({ name: 'Candy', partnerId: null });
    }
    if (sharon) {
      tags.push({ name: sharon.name, partnerId: sharon.partnerId });
    } else {
      tags.push({ name: 'Sharon', partnerId: null });
    }
  }

  const mentionParts = tags.map((t) => {
    if (t.partnerId) {
      return `<a href="#" data-oe-model="res.partner" data-oe-id="${t.partnerId}">@${escapeHtml(t.name)}</a>`;
    }
    return `@${escapeHtml(t.name)}`;
  });

  const mentionHtml = mentionParts.join(' ');
  const partnerIds = tags
    .map((t) => t.partnerId)
    .filter((id): id is number => typeof id === 'number' && id > 0);

  return { mentionHtml, partnerIds };
}

export interface MatchingBoardPurchaseOrderWarning {
  poId: number;
  poName: string;
  poState: string;
  poStateLabel: 'Yet to be approved' | 'Already approved' | string;
  soId: number | null;
  soName: string | null;
  salespersonName?: string | null;
  salespersonUserId?: number | null;
  productName: string;
  quantityLogged: number;
  actorName: string;
}

export async function processBoardIntakePurchaseOrderFulfillment(
  client: OdooClient,
  entry: {
    partner_id?: number | string | null;
    product_id?: number | string | null;
    product_name?: string | null;
    quantity?: number | string | null;
    customer_name?: string | null;
    actor_name?: string | null;
    actor_email?: string | null;
    arrival_date?: string | null;
    arrival_time?: string | null;
    gate?: string | null;
    vehicle_registration?: string | null;
  },
  cachedCandySharon?: Promise<[OdooUserStakeholder | null, OdooUserStakeholder | null]> | null,
): Promise<BoardIntakePoFulfillmentResult | null> {
  try {
    const partnerId = Number(entry.partner_id || 0);
    const productId = Number(entry.product_id || 0);
    const qtyNum = Number(entry.quantity || 0);
    if (!partnerId || !productId || qtyNum <= 0 || partnerId === 350) return null;

    const targetCompanyId = await client.getTargetCompanyIdValue();

    // 1. Find candidate Sales Orders for this customer
    const salesOrders = await client.searchReadRecords<{
      id: number;
      name: string;
      partner_id: [number, string] | false;
      user_id: [number, string] | false;
    }>('sale.order', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['partner_id', '=', partnerId],
        ['state', 'not in', ['cancel']],
      ],
      fields: ['id', 'name', 'partner_id', 'user_id'],
      limit: 50,
      order: 'id desc',
    });

    // 2. Find candidate MOs for target company
    const activeMos = await client.searchReadRecords<{
      id: number;
      name: string;
      origin: string | false | null;
    }>('mrp.production', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', 'in', ['confirmed', 'progress', 'to_close']],
      ],
      fields: ['id', 'name', 'origin'],
      limit: 100,
    });

    const originNames = new Set<string>();
    const soMap = new Map<string, { id: number; name: string; userId: number | null; userName: string | null }>();

    for (const so of salesOrders) {
      originNames.add(so.name);
      soMap.set(so.name, {
        id: so.id,
        name: so.name,
        userId: Array.isArray(so.user_id) ? so.user_id[0] : null,
        userName: Array.isArray(so.user_id) ? so.user_id[1] : null,
      });
    }

    const moMap = new Map<string, number>();
    for (const mo of activeMos) {
      if (mo.origin) {
        const extracted = extractSoNameFromOrigin(mo.origin) || mo.origin;
        if (soMap.has(extracted) || soMap.has(mo.origin)) {
          originNames.add(mo.name);
          originNames.add(mo.origin);
          if (extracted) originNames.add(extracted);
          moMap.set(mo.name, mo.id);
          moMap.set(mo.origin, mo.id);
          if (extracted) moMap.set(extracted, mo.id);
        }
      }
    }

    const candidateOrigins = Array.from(originNames);
    if (!candidateOrigins.length) return null;

    // 3. Find active Purchase Orders in target company
    const purchaseOrders = await client.searchReadRecords<{
      id: number;
      name: string;
      state: string;
      origin: string | false | null;
      partner_id: [number, string] | false;
    }>('purchase.order', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['origin', 'in', candidateOrigins],
        ['state', 'in', ['to approve', 'purchase', 'draft', 'sent']],
      ],
      fields: ['id', 'name', 'state', 'origin', 'partner_id'],
      limit: 50,
      order: 'id desc',
    });

    if (!purchaseOrders.length) return null;

    // 4. Find PO lines matching this board product
    const poIds = purchaseOrders.map((p) => p.id);
    const poLines = await client.searchReadRecords<{
      id: number;
      order_id: [number, string];
      product_id: [number, string] | false;
      product_qty: number;
      qty_received?: number;
    }>('purchase.order.line', {
      domain: [
        ['order_id', 'in', poIds],
        ['product_id', '=', productId],
      ],
      fields: ['id', 'order_id', 'product_id', 'product_qty', 'qty_received'],
      limit: 100,
    });

    if (!poLines.length) return null;

    // Prioritize PO in 'to approve' (waiting for approval) and 'purchase' (already approved).
    // RULE: "only approve a PURCHASE ORDER if its waiting for approval."
    // If a PO is in 'draft' or 'sent', we do NOT approve it and do NOT fulfill via receipt.
    let eligiblePo: (typeof purchaseOrders)[0] | null = null;
    let eligibleLine: (typeof poLines)[0] | null = null;

    for (const po of purchaseOrders) {
      if (po.state === 'to approve') {
        const line = poLines.find((l) => (Array.isArray(l.order_id) ? l.order_id[0] : 0) === po.id);
        if (line) {
          eligiblePo = po;
          eligibleLine = line;
          break;
        }
      }
    }

    if (!eligiblePo) {
      for (const po of purchaseOrders) {
        if (po.state === 'purchase') {
          const line = poLines.find((l) => (Array.isArray(l.order_id) ? l.order_id[0] : 0) === po.id);
          if (line) {
            eligiblePo = po;
            eligibleLine = line;
            break;
          }
        }
      }
    }

    if (!eligiblePo || !eligibleLine) {
      return null;
    }

    let autoApproved = false;
    let currentPoState = eligiblePo.state;

    // STRICT RULE: Only approve if 'to approve'
    if (currentPoState === 'to approve') {
      try {
        await client.callRecordMethod('purchase.order', 'button_approve', [eligiblePo.id]);
      } catch (apprErr) {
        // Fallback to button_confirm only if button_approve failed on 'to approve'
        await client.callRecordMethod('purchase.order', 'button_confirm', [eligiblePo.id]).catch(() => null);
      }
      const refreshed = await client.readRecords<{ state: string }>('purchase.order', [eligiblePo.id], ['state']);
      currentPoState = refreshed[0]?.state || 'purchase';
      autoApproved = true;
    }

    if (currentPoState !== 'purchase') {
      return null;
    }

    // 5. Find incoming receipt picking for this approved PO
    const pickings = await client.searchReadRecords<{
      id: number;
      name: string;
      state: string;
      origin: string | false;
      picking_type_code: string;
    }>('stock.picking', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['picking_type_code', '=', 'incoming'],
        ['state', 'not in', ['done', 'cancel']],
        '|',
        ['origin', '=', eligiblePo.name],
        ['purchase_id', '=', eligiblePo.id],
      ],
      fields: ['id', 'name', 'state', 'origin', 'picking_type_code'],
      limit: 10,
      order: 'id asc',
    });

    if (!pickings.length) {
      const poWithPickings = await client.readRecords<{ picking_ids: number[] }>('purchase.order', [eligiblePo.id], ['picking_ids']).catch(() => []);
      const pickingIds = poWithPickings[0]?.picking_ids || [];
      if (pickingIds.length) {
        const extraPickings = await client.searchReadRecords<{
          id: number;
          name: string;
          state: string;
          origin: string | false;
          picking_type_code: string;
        }>('stock.picking', {
          domain: [
            ['id', 'in', pickingIds],
            ['picking_type_code', '=', 'incoming'],
            ['state', 'not in', ['done', 'cancel']],
          ],
          fields: ['id', 'name', 'state', 'origin', 'picking_type_code'],
          limit: 10,
        }).catch(() => []);
        pickings.push(...extraPickings);
      }
    }

    if (!pickings.length) {
      return null;
    }

    // 6. Find open move for this board product
    const pickingIds = pickings.map((p) => p.id);
    const moves = await client.searchReadRecords<{
      id: number;
      picking_id: [number, string] | false;
      product_id: [number, string] | false;
      product_uom_qty: number;
      quantity: number;
      state: string;
    }>('stock.move', {
      domain: [
        ['picking_id', 'in', pickingIds],
        ['product_id', '=', productId],
        ['state', 'not in', ['done', 'cancel']],
      ],
      fields: ['id', 'picking_id', 'product_id', 'product_uom_qty', 'quantity', 'state'],
      limit: 20,
    });

    if (!moves.length) {
      return null;
    }

    const targetMove = moves[0];
    const targetPickingId = Array.isArray(targetMove.picking_id) ? targetMove.picking_id[0] : targetMove.picking_id;
    const targetPicking = pickings.find((p) => p.id === targetPickingId) || pickings[0];

    const moveOrderedQty = Number(targetMove.product_uom_qty || 0);
    const qtyToFulfill = Math.min(qtyNum, moveOrderedQty > 0 ? moveOrderedQty : qtyNum);
    const surplusQty = Math.max(0, qtyNum - qtyToFulfill);

    // 1. Confirm & assign picking first to ensure all moves are allocated and move lines prepared
    if (targetPicking.state === 'draft') {
      await client.callRecordMethod('stock.picking', 'action_confirm', [targetPicking.id]).catch(() => null);
    }
    await client.callRecordMethod('stock.picking', 'action_assign', [targetPicking.id]).catch(() => null);

    // 2. CRITICAL MULTI-PRODUCT PO ISOLATION (Operations / Receipt Path):
    // A PO receipt often has multiple products (e.g. 3 different board items or hardware).
    // Logging ONE product must ONLY validate that specific product and ONLY the keyed-in quantity!
    // All other moves on the picking MUST have their done quantity explicitly zeroed out
    // so Odoo generates a backorder for the unreceived products and does NOT validate them.
    const allPickingMoves = await client.searchReadRecords<{
      id: number;
      product_id: [number, string] | false;
      product_uom_qty: number;
      quantity: number;
    }>('stock.move', {
      domain: [
        ['picking_id', '=', targetPicking.id],
        ['state', 'not in', ['done', 'cancel']],
      ],
      fields: ['id', 'product_id', 'product_uom_qty', 'quantity'],
      limit: 100,
    }).catch(() => []);

    const allPickingMoveLines = await client.searchReadRecords<{
      id: number;
      move_id: [number, string] | false;
      product_id: [number, string] | false;
      quantity: number;
    }>('stock.move.line', {
      domain: [['picking_id', '=', targetPicking.id]],
      fields: ['id', 'move_id', 'product_id', 'quantity'],
      limit: 200,
    }).catch(() => []);

    const movesToProcess = allPickingMoves.length > 0 ? allPickingMoves : [targetMove];

    for (const move of movesToProcess) {
      const moveProdId = Array.isArray(move.product_id) ? move.product_id[0] : move.product_id;
      const isTarget = moveProdId === productId;
      const targetDoneQty = isTarget ? qtyToFulfill : 0;

      await client.writeRecord('stock.move', [move.id], { quantity: targetDoneQty }).catch(() => null);

      const relatedLines = allPickingMoveLines.filter((l) => {
        const lineMoveId = Array.isArray(l.move_id) ? l.move_id[0] : l.move_id;
        return lineMoveId === move.id;
      });

      if (relatedLines.length > 0) {
        if (isTarget) {
          // Set first line to qtyToFulfill, any additional line for this move to 0
          await client.writeRecord('stock.move.line', [relatedLines[0].id], { quantity: targetDoneQty }).catch(() => null);
          if (relatedLines.length > 1) {
            const extraIds = relatedLines.slice(1).map((l) => l.id);
            await client.writeRecord('stock.move.line', extraIds, { quantity: 0 }).catch(() => null);
          }
        } else {
          // Non-target moves: zero out all move lines so Odoo generates backorders and does not validate them
          const otherLineIds = relatedLines.map((l) => l.id);
          await client.writeRecord('stock.move.line', otherLineIds, { quantity: 0 }).catch(() => null);
        }
      }
    }

    const actorEmail = String(entry.actor_email || 'operator@urbanvibeinteriordesign.co.ke');
    await client.populatePickingValidationMetadata(targetPicking.id, actorEmail).catch(() => null);

    const valResult = await client.callRecordMethod<any>('stock.picking', 'button_validate', [targetPicking.id]).catch(() => null);
    if (valResult && typeof valResult === 'object' && valResult.res_model && valResult.res_id) {
      try {
        await client.callRecordMethod(valResult.res_model, 'process', [valResult.res_id]);
      } catch (wizErr) {
        console.warn('[BoardIntakeSyncService] Backorder wizard note:', wizErr);
      }
    }
    await client.populatePickingValidationMetadata(targetPicking.id, actorEmail).catch(() => null);

    const safeCustomerName = escapeHtml(entry.customer_name);
    const safeProductName = escapeHtml(entry.product_name);
    const safeActor = escapeHtml(entry.actor_name || entry.actor_email || 'Operator');

    const orig = eligiblePo.origin ? String(eligiblePo.origin).trim() : '';
    const extractedSo = extractSoNameFromOrigin(orig);
    const linkedSo = (orig ? soMap.get(orig) : undefined) ?? (extractedSo ? soMap.get(extractedSo) : undefined) ?? null;

    const { mentionHtml, partnerIds } = await resolveBoardIntakeStakeholders(
      client,
      linkedSo?.userId,
      cachedCandySharon,
    );

    const fulfillmentChatterHtml = [
      mentionHtml,
      `<div style="margin-top:8px;padding:12px 14px;background:#f0fdf4;border-left:5px solid #22c55e;color:#166534;border-radius:4px;line-height:1.6;">` +
      `<strong>✅ Gate Board Intake: Received via Purchase Receipt</strong><br/>` +
      `• <strong>Board:</strong> ${safeProductName}<br/>` +
      `• <strong>Quantity Received:</strong> ${qtyToFulfill} sheet${qtyToFulfill === 1 ? '' : 's'}${surplusQty > 0 ? ` (+${surplusQty} surplus sheets)` : ''}<br/>` +
      `• <strong>Responsible Operator:</strong> <strong>${safeActor}</strong><br/>` +
      `• <strong>Client:</strong> ${safeCustomerName}<br/>` +
      `• <strong>Purchase Order:</strong> <strong>${escapeHtml(eligiblePo.name)}</strong> (${autoApproved ? 'Approved automatically from Waiting for Approval' : 'Already Approved'})<br/>` +
      `• <strong>Receipt:</strong> <strong>${escapeHtml(targetPicking.name || 'WH/IN/...')}</strong> (Validated in Odoo)<br/>` +
      `• <strong>Gate & Vehicle:</strong> ${escapeHtml(entry.gate || 'Gate')} · ${escapeHtml(entry.vehicle_registration || '—')}<br/>` +
      `<br/>` +
      `<em>Stock was received officially via the supplier receipt. Manual inventory adjustment was bypassed to prevent duplicate stock.</em>` +
      `</div>`,
    ].join('<br/>\n');

    await client.postModelChatterMessage('purchase.order', eligiblePo.id, fulfillmentChatterHtml, partnerIds).catch(() => null);
    await client.postModelChatterMessage('stock.picking', targetPicking.id, fulfillmentChatterHtml).catch(() => null);
    if (linkedSo?.id) {
      await client.postModelChatterMessage('sale.order', linkedSo.id, fulfillmentChatterHtml, partnerIds).catch(() => null);
    }
    const moId = (orig ? moMap.get(orig) : undefined) ?? (extractedSo ? moMap.get(extractedSo) : undefined);
    if (moId) {
      await client.postModelChatterMessage('mrp.production', moId, fulfillmentChatterHtml, partnerIds).catch(() => null);
    }

    await logEvent('info', 'Board intake fulfilled via purchase order receipt', {
      poId: eligiblePo.id,
      poName: eligiblePo.name,
      pickingId: targetPicking.id,
      pickingName: targetPicking.name,
      productId,
      qtyFulfilled: qtyToFulfill,
      surplusQty,
      operator: safeActor,
      autoApproved,
    }).catch(() => null);

    return {
      fulfilledViaReceipt: true,
      poId: eligiblePo.id,
      poName: eligiblePo.name,
      pickingId: targetPicking.id,
      pickingName: targetPicking.name,
      qtyFulfilled: qtyToFulfill,
      surplusQty,
      poState: currentPoState,
      autoApproved,
    };
  } catch (err) {
    console.error('[BoardIntakeSyncService] Error in processBoardIntakePurchaseOrderFulfillment:', err);
    return null;
  }
}

export const processBoardIntakePurchaseOrderFulfillmentLegacy = processBoardIntakePurchaseOrderFulfillment;

/**
 * Scans recent manual board intake logs (last 14 days) that were processed as client-supply
 * to check if a connected MO or SO now has a confirmed/linked Purchase Order in Odoo.
 * If a matching PO with open receipt picking is found:
 * 1. Validates the receipt picking in Odoo (button_validate).
 * 2. Reverses the earlier temporary manual stock addition to prevent duplicate inventory.
 * 3. Updates the board_intake_queue record to is_purchase = 1 with the PO reference.
 * 4. Posts an itemized chatter note on PO, Picking, SO, and MO.
 */
export async function reconcileRetroactiveBoardLogsForLinkedPos(
  client: OdooClient,
  cachedCandySharon?: Promise<[OdooUserStakeholder | null, OdooUserStakeholder | null]> | null,
): Promise<{ matchedCount: number; logsFulfilled: string[] }> {
  const result = { matchedCount: 0, logsFulfilled: [] as string[] };
  try {
    const recentLogs = await queryAll<{
      id: string;
      product_id: number;
      product_name: string;
      partner_id: number;
      customer_name: string;
      quantity: number;
      actor_name: string;
      actor_email: string | null;
      vehicle_registration: string | null;
      arrival_date: string | null;
      arrival_time: string | null;
      gate: string | null;
      is_purchase: number;
      purchase_order_reference: string | null;
      odoo_stock_quantity: number | null;
    }>(
      `SELECT id, product_id, product_name, partner_id, customer_name, quantity, actor_name, actor_email,
              vehicle_registration, arrival_date, arrival_time, gate, is_purchase, purchase_order_reference, odoo_stock_quantity
       FROM board_intake_queue
       WHERE status = 'synced' AND reverted_at IS NULL AND (is_purchase = 0 OR is_purchase IS NULL)
         AND created_at >= ${getDatabaseDialect() === 'mysql' ? 'DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 14 DAY)' : "datetime(CURRENT_TIMESTAMP, '-14 days')"}
       ORDER BY created_at DESC LIMIT 30`
    );

    if (!recentLogs.length) return result;

    for (const log of recentLogs) {
      try {
        const poFulfillment = await processBoardIntakePurchaseOrderFulfillment(
          client,
          log,
          cachedCandySharon,
        );

        if (poFulfillment?.fulfilledViaReceipt) {
          // Reconcile manual stock if previously added to avoid double counting
          if (poFulfillment.qtyFulfilled > 0) {
            await client.removeBoardsFromStock({
              productId: Number(log.product_id),
              quantity: poFulfillment.qtyFulfilled,
            }).catch((err) => {
              console.warn('[BoardIntakeSyncService] Note reversing previous manual stock after PO receipt fulfillment:', err);
            });
          }

          await updateBoardIntakeQueueEntry(log.id, {
            status: 'synced',
            isPurchase: 1,
            purchaseOrderReference: poFulfillment.poName,
          });

          result.matchedCount += 1;
          result.logsFulfilled.push(log.id);

          await logEvent('info', 'Retroactive board intake matched to newly connected Purchase Order receipt', {
            boardIntakeId: log.id,
            productName: log.product_name,
            customerName: log.customer_name,
            poName: poFulfillment.poName,
            pickingName: poFulfillment.pickingName,
            qtyFulfilled: poFulfillment.qtyFulfilled,
          }).catch(() => undefined);
        }
      } catch (logErr) {
        console.warn(`[BoardIntakeSyncService] Failed checking retroactive PO fulfillment for log ${log.id}:`, logErr);
      }
    }
  } catch (err) {
    console.error('[BoardIntakeSyncService] Error in reconcileRetroactiveBoardLogsForLinkedPos:', err);
  }
  return result;
}

export async function checkAndWarnPurchaseOrdersForManualBoardIntake(
  client: OdooClient,
  entry: {
    partner_id?: number | string | null;
    product_id?: number | string | null;
    product_name?: string | null;
    quantity?: number | string | null;
    customer_name?: string | null;
    actor_name?: string | null;
    actor_email?: string | null;
    arrival_date?: string | null;
  },
  cachedCandySharon?: Promise<[OdooUserStakeholder | null, OdooUserStakeholder | null]> | null,
): Promise<MatchingBoardPurchaseOrderWarning[]> {
  try {
    const partnerId = Number(entry.partner_id || 0);
    const productId = Number(entry.product_id || 0);
    if (!partnerId || !productId || partnerId === 350) return [];

    const targetCompanyId = await client.getTargetCompanyIdValue();

    // 1. Find candidate Sales Orders for this customer
    const salesOrders = await client.searchReadRecords<{
      id: number;
      name: string;
      partner_id: [number, string] | false;
      user_id: [number, string] | false;
    }>('sale.order', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['partner_id', '=', partnerId],
        ['state', 'not in', ['cancel']],
      ],
      fields: ['id', 'name', 'partner_id', 'user_id'],
      limit: 50,
      order: 'id desc',
    });

    // 2. Find candidate MOs for target company
    const activeMos = await client.searchReadRecords<{
      id: number;
      name: string;
      origin: string | false | null;
    }>('mrp.production', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['state', 'in', ['confirmed', 'progress', 'to_close']],
      ],
      fields: ['id', 'name', 'origin'],
      limit: 100,
    });

    const originNames = new Set<string>();
    const soMap = new Map<string, { id: number; name: string; userId: number | null; userName: string | null }>();

    for (const so of salesOrders) {
      originNames.add(so.name);
      soMap.set(so.name, {
        id: so.id,
        name: so.name,
        userId: Array.isArray(so.user_id) ? so.user_id[0] : null,
        userName: Array.isArray(so.user_id) ? so.user_id[1] : null,
      });
    }

    const moMap = new Map<string, number>();
    for (const mo of activeMos) {
      if (mo.origin) {
        const extracted = extractSoNameFromOrigin(mo.origin) || mo.origin;
        if (soMap.has(extracted) || soMap.has(mo.origin)) {
          originNames.add(mo.name);
          originNames.add(mo.origin);
          if (extracted) originNames.add(extracted);
          moMap.set(mo.name, mo.id);
          moMap.set(mo.origin, mo.id);
          if (extracted) moMap.set(extracted, mo.id);
        }
      }
    }

    const candidateOrigins = Array.from(originNames);
    if (!candidateOrigins.length) return [];

    // 3. Find Purchase Orders in target company (both unapproved and approved)
    const purchaseOrders = await client.searchReadRecords<{
      id: number;
      name: string;
      state: string;
      origin: string | false | null;
      partner_id: [number, string] | false;
    }>('purchase.order', {
      domain: [
        ['company_id', '=', targetCompanyId],
        ['origin', 'in', candidateOrigins],
        ['state', 'not in', ['cancel']],
      ],
      fields: ['id', 'name', 'state', 'origin', 'partner_id'],
      limit: 100,
      order: 'id desc',
    });

    if (!purchaseOrders.length) return [];

    // 4. Find PO lines matching this board product
    const poIds = purchaseOrders.map((p) => p.id);
    const poLines = await client.searchReadRecords<{
      id: number;
      order_id: [number, string];
      product_id: [number, string] | false;
      product_qty: number;
    }>('purchase.order.line', {
      domain: [
        ['order_id', 'in', poIds],
        ['product_id', '=', productId],
      ],
      fields: ['id', 'order_id', 'product_id', 'product_qty'],
      limit: 200,
    });

    if (!poLines.length) return [];

    const poLineMap = new Map<number, number>();
    for (const line of poLines) {
      const pId = Array.isArray(line.order_id) ? line.order_id[0] : 0;
      if (pId) {
        poLineMap.set(pId, (poLineMap.get(pId) || 0) + Number(line.product_qty || 0));
      }
    }

    const warnings: MatchingBoardPurchaseOrderWarning[] = [];
    const safeCustomerName = escapeHtml(entry.customer_name);
    const safeProductName = escapeHtml(entry.product_name);
    const safeActor = escapeHtml(entry.actor_name || entry.actor_email || 'Operator');
    const qtyNum = Number(entry.quantity || 0);

    for (const po of purchaseOrders) {
      if (!poLineMap.has(po.id)) continue;
      const poLineQty = poLineMap.get(po.id) || 0;

      const isUnapproved = ['draft', 'sent', 'to approve'].includes(po.state);
      const isApproved = ['purchase', 'done'].includes(po.state);
      const poStateLabel = isUnapproved ? 'Yet to be approved' : isApproved ? 'Already approved' : po.state;

      const orig = po.origin ? String(po.origin).trim() : '';
      const extractedSo = extractSoNameFromOrigin(orig);
      const linkedSo = (orig ? soMap.get(orig) : undefined) ?? (extractedSo ? soMap.get(extractedSo) : undefined) ?? null;

      const vendorName = Array.isArray(po.partner_id) ? po.partner_id[1] : '';

      warnings.push({
        poId: po.id,
        poName: po.name,
        poState: po.state,
        poStateLabel,
        soId: linkedSo?.id ?? null,
        soName: linkedSo?.name ?? (extractedSo || orig || null),
        salespersonUserId: linkedSo?.userId ?? null,
        salespersonName: linkedSo?.userName ?? null,
        productName: String(entry.product_name || ''),
        quantityLogged: qtyNum,
        actorName: String(entry.actor_name || entry.actor_email || 'Operator'),
      });

      const { mentionHtml, partnerIds } = await resolveBoardIntakeStakeholders(
        client,
        linkedSo?.userId,
        cachedCandySharon,
      );

      const warningHtml = [
        mentionHtml,
        `<div style="margin-top:8px;padding:12px 14px;background:#fff7ed;border-left:5px solid #ea580c;color:#9a3412;border-radius:4px;line-height:1.5;">` +
        `<strong>⚠️ Warning: Board Intake vs Purchase Order Communication Needed</strong><br/>` +
        `• <strong>Board:</strong> ${safeProductName}<br/>` +
        `• <strong>Quantity Manually Logged:</strong> ${qtyNum} sheet${qtyNum === 1 ? '' : 's'}<br/>` +
        `• <strong>Responsible Operator:</strong> <strong>${safeActor}</strong><br/>` +
        `• <strong>Client:</strong> ${safeCustomerName}<br/>` +
        `• <strong>Matching Purchase Order:</strong> <strong>${escapeHtml(po.name)}</strong> (<em>${escapeHtml(poStateLabel)}</em> — state: <code>${escapeHtml(po.state)}</code>)<br/>` +
        `• <strong>PO Ordered Quantity:</strong> ${poLineQty} sheets<br/>` +
        (vendorName ? `• <strong>Vendor:</strong> ${escapeHtml(vendorName)}<br/>` : '') +
        `<br/>` +
        `<strong>Action Required for Salesperson:</strong> Boards for this job have been manually logged by operator <strong>${safeActor}</strong> at the gate, and a matching ${escapeHtml(poStateLabel.toLowerCase())} Purchase Order (<strong>${escapeHtml(po.name)}</strong>) exists for this same board. Please communicate with operator <strong>${safeActor}</strong> to confirm whether these boards were purchased with the purchase order or client-supplied.` +
        `</div>`,
      ].join('<br/>\n');

      // 1. Post to related sale.order chatter
      if (linkedSo?.id) {
        await client.postModelChatterMessage('sale.order', linkedSo.id, warningHtml, partnerIds).catch(() => null);
      }

      // 2. Post to matching purchase.order chatter
      await client.postModelChatterMessage('purchase.order', po.id, warningHtml, partnerIds).catch(() => null);

      // 3. Post to mrp.production chatter if active MO exists
      const moId = (orig ? moMap.get(orig) : undefined) ?? (extractedSo ? moMap.get(extractedSo) : undefined);
      if (moId) {
        await client.postModelChatterMessage('mrp.production', moId, warningHtml, partnerIds).catch(() => null);
      }
    }

    if (warnings.length > 0) {
      await logEvent('warn', 'Manual board intake matched active/unapproved PO: warning log notes posted', {
        partnerId,
        productId,
        productName: entry.product_name,
        operator: entry.actor_name,
        warningsCount: warnings.length,
        matchedPos: warnings.map((w) => ({ po: w.poName, state: w.poState, so: w.soName })),
      }).catch(() => null);
    }

    return warnings;
  } catch (err) {
    console.error('[BoardIntakeSyncService] Error checking matching POs for board intake:', err);
    return [];
  }
}

export async function syncBoardIntakeEntry(id: string) {
  let entry = await getBoardIntakeQueueEntry(id);
  if (!entry) throw new Error('Board log was not found.');
  if (entry.reverted_at || entry.status === 'reverted') return { alreadyReverted: true };
  if (entry.status === 'synced') return { alreadySynced: true, stockQuantity: entry.odoo_stock_quantity };
  if (entry.status === 'processing') {
    throw new Error('This board log is already synchronizing with Odoo.');
  }
  if (!await claimBoardIntakeQueueEntry(id)) {
    throw new Error('This board log was claimed by another synchronization attempt.');
  }

  try {
    entry = (await getBoardIntakeQueueEntry(id))!;
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);

    let stockQuantity = entry.odoo_stock_quantity;
    const activeEntry = entry;
    const candySharonPromise = Promise.all([
      findOdooUserByTerm(client, 'Candy').catch(() => null),
      findOdooUserByTerm(client, 'Sharon').catch(() => null),
    ]);

    let poFulfillment: BoardIntakePoFulfillmentResult | null = null;

    if (stockQuantity == null) {
      if (!isBoardProductName(entry.product_name)) {
        throw new Error(
          `${entry.product_name} is not recognized as a physical board. Services and non-board products cannot receive stock quantities.`,
        );
      }
      const stockable = await client.ensureBoardProductIsStockable(Number(entry.product_id));
      if (stockable.changed) {
        await logEvent('warn', 'Odoo board product changed from consumable to stockable', {
          boardIntakeId: id,
          productId: entry.product_id,
          productTemplateId: stockable.templateId,
          productName: stockable.productName,
        }).catch(() => undefined);
      }

      // 1. Preventive check: Check if this board intake matches an active Purchase Order
      poFulfillment = await processBoardIntakePurchaseOrderFulfillment(
        client,
        entry,
        candySharonPromise,
      ).catch((err) => {
        console.error('[BoardIntakeSyncService] Error checking PO fulfillment:', err);
        return null;
      });

      if (poFulfillment?.fulfilledViaReceipt) {
        // Stock arrived through the PO receipt!
        // If there was any surplus beyond PO quantity, add only the surplus manually
        if (poFulfillment.surplusQty > 0) {
          await client.addBoardsToStock({
            productId: Number(entry.product_id),
            quantity: poFulfillment.surplusQty,
          });
          await client.populateInventoryAdjustmentOperator(
            Number(entry.product_id),
            entry.actor_name,
          ).catch(() => null);
        }
        // Read fresh total available quantity from product in Odoo
        const prods = await client.readRecords<{ qty_available: number }>('product.product', [Number(entry.product_id)], ['qty_available']).catch(() => []);
        stockQuantity = Number(prods[0]?.qty_available ?? entry.quantity);
      } else {
        // Normal client-supplied board intake: add via inventory adjustment
        const stockResult = await client.addBoardsToStock({
          productId: Number(entry.product_id),
          quantity: Number(entry.quantity),
        });
        stockQuantity = stockResult.newQty;

        const operatorAttributed = await client.populateInventoryAdjustmentOperator(
          Number(entry.product_id),
          entry.actor_name,
        );
        if (!operatorAttributed) {
          await logEvent('warn', 'Odoo board inventory adjustment was not attributed to the operator', {
            boardIntakeId: id,
            productId: entry.product_id,
            operatorName: entry.actor_name,
          }).catch(() => undefined);
        }

        // If not fulfilled via PO receipt, check if there are unapproved/draft POs to warn
        await checkAndWarnPurchaseOrdersForManualBoardIntake(client, activeEntry, candySharonPromise).catch((err) => {
          console.error('[BoardIntakeSyncService] Error checking matching POs for board intake warning:', err);
        });
      }

      await updateBoardIntakeQueueEntry(id, {
        status: 'processing',
        stockQuantity,
      });
      await recordExactStockQuantity(Number(entry.product_id), entry.product_name, stockQuantity);
    }

    const matchingMOs = await client.findMOsForBoardIntake({
      productId: Number(entry.product_id),
      partnerId: Number(entry.partner_id),
    });

    if (matchingMOs.length) {
      // NOTE: We do NOT reduce the MO's required component quantity (product_uom_qty).
      // When an MO needs 10 boards and operator logs 5, the MO still requires 10 boards total,
      // 5 are added to stock and reserved via action_assign, and the remaining 5 boards
      // remain an active stock shortage / requirement (balance of 5).

      const reportDate = entry.arrival_date || new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      // 1. Post to mrp.production chatter for all matching MOs
      await Promise.all(matchingMOs.map(async (mo) => {
        const { mentionHtml, partnerIds } = await resolveBoardIntakeStakeholders(
          client,
          mo.soUserId,
          candySharonPromise,
        );
        const qtyNeeded = Number(mo.qtyNeeded || 0);
        const qtyLogged = Number(activeEntry.quantity || 0);
        const previousReserved = Number(mo.qtyReserved || 0);
        const totalSupplied = previousReserved + qtyLogged;
        const balanceRemaining = Math.max(0, qtyNeeded - totalSupplied);

        const chatterHtml = buildBoardIntakeChatterHtml({
          customerName: activeEntry.customer_name,
          productName: activeEntry.product_name,
          quantity: activeEntry.quantity,
          moName: mo.moName,
          qtyNeeded: qtyNeeded > 0 ? qtyNeeded : null,
          balanceRemaining: qtyNeeded > 0 ? balanceRemaining : null,
          gate: activeEntry.gate,
          vehicleRegistration: activeEntry.vehicle_registration,
          arrivalTime: activeEntry.arrival_time,
          reportDate,
          actorName: activeEntry.actor_name || activeEntry.actor_email,
          mentionHtml,
          hasBoardPo: mo.hasBoardPo,
          boardPoNames: mo.boardPoNames,
        });
        return client.postModelChatterMessage('mrp.production', mo.moId, chatterHtml, partnerIds).catch(() => null);
      }));

      // 2. Post to related sale.order chatter if matching MO has a linked Sales Order
      const postedSoIds = new Set<number>();
      for (const mo of matchingMOs) {
        if (mo.soId && !postedSoIds.has(mo.soId)) {
          postedSoIds.add(mo.soId);
          const { mentionHtml, partnerIds } = await resolveBoardIntakeStakeholders(
            client,
            mo.soUserId,
            candySharonPromise,
          );
          const qtyNeeded = Number(mo.qtyNeeded || 0);
          const qtyLogged = Number(activeEntry.quantity || 0);
          const previousReserved = Number(mo.qtyReserved || 0);
          const totalSupplied = previousReserved + qtyLogged;
          const balanceRemaining = Math.max(0, qtyNeeded - totalSupplied);

          const chatterHtml = buildBoardIntakeChatterHtml({
            customerName: activeEntry.customer_name,
            productName: activeEntry.product_name,
            quantity: activeEntry.quantity,
            moName: mo.moName,
            qtyNeeded: qtyNeeded > 0 ? qtyNeeded : null,
            balanceRemaining: qtyNeeded > 0 ? balanceRemaining : null,
            gate: activeEntry.gate,
            vehicleRegistration: activeEntry.vehicle_registration,
            arrivalTime: activeEntry.arrival_time,
            reportDate,
            actorName: activeEntry.actor_name || activeEntry.actor_email,
            mentionHtml,
            hasBoardPo: mo.hasBoardPo,
            boardPoNames: mo.boardPoNames,
          });
          await client.postModelChatterMessage('sale.order', mo.soId, chatterHtml, partnerIds).catch(() => null);
        }
      }

      await client.reserveStockOnMOs(matchingMOs.map((mo) => mo.moId));
    }

    const warehouseId = Number(settings.stock.warehouseId || 0);
    if (warehouseId) {
      // Fire-and-forget warehouse-wide auto-reservation in background so it never blocks intake completion
      void client.autoReserveConfirmedMOs(warehouseId).catch(() => null);
    }

    await updateBoardIntakeQueueEntry(id, {
      status: 'synced',
      stockQuantity,
      isPurchase: poFulfillment?.fulfilledViaReceipt ? 1 : (entry.is_purchase ? 1 : 0),
      purchaseOrderReference: poFulfillment?.poName || entry.purchase_order_reference || null,
    });
    void refreshStockMirror();
    await logEvent('info', 'Board intake synchronized with Odoo', {
      boardIntakeId: id,
      productId: entry.product_id,
      partnerId: entry.partner_id,
      quantity: entry.quantity,
      retryCount: entry.retry_count,
      matchingMoCount: matchingMOs.length,
    }).catch(() => undefined);
    return { alreadySynced: false, stockQuantity, matchingMoCount: matchingMOs.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateBoardIntakeQueueEntry(id, { status: 'failed', errorMessage: message }).catch(() => undefined);
    await logEvent('error', 'Board intake Odoo synchronization failed', {
      boardIntakeId: id,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}

export async function revertBoardIntakeEntry(id: string, revertedBy: string) {
  const entry = await getBoardIntakeQueueEntry(id);
  if (!entry) throw new Error('Board log was not found.');
  if (entry.reverted_at || entry.status === 'reverted') return { alreadyReverted: true };
  if (entry.status !== 'synced') throw new Error('Only a board log already synchronized with Odoo can be reverted.');
  if (!await claimBoardIntakeRevert(id)) throw new Error('This board log is already being reverted or was reverted by another user.');

  try {
    const settings = await getSettings();
    const result = await new OdooClient(settings.odoo).removeBoardsFromStock({
      productId: Number(entry.product_id),
      quantity: Number(entry.quantity),
    });
    await finishBoardIntakeRevert(id, revertedBy, result.newQty);
    await recordExactStockQuantity(Number(entry.product_id), entry.product_name, result.newQty, -Number(entry.quantity));
    void refreshStockMirror();
    await logEvent('warn', 'Board intake reverted in Odoo', {
      boardIntakeId: id,
      productId: entry.product_id,
      quantity: entry.quantity,
      revertedBy,
    }).catch(() => undefined);
    return { alreadyReverted: false, stockQuantity: result.newQty };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releaseBoardIntakeRevert(id, message).catch(() => undefined);
    throw error;
  }
}

export async function retryDueBoardIntakeEntries() {
  if (batchPromise) return batchPromise;
  batchPromise = (async () => {
    const due = await getDueBoardIntakeQueueEntries(5);
    for (const entry of due) {
      if (entry.status === 'processing') {
        await releaseStaleBoardIntakeQueueEntry(entry.id);
      }
      await syncBoardIntakeEntry(entry.id).catch(() => undefined);
    }
  })().finally(() => {
    batchPromise = null;
  });
  return batchPromise;
}

let cleanupExecuted = false;

/**
 * Remove preexisting chatter error log notes for "Warning: Board Intake vs Purchase Order Communication Needed"
 * across sale.order, purchase.order, and mrp.production records in Odoo.
 */
export async function cleanPreexistingMismatchChatter(client?: OdooClient): Promise<{ deletedCount: number; deletedIds: number[] }> {
  try {
    let odooClient = client;
    if (!odooClient) {
      const settings = await getSettings();
      if (!settings?.odoo?.baseUrl) return { deletedCount: 0, deletedIds: [] };
      odooClient = new OdooClient(settings.odoo);
    }

    const patterns = [
      '%Warning: Board Intake vs Purchase Order Communication Needed%',
      '%Board Intake vs Purchase Order Communication Needed%',
    ];

    const seenIds = new Set<number>();
    const allMessageIds: number[] = [];

    for (const pat of patterns) {
      const msgs = await odooClient.searchReadRecords<{ id: number }>('mail.message', {
        domain: [['body', 'ilike', pat]],
        fields: ['id'],
        limit: 200,
      });
      for (const m of msgs) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          allMessageIds.push(m.id);
        }
      }
    }

    if (allMessageIds.length > 0) {
      await odooClient.unlinkRecords('mail.message', allMessageIds);
      await logEvent('info', `Cleaned ${allMessageIds.length} preexisting board intake vs PO mismatch chatter message(s)`, {
        ids: allMessageIds,
      });
    }

    return { deletedCount: allMessageIds.length, deletedIds: allMessageIds };
  } catch (err) {
    console.warn('[cleanPreexistingMismatchChatter] Failed to clean chatter messages:', err);
    return { deletedCount: 0, deletedIds: [] };
  }
}

export function startBoardIntakeSyncInterval() {
  if (intervalHandle) return;
  setTimeout(() => {
    void retryDueBoardIntakeEntries();
    if (!cleanupExecuted) {
      cleanupExecuted = true;
      void cleanPreexistingMismatchChatter().catch(() => undefined);
    }
  }, 10_000).unref();
  intervalHandle = setInterval(() => void retryDueBoardIntakeEntries(), AUTO_RETRY_INTERVAL_MS);
  intervalHandle.unref();
}
