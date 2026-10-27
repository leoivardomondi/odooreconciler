import { ParsedJobSummaryResult, SaleOrderLine, SalesOrderDetails } from '../models/types';
import {
  isBoardProductName,
  isRawBoardProductName,
  isCuttingServiceProductName,
  isStockExemptEdgeBandingService,
  assignBoardLinesToSheetMaterials,
  normalizeBoardProductName,
} from './boardProductClassifier';
import { logEvent } from './logService';
import { createTodoActivity, findOpenActivities } from './odooActivityService';
import { OdooClient } from './odooClient';
import { normalizeColor } from './stockProcessingService';

export const QUOTATION_DISCREPANCY_ACTIVITY_SUMMARY = 'JOB SUMMARY QUOTATION DISCREPANCY';
export const QUOTATION_BOARD_SELECTION_ACTIVITY_SUMMARY = 'SELECT BOARD PRODUCT FROM JOB SUMMARY';

export interface QuotationComparisonResult {
  hasShortfall: boolean;
  shortfalls: string[];
  boardDetails: Array<{
    sheetMaterial: string;
    requiredSheets: number;
    quotedSheets: number;
    isSufficient: boolean;
  }>;
  panelsDetail: {
    requiredPanels: number;
    quotedPanels: number;
    isSufficient: boolean;
  };
  edgingDetails: Array<{
    color: string;
    requiredMeters: number;
    quotedMeters: number;
    isSufficient: boolean;
  }>;
}

export interface QuotationSyncResult {
  orderId: number;
  orderName: string;
  orderState: string;
  isTemplateOnly: boolean;
  actionTaken: 'created_lines' | 'compared_sufficient' | 'compared_shortfall_alert' | 'skipped_confirmed_order';
  createdLinesCount: number;
  updatedLinesCount: number;
  shortfalls: string[];
  summary: string;
}

function relationLabel(value: [number, string] | false | null | undefined): string {
  return Array.isArray(value) ? String(value[1]) : '';
}

function relationId(value: [number, string] | false | null | undefined): number | null {
  return Array.isArray(value) ? Number(value[0]) : null;
}

export function lineDisplayName(line: SaleOrderLine): string {
  return relationLabel(line.product_id) || line.name || '';
}

/**
 * Checks if a quotation only has default template placeholder items
 * (e.g., "Example Board 18mm", "Optimised Panels", section headers).
 */
export function isTemplateOnlyQuotation(lines: SaleOrderLine[]): boolean {
  const productLines = lines.filter((line) => !line.display_type);
  if (productLines.length === 0) {
    return true;
  }

  for (const line of productLines) {
    const name = lineDisplayName(line).toLowerCase().trim();

    const isExampleBoard = /example\s+board/i.test(name);
    const isOptimisedPanels = /optimis?ed\s+panels?/i.test(name);

    if (!isExampleBoard && !isOptimisedPanels) {
      // Found a real product line (e.g. customized board, edge banding service, hardware, etc.)
      return false;
    }
  }

  return true;
}

/**
 * Compares quotation lines with the Job Summary to verify quantities are
 * correct, not less, but can be more (e.g., sheets/panels/edging).
 */
