"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUOTATION_BOARD_SELECTION_ACTIVITY_SUMMARY = exports.QUOTATION_DISCREPANCY_ACTIVITY_SUMMARY = void 0;
exports.lineDisplayName = lineDisplayName;
exports.isTemplateOnlyQuotation = isTemplateOnlyQuotation;
exports.compareQuotationLinesWithJobSummary = compareQuotationLinesWithJobSummary;
exports.syncQuotationWithJobSummary = syncQuotationWithJobSummary;
const boardProductClassifier_1 = require("./boardProductClassifier");
const logService_1 = require("./logService");
const odooActivityService_1 = require("./odooActivityService");
const stockProcessingService_1 = require("./stockProcessingService");
exports.QUOTATION_DISCREPANCY_ACTIVITY_SUMMARY = 'JOB SUMMARY QUOTATION DISCREPANCY';
exports.QUOTATION_BOARD_SELECTION_ACTIVITY_SUMMARY = 'SELECT BOARD PRODUCT FROM JOB SUMMARY';
function relationLabel(value) {
    return Array.isArray(value) ? String(value[1]) : '';
}
function relationId(value) {
    return Array.isArray(value) ? Number(value[0]) : null;
}
function lineDisplayName(line) {
    return relationLabel(line.product_id) || line.name || '';
}
/**
 * Checks if a quotation only has default template placeholder items
 * (e.g., "Example Board 18mm", "Optimised Panels", section headers).
 */
