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
import { recordExactStockQuantity, refreshStockMirror } from './stockMirrorService';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';
import { isBoardProductName } from './boardProductClassifier';
import { findOdooUserByTerm, OdooUserStakeholder, extractSoNameFromOrigin } from './poJobSummaryAuditService';

const AUTO_RETRY_INTERVAL_MS = 2 * 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;
let batchPromise: Promise<void> | null = null;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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

    // Persist this checkpoint immediately. If a later Odoo request fails, the
    // retry skips the inventory addition and cannot double-add the boards.
    let stockQuantity = entry.odoo_stock_quantity;
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
      const stockResult = await client.addBoardsToStock({
        productId: Number(entry.product_id),
        quantity: Number(entry.quantity),
      });
      stockQuantity = stockResult.newQty;
      await updateBoardIntakeQueueEntry(id, {
        status: 'processing',
        stockQuantity,
      });
      await recordExactStockQuantity(Number(entry.product_id), entry.product_name, stockQuantity);
    }

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

    const matchingMOs = await client.findMOsForBoardIntake({
      productId: Number(entry.product_id),
      partnerId: Number(entry.partner_id),
    });
    const activeEntry = entry;
    const candySharonPromise = Promise.all([
      findOdooUserByTerm(client, 'Candy').catch(() => null),
      findOdooUserByTerm(client, 'Sharon').catch(() => null),
    ]);

    // Check if there are any Purchase Orders (unapproved or approved) matching this board intake,
    // and post warning log notes to the salesperson asking to communicate with the responsible operator.
    await checkAndWarnPurchaseOrdersForManualBoardIntake(client, activeEntry, candySharonPromise).catch((err) => {
      console.error('[BoardIntakeSyncService] Error checking matching POs for board intake warning:', err);
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

    await updateBoardIntakeQueueEntry(id, { status: 'synced', stockQuantity });
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

export function startBoardIntakeSyncInterval() {
  if (intervalHandle) return;
  setTimeout(() => void retryDueBoardIntakeEntries(), 10_000).unref();
  intervalHandle = setInterval(() => void retryDueBoardIntakeEntries(), AUTO_RETRY_INTERVAL_MS);
  intervalHandle.unref();
}
