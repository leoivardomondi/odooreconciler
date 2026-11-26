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
  normalizeBoardProductName,
  extractBoardAttributes,
  areSameColorFamily,
  extractThicknessMm,
} from './boardProductClassifier';
import { logEvent } from './logService';
import { OdooClient, isSchedulerRunActive } from './odooClient';
import { parseJobSummaryPdf } from './pdfParser';
import { DEFAULT_PARSER_CONFIG, isJobSummaryAttachment, extractSoNameFromOrigin } from '../utils/helpers';
import { resolveCombinedJobSummaryFromOdooAttachments } from './multiJobSummaryCombiner';

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
      } else if (moSub === 'block_board' || matSub === 'block_board') {
        score -= 100;
        reasons.push(`Incompatible block board substrate (${moSub} vs ${matSub})`);
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
 * Checks whether a Sales Order line or Purchase Order line matches the specific board material
 * of a cutting Manufacturing Order (or its matched Job Summary material).
 * Prevents summing unrelated boards (e.g. Backer 3mm + Cherry 18mm + Grooving 3mm = 148).
 */
export function doesLineMatchMoBoardMaterial(input: {
  lineProductName: string;
  moProductName?: string | null;
  componentNames?: string[];
  matchedMaterial?: ParsedSheetMaterial | null;
}): boolean {
  const lineRaw = String(input.lineProductName || '').trim();
  if (!lineRaw) return false;
  if (/example\s+board/i.test(lineRaw) || /optimis?ed\s+panels?/i.test(lineRaw) || /\bgroov(?:ing|e)\b/i.test(lineRaw)) {
    return false;
  }
  if (!isBoardProductName(lineRaw) && !/^cutting\b/i.test(lineRaw)) {
    return false;
  }

  const lineNorm = normalizeBoardProductName(lineRaw);
  const lineThick = extractThicknessMm(lineRaw);
  const lineAttr = extractBoardAttributes(lineRaw);
  const lineColor = cleanMoColor(lineAttr.colorFamily);

  if (input.matchedMaterial) {
    const matNorm = normalizeBoardProductName(input.matchedMaterial.name);
    if (lineNorm.includes(matNorm) || matNorm.includes(lineNorm)) {
      return true;
    }
    const matThick = extractThicknessMm(input.matchedMaterial.name) ?? input.matchedMaterial.thickness_mm;
    if (lineThick !== null && matThick !== null && Math.abs(lineThick - matThick) > 2.1) {
      return false;
    }
    const matColor = cleanMoColor(extractBoardAttributes(input.matchedMaterial.name).colorFamily);
    if (lineColor && matColor) {
      return areSameColorFamily(lineColor, matColor);
    }
  }

  // Compare against MO product name and board components
  const references = [
    String(input.moProductName || '').trim(),
    ...(input.componentNames || []).filter((c) => isBoardProductName(c)),
  ].filter(Boolean);

  for (const ref of references) {
    const refNorm = normalizeBoardProductName(ref);
    if (refNorm && (lineNorm === refNorm || lineNorm.includes(refNorm) || refNorm.includes(lineNorm))) {
      return true;
    }
    const refThick = extractThicknessMm(ref);
    if (lineThick !== null && refThick !== null && Math.abs(lineThick - refThick) > 2.1) {
      continue;
    }
    const refColor = cleanMoColor(extractBoardAttributes(ref).colorFamily);
    if (lineColor && refColor && areSameColorFamily(lineColor, refColor)) {
      return true;
    }
  }

  return false;
}

/**
 * Determines the target quantity to process from the matched Job Summary material,
 * approved Purchase Order, or Sales Order quoted lines (accounting for offcut allowances).
 */
export function determineTargetCuttingQuantity(input: {
  matchedMaterial?: ParsedSheetMaterial | null;
  parsedJobSummary?: ParsedJobSummaryResult | null;
  approvedPoQuantity?: number | null;
  soBoardQuantity?: number | null;
}): number | null {
  const { matchedMaterial, parsedJobSummary, approvedPoQuantity, soBoardQuantity } = input;

  const matSheets =
    matchedMaterial && typeof matchedMaterial.sheets === 'number' && matchedMaterial.sheets > 0
      ? matchedMaterial.sheets
      : null;

  // 1. Offcut Rule: If approved PO or Sales Order quoted exactly matSheets - 1
  // (e.g. Job Summary has 4 sheets, but Sales Order / PO has 3 because the final layout
  // page has 1-2 small panels acquired from workshop offcuts without charging the customer),
  // honor the 3 full boards to prevent over-consuming raw boards or generating false shortages.
  if (matSheets && matSheets >= 2) {
    if (typeof approvedPoQuantity === 'number' && approvedPoQuantity === matSheets - 1) {
      return approvedPoQuantity;
    }
    if (typeof soBoardQuantity === 'number' && soBoardQuantity === matSheets - 1) {
      return soBoardQuantity;
    }
  }

  // 2. Primary from matched sheet material sheets count
  if (matchedMaterial) {
    if (typeof matchedMaterial.sheets === 'number' && matchedMaterial.sheets > 0) {
      return matchedMaterial.sheets;
    }
    if (typeof matchedMaterial.panels === 'number' && matchedMaterial.panels > 0) {
      return matchedMaterial.panels;
    }
  }

  // 3. Material-specific Approved PO quantity if available
  if (typeof approvedPoQuantity === 'number' && approvedPoQuantity > 0) {
    return approvedPoQuantity;
  }

  // 4. Material-specific Sales Order board quantity if available
  if (typeof soBoardQuantity === 'number' && soBoardQuantity > 0) {
    return soBoardQuantity;
  }

  // 5 & 6. Fallback to optimizedSheets / totalPanels ONLY when the Job Summary had NO
  // sheetMaterials breakdown at all. If sheetMaterials existed (>0) and none matched this MO,
  // optimizedSheets/totalPanels belong to OTHER board materials and must never overwrite this MO!
  const hasUnmatchedSheetMaterials =
    !matchedMaterial &&
    Array.isArray(parsedJobSummary?.sheetMaterials) &&
    parsedJobSummary!.sheetMaterials.length > 0;

  if (!hasUnmatchedSheetMaterials) {
    if (
      parsedJobSummary &&
      typeof parsedJobSummary.optimizedSheets === 'number' &&
      parsedJobSummary.optimizedSheets > 0
    ) {
      return parsedJobSummary.optimizedSheets;
    }

    if (
      parsedJobSummary &&
      typeof parsedJobSummary.totalPanels === 'number' &&
      parsedJobSummary.totalPanels > 0
    ) {
      return parsedJobSummary.totalPanels;
    }
  }

  return null;
}

export interface PreloadedMoRecord {
  id: number;
  name: string;
  product_id: [number, string] | false;
  product_qty: number;
  qty_producing: number;
  qty_produced: number;
  state: string;
  origin: string | null;
  company_id: [number, string] | false;
}

export interface PreloadedMoRawMove {
  id: number;
  raw_material_production_id?: [number, string] | number | false;
  product_id: [number, string] | false;
  product_uom_qty: number;
  state: string;
}

export interface PreloadedMoWorkorder {
  id: number;
  production_id?: [number, string] | number | false;
  name: string;
  qty_production: number;
  qty_producing: number;
  state: string;
}

export interface PreloadedBoardPoLine {
  id: number;
  product_id: [number, string] | false;
  product_qty: number;
}

export interface PreloadedSoLine {
  id: number;
  name: string;
  product_id: [number, string] | false;
  product_uom_qty: number;
  display_type: string | false;
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
    preloadedMo?: PreloadedMoRecord;
    preloadedRawMoves?: PreloadedMoRawMove[];
    preloadedWorkorders?: PreloadedMoWorkorder[];
    preloadedPoLines?: PreloadedBoardPoLine[];
    preloadedSoLines?: PreloadedSoLine[];
  },
): Promise<WorkOrderReconciliationResult | null> {
  let mo = options?.preloadedMo;
  if (!mo) {
    const mos = await client.searchReadRecords<PreloadedMoRecord>('mrp.production', {
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
    mo = mos[0];
  }

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

  // Load raw material components for this MO (reusing bulk-fetched moves when available)
  const rawMoves =
    options?.preloadedRawMoves ??
    (await client.searchReadRecords<PreloadedMoRawMove>('stock.move', {
      domain: [['raw_material_production_id', '=', mo.id]],
      fields: ['id', 'product_id', 'product_uom_qty', 'state'],
      limit: 100,
    }));

  const componentNames = rawMoves.map((m) => relationLabel(m.product_id));
  const hasBoardComponent = componentNames.some((c) => isBoardProductName(c));

  // Load open work orders for this MO (reusing bulk-fetched work orders when available)
  const workorders =
    options?.preloadedWorkorders ??
    (await client.searchReadRecords<PreloadedMoWorkorder>('mrp.workorder', {
      domain: [
        ['production_id', '=', mo.id],
        ['state', 'not in', ['done', 'cancel']],
      ],
      fields: ['id', 'name', 'qty_production', 'qty_producing', 'state'],
      limit: 50,
    }));

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

  // Obtain Job Summary (comparing & combining multiple Job Summary PDFs if >1 are attached)
  let parsed: ParsedJobSummaryResult | null = options?.parsedJobSummary || null;

  if (!parsed && soId) {
    try {
      const combinedResult = await resolveCombinedJobSummaryFromOdooAttachments(
        client,
        soId,
        DEFAULT_PARSER_CONFIG as any,
      );
      if (combinedResult?.combined) {
        parsed = combinedResult.combined;
      }
    } catch {
      // Fall back to local extraction history below
    }
  }

  if (!parsed && soId) {
    const latestExtracted = await getLatestExtractedResultByOrderId(soId);
    if (latestExtracted?.resultJson) {
      parsed = latestExtracted.resultJson as ParsedJobSummaryResult;
    }
  }

  // Find matching sheet material from Job Summary first so PO and SO line checks can filter by material
  const matchResult = findMatchingSheetMaterial({
    moProductName,
    componentNames,
    sheetMaterials: parsed?.sheetMaterials || [],
    currentMoQty: mo.product_qty,
    excludedMaterialNames: options?.excludedMaterialNames,
  });

  // Check if there is an approved Purchase Order linked to this SO/MO for THIS board material
  let approvedPoQty: number | null = null;
  try {
    let poLines: PreloadedBoardPoLine[] = [];
    if (options?.preloadedPoLines) {
      poLines = options.preloadedPoLines;
    } else {
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
          poLines = await client.searchReadRecords<PreloadedBoardPoLine>('purchase.order.line', {
            domain: [['order_id', 'in', poIds]],
            fields: ['id', 'product_id', 'product_qty'],
            limit: 100,
          });
        }
      }
    }

    if (poLines.length > 0) {
      // Sum only PO lines that match THIS MO's specific board material
      const matchingPoLines = poLines.filter((l) => {
        const prodName = relationLabel(l.product_id);
        return (
          isBoardProductName(prodName) &&
          doesLineMatchMoBoardMaterial({
            lineProductName: prodName,
            moProductName,
            componentNames,
            matchedMaterial: matchResult?.material,
          })
        );
      });

      if (matchingPoLines.length > 0) {
        approvedPoQty = matchingPoLines.reduce(
          (sum, l) => sum + (Number(l.product_qty) || 0),
          0,
        );
      }
    }
  } catch {
    // Non-blocking PO check
  }

  // Check if Sales Order has board/cutting lines for THIS specific material (offcut rule support)
  let soBoardQty: number | null = null;
  if (soId) {
    try {
      const soLines =
        options?.preloadedSoLines ??
        (await client.searchReadRecords<PreloadedSoLine>('sale.order.line', {
          domain: [['order_id', '=', soId]],
          fields: ['id', 'name', 'product_id', 'product_uom_qty', 'display_type'],
          limit: 100,
        }));

      const productSoLines = soLines.filter((l) => !l.display_type);
      const specificLines = productSoLines.filter((l) => {
        const prodName = relationLabel(l.product_id) || l.name || '';
        return doesLineMatchMoBoardMaterial({
          lineProductName: prodName,
          moProductName,
          componentNames,
          matchedMaterial: matchResult?.material,
        });
      });

      if (specificLines.length > 0) {
        soBoardQty = specificLines.reduce((sum, l) => sum + (Number(l.product_uom_qty) || 0), 0);
      }
    } catch {
      // Non-blocking SO line lookup
    }
  }

  const targetQty = determineTargetCuttingQuantity({
    matchedMaterial: matchResult?.material,
    parsedJobSummary: parsed,
    approvedPoQuantity: approvedPoQty,
    soBoardQuantity: soBoardQty,
  });

  if (!targetQty || targetQty <= 0) {
    // If no Job Summary or PO determined a target, but user manually set mo.product_qty in Odoo:
    // Align open cutting work orders and 1:1 board component moves to match mo.product_qty
    if (mo.product_qty && mo.product_qty > 0) {
      let workordersUpdated = 0;
      for (const wo of workorders) {
        if (Math.abs(Number(wo.qty_production || 0) - mo.product_qty) > 0.001) {
          const woVals: Record<string, unknown> = { qty_production: mo.product_qty };
          if (Number(wo.qty_producing || 0) > mo.product_qty) {
            woVals.qty_producing = mo.product_qty;
          }
          try {
            await client.writeRecord('mrp.workorder', [wo.id], woVals);
            workordersUpdated++;
          } catch {
            // Non-critical
          }
        }
      }

      let componentsUpdated = 0;
      for (const move of rawMoves) {
        const prodName = relationLabel(move.product_id);
        if (isBoardProductName(prodName) && Math.abs((move.product_uom_qty || 0) - mo.product_qty) > 0.001) {
          try {
            await client.writeRecord('stock.move', [move.id], { product_uom_qty: mo.product_qty });
            componentsUpdated++;
          } catch {
            // Non-critical
          }
        }
      }

      // Reconcile local shop_floor_pending_processes for this MO so board intake requirements reflect the new target
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
          if (isBoardProductName(prodName)) {
            const newQtyNeeded = mo.product_qty;
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

        invalidatePendingShopFloorProcessesCache();
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        await deleteShopFloorSharedCachePrefix('shop-floor:').catch(() => null);
      } catch {
        // Non-critical local update
      }

      if (workordersUpdated > 0 || componentsUpdated > 0) {
        await client.callRecordMethod('mrp.production', 'action_assign', [mo.id]).catch(() => null);
      }
    }

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

    // Trigger full background sync to ensure clean state (defer during active scheduler batch to avoid Odoo queue contention)
    if (!isSchedulerRunActive()) {
      void syncPendingProcessesFromOdoo(true).catch(() => null);
    }
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

  await client.postModelChatterMessage('mrp.production', mo.id, moChatterHtml, undefined, {
    skipSoSync: Boolean(soId),
    checkExisting: true,
    dedupeSnippet: `adjusted from ${currentQty} to ${targetQty}`,
  }).catch(() => null);

  // 6. Cross-alert note on Sales Order chatter
  if (soId) {
    const soChatterHtml =
      `<p>✂️ <strong>Work Order Cutting Quantity Adjusted:</strong> MO <strong>${mo.name}</strong> (${moProductName}) work order quantity modified from <strong>${currentQty}</strong> to <strong>${targetQty}</strong> to match Job Summary requirements.</p>`;
    await client.postModelChatterMessage('sale.order', soId, soChatterHtml, undefined, {
      skipSoSync: true,
      checkExisting: true,
      dedupeSnippet: `MO ${mo.name} (${moProductName}) work order quantity modified from ${currentQty} to ${targetQty}`,
    }).catch(() => null);
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
    soName?: string;
    preloadedPoLines?: PreloadedBoardPoLine[];
    preloadedSoLines?: PreloadedSoLine[];
  },
): Promise<WorkOrderReconciliationResult[]> {
  let so: { id: number; name: string } | undefined = options?.soName
    ? { id: saleOrderId, name: options.soName }
    : undefined;
  if (!so) {
    const saleOrders = await client.readRecords<{ id: number; name: string }>(
      'sale.order',
      [saleOrderId],
      ['id', 'name'],
    );
    so = saleOrders[0];
  }

  if (!so) return [];

  let resolvedJobSummary: ParsedJobSummaryResult | undefined = options?.parsedJobSummary;
  if (!resolvedJobSummary) {
    try {
      const combinedResult = await resolveCombinedJobSummaryFromOdooAttachments(
        client,
        so.id,
        DEFAULT_PARSER_CONFIG as any,
      );
      if (combinedResult?.combined) {
        resolvedJobSummary = combinedResult.combined;
      }
    } catch {
      // Fall back inside reconcileWorkOrderQuantitiesForMo
    }
  }

  // Search active MOs linked to this Sales Order with all needed fields in 1 RPC
  const candidateMos = await client.searchReadRecords<PreloadedMoRecord>(
    'mrp.production',
    {
      domain: [
        ['origin', 'ilike', so.name],
        ['state', 'not in', ['done', 'cancel']],
      ],
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
      limit: 20,
    },
  );

  if (candidateMos.length === 0) {
    return [];
  }

  // Bulk-fetch raw material moves and open work orders for all candidate MOs in 2 RPCs (instead of 2*N)
  const moIds = candidateMos.map((m) => m.id);
  const allRawMoves = await client
    .searchReadRecords<PreloadedMoRawMove>('stock.move', {
      domain: [['raw_material_production_id', 'in', moIds]],
      fields: ['id', 'raw_material_production_id', 'product_id', 'product_uom_qty', 'state'],
      limit: Math.max(200, moIds.length * 50),
    })
    .catch(() => [] as PreloadedMoRawMove[]);
  const allWorkorders = await client
    .searchReadRecords<PreloadedMoWorkorder>('mrp.workorder', {
      domain: [
        ['production_id', 'in', moIds],
        ['state', 'not in', ['done', 'cancel']],
      ],
      fields: ['id', 'production_id', 'name', 'qty_production', 'qty_producing', 'state'],
      limit: Math.max(100, moIds.length * 20),
    })
    .catch(() => [] as PreloadedMoWorkorder[]);

  const rawMovesByMoId = new Map<number, PreloadedMoRawMove[]>();
  for (const move of allRawMoves) {
    const rmId = Array.isArray(move.raw_material_production_id)
      ? Number(move.raw_material_production_id[0])
      : Number(move.raw_material_production_id || 0);
    if (!rmId) continue;
    const list = rawMovesByMoId.get(rmId) || [];
    list.push(move);
    rawMovesByMoId.set(rmId, list);
  }

  const workordersByMoId = new Map<number, PreloadedMoWorkorder[]>();
  for (const wo of allWorkorders) {
    const prodId = Array.isArray(wo.production_id)
      ? Number(wo.production_id[0])
      : Number(wo.production_id || 0);
    if (!prodId) continue;
    const list = workordersByMoId.get(prodId) || [];
    list.push(wo);
    workordersByMoId.set(prodId, list);
  }

  const hasAnyCuttingMo = candidateMos.some((mo) => {
    const productName = relationLabel(mo.product_id);
    const moves = rawMovesByMoId.get(mo.id) || [];
    const wos = workordersByMoId.get(mo.id) || [];
    return (
      isCuttingProductOrWorkOrder(productName) ||
      wos.some((wo) => isCuttingProductOrWorkOrder(undefined, wo.name)) ||
      moves.some((m) => isBoardProductName(relationLabel(m.product_id)))
    );
  });

  // Pre-fetch SO lines and linked PO lines ONCE for the whole Sales Order if any cutting MO exists
  let sharedSoLines = options?.preloadedSoLines;
  let sharedPoLines = options?.preloadedPoLines;
  if (hasAnyCuttingMo) {
    if (!sharedSoLines) {
      sharedSoLines = await client
        .searchReadRecords<PreloadedSoLine>('sale.order.line', {
          domain: [['order_id', '=', so.id]],
          fields: ['id', 'name', 'product_id', 'product_uom_qty', 'display_type'],
          limit: 100,
        })
        .catch(() => []);
    }
    if (!sharedPoLines) {
      try {
        const pos = await client.searchReadRecords<{ id: number; name: string; state: string }>(
          'purchase.order',
          {
            domain: [
              ['origin', 'ilike', so.name],
              ['state', 'in', ['purchase', 'done']],
            ],
            fields: ['id', 'name', 'state'],
            limit: 5,
          },
        );
        if (pos.length > 0) {
          sharedPoLines = await client.searchReadRecords<PreloadedBoardPoLine>('purchase.order.line', {
            domain: [['order_id', 'in', pos.map((p) => p.id)]],
            fields: ['id', 'product_id', 'product_qty'],
            limit: 100,
          });
        } else {
          sharedPoLines = [];
        }
      } catch {
        sharedPoLines = [];
      }
    }
  }

  const results: WorkOrderReconciliationResult[] = [];
  const claimedMaterialNames: string[] = [];
  for (const candidate of candidateMos) {
    try {
      const res = await reconcileWorkOrderQuantitiesForMo(client, candidate.id, {
        parsedJobSummary: resolvedJobSummary,
        soId: so.id,
        soName: so.name,
        actorName: options?.actorName,
        excludedMaterialNames: claimedMaterialNames,
        preloadedMo: candidate,
        preloadedRawMoves: rawMovesByMoId.get(candidate.id) || [],
        preloadedWorkorders: workordersByMoId.get(candidate.id) || [],
        preloadedPoLines: sharedPoLines,
        preloadedSoLines: sharedSoLines,
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
