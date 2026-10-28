import {
  ParsedJobSummaryResult,
  ParsedSheetMaterial,
} from '../models/types';
import {
  getLatestExtractedResultByOrderId,
  deleteShopFloorSharedCachePrefix,
  invalidatePendingShopFloorProcessesCache,
} from '../models/repositories';
import { queryAll, execute } from '../models/db';
import { shopFloorCache } from '../routes/shopFloor';
import { syncPendingProcessesFromOdoo } from './shopFloorPendingSyncService';
import {
  isBoardProductName,
  extractBoardAttributes,
  areSameColorFamily,
  extractThicknessMm,
} from './boardProductClassifier';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';
import { parseJobSummaryPdf } from './pdfParser';
import { DEFAULT_PARSER_CONFIG, isJobSummaryAttachment, extractSoNameFromOrigin } from '../utils/helpers';

export interface WorkOrderReconciliationResult {
  moId: number;
  moName: string;
  moProductName: string;
  soId: number | null;
  soName: string | null;
  previousQty: number;
  updatedQty: number;
  workordersUpdated: number;
  componentsUpdated: number;
  matchedMaterial: string;
  actionTaken:
    | 'updated_quantities'
    | 'already_matches'
    | 'no_cutting_product'
    | 'no_matching_material'
    | 'skipped_closed_order'
    | 'skipped_excluded_company';
  reason: string;
}

function relationLabel(value: [number, string] | false | null | undefined): string {
  return Array.isArray(value) ? String(value[1]) : '';
}

function relationId(value: [number, string] | false | null | undefined): number | null {
  return Array.isArray(value) ? Number(value[0]) : null;
}

/**
 * Checks if a product or work order operation relates to cutting boards/panels.
 * Handles patterns such as:
 * - "Cutting White Mdf 18mm 6 panels"
 * - "Cutting White MDF 18mm"
 * - "Cutting - White MDF 18mm"
 * - "Table Saw Cutting", "Panel Saw", "Sawing"
 */
export function isCuttingProductOrWorkOrder(
  productName?: string | null,
  workOrderName?: string | null,
): boolean {
  const p = String(productName || '').toLowerCase().trim();
  const w = String(workOrderName || '').toLowerCase().trim();

  if (/^cutting\b/i.test(p) || /\bcutting\b/i.test(p) || /^cut\b/i.test(p)) {
    return true;
  }
  if (
    w &&
    (/cutting/i.test(w) ||
      /table\s*saw/i.test(w) ||
      /panel\s*saw/i.test(w) ||
      /sawing/i.test(w))
  ) {
    return true;
  }
  return false;
}

export { extractThicknessMm };