export function compareQuotationLinesWithJobSummary(
  lines: SaleOrderLine[],
  parsed: ParsedJobSummaryResult,
): QuotationComparisonResult {
  const shortfalls: string[] = [];
  const productLines = lines.filter((line) => !line.display_type);

  // 1. Compare Board Sheets
  const sheetMaterials = parsed.sheetMaterials || [];
  const boardDetails: QuotationComparisonResult['boardDetails'] = [];

  const assignedBoardLines = assignBoardLinesToSheetMaterials(
    productLines,
    sheetMaterials,
    lineDisplayName,
  );

  for (const material of sheetMaterials) {
    const requiredSheets = material.sheets || 0;
    const matchingBoardLines = assignedBoardLines.get(material) || [];

    const quotedSheets = matchingBoardLines.reduce(
      (sum, l) => sum + (Number(l.product_uom_qty) || 0),
      0,
    );

    // Rule: "Not less, but can be more" — only mention quantity if it's lower than Job Summary
    const isSufficient = quotedSheets >= requiredSheets;
    if (quotedSheets < requiredSheets) {
      if (quotedSheets === 0) {
        const existingBoards = productLines
          .map(lineDisplayName)
          .filter((name) => isBoardProductName(name) && !/example\s+board/i.test(name) && !/optimis?ed\s+panels?/i.test(name));
        const hint = existingBoards.length > 0 ? ` (Quotation has '${existingBoards.join("', '")}')` : '';
        shortfalls.push(
          `Board Mismatch / Missing Board: Job Summary requires '${material.name}${material.thickness_mm ? ` ${material.thickness_mm}mm` : ''}' (${requiredSheets} sheet(s)), but this board was not found on the quotation${hint}.`,
        );
      } else {
        shortfalls.push(
          `Board Shortfall (${material.name} ${material.thickness_mm ? `${material.thickness_mm}mm` : ''}): Quotation has ${quotedSheets} sheet(s), but Job Summary requires ${requiredSheets} sheet(s) (Shortfall: ${Math.round((requiredSheets - quotedSheets) * 100) / 100} sheet(s)).`,
        );
      }
    }

    boardDetails.push({
      sheetMaterial: material.name,
      requiredSheets,
      quotedSheets,
      isSufficient,
    });
  }

  // 2. Compare Optimised Panels
  const requiredPanels = Number(parsed.optimizedSheets ?? parsed.totalPanels ?? 0);
  const panelsLine = productLines.find((line) =>
    /optimis?ed\s+panels?/i.test(lineDisplayName(line)),
  );
  const quotedPanels = panelsLine ? Number(panelsLine.product_uom_qty) || 0 : 0;
  const panelsSufficient = quotedPanels >= requiredPanels;

  if (!panelsSufficient && requiredPanels > 0) {
    shortfalls.push(
      `Optimised Panels: Quotation has ${quotedPanels} piece(s), but Job Summary requires ${requiredPanels} sheet(s).`,
    );
  }

  // 3. Compare Edging Meters
  const edgingDetails: QuotationComparisonResult['edgingDetails'] = [];
  for (const item of parsed.items || []) {
    const requiredMeters = Math.round((item.length_mm || 0) / 1000);
    const normalizedItemColor = normalizeColor(item.color);

    const matchingEdgingLines = productLines.filter((line) => {
      const name = lineDisplayName(line).toLowerCase();
      if (!name.includes('edge band') && !name.includes('edging band')) return false;
      const normalizedLineName = normalizeColor(name);
      return normalizedLineName.includes(normalizedItemColor);
    });

    const quotedMeters = matchingEdgingLines.reduce(
      (sum, l) => sum + (Number(l.product_uom_qty) || 0),
      0,
    );

    const isSufficient = quotedMeters >= requiredMeters;
    if (!isSufficient) {
      shortfalls.push(
        `Edge Banding Service (${item.color}): Quotation has ${quotedMeters} m, but Job Summary requires ${requiredMeters} m.`,
      );
    }

    edgingDetails.push({
      color: item.color,
      requiredMeters,
      quotedMeters,
      isSufficient,
    });
  }

  return {
    hasShortfall: shortfalls.length > 0,
    shortfalls,
    boardDetails,
    panelsDetail: {
      requiredPanels,
      quotedPanels,
      isSufficient: panelsSufficient,
    },
    edgingDetails,
  };
}

function resolveSalespersonUserId(order: SalesOrderDetails): number | null {
  return relationId(order.user_id) || relationId(order.create_uid);
}

/**
 * Main synchronizer:
 * 1. If quotation is newly created with template items only:
 *    - Replaces Example Board with parsed board product
 *    - Updates Optimised Panels quantity to Optimized Sheets
 *    - Creates Edge Banding Service line(s)
 * 2. If quotation has custom/existing lines:
 *    - Compares quantities (not less, but can be more)
 *    - If shortfalls exist, creates a To-Do activity for the salesperson
 */
