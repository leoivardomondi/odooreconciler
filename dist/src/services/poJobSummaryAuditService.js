"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY = exports.PO_JOB_SUMMARY_DISCREPANCY_ACTIVITY_SUMMARY = void 0;
exports.extractSoNameFromOrigin = extractSoNameFromOrigin;
exports.findOdooUserByTerm = findOdooUserByTerm;
exports.resolveNotificationStakeholders = resolveNotificationStakeholders;
exports.comparePoLinesWithSheetMaterials = comparePoLinesWithSheetMaterials;
exports.auditPurchaseOrderAgainstJobSummary = auditPurchaseOrderAgainstJobSummary;
exports.auditLinkedPurchaseOrdersForSaleOrder = auditLinkedPurchaseOrdersForSaleOrder;
const repositories_1 = require("../models/repositories");
const boardProductClassifier_1 = require("./boardProductClassifier");
const logService_1 = require("./logService");
const odooActivityService_1 = require("./odooActivityService");
const poBillAutomationService_1 = require("./poBillAutomationService");
const pdfParser_1 = require("./pdfParser");
const helpers_1 = require("../utils/helpers");
const stockProcessingService_1 = require("./stockProcessingService");
const workOrderQuantityReconciliationService_1 = require("./workOrderQuantityReconciliationService");
exports.PO_JOB_SUMMARY_DISCREPANCY_ACTIVITY_SUMMARY = 'PO PROCUREMENT MISMATCH: CLARIFICATION NEEDED';
exports.PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY = 'AWAIT JOB SUMMARY ATTACHMENT BEFORE APPROVING PO';
function relationLabel(value) {
    return Array.isArray(value) ? String(value[1]) : '';
}
function relationId(value) {
    return Array.isArray(value) ? Number(value[0]) : null;
}
/**
 * Extracts candidate Sales Order name from a PO origin field.
 * Handles patterns such as:
 * - "S02182"
 * - "S02182:WH/MO/05412"
 * - "WH/MO/05412" (will need MO resolution)
 */
function extractSoNameFromOrigin(origin) {
    const trimmed = String(origin || '').trim();
    if (!trimmed)
        return null;
    // Direct SO match (e.g. S02182, SO0012, S12345)
    const soMatch = trimmed.match(/\b(S\d{4,}|SO\d{3,})\b/i);
    if (soMatch) {
        return soMatch[1].toUpperCase();
    }
    return null;
}
/**
 * Searches Odoo for a user by name or login pattern.
 */
async function findOdooUserByTerm(client, term) {
    try {
        const users = await client.searchReadRecords('res.users', {
            domain: [
                '|',
                ['name', 'ilike', term],
                ['login', 'ilike', term],
            ],
            fields: ['id', 'name', 'login', 'partner_id'],
            limit: 1,
        });
        const u = users[0];
        if (!u)
            return null;
        return {
            name: u.name,
            login: u.login,
            userId: u.id,
            partnerId: relationId(u.partner_id),
        };
    }
    catch {
        return null;
    }
}
/**
 * Resolves the 4 key stakeholder recipients for reporting:
 * 1. Charles
 * 2. Leoivard Ongule
 * 3. Responsible Sales Person (from SO)
 * 4. Raphael Onyango
 */
