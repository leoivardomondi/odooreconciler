"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCuttingProductOrWorkOrder = isCuttingProductOrWorkOrder;
exports.extractThicknessMm = extractThicknessMm;
exports.findMatchingSheetMaterial = findMatchingSheetMaterial;
exports.determineTargetCuttingQuantity = determineTargetCuttingQuantity;
exports.reconcileWorkOrderQuantitiesForMo = reconcileWorkOrderQuantitiesForMo;
exports.reconcileWorkOrderQuantitiesForSaleOrder = reconcileWorkOrderQuantitiesForSaleOrder;
exports.reconcileWorkOrderQuantitiesForPurchaseOrder = reconcileWorkOrderQuantitiesForPurchaseOrder;
const repositories_1 = require("../models/repositories");
const boardProductClassifier_1 = require("./boardProductClassifier");
const logService_1 = require("./logService");
const pdfParser_1 = require("./pdfParser");
const helpers_1 = require("../utils/helpers");
function relationLabel(value) {
    return Array.isArray(value) ? String(value[1]) : '';
}
function relationId(value) {
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
function isCuttingProductOrWorkOrder(productName, workOrderName) {
    const p = String(productName || '').toLowerCase().trim();
    const w = String(workOrderName || '').toLowerCase().trim();
    if (/^cutting\b/i.test(p) || /\bcutting\b/i.test(p) || /^cut\b/i.test(p)) {
        return true;
    }
    if (w &&
        (/cutting/i.test(w) ||
            /table\s*saw/i.test(w) ||
            /panel\s*saw/i.test(w) ||
            /sawing/i.test(w))) {
        return true;
    }
    return false;
}
/**
 * Extracts board thickness in mm from a product or material string (e.g. "18mm", "18 mm", "16mm").
 */
function extractThicknessMm(text) {
    const str = String(text || '');
    const m = str.match(/\b(\d+(?:\.\d+)?)\s*mm\b/i);
    if (m) {
        return parseFloat(m[1]);
    }
    return null;
}
/**
 * Matches a Manufacturing Order's product or component boards against
 * the sheet materials parsed from the Job Summary PDF.
 */
function findMatchingSheetMaterial(input) {
    const sheetMaterials = input.sheetMaterials || [];
    if (sheetMaterials.length === 0)
        return null;
    // Single sheet material in Job Summary directly maps to the cutting MO
    if (sheetMaterials.length === 1) {
        return {
            material: sheetMaterials[0],
            matchScore: 100,
            reason: 'Single sheet material in Job Summary',
        };
    }
    const moProductName = String(input.moProductName || '').toLowerCase();
    const moThickness = extractThicknessMm(moProductName);
    const componentNames = (input.componentNames || []).map((c) => c.toLowerCase());
    let bestMatch = null;
    for (const mat of sheetMaterials) {
        let score = 0;
        const reasons = [];
        const matName = mat.name.toLowerCase();
        const matWords = matName.split(/[\s_\-/]+/).filter((w) => w.length > 2);
        // 1. Raw material component check (highest fidelity)
        for (const compName of componentNames) {
            if ((0, boardProductClassifier_1.isBoardProductName)(compName)) {
                const compThickness = extractThicknessMm(compName);
                if (mat.thickness_mm && compThickness === mat.thickness_mm) {
                    score += 40;
                    reasons.push(`Component thickness match (${mat.thickness_mm}mm)`);
                }
                const compWordsMatch = matWords.filter((w) => compName.includes(w)).length;
                if (compWordsMatch > 0) {
                    score += compWordsMatch * 20;
                    reasons.push(`Component keyword match (${compWordsMatch} words)`);
                }
            }
        }
        // 2. MO product name check
        if (mat.thickness_mm && moThickness === mat.thickness_mm) {
            score += 30;
            reasons.push(`MO product thickness match (${mat.thickness_mm}mm)`);
        }
        else if (mat.thickness_mm && moThickness && mat.thickness_mm !== moThickness) {
            score -= 50; // Thickness conflict
        }
        const moWordsMatch = matWords.filter((w) => moProductName.includes(w)).length;
        if (moWordsMatch > 0) {
            score += moWordsMatch * 15;
            reasons.push(`MO product keyword match (${moWordsMatch} words)`);
        }
        // Substrate check
        const substrates = ['mdf', 'particle', 'chipboard', 'plywood', 'veneer', 'blockboard'];
        for (const sub of substrates) {
            const matHasSub = matName.includes(sub);
            const moHasSub = moProductName.includes(sub);
            if (matHasSub && moHasSub) {
                score += 25;
                reasons.push(`Substrate match (${sub})`);
            }
            else if (matHasSub && !moHasSub && substrates.some((s) => s !== sub && moProductName.includes(s))) {
                score -= 40; // Substrate mismatch
            }
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
function determineTargetCuttingQuantity(input) {
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
    if (parsedJobSummary &&
        typeof parsedJobSummary.optimizedSheets === 'number' &&
        parsedJobSummary.optimizedSheets > 0) {
        return parsedJobSummary.optimizedSheets;
    }
    // 4. Fallback to totalPanels from Job Summary
    if (parsedJobSummary &&
        typeof parsedJobSummary.totalPanels === 'number' &&
        parsedJobSummary.totalPanels > 0) {
        return parsedJobSummary.totalPanels;
    }
    return null;
}
/**
 * Reconciles cutting work order and MO quantities for a specific Manufacturing Order
 * against the Job Summary and approved PO requirements.
 */
async function reconcileWorkOrderQuantitiesForMo(client, moId, options) {
    const mos = await client.searchReadRecords('mrp.production', {
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
    if (!mo)
        return null;
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
    const rawMoves = await client.searchReadRecords('stock.move', {
        domain: [['raw_material_production_id', '=', mo.id]],
        fields: ['id', 'product_id', 'product_uom_qty', 'state'],
        limit: 100,
    });
    const componentNames = rawMoves.map((m) => relationLabel(m.product_id));
    const hasBoardComponent = componentNames.some((c) => (0, boardProductClassifier_1.isBoardProductName)(c));
    // Load open work orders for this MO
    const workorders = await client.searchReadRecords('mrp.workorder', {
        domain: [
            ['production_id', '=', mo.id],
            ['state', 'not in', ['done', 'cancel']],
        ],
        fields: ['id', 'name', 'qty_production', 'qty_producing', 'state'],
        limit: 50,
    });
    const isCutting = isCuttingProductOrWorkOrder(moProductName) ||
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
    const soNameCandidate = options?.soName || (0, helpers_1.extractSoNameFromOrigin)(originStr);
    let soId = options?.soId || null;
    let soName = soNameCandidate;
    if (!soId && soNameCandidate) {
        const saleOrders = await client.searchReadRecords('sale.order', {
            domain: [['name', '=', soNameCandidate]],
            fields: ['id', 'name'],
            limit: 1,
        });
        if (saleOrders[0]) {
            soId = saleOrders[0].id;
            soName = saleOrders[0].name;
        }
    }
    // Obtain Job Summary
    let parsed = options?.parsedJobSummary || null;
    if (!parsed && soId) {
        const latestExtracted = await (0, repositories_1.getLatestExtractedResultByOrderId)(soId);
        if (latestExtracted?.resultJson) {
            parsed = latestExtracted.resultJson;
        }
    }
    if (!parsed && soId) {
        try {
            const attachments = await client.getAttachments(soId);
            const targetAttachment = attachments.find((a) => (0, helpers_1.isJobSummaryAttachment)(a, 'job summary'));
            if (targetAttachment) {
                const downloaded = await client.downloadAttachment(targetAttachment.id);
                parsed = await (0, pdfParser_1.parseJobSummaryPdf)(downloaded.content, helpers_1.DEFAULT_PARSER_CONFIG);
            }
        }
        catch {
            // Non-blocking attachment retrieval
        }
    }
    // Check if there is an approved Purchase Order linked to this SO/MO
    let approvedPoQty = null;
    try {
        const originFilter = soName || originStr;
        if (originFilter) {
            const pos = await client.searchReadRecords('purchase.order', {
                domain: [
                    ['origin', 'ilike', originFilter],
                    ['state', 'in', ['purchase', 'done']], // Only confirmed/approved POs
                ],
                fields: ['id', 'name', 'state'],
                limit: 5,
            });
            if (pos.length > 0) {
                const poIds = pos.map((p) => p.id);
                const poLines = await client.searchReadRecords('purchase.order.line', {
                    domain: [['order_id', 'in', poIds]],
                    fields: ['id', 'product_id', 'product_qty'],
                    limit: 100,
                });
                // Sum matching board quantities from approved PO
                const matchingPoLines = poLines.filter((l) => {
                    const name = relationLabel(l.product_id).toLowerCase();
                    return (0, boardProductClassifier_1.isBoardProductName)(name);
                });
                if (matchingPoLines.length > 0) {
                    approvedPoQty = matchingPoLines.reduce((sum, l) => sum + (Number(l.product_qty) || 0), 0);
                }
            }
        }
    }
    catch {
        // Non-blocking PO check
    }
    // Find matching sheet material from Job Summary
    const matchResult = findMatchingSheetMaterial({
        moProductName,
        componentNames,
        sheetMaterials: parsed?.sheetMaterials || [],
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
    const moVals = { product_qty: targetQty };
    if (Number(mo.qty_producing || 0) > targetQty) {
        moVals.qty_producing = targetQty;
    }
    await client.writeRecord('mrp.production', [mo.id], moVals);
    // 2. Update mrp.workorder qty_production
    let workordersUpdated = 0;
    for (const wo of workorders) {
        const woVals = { qty_production: targetQty };
        if (Number(wo.qty_producing || 0) > targetQty) {
            woVals.qty_producing = targetQty;
        }
        try {
            await client.writeRecord('mrp.workorder', [wo.id], woVals);
            workordersUpdated++;
        }
        catch {
            // Some Odoo builds compute qty_production dynamically from production_id.product_qty
        }
    }
    // 3. Update stock.move component requirements
    let componentsUpdated = 0;
    for (const move of rawMoves) {
        const prodName = relationLabel(move.product_id);
        if ((0, boardProductClassifier_1.isBoardProductName)(prodName) || (matchResult && prodName.toLowerCase().includes(matchResult.material.name.toLowerCase()))) {
            if (Math.abs((move.product_uom_qty || 0) - targetQty) > 0.001) {
                await client.writeRecord('stock.move', [move.id], { product_uom_qty: targetQty });
                componentsUpdated++;
            }
        }
    }
    // 4. Re-evaluate stock reservation so 100% stock availability is assigned immediately
    await client.callRecordMethod('mrp.production', 'action_assign', [mo.id]).catch(() => null);
    const matchedMaterialDesc = matchResult?.material
        ? `${matchResult.material.name} ${matchResult.material.thickness_mm ? `${matchResult.material.thickness_mm}mm` : ''}`
        : 'Job Summary Board';
    // 5. Post audit log notes on MO chatter
    const actorInfo = options?.actorName ? `\nUpdated by: ${options.actorName}` : '';
    const moChatterHtml = `<p>✂️ <strong>Work Order Cutting Quantity Reconciled with Job Summary</strong></p>` +
        `<p>Quantity to be processed on MO <strong>${mo.name}</strong> (${moProductName}) adjusted from <strong>${currentQty}</strong> to <strong>${targetQty}</strong> to match Job Summary requirements (${matchedMaterialDesc}: ${targetQty} sheets/panels).</p>` +
        `<p>Raw material component stock requirement updated to <strong>${targetQty}</strong> and re-reserved.</p>` +
        (actorInfo ? `<p><em>${actorInfo}</em></p>` : '');
    await client.postModelChatterMessage('mrp.production', mo.id, moChatterHtml).catch(() => null);
    // 6. Cross-alert note on Sales Order chatter
    if (soId) {
        const soChatterHtml = `<p>✂️ <strong>Work Order Cutting Quantity Adjusted:</strong> MO <strong>${mo.name}</strong> (${moProductName}) work order quantity modified from <strong>${currentQty}</strong> to <strong>${targetQty}</strong> to match Job Summary requirements.</p>`;
        await client.postModelChatterMessage('sale.order', soId, soChatterHtml).catch(() => null);
    }
    await (0, logService_1.logEvent)('info', 'Work order cutting quantity reconciled with Job Summary', {
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
async function reconcileWorkOrderQuantitiesForSaleOrder(client, saleOrderId, options) {
    const saleOrders = await client.readRecords('sale.order', [saleOrderId], ['id', 'name']);
    const so = saleOrders[0];
    if (!so)
        return [];
    // Search active MOs linked to this Sales Order (origin === SO name or contains it)
    const candidateMos = await client.searchReadRecords('mrp.production', {
        domain: [
            ['origin', 'ilike', so.name],
            ['state', 'not in', ['done', 'cancel']],
        ],
        fields: ['id', 'name'],
        limit: 20,
    });
    const results = [];
    for (const candidate of candidateMos) {
        try {
            const res = await reconcileWorkOrderQuantitiesForMo(client, candidate.id, {
                parsedJobSummary: options?.parsedJobSummary,
                soId: so.id,
                soName: so.name,
                actorName: options?.actorName,
            });
            if (res) {
                results.push(res);
            }
        }
        catch (err) {
            await (0, logService_1.logEvent)('warn', `Failed to reconcile MO ${candidate.name} work order quantity`, {
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
async function reconcileWorkOrderQuantitiesForPurchaseOrder(client, purchaseOrderId, options) {
    const orders = await client.readRecords('purchase.order', [purchaseOrderId], ['id', 'name', 'origin']);
    const po = orders[0];
    if (!po)
        return [];
    const origin = String(po.origin || '').trim();
    let soNameCandidate = (0, helpers_1.extractSoNameFromOrigin)(origin);
    if (!soNameCandidate && origin.startsWith('WH/MO/')) {
        const mos = await client.searchReadRecords('mrp.production', {
            domain: [['name', '=', origin]],
            fields: ['id', 'name', 'origin'],
            limit: 1,
        });
        if (mos[0]?.origin) {
            soNameCandidate = (0, helpers_1.extractSoNameFromOrigin)(mos[0].origin);
        }
    }
    if (!soNameCandidate)
        return [];
    const saleOrders = await client.searchReadRecords('sale.order', {
        domain: [['name', '=', soNameCandidate]],
        fields: ['id', 'name'],
        limit: 1,
    });
    const so = saleOrders[0];
    if (!so)
        return [];
    return reconcileWorkOrderQuantitiesForSaleOrder(client, so.id, {
        actorName: options?.actorName,
    });
}