function isTemplateOnlyQuotation(lines) {
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
function compareQuotationLinesWithJobSummary(lines, parsed) {
    const shortfalls = [];
    const productLines = lines.filter((line) => !line.display_type);
    // 1. Compare Board Sheets
    const sheetMaterials = parsed.sheetMaterials || [];
    const boardDetails = [];
    for (const material of sheetMaterials) {
        const requiredSheets = material.sheets || 0;
        const materialNameLower = material.name.toLowerCase().trim();
        // Match board lines by name or thickness
        const matchingBoardLines = productLines.filter((line) => {
            const name = lineDisplayName(line).toLowerCase();
            if (!(0, boardProductClassifier_1.isBoardProductName)(name))
                return false;
            if (/example\s+board/i.test(name))
                return false;
            if (/optimis?ed\s+panels?/i.test(name))
                return false;
            // Match material name keywords (e.g. "mdf", "white", "chipboard", etc.)
            const nameWords = materialNameLower.split(/\s+/).filter((w) => w.length > 2);
            const matchesWord = nameWords.some((word) => name.includes(word));
            return matchesWord || (sheetMaterials.length === 1 && (0, boardProductClassifier_1.isBoardProductName)(name));
        });
        const quotedSheets = matchingBoardLines.reduce((sum, l) => sum + (Number(l.product_uom_qty) || 0), 0);
        // Rule: "Not less, but can be more" applies ONLY to edge banding, NOT boards (MDF, particle board, etc.)
        const isSufficient = quotedSheets === requiredSheets;
        if (quotedSheets < requiredSheets) {
            shortfalls.push(`Board (${material.name} ${material.thickness_mm ? `${material.thickness_mm}mm` : ''}): Quotation has ${quotedSheets} sheet(s), but Job Summary requires ${requiredSheets} sheet(s) (Shortfall: ${Math.round((requiredSheets - quotedSheets) * 100) / 100} sheet(s)).`);
        }
        else if (quotedSheets > requiredSheets) {
            shortfalls.push(`Board (${material.name} ${material.thickness_mm ? `${material.thickness_mm}mm` : ''}): Quotation has ${quotedSheets} sheet(s), but Job Summary requires ${requiredSheets} sheet(s) (Excess: ${Math.round((quotedSheets - requiredSheets) * 100) / 100} sheet(s) — boards must match exactly).`);
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
    const panelsLine = productLines.find((line) => /optimis?ed\s+panels?/i.test(lineDisplayName(line)));
    const quotedPanels = panelsLine ? Number(panelsLine.product_uom_qty) || 0 : 0;
    const panelsSufficient = quotedPanels >= requiredPanels;
    if (!panelsSufficient && requiredPanels > 0) {
        shortfalls.push(`Optimised Panels: Quotation has ${quotedPanels} piece(s), but Job Summary requires ${requiredPanels} sheet(s).`);
    }
    // 3. Compare Edging Meters
    const edgingDetails = [];
    for (const item of parsed.items || []) {
        const requiredMeters = Math.round((item.length_mm || 0) / 1000);
        const normalizedItemColor = (0, stockProcessingService_1.normalizeColor)(item.color);
        const matchingEdgingLines = productLines.filter((line) => {
            const name = lineDisplayName(line).toLowerCase();
            if (!name.includes('edge band') && !name.includes('edging band'))
                return false;
            const normalizedLineName = (0, stockProcessingService_1.normalizeColor)(name);
            return normalizedLineName.includes(normalizedItemColor);
        });
        const quotedMeters = matchingEdgingLines.reduce((sum, l) => sum + (Number(l.product_uom_qty) || 0), 0);
        const isSufficient = quotedMeters >= requiredMeters;
        if (!isSufficient) {
            shortfalls.push(`Edge Banding Service (${item.color}): Quotation has ${quotedMeters} m, but Job Summary requires ${requiredMeters} m.`);
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
function resolveSalespersonUserId(order) {
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
async function syncQuotationWithJobSummary(client, orderId, parsed) {
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
        const unresolvedBoards = [];
        const exampleBoardLine = lines.find((l) => !l.display_type && /example\s+board/i.test(lineDisplayName(l)));
        const optimisedPanelsLine = lines.find((l) => !l.display_type && /optimis?ed\s+panels?/i.test(lineDisplayName(l)));
        // 1. Boards: Replace Example Board or Create Board Lines
        const sheetMaterials = parsed.sheetMaterials || [];
        let exampleBoardUsed = false;
        for (const material of sheetMaterials) {
            const sheets = material.sheets || 1;
            const searchTerms = [material.name];
            if (material.thickness_mm) {
                searchTerms.push(`${material.thickness_mm}mm`);
            }
            // Find matching Odoo board product
            const candidateProducts = await client.searchReadRecords('product.product', {
                domain: [
                    ['sale_ok', '=', true],
                    ['name', 'ilike', material.name],
                ],
                fields: ['id', 'name', 'display_name'],
                limit: 10,
            });
            // Filter candidate products to physical boards
            const matchedProducts = candidateProducts.filter((p) => {
                const prodName = (p.display_name || p.name).toLowerCase();
                if (material.thickness_mm) {
                    const thicknessStr = `${material.thickness_mm}mm`;
                    const thicknessSpaced = `${material.thickness_mm} mm`;
                    if (!prodName.includes(thicknessStr) && !prodName.includes(thicknessSpaced)) {
                        return false;
                    }
                }
                return (0, boardProductClassifier_1.isBoardProductName)(prodName);
            });
            const selectedProduct = matchedProducts.length === 1 ? matchedProducts[0] : null;
            if (selectedProduct) {
                if (exampleBoardLine && !exampleBoardUsed) {
                    // Replace Example Board line
                    await client.writeRecord('sale.order.line', [exampleBoardLine.id], {
                        product_id: selectedProduct.id,
                        name: selectedProduct.display_name || selectedProduct.name,
                        product_uom_qty: sheets,
                    });
                    exampleBoardUsed = true;
                    updatedLinesCount++;
                }
                else {
                    // Add additional board line
                    await client.createRecord('sale.order.line', {
                        order_id: orderId,
                        product_id: selectedProduct.id,
                        name: selectedProduct.display_name || selectedProduct.name,
                        product_uom_qty: sheets,
                    });
                    createdLinesCount++;
                }
            }
            else {
                unresolvedBoards.push(`${material.name} ${material.thickness_mm ? `${material.thickness_mm}mm` : ''} (${sheets} sheets)`);
            }
        }
        // 2. Update Optimised Panels quantity to Optimized Sheets
        if (optimisedPanelsLine && parsed.optimizedSheets) {
            await client.writeRecord('sale.order.line', [optimisedPanelsLine.id], {
                product_uom_qty: parsed.optimizedSheets,
            });
            updatedLinesCount++;
        }
        // 3. Create Edge Banding Service line(s)
        for (const item of parsed.items || []) {
            const meters = Math.round((item.length_mm || 0) / 1000);
            const colorNormalized = (0, stockProcessingService_1.normalizeColor)(item.color);
            const expectedServiceName = `Edge Banding Service ${colorNormalized}`;
            // Search for edge banding service product in Odoo
            const serviceCandidates = await client.searchReadRecords('product.product', {
                domain: [
                    ['sale_ok', '=', true],
                    ['name', 'ilike', 'Edge Banding Service'],
                ],
                fields: ['id', 'name', 'display_name'],
                limit: 50,
            });
            const matchedService = serviceCandidates.find((p) => {
                const prodName = (p.display_name || p.name).toLowerCase();
                return prodName.includes(colorNormalized);
            });
            if (matchedService) {
                await client.createRecord('sale.order.line', {
                    order_id: orderId,
                    product_id: matchedService.id,
                    name: matchedService.display_name || matchedService.name,
                    product_uom_qty: meters,
                });
                createdLinesCount++;
            }
            else {
                // Create an activity if the edge banding service product wasn't found
                const userId = resolveSalespersonUserId(order);
                if (userId) {
                    await (0, odooActivityService_1.createTodoActivity)(client, {
                        modelName: 'sale.order',
                        recordId: orderId,
                        userId,
                        summary: 'ADD EDGE BANDING SERVICE TO QUOTATION',
                        noteLines: [
                            `Sales Order / Quotation: ${order.name}`,
                            `Job Summary specifies ${meters}m of ${item.color} edging.`,
                            `Could not find product matching '${expectedServiceName}'. Please add it manually.`,
                        ],
                    });
                }
            }
        }
        // If any boards could not be uniquely resolved, notify salesperson
        if (unresolvedBoards.length > 0) {
            const userId = resolveSalespersonUserId(order);
            if (userId) {
                await (0, odooActivityService_1.createTodoActivity)(client, {
                    modelName: 'sale.order',
                    recordId: orderId,
                    userId,
                    summary: exports.QUOTATION_BOARD_SELECTION_ACTIVITY_SUMMARY,
                    noteLines: [
                        `Quotation: ${order.name}`,
                        `The following board material(s) from Job Summary could not be uniquely matched to Odoo products:`,
                        ...unresolvedBoards.map((b) => `• ${b}`),
                        `Please select the correct board product(s) on the quotation lines.`,
                    ],
                });
            }
        }
        await (0, logService_1.logEvent)('info', 'Quotation template lines updated from Job Summary', {
            orderId,
            orderName: order.name,
            updatedLinesCount,
            createdLinesCount,
            unresolvedBoards,
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
            summary: `Populated quotation lines: ${updatedLinesCount} updated, ${createdLinesCount} created.`,
        };
    }
    // Case B: Quotation already has custom/filled order lines -> Compare quantities
    const comparison = compareQuotationLinesWithJobSummary(lines, parsed);
    if (comparison.hasShortfall) {
        const userId = resolveSalespersonUserId(order);
        if (userId) {
            const existingActivities = await (0, odooActivityService_1.findOpenActivities)(client, {
                modelName: 'sale.order',
                recordId: orderId,
                summary: exports.QUOTATION_DISCREPANCY_ACTIVITY_SUMMARY,
            });
            if (existingActivities.length === 0) {
                await (0, odooActivityService_1.createTodoActivity)(client, {
                    modelName: 'sale.order',
                    recordId: orderId,
                    userId,
                    summary: exports.QUOTATION_DISCREPANCY_ACTIVITY_SUMMARY,
                    noteLines: [
                        `Quotation: ${order.name}`,
                        `The following line shortfalls were found compared to the attached Job Summary:`,
                        ...comparison.shortfalls.map((s) => `• ${s}`),
                        `Note: Quotation quantities must be equal to or greater than the Job Summary.`,
                    ],
                });
            }
        }
        await client.postModelChatterMessage('sale.order', orderId, `<p><strong>Job Summary Verification Alert:</strong></p><ul>${comparison.shortfalls
            .map((s) => `<li>${s}</li>`)
            .join('')}</ul><p><em>Quotation lines were NOT modified because they were already customized.</em></p>`);
        await (0, logService_1.logEvent)('warn', 'Quotation lines shortfall compared to Job Summary', {
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
    await (0, logService_1.logEvent)('info', 'Quotation lines verified against Job Summary (quantities sufficient)', {
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