async function resolveNotificationStakeholders(client, soUserId) {
    const searchTerms = ['Charles', 'Leoivard', 'Raphael'];
    const stakeholders = [];
    const partnerIdsSet = new Set();
    for (const term of searchTerms) {
        const u = await findOdooUserByTerm(client, term);
        if (u) {
            stakeholders.push(u);
            if (u.partnerId)
                partnerIdsSet.add(u.partnerId);
        }
    }
    // Add Salesperson if available
    if (soUserId) {
        try {
            const users = await client.readRecords('res.users', [soUserId], ['id', 'name', 'login', 'partner_id']);
            const soUser = users[0];
            if (soUser && !stakeholders.some((s) => s.userId === soUser.id)) {
                const u = {
                    name: soUser.name,
                    login: soUser.login,
                    userId: soUser.id,
                    partnerId: relationId(soUser.partner_id),
                };
                stakeholders.push(u);
                if (u.partnerId)
                    partnerIdsSet.add(u.partnerId);
            }
        }
        catch {
            // Non-blocking
        }
    }
    const mentionParts = stakeholders.map((s) => {
        if (s.partnerId) {
            return `<a href="#" data-oe-model="res.partner" data-oe-id="${s.partnerId}">@${s.name}</a>`;
        }
        return `@${s.name}`;
    });
    const mentionHtml = mentionParts.length > 0
        ? mentionParts.join(', ')
        : '@Charles, @Leoivard Ongule, @Salesperson, @Raphael Onyango';
    return {
        stakeholders,
        partnerIds: Array.from(partnerIdsSet),
        mentionHtml,
    };
}
/**
 * Compares PO orderlines with Job Summary requirements.
 * Rules:
 * - "Not less, but can be more" applies ONLY to edge banding products (meters >= required).
 * - Boards (particle board, MDF, etc.) MUST BE AN EXACT MATCH (orderedSheets === requiredSheets).
 *   Both under-ordering (shortfall) and over-ordering (excess) are flagged as mismatches.
 */
function comparePoLinesWithSheetMaterials(poLines, sheetMaterials, edgingItems = []) {
    const shortfalls = [];
    const verified = [];
    const details = [];
    // 1. Boards: MUST BE EXACT MATCH (not less, and NOT more)
    for (const material of sheetMaterials) {
        const requiredSheets = material.sheets || 0;
        const materialNameLower = material.name.toLowerCase().trim();
        // Find PO lines matching this sheet material
        const matchingLines = poLines.filter((line) => {
            const lineName = (relationLabel(line.product_id) || line.name || '').toLowerCase();
            if (!(0, boardProductClassifier_1.isBoardProductName)(lineName))
                return false;
            if (/optimis?ed\s+panels?/i.test(lineName))
                return false;
            // Match thickness if specified
            if (material.thickness_mm) {
                const t1 = `${material.thickness_mm}mm`;
                const t2 = `${material.thickness_mm} mm`;
                if (!lineName.includes(t1) && !lineName.includes(t2)) {
                    return false;
                }
            }
            // Match keywords from material name
            const words = materialNameLower.split(/\s+/).filter((w) => w.length > 2);
            const matchesKeyword = words.some((w) => lineName.includes(w));
            return matchesKeyword || (sheetMaterials.length === 1 && (0, boardProductClassifier_1.isBoardProductName)(lineName));
        });
        const orderedSheets = matchingLines.reduce((sum, l) => sum + (Number(l.product_qty) || 0), 0);
        const isMatch = orderedSheets === requiredSheets;
        if (orderedSheets < requiredSheets) {
            const shortfallCount = Math.round((requiredSheets - orderedSheets) * 100) / 100;
            shortfalls.push(`Board (${material.name} ${material.thickness_mm ? `${material.thickness_mm}mm` : ''}): PO ordered ${orderedSheets} sheet(s), but Job Summary requires ${requiredSheets} sheet(s) (Shortfall: ${shortfallCount} sheet(s)).`);
        }
        else if (orderedSheets > requiredSheets) {
            const excessCount = Math.round((orderedSheets - requiredSheets) * 100) / 100;
            shortfalls.push(`Board (${material.name} ${material.thickness_mm ? `${material.thickness_mm}mm` : ''}): PO ordered ${orderedSheets} sheet(s), but Job Summary requires ${requiredSheets} sheet(s) (Excess: ${excessCount} sheet(s) — boards must match exactly).`);
        }
        else {
            verified.push(`Board (${material.name} ${material.thickness_mm ? `${material.thickness_mm}mm` : ''}): PO ordered ${orderedSheets} sheet(s) (Required: ${requiredSheets} sheet(s)).`);
        }
        details.push({
            itemType: 'board',
            materialName: material.name,
            thickness_mm: material.thickness_mm,
            requiredQty: requiredSheets,
            orderedQty: orderedSheets,
            unit: 'sheet(s)',
            isMatch,
        });
    }
    // 2. Edge Banding: "Not less, but can be more"
    for (const item of edgingItems || []) {
        const requiredMeters = Math.round((item.length_mm || 0) / 1000);
        const normalizedColor = (0, stockProcessingService_1.normalizeColor)(item.color);
        const matchingLines = poLines.filter((line) => {
            const lineName = (relationLabel(line.product_id) || line.name || '').toLowerCase();
            if (!lineName.includes('edge band') && !lineName.includes('edging band') && !lineName.includes('edgebanding')) {
                return false;
            }
            return (0, stockProcessingService_1.normalizeColor)(lineName).includes(normalizedColor);
        });
        // If PO contains edge banding lines, audit them
        if (matchingLines.length > 0 || poLines.some((l) => (relationLabel(l.product_id) || '').toLowerCase().includes('edge band'))) {
            const orderedMeters = matchingLines.reduce((sum, l) => sum + (Number(l.product_qty) || 0), 0);
            const isSufficient = orderedMeters >= requiredMeters;
            if (!isSufficient) {
                const shortfall = Math.round((requiredMeters - orderedMeters) * 100) / 100;
                shortfalls.push(`Edge Banding (${item.color}): Ordered ${orderedMeters}m, Job Summary requires ${requiredMeters}m — Short by ${shortfall}m.`);
            }
            else {
                verified.push(`Edge Banding (${item.color}): Ordered ${orderedMeters}m (Required: ${requiredMeters}m — Verified sufficient).`);
            }
            details.push({
                itemType: 'edge_banding',
                materialName: item.color,
                thickness_mm: item.thickness_mm,
                requiredQty: requiredMeters,
                orderedQty: orderedMeters,
                unit: 'm',
                isMatch: isSufficient,
            });
        }
    }
    return {
        shortfalls,
        verified,
        hasShortfall: shortfalls.length > 0,
        details,
    };
}
/**
 * Audits a single Purchase Order against the linked Sales Order's Job Summary.
 * Rules:
 * - Runs strictly on confirmed Purchase Orders (state in 'purchase' or 'done').
 * - If Job Summary is not found on associated Sales Order: creates activity for Charles to await/request it before approving PO.
 * - If Job Summary is found: compares PO lines vs Job Summary.
 *   - Match: reports match to Charles, Leoivard Ongule, responsible salesperson, and Raphael Onyango as log notes.
 *   - Mismatch: creates urgent To-Do activity on PO assigned to Buyer seeking written clarification or correction,
 *     posts breakdown on PO chatter, and cross-alerts Sales Order chatter.
 */