export async function syncQuotationWithJobSummary(
  client: OdooClient,
  orderId: number,
  parsed: ParsedJobSummaryResult,
): Promise<QuotationSyncResult> {
  const order = await client.getSaleOrder(orderId);
  const orderState = String(order.state || '').toLowerCase();

  // Quotation synchronization strictly applies to draft/sent orders
  if (!['draft', 'sent'].includes(orderState)) {
    return {
      orderId,
      orderName: order.name,
      orderState,
      isTemplateOnly: false,
      actionTaken: 'skipped_confirmed_order',
      createdLinesCount: 0,
      updatedLinesCount: 0,
      shortfalls: [],
      summary: `Quotation is in '${orderState}' state. Skipped quotation line sync.`,
    };
  }

  const lines = await client.getSaleOrderLines(orderId);
  const isTemplate = isTemplateOnlyQuotation(lines);

  if (isTemplate) {
    let updatedLinesCount = 0;
    let createdLinesCount = 0;
    const unmatchedItems: Array<{ type: string; name: string; reason: string }> = [];

    // 1. Identify or Create Sections
    let boardsSection = lines.find((l) => l.display_type === 'line_section' && /boards?/i.test(l.name || ''));
    let servicesSection = lines.find((l) => l.display_type === 'line_section' && /(cutting|edging|grooving)/i.test(l.name || ''));

    if (!boardsSection) {
      await client.createRecord('sale.order.line', {
        order_id: orderId,
        display_type: 'line_section',
        name: 'BOARDS',
        sequence: 10,
      });
      createdLinesCount++;
    }

    if (!servicesSection) {
      await client.createRecord('sale.order.line', {
        order_id: orderId,
        display_type: 'line_section',
        name: 'CUTTING+EDGING+GROOVING',
        sequence: 20,
      });
      createdLinesCount++;
    }

    let boardSequence = 11;
    let serviceSequence = 21;

    const exampleBoardLine = lines.find((l) =>
      !l.display_type && /example\s+board/i.test(lineDisplayName(l)),
    );
    const optimisedPanelsLine = lines.find((l) =>
      !l.display_type && /optimis?ed\s+panels?/i.test(lineDisplayName(l)),
    );

    // Fetch candidate products in bulk (lightning-fast single RPC call)
    const candidateProducts = await client.searchReadRecords<{ id: number; name: string; display_name?: string }>(
      'product.product',
      {
        domain: [
          ['sale_ok', '=', true],
        ],
        fields: ['id', 'name', 'display_name'],
        limit: 500,
      },
    );

    const sheetMaterials = parsed.sheetMaterials || [];
    let exampleBoardUsed = false;

    // Helper to find raw board product in candidateProducts
    function findRawBoard(matName: string, thicknessMm?: number | null) {
      const cleanName = matName.replace(/^cutting\s+/i, '').trim();
      const normClean = normalizeBoardProductName(cleanName);
      const matWords = normClean.split(/[\s_\-/]+/).filter((w) => w.length > 2 && !['board', 'boards', 'sheet', 'sheets'].includes(w));

      return candidateProducts.find((p) => {
        const prodName = (p.display_name || p.name || '');
        if (!isRawBoardProductName(prodName)) return false;
        const normProd = normalizeBoardProductName(prodName);

        if (thicknessMm) {
          const tStr = `${thicknessMm}mm`;
          const tSpaced = `${thicknessMm} mm`;
          if (!normProd.includes(tStr) && !normProd.includes(tSpaced)) return false;
        }

        return matWords.length > 0 && matWords.every((w) => normProd.includes(w));
      });
    }

    // Helper to find cutting service product in candidateProducts
    function findCuttingService(matName: string, thicknessMm?: number | null) {
      const cleanName = matName.replace(/^cutting\s+/i, '').trim();
      const normClean = normalizeBoardProductName(cleanName);
      const matWords = normClean.split(/[\s_\-/]+/).filter((w) => w.length > 2 && !['board', 'boards', 'sheet', 'sheets', 'cutting'].includes(w));

      return candidateProducts.find((p) => {
        const prodName = (p.display_name || p.name || '');
        if (!isCuttingServiceProductName(prodName)) return false;
        const normProd = normalizeBoardProductName(prodName);

        if (thicknessMm) {
          const tStr = `${thicknessMm}mm`;
          const tSpaced = `${thicknessMm} mm`;
          if (!normProd.includes(tStr) && !normProd.includes(tSpaced)) return false;
        }

        return matWords.length > 0 && matWords.every((w) => normProd.includes(w));
      });
    }

    // Helper to find edge banding service product in candidateProducts
    function findEdgeBandingService(color: string) {
      const colorNorm = normalizeColor(color);
      return candidateProducts.find((p) => {
        const prodName = (p.display_name || p.name || '');
        if (!isStockExemptEdgeBandingService(prodName)) return false;
        const normProd = normalizeColor(prodName);
        return normProd.includes(colorNorm);
      });
    }

    // A. Populate Boards under BOARDS section
    for (const material of sheetMaterials) {
      const sheets = material.sheets || 1;
      const rawBoard = findRawBoard(material.name, material.thickness_mm);

      if (rawBoard) {
        if (exampleBoardLine && !exampleBoardUsed) {
          await client.writeRecord('sale.order.line', [exampleBoardLine.id], {
            product_id: rawBoard.id,
            name: rawBoard.display_name || rawBoard.name,
            product_uom_qty: sheets,
            sequence: boardSequence++,
          });
          exampleBoardUsed = true;
          updatedLinesCount++;
        } else {
          await client.createRecord('sale.order.line', {
            order_id: orderId,
            product_id: rawBoard.id,
            name: rawBoard.display_name || rawBoard.name,
            product_uom_qty: sheets,
            sequence: boardSequence++,
          });
          createdLinesCount++;
        }
      } else {
        const boardDesc = `${material.name}${material.thickness_mm ? ` ${material.thickness_mm}mm` : ''}`;
        unmatchedItems.push({
          type: 'Board',
          name: `${boardDesc} (${sheets} sheet(s))`,
          reason: 'No matching physical board product found in Odoo catalog',
        });
      }
    }

    // B. Populate Services under CUTTING+EDGING+GROOVING section
    // 1. Optimised Panels
    const totalPanels = Number(parsed.optimizedSheets ?? parsed.totalPanels ?? 0);
    if (optimisedPanelsLine && totalPanels > 0) {
      await client.writeRecord('sale.order.line', [optimisedPanelsLine.id], {
        product_uom_qty: totalPanels,
        sequence: serviceSequence++,
      });
      updatedLinesCount++;
    } else if (totalPanels > 0) {
      const panelsProduct = candidateProducts.find((p) => /optimis?ed\s+panels?/i.test(p.display_name || p.name));
      if (panelsProduct) {
        await client.createRecord('sale.order.line', {
          order_id: orderId,
          product_id: panelsProduct.id,
          name: panelsProduct.display_name || panelsProduct.name,
          product_uom_qty: totalPanels,
          sequence: serviceSequence++,
        });
        createdLinesCount++;
      }
    }

    // 2. Cutting Services (for each sheet material)
    for (const material of sheetMaterials) {
      const sheets = material.sheets || 1;
      const cuttingProduct = findCuttingService(material.name, material.thickness_mm);

      if (cuttingProduct) {
        await client.createRecord('sale.order.line', {
          order_id: orderId,
          product_id: cuttingProduct.id,
          name: cuttingProduct.display_name || cuttingProduct.name,
          product_uom_qty: sheets,
          sequence: serviceSequence++,
        });
        createdLinesCount++;
      } else {
        const cuttingDesc = `Cutting ${material.name.replace(/^cutting\s+/i, '')}${material.thickness_mm ? ` ${material.thickness_mm}mm` : ''}`;
        unmatchedItems.push({
          type: 'Cutting Service',
          name: `${cuttingDesc} (${sheets} sheet(s))`,
          reason: 'No matching cutting service product found in Odoo catalog',
        });
      }
    }

    // 3. Edge Banding Services (for each edging item)
    for (const item of parsed.items || []) {
      const meters = Math.round((item.length_mm || 0) / 1000);
      const edgeService = findEdgeBandingService(item.color);

      if (edgeService) {
        await client.createRecord('sale.order.line', {
          order_id: orderId,
          product_id: edgeService.id,
          name: edgeService.display_name || edgeService.name,
          product_uom_qty: meters,
          sequence: serviceSequence++,
        });
        createdLinesCount++;
      } else {
        unmatchedItems.push({
          type: 'Edge Banding Service',
          name: `Edge Banding Service ${item.color} (${meters}m)`,
          reason: `No matching edge banding service product found in Odoo catalog for color '${item.color}'`,
        });
      }
    }

    // C. Post Chatter Note and Assign Activity if Any Items Unmatched
    if (unmatchedItems.length > 0) {
      const itemRows = unmatchedItems
        .map((u) => `<li><strong>${u.type}:</strong> ${u.name} — <em>${u.reason}</em></li>`)
        .join('');
      await client.postModelChatterMessage(
        'sale.order',
        orderId,
        `<p><strong>Job Summary Line Population Notice:</strong></p><p>The following item(s) from the Job Summary could not be created because no matching product exists in Odoo:</p><ul>${itemRows}</ul><p><em>Please create the missing products or add them manually to the quotation.</em></p>`,
      );

      const userId = resolveSalespersonUserId(order);
      if (userId) {
        await createTodoActivity(client, {
          modelName: 'sale.order',
          recordId: orderId,
          userId,
          summary: 'UNMATCHED PRODUCTS FROM JOB SUMMARY',
          noteLines: [
            `Quotation: ${order.name}`,
            `The following item(s) from the Job Summary could not be created because no matching product exists in Odoo:`,
            ...unmatchedItems.map((u) => `• [${u.type}] ${u.name}: ${u.reason}`),
            `Please create the missing products or select them manually.`,
          ],
        });
      }
    }

    await logEvent('info', 'Quotation template lines updated from Job Summary', {
      orderId,
      orderName: order.name,
      updatedLinesCount,
      createdLinesCount,
      unmatchedItems,
    });

    return {
      orderId,
      orderName: order.name,
      orderState,
      isTemplateOnly: true,
      actionTaken: 'created_lines',
      createdLinesCount,
      updatedLinesCount,
      shortfalls: [],
      summary: `Populated quotation lines: ${updatedLinesCount} updated, ${createdLinesCount} created under BOARDS and CUTTING+EDGING+GROOVING sections.`,
    };
  }

  // Case B: Quotation already has custom/filled order lines -> Compare quantities
  const comparison = compareQuotationLinesWithJobSummary(lines, parsed);

  if (comparison.hasShortfall) {
    const userId = resolveSalespersonUserId(order);

    if (userId) {
      const existingActivities = await findOpenActivities(client, {
        modelName: 'sale.order',
        recordId: orderId,
        summary: QUOTATION_DISCREPANCY_ACTIVITY_SUMMARY,
      });

      if (existingActivities.length === 0) {
        await createTodoActivity(client, {
          modelName: 'sale.order',
          recordId: orderId,
          userId,
          summary: QUOTATION_DISCREPANCY_ACTIVITY_SUMMARY,
          noteLines: [
            `Quotation: ${order.name}`,
            `The following line shortfalls were found compared to the attached Job Summary:`,
            ...comparison.shortfalls.map((s) => `• ${s}`),
            `Note: Quotation quantities must be equal to or greater than the Job Summary.`,
          ],
        });
      }
    }

    await client.postModelChatterMessage(
      'sale.order',
      orderId,
      `<p><strong>Job Summary Verification Alert:</strong></p><ul>${comparison.shortfalls
        .map((s) => `<li>${s}</li>`)
        .join('')}</ul><p><em>Quotation lines were NOT modified because they were already customized.</em></p>`,
    );

    await logEvent('warn', 'Quotation lines shortfall compared to Job Summary', {
      orderId,
      orderName: order.name,
      shortfalls: comparison.shortfalls,
    });

    return {
      orderId,
      orderName: order.name,
      orderState,
      isTemplateOnly: false,
      actionTaken: 'compared_shortfall_alert',
      createdLinesCount: 0,
      updatedLinesCount: 0,
      shortfalls: comparison.shortfalls,
      summary: `Discrepancy detected: ${comparison.shortfalls.length} shortfall(s) flagged to salesperson.`,
    };
  }

  // All lines exist and quantities are sufficient (equal or more)
  await logEvent('info', 'Quotation lines verified against Job Summary (quantities sufficient)', {
    orderId,
    orderName: order.name,
  });

  return {
    orderId,
    orderName: order.name,
    orderState,
    isTemplateOnly: false,
    actionTaken: 'compared_sufficient',
    createdLinesCount: 0,
    updatedLinesCount: 0,
    shortfalls: [],
    summary: 'Quotation lines verified: all quantities are correct and sufficient.',
  };
}