function cleanMoColor(color?: string | null): string {
  return String(color || '')
    .replace(
      /\b(CUTTING|CUT|SAWING|SAW|PANEL|PANELS|OPERATION|JOB|AREA|SERVICE|WORK|ORDER|GENERIC|PROCESS|PRODUCTION|MANUFACTURING|EXTRACTION)\b/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches a Manufacturing Order's product or component boards against
 * the sheet materials parsed from the Job Summary PDF.
 *
 * Employs strict thickness tolerance (carcass 16-18mm compatible, others incompatible),
 * hard color conflict penalties, existing quantity alignment bonus, and material exclusion
 * to prevent multiple MOs claiming the same material.
 */
export function findMatchingSheetMaterial(input: {
  moProductName?: string | null;
  componentNames?: string[];
  sheetMaterials?: ParsedSheetMaterial[];
  currentMoQty?: number | null;
  excludedMaterialNames?: string[];
}): { material: ParsedSheetMaterial; matchScore: number; reason: string } | null {
  const sheetMaterials = input.sheetMaterials || [];
  if (sheetMaterials.length === 0) return null;

  const moProductName = String(input.moProductName || '').trim();
  const moThickness = extractThicknessMm(moProductName);
  const moAttr = extractBoardAttributes(moProductName);
  const moColor = cleanMoColor(moAttr.colorFamily);

  const componentNames = (input.componentNames || []).map((c) => String(c).trim());
  const compAttrs = componentNames.map((c) => ({
    name: c,
    thickness: extractThicknessMm(c),
    attr: extractBoardAttributes(c),
    color: cleanMoColor(extractBoardAttributes(c).colorFamily),
  }));

  // Resolve target thickness from MO product or board components
  const targetThickness =
    moThickness ??
    compAttrs.find((ca) => ca.thickness !== null && isBoardProductName(ca.name))?.thickness ??
    null;

  // Single sheet material in Job Summary directly maps to the cutting MO if thickness is compatible
  if (sheetMaterials.length === 1) {
    const singleMat = sheetMaterials[0];
    const singleThickness = extractThicknessMm(singleMat.name) ?? singleMat.thickness_mm;
    if (singleThickness !== null && targetThickness !== null && Math.abs(singleThickness - targetThickness) > 2.1) {
      return null;
    }
    return {
      material: singleMat,
      matchScore: 100,
      reason: 'Single sheet material in Job Summary',
    };
  }

  let bestMatch: { material: ParsedSheetMaterial; matchScore: number; reason: string } | null = null;

  for (const mat of sheetMaterials) {
    let score = 0;
    const reasons: string[] = [];
    const matThickness = extractThicknessMm(mat.name) ?? mat.thickness_mm;
    const matAttr = extractBoardAttributes(mat.name);
    const matColor = cleanMoColor(matAttr.colorFamily);

    // 1. Thickness comparison (dominant physical constraint)
    if (targetThickness !== null && matThickness !== null) {
      const diff = Math.abs(targetThickness - matThickness);
      if (diff <= 0.1) {
        score += 45;
        reasons.push(`Thickness match (${matThickness}mm)`);
      } else if (diff <= 2.1) {
        // Carcass board tolerance: 16mm vs 18mm
        score += 20;
        reasons.push(`Thickness compatible (${matThickness}mm vs ${targetThickness}mm)`);
      } else {
        // Major thickness conflict (e.g. 6mm vs 18mm, 9mm vs 18mm)
        score -= 100;
        reasons.push(`Thickness conflict (${matThickness}mm vs ${targetThickness}mm)`);
      }
    }

    // 2. Color comparison
    if (moColor && matColor) {
      if (areSameColorFamily(moColor, matColor)) {
        score += 40;
        reasons.push(`Color match (${matColor})`);
      } else {
        // Explicit color conflict (e.g. White vs Dark Grey or Cappuccino)
        score -= 100;
        reasons.push(`Color conflict (${moColor} vs ${matColor})`);
      }
    } else if (!moColor && matColor) {
      // Check if any component specifies color
      const matchingCompColor = compAttrs.find((ca) => ca.color && areSameColorFamily(ca.color, matColor));
      if (matchingCompColor) {
        score += 35;
        reasons.push(`Component color match (${matColor})`);
      }
    }

    // 3. Substrate comparison
    const moSub = moAttr.substrate;
    const matSub = matAttr.substrate;
    if (moSub !== 'other' && matSub !== 'other') {
      if (moSub === matSub) {
        score += 30;
        reasons.push(`Substrate match (${matSub})`);
      } else if (
        (moSub === 'mdf' && matSub === 'hardboard') ||
        (moSub === 'hardboard' && matSub === 'mdf')
      ) {
        score += 15;
        reasons.push(`Substrate compatible (${moSub}/${matSub})`);
      } else {
        score -= 25;
        reasons.push(`Substrate mismatch (${moSub} vs ${matSub})`);
      }
    }

    // 4. Raw material component keyword match
    const matWords = mat.name
      .toLowerCase()
      .split(/[\s_\-/]+/)
      .filter((w) => w.length > 2 && !['has', 'grain', 'sheet', 'panels', 'ply', 'mdf'].includes(w));

    for (const ca of compAttrs) {
      if (isBoardProductName(ca.name)) {
        const compWordsMatch = matWords.filter((w) => ca.name.toLowerCase().includes(w)).length;
        if (compWordsMatch > 0) {
          score += compWordsMatch * 20;
          reasons.push(`Component keyword match (${compWordsMatch} words)`);
        }
      }
    }

    // 5. MO product name keyword match
    const moWordsMatch = matWords.filter((w) => moProductName.toLowerCase().includes(w)).length;
    if (moWordsMatch > 0) {
      score += moWordsMatch * 15;
      reasons.push(`MO product keyword match (${moWordsMatch} words)`);
    }

    // 6. Existing Quantity Alignment Bonus
    if (input.currentMoQty != null && input.currentMoQty > 0) {
      if (mat.sheets === input.currentMoQty) {
        score += 35;
        reasons.push(`Quantity exact match (${mat.sheets} sheets)`);
      } else if (mat.panels === input.currentMoQty) {
        score += 25;
        reasons.push(`Panel count exact match (${mat.panels} panels)`);
      }
    }

    // 7. Excluded / already claimed material penalty
    if (input.excludedMaterialNames && input.excludedMaterialNames.includes(mat.name)) {
      score -= 60;
      reasons.push('Already claimed by another MO');
    }

    if (score > (bestMatch?.matchScore ?? 0)) {
      bestMatch = {
        material: mat,
        matchScore: score,
        reason: reasons.join(', ') || 'Best keyword overlap',
      };
    }
  }

  return bestMatch && bestMatch.matchScore > 0 ? bestMatch : null;
}

/**
 * Determines the target quantity to process from the matched Job Summary material
 * or approved Purchase Order.
 */
export function determineTargetCuttingQuantity(input: {
  matchedMaterial?: ParsedSheetMaterial | null;
  parsedJobSummary?: ParsedJobSummaryResult | null;
  approvedPoQuantity?: number | null;
}): number | null {
  const { matchedMaterial, parsedJobSummary, approvedPoQuantity } = input;

  // 1. Primary from matched sheet material sheets count
  if (matchedMaterial) {
    if (typeof matchedMaterial.sheets === 'number' && matchedMaterial.sheets > 0) {
      return matchedMaterial.sheets;
    }
    if (typeof matchedMaterial.panels === 'number' && matchedMaterial.panels > 0) {
      return matchedMaterial.panels;
    }
  }

  // 2. Approved PO quantity if available
  if (typeof approvedPoQuantity === 'number' && approvedPoQuantity > 0) {
    return approvedPoQuantity;
  }

  // 3. Fallback to optimizedSheets from Job Summary
  if (
    parsedJobSummary &&
    typeof parsedJobSummary.optimizedSheets === 'number' &&
    parsedJobSummary.optimizedSheets > 0
  ) {
    return parsedJobSummary.optimizedSheets;
  }

  // 4. Fallback to totalPanels from Job Summary
  if (
    parsedJobSummary &&
    typeof parsedJobSummary.totalPanels === 'number' &&
    parsedJobSummary.totalPanels > 0
  ) {
    return parsedJobSummary.totalPanels;
  }

  return null;
}

/**
 * Reconciles cutting work order and MO quantities for a specific Manufacturing Order
 * against the Job Summary and approved PO requirements.
 */
export async function reconcileWorkOrderQuantitiesForMo(
  client: OdooClient,
  moId: number,
  options?: {
    parsedJobSummary?: ParsedJobSummaryResult;
    soId?: number;
    soName?: string;
    actorName?: string;
    excludedMaterialNames?: string[];
  },
): Promise<WorkOrderReconciliationResult | null> {
  const mos = await client.searchReadRecords<{
    id: number;
    name: string;
    product_id: [number, string] | false;
    product_qty: number;
    qty_producing: number;
    qty_produced: number;
    state: string;
    origin: string | null;
    company_id: [number, string] | false;
  }>('mrp.production', {
    domain: [['id', '=', moId]],
    fields: [
      'id',
      'name',
      'product_id',
      'product_qty',
      'qty_producing',
      'qty_produced',
      'state',
      'origin',
      'company_id',
    ],
    limit: 1,
  });

  const mo = mos[0];
  if (!mo) return null;

  const moProductName = relationLabel(mo.product_id);
  const companyId = relationId(mo.company_id);

  // Exclude URBAN VIBE 2 or invalid prefix
  if (companyId === 3 || String(mo.name).startsWith('VA/')) {
    return {
      moId: mo.id,
      moName: mo.name,
      moProductName,
      soId: null,
      soName: null,
      previousQty: mo.product_qty,
      updatedQty: mo.product_qty,
      workordersUpdated: 0,
      componentsUpdated: 0,
      matchedMaterial: '',
      actionTaken: 'skipped_excluded_company',
      reason: 'MO belongs to excluded company URBAN VIBE 2.',
    };
  }

  // Never modify done or cancelled MOs
  if (['done', 'cancel'].includes(mo.state)) {
    return {
      moId: mo.id,
      moName: mo.name,
      moProductName,
      soId: null,
      soName: null,
      previousQty: mo.product_qty,
      updatedQty: mo.product_qty,
      workordersUpdated: 0,
      componentsUpdated: 0,
      matchedMaterial: '',
      actionTaken: 'skipped_closed_order',
      reason: `MO is in "${mo.state}" state (already closed or cancelled).`,
    };
  }

  // Load raw material components for this MO
  const rawMoves = await client.searchReadRecords<{
    id: number;
    product_id: [number, string] | false;
    product_uom_qty: number;
    state: string;
  }>('stock.move', {
    domain: [['raw_material_production_id', '=', mo.id]],
    fields: ['id', 'product_id', 'product_uom_qty', 'state'],
    limit: 100,
  });

  const componentNames = rawMoves.map((m) => relationLabel(m.product_id));
  const hasBoardComponent = componentNames.some((c) => isBoardProductName(c));

  // Load open work orders for this MO
  const workorders = await client.searchReadRecords<{
    id: number;
    name: string;
    qty_production: number;
    qty_producing: number;
    state: string;
  }>('mrp.workorder', {
    domain: [
      ['production_id', '=', mo.id],
      ['state', 'not in', ['done', 'cancel']],
    ],
    fields: ['id', 'name', 'qty_production', 'qty_producing', 'state'],
    limit: 50,
  });

  const isCutting =
    isCuttingProductOrWorkOrder(moProductName) ||
    workorders.some((wo) => isCuttingProductOrWorkOrder(undefined, wo.name)) ||
    hasBoardComponent;

  if (!isCutting) {
    return {
      moId: mo.id,
      moName: mo.name,
      moProductName,
      soId: null,
      soName: null,
      previousQty: mo.product_qty,
      updatedQty: mo.product_qty,
      workordersUpdated: 0,
      componentsUpdated: 0,
      matchedMaterial: '',
      actionTaken: 'no_cutting_product',
      reason: `Product "${moProductName}" and operations are not cutting-related.`,
    };
  }

  // Resolve Sales Order origin
  const originStr = String(mo.origin || '').trim();
  const soNameCandidate = options?.soName || extractSoNameFromOrigin(originStr);

  let soId = options?.soId || null;
  let soName = soNameCandidate;

  if (!soId && soNameCandidate) {
    const saleOrders = await client.searchReadRecords<{ id: number; name: string }>(
      'sale.order',
      {
        domain: [['name', '=', soNameCandidate]],
        fields: ['id', 'name'],
        limit: 1,
      },
    );
    if (saleOrders[0]) {
      soId = saleOrders[0].id;
      soName = saleOrders[0].name;
    }
  }

  // Obtain Job Summary
  let parsed: ParsedJobSummaryResult | null = options?.parsedJobSummary || null;

  if (!parsed && soId) {
    const latestExtracted = await getLatestExtractedResultByOrderId(soId);
    if (latestExtracted?.resultJson) {
      parsed = latestExtracted.resultJson as ParsedJobSummaryResult;
    }
  }

  if (!parsed && soId) {
    try {
      const attachments = await client.getAttachments(soId);
      const targetAttachment = attachments.find((a) => isJobSummaryAttachment(a, 'job summary'));
      if (targetAttachment) {
        const downloaded = await client.downloadAttachment(targetAttachment.id);
        parsed = await parseJobSummaryPdf(downloaded.content, DEFAULT_PARSER_CONFIG as any);
      }
    } catch {
      // Non-blocking attachment retrieval
    }
  }

  // Check if there is an approved Purchase Order linked to this SO/MO
  let approvedPoQty: number | null = null;
  try {
    const originFilter = soName || originStr;
    if (originFilter) {
      const pos = await client.searchReadRecords<{ id: number; name: string; state: string }>(
        'purchase.order',
        {
          domain: [
            ['origin', 'ilike', originFilter],
            ['state', 'in', ['purchase', 'done']], // Only confirmed/approved POs
          ],
          fields: ['id', 'name', 'state'],
          limit: 5,
        },
      );
      if (pos.length > 0) {
        const poIds = pos.map((p) => p.id);
        const poLines = await client.searchReadRecords<{
          id: number;
          product_id: [number, string] | false;
          product_qty: number;
        }>('purchase.order.line', {
          domain: [['order_id', 'in', poIds]],
          fields: ['id', 'product_id', 'product_qty'],
          limit: 100,
        });

        // Sum matching board quantities from approved PO
        const matchingPoLines = poLines.filter((l) => {
          const name = relationLabel(l.product_id).toLowerCase();
          return isBoardProductName(name);
        });

        if (matchingPoLines.length > 0) {
          approvedPoQty = matchingPoLines.reduce(
            (sum, l) => sum + (Number(l.product_qty) || 0),
            0,
          );
        }
      }
    }
  } catch {
    // Non-blocking PO check
  }

  // Find matching sheet material from Job Summary
  const matchResult = findMatchingSheetMaterial({
    moProductName,
    componentNames,
    sheetMaterials: parsed?.sheetMaterials || [],
    currentMoQty: mo.product_qty,
    excludedMaterialNames: options?.excludedMaterialNames,
  });

  const targetQty = determineTargetCuttingQuantity({
    matchedMaterial: matchResult?.material,
    parsedJobSummary: parsed,
    approvedPoQuantity: approvedPoQty,
  });

  if (!targetQty || targetQty <= 0) {
    return {
      moId: mo.id,
      moName: mo.name,
      moProductName,
      soId,
      soName,
      previousQty: mo.product_qty,
      updatedQty: mo.product_qty,
      workordersUpdated: 0,
      componentsUpdated: 0,
      matchedMaterial: matchResult?.material?.name || '',
      actionTaken: 'no_matching_material',
      reason: 'Could not determine target cutting quantity from Job Summary or PO.',
    };
  }

  const currentQty = Number(mo.product_qty || 0);

  // If already matching, skip update
  if (Math.abs(currentQty - targetQty) < 0.001) {
    return {
      moId: mo.id,
      moName: mo.name,
      moProductName,
      soId,
      soName,
      previousQty: currentQty,
      updatedQty: currentQty,
      workordersUpdated: 0,
      componentsUpdated: 0,
      matchedMaterial: matchResult?.material?.name || 'Board',
      actionTaken: 'already_matches',
      reason: `Quantity already matches target quantity (${targetQty}).`,
    };
  }

  // --- PERFORM RECONCILIATION UPDATES ---

  // 1. Update mrp.production product_qty
  const moVals: Record<string, unknown> = { product_qty: targetQty };
  if (Number(mo.qty_producing || 0) > targetQty) {
    moVals.qty_producing = targetQty;
  }
  await client.writeRecord('mrp.production', [mo.id], moVals);

  // 2. Update mrp.workorder qty_production
  let workordersUpdated = 0;
  for (const wo of workorders) {
    const woVals: Record<string, unknown> = { qty_production: targetQty };
    if (Number(wo.qty_producing || 0) > targetQty) {
      woVals.qty_producing = targetQty;
    }
    try {
      await client.writeRecord('mrp.workorder', [wo.id], woVals);
      workordersUpdated++;
    } catch {
      // Some Odoo builds compute qty_production dynamically from production_id.product_qty
    }
  }

  // 3. Update stock.move component requirements
  let componentsUpdated = 0;
  for (const move of rawMoves) {
    const prodName = relationLabel(move.product_id);
    if (isBoardProductName(prodName) || (matchResult && prodName.toLowerCase().includes(matchResult.material.name.toLowerCase()))) {
      if (Math.abs((move.product_uom_qty || 0) - targetQty) > 0.001) {
        await client.writeRecord('stock.move', [move.id], { product_uom_qty: targetQty });
        componentsUpdated++;
      }
    }
  }

  // 4. Re-evaluate stock reservation so 100% stock availability is assigned immediately
  await client.callRecordMethod('mrp.production', 'action_assign', [mo.id]).catch(() => null);

  // 4b. Reconcile local shop_floor_pending_processes for this MO so board intake requirements reflect the new target
  try {
    const existingProcesses = await queryAll<{
      id: string;
      product_name: string;
      qty_needed: number;
      qty_reserved: number;
      qty_missing: number;
      status: string;
    }>(
      'SELECT id, product_name, qty_needed, qty_reserved, qty_missing, status FROM shop_floor_pending_processes WHERE mo_id = ?',
      [mo.id],
    );

    for (const proc of existingProcesses) {
      const prodName = proc.product_name || '';
      if (
        isBoardProductName(prodName) ||
        (matchResult && prodName.toLowerCase().includes(matchResult.material.name.toLowerCase()))
      ) {
        const newQtyNeeded = targetQty;
        const curReserved = Number(proc.qty_reserved || 0);
        const newQtyMissing = Math.max(0, newQtyNeeded - curReserved);
        const newQtyReserved = Math.min(newQtyNeeded, curReserved);
        const newStatus = newQtyMissing <= 0 ? 'loaded' : 'pending';

        await execute(
          `UPDATE shop_floor_pending_processes
           SET qty_needed = ?, qty_reserved = ?, qty_missing = ?, status = ?,
               loaded_at = CASE WHEN ? = 'loaded' AND (loaded_at IS NULL OR loaded_at = '') THEN CURRENT_TIMESTAMP ELSE loaded_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newQtyNeeded, newQtyReserved, newQtyMissing, newStatus, newStatus, proc.id],
        );
      }
    }

    // Invalidate shop-floor RAM and shared snapshots
    try {
      invalidatePendingShopFloorProcessesCache();
      shopFloorCache.clearPrefix('shop-floor-dashboard:');
      await deleteShopFloorSharedCachePrefix('shop-floor:').catch(() => null);
    } catch (_cacheErr) {
      // Non-fatal cache invalidation
    }

    // Trigger full background sync to ensure clean state
    void syncPendingProcessesFromOdoo(true).catch(() => null);
  } catch (syncErr) {
    void logEvent('warn', 'Failed to update shop_floor_pending_processes after cutting quantity reconciliation', {
      moId: mo.id,
      error: syncErr instanceof Error ? syncErr.message : String(syncErr),
    }).catch(() => null);
  }

  const matchedMaterialDesc = matchResult?.material
    ? (matchResult.material.name.toLowerCase().includes('mm')
        ? matchResult.material.name
        : `${matchResult.material.name}${matchResult.material.thickness_mm ? ` ${matchResult.material.thickness_mm}mm` : ''}`).trim()
    : 'Job Summary Board';

  // 5. Post audit log notes on MO chatter
  const actorInfo = options?.actorName ? `\nUpdated by: ${options.actorName}` : '';
  const moChatterHtml =
    `<p>✂️ <strong>Work Order Cutting Quantity Reconciled with Job Summary</strong></p>` +
    `<p>Quantity to be processed on MO <strong>${mo.name}</strong> (${moProductName}) adjusted from <strong>${currentQty}</strong> to <strong>${targetQty}</strong> to match Job Summary requirements (${matchedMaterialDesc}: ${targetQty} sheets/panels).</p>` +
    `<p>Raw material component stock requirement updated to <strong>${targetQty}</strong> and re-reserved.</p>` +
    (actorInfo ? `<p><em>${actorInfo}</em></p>` : '');

  await client.postModelChatterMessage('mrp.production', mo.id, moChatterHtml).catch(() => null);

  // 6. Cross-alert note on Sales Order chatter
  if (soId) {
    const soChatterHtml =
      `<p>✂️ <strong>Work Order Cutting Quantity Adjusted:</strong> MO <strong>${mo.name}</strong> (${moProductName}) work order quantity modified from <strong>${currentQty}</strong> to <strong>${targetQty}</strong> to match Job Summary requirements.</p>`;
    await client.postModelChatterMessage('sale.order', soId, soChatterHtml).catch(() => null);
  }

  await logEvent('info', 'Work order cutting quantity reconciled with Job Summary', {
    moId: mo.id,
    moName: mo.name,
    productName: moProductName,
    soId,
    soName,
    previousQty: currentQty,
    updatedQty: targetQty,
    workordersUpdated,
    componentsUpdated,
    matchedMaterial: matchedMaterialDesc,
  }).catch(() => null);

  return {
    moId: mo.id,
    moName: mo.name,
    moProductName,
    soId,
    soName,
    previousQty: currentQty,
    updatedQty: targetQty,
    workordersUpdated,
    componentsUpdated,
    matchedMaterial: matchedMaterialDesc,
    actionTaken: 'updated_quantities',
    reason: `Cutting quantity adjusted from ${currentQty} to ${targetQty} to match Job Summary (${matchedMaterialDesc}).`,
  };
}

/**
 * Reconciles cutting work orders and MO quantities for all active Manufacturing Orders
 * linked to a Sales Order.
 */
export async function reconcileWorkOrderQuantitiesForSaleOrder(
  client: OdooClient,
  saleOrderId: number,
  options?: {
    parsedJobSummary?: ParsedJobSummaryResult;
    actorName?: string;
  },
): Promise<WorkOrderReconciliationResult[]> {
  const saleOrders = await client.readRecords<{ id: number; name: string }>(
    'sale.order',
    [saleOrderId],
    ['id', 'name'],
  );

  const so = saleOrders[0];
  if (!so) return [];

  // Search active MOs linked to this Sales Order (origin === SO name or contains it)
  const candidateMos = await client.searchReadRecords<{ id: number; name: string }>(
    'mrp.production',
    {
      domain: [
        ['origin', 'ilike', so.name],
        ['state', 'not in', ['done', 'cancel']],
      ],
      fields: ['id', 'name'],
      limit: 20,
    },
  );

  const results: WorkOrderReconciliationResult[] = [];
  const claimedMaterialNames: string[] = [];
  for (const candidate of candidateMos) {
    try {
      const res = await reconcileWorkOrderQuantitiesForMo(client, candidate.id, {
        parsedJobSummary: options?.parsedJobSummary,
        soId: so.id,
        soName: so.name,
        actorName: options?.actorName,
        excludedMaterialNames: claimedMaterialNames,
      });
      if (res) {
        results.push(res);
        if (res.matchedMaterial) {
          claimedMaterialNames.push(res.matchedMaterial);
        }
      }
    } catch (err) {
      await logEvent('warn', `Failed to reconcile MO ${candidate.name} work order quantity`, {
        moId: candidate.id,
        soId: saleOrderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Reconciles cutting work order quantities given a confirmed Purchase Order.
 */
export async function reconcileWorkOrderQuantitiesForPurchaseOrder(
  client: OdooClient,
  purchaseOrderId: number,
  options?: {
    actorName?: string;
  },
): Promise<WorkOrderReconciliationResult[]> {
  const orders = await client.readRecords<{
    id: number;
    name: string;
    origin?: string;
  }>('purchase.order', [purchaseOrderId], ['id', 'name', 'origin']);

  const po = orders[0];
  if (!po) return [];

  const origin = String(po.origin || '').trim();
  let soNameCandidate = extractSoNameFromOrigin(origin);

  if (!soNameCandidate && origin.startsWith('WH/MO/')) {
    const mos = await client.searchReadRecords<{ id: number; name: string; origin?: string }>(
      'mrp.production',
      {
        domain: [['name', '=', origin]],
        fields: ['id', 'name', 'origin'],
        limit: 1,
      },
    );
    if (mos[0]?.origin) {
      soNameCandidate = extractSoNameFromOrigin(mos[0].origin);
    }
  }

  if (!soNameCandidate) return [];

  const saleOrders = await client.searchReadRecords<{ id: number; name: string }>(
    'sale.order',
    {
      domain: [['name', '=', soNameCandidate]],
      fields: ['id', 'name'],
      limit: 1,
    },
  );

  const so = saleOrders[0];
  if (!so) return [];

  return reconcileWorkOrderQuantitiesForSaleOrder(client, so.id, {
    actorName: options?.actorName,
  });
}