async function auditPurchaseOrderAgainstJobSummary(client, purchaseOrderId, providedParsed) {
    const orders = await client.readRecords('purchase.order', [purchaseOrderId], ['id', 'name', 'state', 'origin', 'company_id', 'user_id', 'create_uid']);
    const po = orders[0];
    if (!po) {
        throw new Error(`Purchase Order ${purchaseOrderId} was not found in Odoo.`);
    }
    const companyId = relationId(po.company_id);
    if (companyId === 3 || String(po.name).startsWith('VA/')) {
        return {
            poId: po.id,
            poName: po.name,
            poState: po.state || null,
            soId: null,
            soName: null,
            hasShortfall: false,
            shortfalls: [],
            verifiedItems: [],
            actionTaken: 'skipped_excluded_company',
            summary: 'PO belongs to excluded company URBAN VIBE 2. Audit skipped.',
        };
    }
    // The whole PO audit operates on a confirmed Purchase Order ('purchase' or 'done')
    const isConfirmedPo = po.state === 'purchase' || po.state === 'done';
    if (!isConfirmedPo) {
        return {
            poId: po.id,
            poName: po.name,
            poState: po.state || null,
            soId: null,
            soName: null,
            hasShortfall: false,
            shortfalls: [],
            verifiedItems: [],
            actionTaken: 'skipped_unconfirmed_po',
            summary: `PO ${po.name} is in "${po.state}" state (not confirmed). Audit will execute once the PO is confirmed.`,
        };
    }
    const origin = String(po.origin || '').trim();
    let soNameCandidate = extractSoNameFromOrigin(origin);
    // If origin is an MO (e.g. WH/MO/05412), resolve MO origin to find the SO
    if (!soNameCandidate && origin.startsWith('WH/MO/')) {
        const mos = await client.searchReadRecords('mrp.production', {
            domain: [['name', '=', origin]],
            fields: ['id', 'name', 'origin'],
            limit: 1,
        });
        if (mos[0]?.origin) {
            soNameCandidate = extractSoNameFromOrigin(mos[0].origin);
        }
    }
    if (!soNameCandidate) {
        return {
            poId: po.id,
            poName: po.name,
            poState: po.state || null,
            soId: null,
            soName: null,
            hasShortfall: false,
            shortfalls: [],
            verifiedItems: [],
            actionTaken: 'no_so_origin',
            summary: `PO ${po.name} has no Sales Order origin specified (origin: "${origin || 'none'}").`,
        };
    }
    // Find Sales Order by name
    const saleOrders = await client.searchReadRecords('sale.order', {
        domain: [['name', '=', soNameCandidate]],
        fields: ['id', 'name', 'user_id', 'partner_id'],
        limit: 1,
    });
    const so = saleOrders[0];
    if (!so) {
        return {
            poId: po.id,
            poName: po.name,
            poState: po.state || null,
            soId: null,
            soName: soNameCandidate,
            hasShortfall: false,
            shortfalls: [],
            verifiedItems: [],
            actionTaken: 'no_so_origin',
            summary: `Linked Sales Order "${soNameCandidate}" was not found in Odoo.`,
        };
    }
    const soUserId = relationId(so.user_id);
    const buyerUserId = relationId(po.user_id) || relationId(po.create_uid);
    // Obtain Job Summary
    let parsed = providedParsed || null;
    if (!parsed) {
        const latestExtracted = await (0, repositories_1.getLatestExtractedResultByOrderId)(so.id);
        if (latestExtracted?.resultJson) {
            parsed = latestExtracted.resultJson;
        }
    }
    if (!parsed) {
        // Attempt on-the-fly download & extraction of Job Summary attachment
        const attachments = await client.getAttachments(so.id);
        const targetAttachment = attachments.find((a) => (0, helpers_1.isJobSummaryAttachment)(a, 'job summary'));
        if (targetAttachment) {
            const downloaded = await client.downloadAttachment(targetAttachment.id);
            parsed = await (0, pdfParser_1.parseJobSummaryPdf)(downloaded.content, helpers_1.DEFAULT_PARSER_CONFIG);
        }
    }
    // CASE 1: Job Summary is NOT FOUND
    // User Rule: "what if job summary is not found, create activity for the user Charles to await or request job summary to be attached ASAP to the associated sales Order log note area, before approving the purchase order, this should appear when PO is confirmed"
    if (!parsed || (!parsed.sheetMaterials?.length && !parsed.items?.length)) {
        const charlesUser = await findOdooUserByTerm(client, 'Charles');
        const targetActivityUserId = charlesUser?.userId || buyerUserId;
        if (targetActivityUserId) {
            const existing = await (0, odooActivityService_1.findOpenActivities)(client, {
                modelName: 'purchase.order',
                recordId: po.id,
                summary: exports.PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY,
            });
            if (existing.length === 0) {
                await (0, odooActivityService_1.createTodoActivity)(client, {
                    modelName: 'purchase.order',
                    recordId: po.id,
                    userId: targetActivityUserId,
                    summary: exports.PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY,
                    noteLines: [
                        `Purchase Order: ${po.name} is confirmed, but Job Summary was not found on associated Sales Order ${so.name}.`,
                        `Please await or request the Job Summary PDF to be attached ASAP to the associated Sales Order log note area before approving/releasing Purchase Order ${po.name}.`,
                    ],
                });
            }
        }
        const charlesMention = charlesUser?.partnerId
            ? `<a href="#" data-oe-model="res.partner" data-oe-id="${charlesUser.partnerId}">@${charlesUser.name}</a>`
            : '@Charles';
        const notifyPartnerIds = charlesUser?.partnerId ? [charlesUser.partnerId] : undefined;
        // Post chatter note on PO
        await client.postModelChatterMessage('purchase.order', po.id, `<p>⚠️ <strong>Job Summary Missing Alert (${charlesMention}):</strong></p>` +
            `<p>Associated Sales Order <strong>${so.name}</strong> has no Job Summary PDF attached.</p>` +
            `<p>Please await or request Job Summary to be attached ASAP to the associated Sales Order log note area before approving Purchase Order <strong>${po.name}</strong>.</p>`, notifyPartnerIds);
        // Cross-alert note on Sales Order chatter
        await client.postModelChatterMessage('sale.order', so.id, `<p>⚠️ <strong>Job Summary Required for PO ${po.name}:</strong></p>` +
            `<p>Purchase Order <strong>${po.name}</strong> is confirmed, but no Job Summary PDF is attached to this Sales Order. Please attach the Job Summary PDF ASAP in this log note area so procurement can be verified.</p>`);
        await (0, logService_1.logEvent)('warn', 'PO audit: Job Summary not found, activity created for Charles', {
            poId: po.id,
            poName: po.name,
            soId: so.id,
            soName: so.name,
            assignedUserId: targetActivityUserId,
        });
        return {
            poId: po.id,
            poName: po.name,
            poState: po.state || null,
            soId: so.id,
            soName: so.name,
            hasShortfall: true,
            shortfalls: [`Job Summary not found for associated Sales Order ${so.name}.`],
            verifiedItems: [],
            actionTaken: 'no_job_summary_found',
            summary: `No Job Summary found for ${so.name}. Created activity for Charles to await Job Summary attachment before approving PO ${po.name}.`,
        };
    }
    // CASE 2: Job Summary IS FOUND — Close any open "AWAIT JOB SUMMARY ATTACHMENT" activity on this PO
    try {
        const openMissingJsActivities = await (0, odooActivityService_1.findOpenActivities)(client, {
            modelName: 'purchase.order',
            recordId: po.id,
            summary: exports.PO_JOB_SUMMARY_MISSING_ACTIVITY_SUMMARY,
        });
        if (openMissingJsActivities.length > 0) {
            await (0, odooActivityService_1.closeActivities)(client, openMissingJsActivities.map((a) => a.id), `Job Summary PDF was uploaded to associated Sales Order ${so.name}. Procurement audit completed.`);
        }
    }
    catch {
        // Non-critical activity close failure
    }
    // Reconcile cutting work order and MO quantities with Job Summary requirements & approved PO
    try {
        await (0, workOrderQuantityReconciliationService_1.reconcileWorkOrderQuantitiesForSaleOrder)(client, so.id, {
            parsedJobSummary: parsed,
        });
    }
    catch (reconcileErr) {
        await (0, logService_1.logEvent)('warn', 'Failed to reconcile work order quantities during PO audit', {
            poId: po.id,
            soId: so.id,
            error: reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr),
        });
    }
    // Compare PO lines
    const poLines = await (0, poBillAutomationService_1.getPurchaseOrderLines)(client, po.id);
    const comparison = comparePoLinesWithSheetMaterials(poLines, parsed.sheetMaterials || [], parsed.items || []);
    // Resolve the 4 key stakeholders: Charles, Leoivard Ongule, Salesperson, Raphael Onyango
    const { partnerIds, mentionHtml } = await resolveNotificationStakeholders(client, soUserId);
    if (comparison.hasShortfall) {
        // MISMATCH DETECTED
        // User Rule: "if there is a mismatch report and create activity seeking clarrification in writing explaining the mismatch or correction to be done. Creates an urgent To-Do Activity on the PO assigned to the Buyer (res.users). Posts a breakdown note in the PO Chatter detailing the shortfall... Posts a cross-alert note on the Sales Order Chatter"
        if (buyerUserId) {
            const existing = await (0, odooActivityService_1.findOpenActivities)(client, {
                modelName: 'purchase.order',
                recordId: po.id,
                summary: exports.PO_JOB_SUMMARY_DISCREPANCY_ACTIVITY_SUMMARY,
            });
            if (existing.length === 0) {
                await (0, odooActivityService_1.createTodoActivity)(client, {
                    modelName: 'purchase.order',
                    recordId: po.id,
                    userId: buyerUserId,
                    summary: exports.PO_JOB_SUMMARY_DISCREPANCY_ACTIVITY_SUMMARY,
                    noteLines: [
                        `Purchase Order: ${po.name} (linked to Sales Order ${so.name})`,
                        `Discrepancy detected between PO lines and Job Summary requirements:`,
                        ...comparison.shortfalls.map((s) => `• ${s}`),
                        `Please provide written clarification explaining the mismatch or take corrective action before approving/releasing.`,
                    ],
                });
            }
        }
        const soPartnerId = relationId(so.partner_id);
        let manualBoardLogWarningHtml = '';
        if (soPartnerId) {
            try {
                const activeLogs = await (0, repositories_1.findActiveBoardIntakeLogsByPartnerOrProduct)(soPartnerId);
                if (activeLogs.length > 0) {
                    const logItems = activeLogs.slice(0, 3).map((l) => `• <strong>${String(l.product_name || 'Board')}</strong>: ${Number(l.quantity)} sheets manually logged by operator <strong>${String(l.actor_name || 'Operator')}</strong>`).join('<br/>\n');
                    const primaryOperator = activeLogs[0].actor_name || 'the responsible operator';
                    manualBoardLogWarningHtml =
                        `<div style="margin-top:8px;padding:10px 14px;background:#fff7ed;border-left:5px solid #ea580c;color:#9a3412;border-radius:4px;line-height:1.5;">` +
                            `<strong>⚠️ Notice: Matching Manual Board Intake Detected:</strong><br/>` +
                            `${logItems}<br/>` +
                            `Please communicate with operator <strong>${primaryOperator}</strong> to confirm whether these boards were purchased with this Purchase Order (<strong>${po.name}</strong>) or client-supplied.` +
                            `</div>`;
                }
            }
            catch {
                // Non-blocking
            }
        }
        // Post breakdown note in the PO Chatter
        await client.postModelChatterMessage('purchase.order', po.id, `<p><strong>⚠️ Job Summary Procurement Mismatch Alert:</strong></p>` +
            `<p><strong>Stakeholders Alerted:</strong> ${mentionHtml}</p>` +
            `<p>Discrepancies found between Purchase Order <strong>${po.name}</strong> and Job Summary for <strong>${so.name}</strong>:</p>` +
            `<ul>${comparison.shortfalls.map((s) => `<li>${s}</li>`).join('')}</ul>` +
            `<p><em>An activity has been created seeking written clarification or correction before approving this Purchase Order.</em></p>` +
            manualBoardLogWarningHtml, partnerIds);
        // Cross-alert note on Sales Order chatter
        await client.postModelChatterMessage('sale.order', so.id, `<p><strong>⚠️ PO Procurement Discrepancy on ${po.name}:</strong></p>` +
            `<p>The following mismatch was flagged on confirmed Purchase Order <strong>${po.name}</strong>:</p>` +
            `<ul>${comparison.shortfalls.map((s) => `<li>${s}</li>`).join('')}</ul>` +
            manualBoardLogWarningHtml);
        await (0, logService_1.logEvent)('warn', 'PO procurement mismatch detected against Job Summary', {
            poId: po.id,
            poName: po.name,
            soId: so.id,
            soName: so.name,
            shortfalls: comparison.shortfalls,
        });
        return {
            poId: po.id,
            poName: po.name,
            poState: po.state || null,
            soId: so.id,
            soName: so.name,
            hasShortfall: true,
            shortfalls: comparison.shortfalls,
            verifiedItems: comparison.verified,
            actionTaken: 'shortfall_alert',
            summary: `Procurement mismatch on PO ${po.name}: ${comparison.shortfalls.length} discrepancy item(s) found against ${so.name} Job Summary.`,
        };
    }
    // CASE 3: ALL ITEMS MATCH
    // User Rule: "If PO Sheets == Required Sheets: It marks procurement verified, report as a match between job summary and Purchase order for user Charles and Leoivard Ongule and the responsible sales person, and Raphael Onyango in odoo, as log notes"
    const soPartnerId = relationId(so.partner_id);
    let manualBoardLogWarningHtml = '';
    if (soPartnerId) {
        try {
            const activeLogs = await (0, repositories_1.findActiveBoardIntakeLogsByPartnerOrProduct)(soPartnerId);
            if (activeLogs.length > 0) {
                const logItems = activeLogs.slice(0, 3).map((l) => `• <strong>${String(l.product_name || 'Board')}</strong>: ${Number(l.quantity)} sheets manually logged by operator <strong>${String(l.actor_name || 'Operator')}</strong>`).join('<br/>\n');
                const primaryOperator = activeLogs[0].actor_name || 'the responsible operator';
                manualBoardLogWarningHtml =
                    `<div style="margin-top:8px;padding:10px 14px;background:#fff7ed;border-left:5px solid #ea580c;color:#9a3412;border-radius:4px;line-height:1.5;">` +
                        `<strong>⚠️ Notice: Matching Manual Board Intake Detected:</strong><br/>` +
                        `${logItems}<br/>` +
                        `Please communicate with operator <strong>${primaryOperator}</strong> to confirm whether these boards were purchased with this Purchase Order (<strong>${po.name}</strong>) or client-supplied.` +
                        `</div>`;
            }
        }
        catch {
            // Non-blocking
        }
    }
    await client.postModelChatterMessage('purchase.order', po.id, `<p><strong>✅ Procurement Match Confirmed</strong></p>` +
        `<p>Procurement quantities on Purchase Order <strong>${po.name}</strong> match the Job Summary of Sales Order <strong>${so.name}</strong>.</p>` +
        `<p><strong>Stakeholders Notified:</strong> ${mentionHtml}</p>` +
        `<ul>${comparison.verified.map((v) => `<li>${v}</li>`).join('')}</ul>` +
        manualBoardLogWarningHtml, partnerIds);
    // Confirmation on Sales Order chatter
    await client.postModelChatterMessage('sale.order', so.id, `<p><strong>✅ Procurement Match Confirmed:</strong> Purchase Order <strong>${po.name}</strong> sheet and edging quantities match the Job Summary.</p>` +
        manualBoardLogWarningHtml);
    await (0, logService_1.logEvent)('info', 'PO procurement quantities verified against Job Summary', {
        poId: po.id,
        poName: po.name,
        soId: so.id,
        soName: so.name,
        verifiedItems: comparison.verified,
    });
    return {
        poId: po.id,
        poName: po.name,
        poState: po.state || null,
        soId: so.id,
        soName: so.name,
        hasShortfall: false,
        shortfalls: [],
        verifiedItems: comparison.verified,
        actionTaken: 'verified_sufficient',
        summary: `PO ${po.name} procurement verified: all board and edging quantities match ${so.name} Job Summary requirements.`,
    };
}
/**
 * Given a Sales Order, finds all linked Purchase Orders and audits them against the Job Summary.
 */
