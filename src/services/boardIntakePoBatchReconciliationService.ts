import { OdooClient } from './odooClient';
import { logEvent } from './logService';

export interface PoReconciliationTarget {
  poId: number;
  poName: string;
  vendorName: string;
  pickingId: number;
  pickingName: string;
  pickingState: string;
  action: 'validate_full' | 'validate_partial_with_backorder' | 'skip_already_done';
  lines: Array<{
    lineId: number;
    productId: number;
    productName: string;
    orderedQty: number;
    receivedQty: number;
    moveId: number;
    moveDemand: number;
    currentDoneQty: number;
    targetDoneQty: number;
    status: 'fully_logged' | 'partially_logged' | 'unlogged' | 'already_received';
  }>;
}

export interface PoReconciliationReport {
  dryRun: boolean;
  totalAudited: number;
  targets: PoReconciliationTarget[];
  validatedCount: number;
  errors: Array<{ poName: string; error: string }>;
}

export interface ParsedChatterBoardLog {
  productName: string;
  quantity: number;
  date: string;
}

/**
 * Extracts and deduplicates logged board quantities from chatter messages.
 * Filters out rapid duplicate retries (within 2 minutes with identical product and qty),
 * while honoring separate sequential offloading batches.
 */
export function parseLoggedQtysFromChatter(
  messages: Array<{ id?: number; body: string; date?: string }>
): Record<string, { max: number; sum: number; last: number }> {
  const parsedEntries: ParsedChatterBoardLog[] = [];

  for (const msg of messages) {
    const text = (msg.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const match = text.match(/Board:\s*([^•]+?)\s*•\s*Quantity Received:\s*(\d+(?:\.\d+)?)/i);
    if (match) {
      const prodName = match[1].trim();
      const qty = parseFloat(match[2]);
      const date = msg.date || '';

      // Check if this is a rapid duplicate of a previous entry (within 2 minutes)
      const isDuplicate = parsedEntries.some((existing) => {
        if (existing.productName.toLowerCase() !== prodName.toLowerCase()) return false;
        if (existing.quantity !== qty) return false;
        if (existing.date && date) {
          const diffMs = Math.abs(new Date(existing.date).getTime() - new Date(date).getTime());
          return diffMs < 120_000;
        }
        return false;
      });

      if (!isDuplicate) {
        parsedEntries.push({ productName: prodName, quantity: qty, date });
      }
    }
  }

  const result: Record<string, { max: number; sum: number; last: number }> = {};
  for (const entry of parsedEntries) {
    if (!result[entry.productName]) {
      result[entry.productName] = { max: 0, sum: 0, last: 0 };
    }
    result[entry.productName].max = Math.max(result[entry.productName].max, entry.quantity);
    result[entry.productName].sum += entry.quantity;
    result[entry.productName].last = entry.quantity;
  }

  return result;
}

/**
 * Audits and safely validates stuck PO incoming receipts whose boards were logged at gate intake.
 * Strictly prevents double entry:
 * 1. Skips pickings already in 'done' state.
 * 2. Only stages done quantities matching PO demand / logged amounts.
 * 3. Handles backorders automatically for partial deliveries.
 */
export async function reconcileLoggedPurchaseOrderReceipts(
  client: OdooClient,
  options: { dryRun?: boolean; specificPoIds?: number[] } = {}
): Promise<PoReconciliationReport> {
  const dryRun = options.dryRun ?? false;
  const report: PoReconciliationReport = {
    dryRun,
    totalAudited: 0,
    targets: [],
    validatedCount: 0,
    errors: [],
  };

  try {
    const targetCompanyId = await client.getTargetCompanyIdValue();

    // 1. Find candidate POs: Either specific IDs or search POs with Gate Board Intake chatter
    let candidatePoIds: number[] = options.specificPoIds || [];
    if (candidatePoIds.length === 0) {
      const messages = await client.searchReadRecords<{ res_id: number }>('mail.message', {
        domain: [
          ['model', '=', 'purchase.order'],
          ['body', 'like', 'Gate Board Intake: Received via Purchase Receipt'],
        ],
        fields: ['res_id'],
        limit: 100,
        order: 'id desc',
      }).catch(() => []);

      candidatePoIds = [...new Set(messages.map((m) => m.res_id).filter(Boolean))];
    }

    if (candidatePoIds.length === 0) {
      return report;
    }

    const pos = await client.searchReadRecords<{
      id: number;
      name: string;
      state: string;
      partner_id: [number, string] | false;
      picking_ids: number[];
    }>('purchase.order', {
      domain: [
        ['id', 'in', candidatePoIds],
        ['state', 'in', ['purchase', 'done']],
      ],
      fields: ['id', 'name', 'state', 'partner_id', 'picking_ids'],
    }).catch(() => []);

    report.totalAudited = pos.length;

    for (const po of pos) {
      if (!po.picking_ids || po.picking_ids.length === 0) continue;

      // Find incoming pickings that are not done or cancelled
      const openPickings = await client.searchReadRecords<{
        id: number;
        name: string;
        state: string;
      }>('stock.picking', {
        domain: [
          ['id', 'in', po.picking_ids],
          ['company_id', '=', targetCompanyId],
          ['picking_type_code', '=', 'incoming'],
          ['state', 'in', ['assigned', 'confirmed']],
        ],
        fields: ['id', 'name', 'state'],
      }).catch(() => []);

      if (openPickings.length === 0) continue;

      const poLines = await client.searchReadRecords<{
        id: number;
        product_id: [number, string];
        product_qty: number;
        qty_received: number;
      }>('purchase.order.line', {
        domain: [['order_id', '=', po.id]],
        fields: ['id', 'product_id', 'product_qty', 'qty_received'],
      }).catch(() => []);

      // Get chatter messages for this PO
      const chatterMessages = await client.searchReadRecords<{ body: string; date: string }>('mail.message', {
        domain: [
          ['model', '=', 'purchase.order'],
          ['res_id', '=', po.id],
          ['body', 'like', 'Gate Board Intake'],
        ],
        fields: ['body', 'date'],
        order: 'id asc',
      }).catch(() => []);

      const loggedQtysMap = parseLoggedQtysFromChatter(chatterMessages);

      for (const picking of openPickings) {
        const moves = await client.searchReadRecords<{
          id: number;
          product_id: [number, string] | false;
          product_uom_qty: number;
          quantity: number;
          state: string;
        }>('stock.move', {
          domain: [
            ['picking_id', '=', picking.id],
            ['state', 'not in', ['done', 'cancel']],
          ],
          fields: ['id', 'product_id', 'product_uom_qty', 'quantity', 'state'],
        }).catch(() => []);

        if (moves.length === 0) continue;

        const targetLines: PoReconciliationTarget['lines'] = [];
        let allLinesFullyLogged = true;
        let anyLineLogged = false;

        for (const poLine of poLines) {
          const prodId = poLine.product_id[0];
          const prodName = poLine.product_id[1];
          const move = moves.find((m) => {
            const mProdId = Array.isArray(m.product_id) ? m.product_id[0] : m.product_id;
            return mProdId === prodId;
          });

          if (!move) continue;

          // Find matching chatter log
          const matchingKey = Object.keys(loggedQtysMap).find(
            (k) => k.toLowerCase().includes(prodName.toLowerCase()) || prodName.toLowerCase().includes(k.toLowerCase())
          );
          const chatterStats = matchingKey ? loggedQtysMap[matchingKey] : null;
          const bestLoggedQty = chatterStats
            ? (chatterStats.sum === move.product_uom_qty || chatterStats.sum === poLine.product_qty)
              ? chatterStats.sum
              : Math.max(chatterStats.max, chatterStats.last)
            : 0;

          let status: 'fully_logged' | 'partially_logged' | 'unlogged' | 'already_received' = 'unlogged';
          let targetDoneQty = 0;

          if (poLine.qty_received >= poLine.product_qty) {
            status = 'already_received';
            targetDoneQty = 0; // Already received in another picking
          } else if (bestLoggedQty >= move.product_uom_qty || bestLoggedQty >= poLine.product_qty) {
            status = 'fully_logged';
            targetDoneQty = move.product_uom_qty;
            anyLineLogged = true;
          } else if (bestLoggedQty > 0) {
            status = 'partially_logged';
            targetDoneQty = bestLoggedQty;
            anyLineLogged = true;
            allLinesFullyLogged = false;
          } else {
            status = 'unlogged';
            targetDoneQty = 0;
            allLinesFullyLogged = false;
          }

          targetLines.push({
            lineId: poLine.id,
            productId: prodId,
            productName: prodName,
            orderedQty: poLine.product_qty,
            receivedQty: poLine.qty_received,
            moveId: move.id,
            moveDemand: move.product_uom_qty,
            currentDoneQty: move.quantity,
            targetDoneQty,
            status,
          });
        }

        if (targetLines.length === 0) continue;

        const action: PoReconciliationTarget['action'] = allLinesFullyLogged
          ? 'validate_full'
          : anyLineLogged
          ? 'validate_partial_with_backorder'
          : 'skip_already_done';

        const targetSummary: PoReconciliationTarget = {
          poId: po.id,
          poName: po.name,
          vendorName: po.partner_id ? po.partner_id[1] : 'Unknown',
          pickingId: picking.id,
          pickingName: picking.name,
          pickingState: picking.state,
          action,
          lines: targetLines,
        };

        report.targets.push(targetSummary);

        // If not a dry run and action requires validation, execute safe validation!
        if (!dryRun && (action === 'validate_full' || action === 'validate_partial_with_backorder')) {
          try {
            // Stage move and move.line done quantities
            const moveLines = await client.searchReadRecords<{
              id: number;
              move_id: [number, string] | false;
              product_id: [number, string] | false;
              quantity: number;
            }>('stock.move.line', {
              domain: [['picking_id', '=', picking.id]],
              fields: ['id', 'move_id', 'product_id', 'quantity'],
              limit: 200,
            }).catch(() => []);

            for (const tLine of targetLines) {
              await client.writeRecord('stock.move', [tLine.moveId], { quantity: tLine.targetDoneQty }).catch(() => null);

              const relatedLines = moveLines.filter((l) => {
                const lineMoveId = Array.isArray(l.move_id) ? l.move_id[0] : l.move_id;
                return lineMoveId === tLine.moveId;
              });

              if (relatedLines.length > 0) {
                await client.writeRecord('stock.move.line', [relatedLines[0].id], { quantity: tLine.targetDoneQty }).catch(() => null);
                if (relatedLines.length > 1) {
                  const extraIds = relatedLines.slice(1).map((l) => l.id);
                  await client.writeRecord('stock.move.line', extraIds, { quantity: 0 }).catch(() => null);
                }
              }
            }

            // Populate metadata
            await client.populatePickingValidationMetadata(picking.id, 'system-reconciliation@urbanvibeinteriordesign.co.ke').catch(() => null);

            // Execute button_validate
            const valResult = await client.callRecordMethod<any>('stock.picking', 'button_validate', [picking.id]).catch((err) => {
              report.errors.push({ poName: po.name, error: String(err?.message || err) });
              return null;
            });

            // Handle backorder wizard if prompted
            if (valResult && typeof valResult === 'object' && valResult.res_model) {
              const wizardContext = {
                active_model: 'stock.picking',
                active_id: picking.id,
                active_ids: [picking.id],
                button_validate_picking_ids: [picking.id],
                ...(valResult.context || {}),
              };
              const wizardId = valResult.res_id;
              if (wizardId) {
                await client.callRecordMethod(valResult.res_model, 'process', [wizardId], { context: wizardContext }).catch(() => null);
              } else {
                const createdWizId = await client.createRecord(valResult.res_model, {
                  pick_ids: [[6, 0, [picking.id]]],
                }, { context: wizardContext }).catch(() => null);
                if (createdWizId) {
                  await client.callRecordMethod(valResult.res_model, 'process', [createdWizId], { context: wizardContext }).catch(() => null);
                }
              }
            }

            await client.populatePickingValidationMetadata(picking.id, 'system-reconciliation@urbanvibeinteriordesign.co.ke').catch(() => null);

            // Check if picking is now done
            const refreshed = typeof (client as any).readRecords === 'function'
              ? await client.readRecords<{ id: number; state: string }>('stock.picking', [picking.id], ['id', 'state']).catch(() => [])
              : await client.searchReadRecords<{ id: number; state: string }>('stock.picking', { domain: [['id', '=', picking.id]], fields: ['id', 'state'], limit: 1 }).catch(() => []);

            if (refreshed[0]?.state === 'done') {
              report.validatedCount += 1;
              targetSummary.pickingState = 'done';
              await logEvent('info', 'Successfully validated stuck board intake receipt', {
                poName: po.name,
                pickingId: picking.id,
                pickingName: picking.name,
                action,
              }).catch(() => null);
            }
          } catch (execErr: any) {
            report.errors.push({ poName: po.name, error: execErr?.message || String(execErr) });
          }
        }
      }
    }
  } catch (err: any) {
    report.errors.push({ poName: 'ALL', error: err?.message || String(err) });
  }

  return report;
}