async function auditLinkedPurchaseOrdersForSaleOrder(client, saleOrderId, parsed) {
    const saleOrders = await client.readRecords('sale.order', [saleOrderId], ['id', 'name']);
    const so = saleOrders[0];
    if (!so)
        return [];
    // Search POs where origin contains the SO name
    const candidatePos = await client.searchReadRecords('purchase.order', {
        domain: [
            ['origin', 'ilike', so.name],
            ['state', 'in', ['purchase', 'done']], // Only audit confirmed POs
        ],
        fields: ['id', 'name', 'origin'],
        limit: 20,
    });
    // Also check MOs linked to this SO to find POs ordered via MO
    const mos = await client.searchReadRecords('mrp.production', {
        domain: [
            ['origin', '=', so.name],
            ['state', 'not in', ['cancel']],
        ],
        fields: ['id', 'name'],
        limit: 20,
    });
    if (mos.length > 0) {
        const moNames = mos.map((m) => m.name);
        const moPos = await client.searchReadRecords('purchase.order', {
            domain: [
                ['origin', 'in', moNames],
                ['state', 'in', ['purchase', 'done']], // Only audit confirmed POs
            ],
            fields: ['id', 'name', 'origin'],
            limit: 20,
        });
        for (const p of moPos) {
            if (!candidatePos.some((c) => c.id === p.id)) {
                candidatePos.push(p);
            }
        }
    }
    const results = [];
    for (const p of candidatePos) {
        try {
            const res = await auditPurchaseOrderAgainstJobSummary(client, p.id, parsed);
            results.push(res);
        }
        catch (err) {
            await (0, logService_1.logEvent)('error', `Failed to audit PO ${p.name} against Job Summary`, {
                poId: p.id,
                soId: saleOrderId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return results;
}
