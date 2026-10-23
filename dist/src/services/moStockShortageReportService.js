"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNAPPROVED_PO_ALERT_COOLDOWN_MS = exports.unapprovedPoAlertCooldown = void 0;
exports.checkAndAlertUnapprovedPurchaseOrders = checkAndAlertUnapprovedPurchaseOrders;
exports.generateMoStockShortageReport = generateMoStockShortageReport;
exports.updateMoStockShortageAutomationSettings = updateMoStockShortageAutomationSettings;
exports.renderMoStockShortageReportHtml = renderMoStockShortageReportHtml;
exports.sendDailyMoStockShortageReport = sendDailyMoStockShortageReport;
const odooClient_1 = require("./odooClient");
const boardProductClassifier_1 = require("./boardProductClassifier");
const repositories_1 = require("../models/repositories");
const poJobSummaryAuditService_1 = require("./poJobSummaryAuditService");
const mailTransport_1 = require("./mailTransport");
const logService_1 = require("./logService");
let cachedSummary = null;
const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
exports.unapprovedPoAlertCooldown = new Map();
exports.UNAPPROVED_PO_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
/**
 * Checks if any required Purchase Orders linked to active Manufacturing Orders
 * (ready to start or in progress on the shop floor) are awaiting approval in Odoo.
 * If found, logs a note in Odoo chatter tagging Charles and Leoivard to check and approve.
 */
async function checkAndAlertUnapprovedPurchaseOrders(client, activeMos, soPartnerMap, options = {}) {
    const resultByMoId = new Map();
    if (!activeMos.length)
        return resultByMoId;
    const targetCompanyId = await client.getTargetCompanyIdValue();
    const originList = [
        ...new Set(activeMos
            .flatMap((mo) => [mo.origin ? String(mo.origin).trim() : '', mo.name ? String(mo.name).trim() : ''])
            .filter(Boolean)),
    ];
    if (!originList.length)
        return resultByMoId;
    let candidatePos = [];
    try {
        candidatePos = await client.searchReadRecords('purchase.order', {
            domain: [
                ['company_id', '=', targetCompanyId],
                ['origin', 'in', originList],
                ['state', 'in', ['draft', 'sent', 'to approve']],
            ],
            fields: ['id', 'name', 'state', 'origin', 'partner_id'],
            limit: 500,
            order: 'id desc',
        });
    }
    catch (err) {
        console.warn('[UnapprovedPoCheck] Failed to query purchase orders:', err);
        return resultByMoId;
    }
    if (!candidatePos.length)
        return resultByMoId;
    const posByOrigin = new Map();
    for (const po of candidatePos) {
        const orig = po.origin ? String(po.origin).trim() : '';
        if (orig) {
            const list = posByOrigin.get(orig) || [];
            list.push(po);
            posByOrigin.set(orig, list);
        }
    }
    // Pre-fetch Charles and Leoivard users for chatter mentions
    let charlesUser = null;
    let leoivardUser = null;
    if (!options.skipChatterAlert) {
        [charlesUser, leoivardUser] = await Promise.all([
            (0, poJobSummaryAuditService_1.findOdooUserByTerm)(client, 'Charles').catch(() => null),
            (0, poJobSummaryAuditService_1.findOdooUserByTerm)(client, 'Leoivard').catch(() => null),
        ]);
    }
    const charlesMention = charlesUser?.partnerId
        ? `<a href="#" data-oe-model="res.partner" data-oe-id="${charlesUser.partnerId}">@${charlesUser.name}</a>`
        : '@Charles';
    const leoivardMention = leoivardUser?.partnerId
        ? `<a href="#" data-oe-model="res.partner" data-oe-id="${leoivardUser.partnerId}">@${leoivardUser.name}</a>`
        : '@Leoivard Ongule';
    const notifyPartnerIds = [charlesUser?.partnerId, leoivardUser?.partnerId].filter(Boolean);
    const now = Date.now();
    for (const mo of activeMos) {
        const moOrigin = mo.origin ? String(mo.origin).trim() : '';
        const moName = mo.name ? String(mo.name).trim() : '';
        const clientName = moOrigin ? soPartnerMap.get(moOrigin)?.partnerName || 'Client' : 'Client';
        const matchedPos = [];
        if (moOrigin && posByOrigin.has(moOrigin)) {
            matchedPos.push(...posByOrigin.get(moOrigin));
        }
        if (moName && posByOrigin.has(moName)) {
            for (const p of posByOrigin.get(moName)) {
                if (!matchedPos.some((item) => item.id === p.id)) {
                    matchedPos.push(p);
                }
            }
        }
        if (!matchedPos.length)
            continue;
        const unapprovedItems = matchedPos.map((p) => ({
            id: p.id,
            name: p.name,
            state: p.state,
            supplierName: Array.isArray(p.partner_id) ? p.partner_id[1] : 'Supplier',
        }));
        resultByMoId.set(mo.id, unapprovedItems);
        if (options.skipChatterAlert)
            continue;
        for (const po of matchedPos) {
            const dedupeKey = `${po.id}:${mo.id}`;
            const lastAlertedAt = exports.unapprovedPoAlertCooldown.get(dedupeKey) || 0;
            if (!options.forceAlert && now - lastAlertedAt < exports.UNAPPROVED_PO_ALERT_COOLDOWN_MS) {
                continue;
            }
            const moStateLabel = mo.state === 'progress' ? 'IN PROGRESS' : 'READY TO START (Confirmed)';
            const poChatterHtml = `
<p>⚠️ <strong>PO Approval Check Required (${charlesMention} ${leoivardMention}):</strong></p>
<p>Manufacturing Order <strong>${mo.name}</strong> (${clientName}) is <strong>${moStateLabel}</strong> on the shop floor, but this Purchase Order <strong>${po.name}</strong> has not yet been approved (current state: <em>${po.state}</em>).</p>
<p>Please check if this Purchase Order needs to be approved immediately so production and materials are not held up.</p>
`.trim();
            const moChatterHtml = `
<p>⚠️ <strong>Purchase Order Awaiting Approval:</strong></p>
<p>Linked Purchase Order <strong>${po.name}</strong> is in state <em>${po.state}</em> (not yet approved). Alerted ${charlesMention} and ${leoivardMention} to check and approve.</p>
`.trim();
            try {
                await client.postModelChatterMessage('purchase.order', po.id, poChatterHtml, notifyPartnerIds.length ? notifyPartnerIds : undefined);
                await client.postModelChatterMessage('mrp.production', mo.id, moChatterHtml);
                exports.unapprovedPoAlertCooldown.set(dedupeKey, now);
                await (0, logService_1.logEvent)('info', 'Unapproved PO alert logged to chatter for Charles and Leoivard', {
                    poId: po.id,
                    poName: po.name,
                    poState: po.state,
                    moId: mo.id,
                    moName: mo.name,
                    moState: mo.state,
                    recipients: ['Charles', 'Leoivard Ongule'],
                }).catch((e) => console.warn('[UnapprovedPoAlert] Failed to write event log:', e));
            }
            catch (err) {
                console.warn(`[UnapprovedPoAlert] Failed to post chatter alert for PO ${po.name} / MO ${mo.name}:`, err);
            }
        }
    }
    return resultByMoId;
}
async function generateMoStockShortageReport(client, options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && cachedSummary && cachedSummary.expiresAt > now) {
        return cachedSummary.data;
    }
    const settings = options.settings || (await (0, repositories_1.getSettings)());
    const odooClient = client || new odooClient_1.OdooClient(settings.odoo);
    const targetCompanyId = await odooClient.getTargetCompanyIdValue();
    const warehouseId = Number(settings.stock?.warehouseId || 0);
    // 1. Fetch active manufacturing orders in confirmed/progress state for target company
    const rawMos = await odooClient.searchReadRecords('mrp.production', {
        domain: [
            ['company_id', '=', targetCompanyId],
            ['state', 'in', ['confirmed', 'progress', 'to_close']],
        ],
        fields: ['id', 'name', 'state', 'origin', 'product_id', 'product_qty'],
        limit: 500,
        order: 'id desc',
    });
    // Enforce company isolation: exclude Company 3 / 'VA/' prefix
    const activeMos = rawMos.filter((mo) => {
        const name = String(mo.name || '').trim().toUpperCase();
        return !name.startsWith('VA/') && !name.startsWith('VA:');
    });
    const automationEntry = settings.mail?.automations?.find((a) => a.systemKey === 'mo-stock-shortage-report');
    const automationSettings = {
        enabled: automationEntry ? automationEntry.enabled : true,
        frequency: automationEntry ? automationEntry.frequency : 'daily',
        hour: automationEntry ? automationEntry.hour : 8,
        recipients: automationEntry ? automationEntry.recipients : '',
        lastSentAt: automationEntry ? automationEntry.lastSentAt : '',
    };
    if (!activeMos.length) {
        const emptySummary = {
            generatedAt: new Date().toISOString(),
            totalActiveMosScanned: 0,
            totalMosLackingStock: 0,
            criticalBoardMismatchesCount: 0,
            awaitingBoardIntakeCount: 0,
            pendingReceiptCount: 0,
            unprocuredHardwareCount: 0,
            totalUnapprovedPosCount: 0,
            automationSettings,
            orders: [],
        };
        cachedSummary = { data: emptySummary, expiresAt: now + SUMMARY_CACHE_TTL_MS };
        return emptySummary;
    }
    const moIds = activeMos.map((mo) => mo.id);
    // 2. Fetch origins for sales orders to resolve client partner and salesperson
    const origins = [
        ...new Set(activeMos
            .map((mo) => (mo.origin ? String(mo.origin).trim() : ''))
            .filter(Boolean)),
    ];
    const soPartnerMap = new Map();
    if (origins.length > 0) {
        const soRecords = await odooClient.searchReadRecords('sale.order', {
            domain: [
                ['company_id', '=', targetCompanyId],
                ['name', 'in', origins],
            ],
            fields: ['name', 'partner_id', 'user_id'],
            limit: 1000,
        });
        for (const so of soRecords) {
            const pId = Array.isArray(so.partner_id) ? so.partner_id[0] : 0;
            const pName = Array.isArray(so.partner_id) ? so.partner_id[1] : 'Unknown Client';
            const spName = Array.isArray(so.user_id) ? so.user_id[1] : 'Unassigned';
            if (pId !== 350 && !pName.toUpperCase().includes('URBAN VIBE 2')) {
                soPartnerMap.set(so.name, {
                    partnerId: pId,
                    partnerName: pName,
                    salesperson: spName,
                });
            }
        }
    }
    // 3. Check for Unapproved Purchase Orders on Active / In-Progress MOs and Alert Charles & Leoivard
    const unapprovedPosByMoId = await checkAndAlertUnapprovedPurchaseOrders(odooClient, activeMos, soPartnerMap, { skipChatterAlert: options.skipChatterAlert });
    // 4. Fetch component stock moves for active MOs
    const rawMoves = await odooClient.getBulkManufacturingOrderComponents(moIds);
    const openReceiptsByProductId = new Map();
    try {
        const incomingDomain = [
            ['company_id', '=', targetCompanyId],
            ['picking_type_code', '=', 'incoming'],
            ['state', 'in', ['draft', 'waiting', 'confirmed', 'assigned']],
        ];
        if (warehouseId > 0) {
            try {
                const verifiedWh = await odooClient.getVerifiedTargetWarehouse(warehouseId);
                incomingDomain.push(['picking_type_id.warehouse_id', '=', verifiedWh.id]);
            }
            catch (_) { }
        }
        const openPickings = await odooClient.searchReadRecords('stock.picking', {
            domain: incomingDomain,
            fields: ['id', 'name', 'partner_id', 'state', 'scheduled_date'],
            limit: 300,
            order: 'scheduled_date asc, id asc',
        });
        if (openPickings.length > 0) {
            const pickingIds = openPickings.map((p) => p.id);
            const receiptMoves = await odooClient.searchReadRecords('stock.move', {
                domain: [
                    ['picking_id', 'in', pickingIds],
                    ['state', 'not in', ['done', 'cancel']],
                ],
                fields: ['picking_id', 'product_id', 'product_uom_qty', 'quantity'],
                limit: 2000,
            });
            const pickingMap = new Map(openPickings.map((p) => [p.id, p]));
            for (const rm of receiptMoves) {
                const pId = Array.isArray(rm.picking_id) ? rm.picking_id[0] : 0;
                const prodId = Array.isArray(rm.product_id) ? rm.product_id[0] : 0;
                const picking = pickingMap.get(pId);
                if (prodId && picking) {
                    const supplierName = Array.isArray(picking.partner_id) ? picking.partner_id[1] : '';
                    const scheduledDate = picking.scheduled_date ? String(picking.scheduled_date).split(' ')[0] : 'Pending';
                    const items = openReceiptsByProductId.get(prodId) || [];
                    items.push({
                        receiptId: picking.id,
                        receiptName: picking.name,
                        supplierName,
                        scheduledDate,
                        state: picking.state,
                        productId: prodId,
                        qtyExpected: Number(rm.product_uom_qty || 0),
                    });
                    openReceiptsByProductId.set(prodId, items);
                }
            }
        }
    }
    catch (err) {
        console.warn('[MoStockShortage] Failed to fetch open receipts:', err);
    }
    // 6. Fetch recent board intake logs from MySQL / SQLite
    const recentBoardIntakes = options.boardIntakes || (await (0, repositories_1.getRecentBoardIntakeForAudit)(1000));
    // Group logged boards by partner_id and by normalized customer name
    const boardsByPartnerId = new Map();
    const boardsByCustomerName = new Map();
    for (const entry of recentBoardIntakes) {
        if (entry.partner_id) {
            const list = boardsByPartnerId.get(entry.partner_id) || [];
            list.push(entry);
            boardsByPartnerId.set(entry.partner_id, list);
        }
        const normCust = String(entry.customer_name || '').trim().toLowerCase();
        if (normCust) {
            const list = boardsByCustomerName.get(normCust) || [];
            list.push(entry);
            boardsByCustomerName.set(normCust, list);
        }
    }
    // Group moves by MO
    const movesByMoId = new Map();
    for (const move of rawMoves) {
        const mId = Array.isArray(move.raw_material_production_id)
            ? move.raw_material_production_id[0]
            : Number(move.raw_material_production_id);
        if (!mId)
            continue;
        const list = movesByMoId.get(mId) || [];
        list.push(move);
        movesByMoId.set(mId, list);
    }
    const ordersWithShortage = [];
    let totalBoardMismatches = 0;
    let totalAwaitingBoardIntake = 0;
    let totalPendingReceipts = 0;
    let totalUnprocuredHardware = 0;
    let totalUnapprovedPos = 0;
    for (const mo of activeMos) {
        const moves = movesByMoId.get(mo.id) || [];
        const origin = mo.origin ? String(mo.origin).trim() : '';
        const soInfo = origin ? soPartnerMap.get(origin) : null;
        const clientId = soInfo?.partnerId || null;
        const clientName = soInfo?.partnerName || 'Unknown / Internal Client';
        const salespersonName = soInfo?.salesperson || 'Unassigned';
        const unapprovedPos = unapprovedPosByMoId.get(mo.id) || [];
        const hasUnapprovedPo = unapprovedPos.length > 0;
        if (hasUnapprovedPo) {
            totalUnapprovedPos += unapprovedPos.length;
        }
        const missingComponents = [];
        // Client's logged boards
        const clientLoggedBoards = [];
        if (clientId && boardsByPartnerId.has(clientId)) {
            clientLoggedBoards.push(...boardsByPartnerId.get(clientId));
        }
        const normClient = clientName.toLowerCase();
        if (boardsByCustomerName.has(normClient)) {
            for (const entry of boardsByCustomerName.get(normClient)) {
                if (!clientLoggedBoards.some((e) => e.id === entry.id)) {
                    clientLoggedBoards.push(entry);
                }
            }
        }
        for (const move of moves) {
            const requiredQty = Number(move.product_uom_qty || 0);
            const availableQty = Number(move.quantity || 0);
            const state = move.state;
            const productName = Array.isArray(move.product_id) ? move.product_id[1] : '';
            const productId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
            const uom = 'Units';
            if (requiredQty <= 0)
                continue;
            if (state === 'done')
                continue;
            if (state === 'assigned' && availableQty >= requiredQty)
                continue;
            if ((0, boardProductClassifier_1.isStockExemptEdgeBandingService)(productName))
                continue;
            const missingQty = Math.max(0, requiredQty - availableQty);
            if (missingQty <= 0)
                continue;
            const isBoard = (0, boardProductClassifier_1.isBoardProductName)(productName);
            let rootCause = 'unprocured_hardware';
            let badgeLabel = 'NO RECEIPT';
            let badgeColor = 'secondary';
            let explanation = 'No incoming vendor receipt or purchase order found';
            let mismatchDetails = undefined;
            let receiptDetails = undefined;
            if (isBoard) {
                // Step A: Check if a board of the same color was logged with WRONG SUBSTRATE OR SIZE
                let detectedMismatch = false;
                for (const logged of clientLoggedBoards) {
                    const mismatch = (0, boardProductClassifier_1.detectBoardMismatch)(productName, logged.product_name);
                    if (mismatch && mismatch.hasMismatch) {
                        detectedMismatch = true;
                        rootCause = 'board_mismatch';
                        badgeLabel = 'WRONG BOARD LOGGED';
                        badgeColor = 'danger';
                        explanation = `Client has "${logged.product_name}" logged (${logged.quantity} sheets on ${String(logged.created_at || '').split('T')[0] || String(logged.created_at || '').split(' ')[0]}), but MO requires "${productName}". ${mismatch.description}.`;
                        mismatchDetails = {
                            loggedProductName: logged.product_name,
                            loggedQuantity: logged.quantity,
                            loggedDate: String(logged.created_at || ''),
                            discrepancy: mismatch.description,
                        };
                        totalBoardMismatches += 1;
                        break;
                    }
                }
                // Step B: If no board mismatch, check if an open incoming vendor receipt exists
                if (!detectedMismatch) {
                    const receipts = openReceiptsByProductId.get(productId);
                    if (receipts && receipts.length > 0) {
                        const firstReceipt = receipts[0];
                        rootCause = 'pending_receipt';
                        badgeLabel = 'RECEIPT PENDING';
                        badgeColor = 'warning';
                        explanation = `Incoming transfer ${firstReceipt.receiptName} (${firstReceipt.state}) from ${firstReceipt.supplierName || 'vendor'} pending validation in Receipt App`;
                        receiptDetails = firstReceipt;
                        totalPendingReceipts += 1;
                    }
                    else {
                        // Step C: Awaiting board intake
                        rootCause = 'awaiting_board_intake';
                        badgeLabel = 'AWAITING BOARD INTAKE';
                        badgeColor = 'info';
                        explanation = `Board material not yet logged in Board Intake App for client "${clientName}"`;
                        totalAwaitingBoardIntake += 1;
                    }
                }
            }
            else {
                // Non-board (Hardware)
                const receipts = openReceiptsByProductId.get(productId);
                if (receipts && receipts.length > 0) {
                    const firstReceipt = receipts[0];
                    rootCause = 'pending_receipt';
                    badgeLabel = 'RECEIPT PENDING';
                    badgeColor = 'warning';
                    explanation = `Incoming transfer ${firstReceipt.receiptName} (${firstReceipt.state}) from ${firstReceipt.supplierName || 'vendor'} pending validation in Receipt App`;
                    receiptDetails = firstReceipt;
                    totalPendingReceipts += 1;
                }
                else {
                    rootCause = 'unprocured_hardware';
                    badgeLabel = 'UNPROCURED / NO RECEIPT';
                    badgeColor = 'secondary';
                    explanation = `Item not yet received in Receipt App / No open vendor receipt found`;
                    totalUnprocuredHardware += 1;
                }
            }
            missingComponents.push({
                id: move.id,
                productId,
                productName,
                isBoard,
                requiredQty,
                reservedQty: availableQty,
                missingQty,
                uom,
                rootCause,
                badgeLabel,
                badgeColor,
                explanation,
                mismatchDetails,
                receiptDetails,
            });
        }
        if (missingComponents.length > 0 || hasUnapprovedPo) {
            ordersWithShortage.push({
                moId: mo.id,
                moName: mo.name,
                moState: mo.state,
                origin,
                clientId,
                clientName,
                salespersonName,
                totalComponentsNeeded: moves.length,
                missingComponents,
                hasBoardMismatch: missingComponents.some((c) => c.rootCause === 'board_mismatch'),
                hasAwaitingBoardIntake: missingComponents.some((c) => c.rootCause === 'awaiting_board_intake'),
                hasPendingReceipt: missingComponents.some((c) => c.rootCause === 'pending_receipt'),
                hasUnprocuredHardware: missingComponents.some((c) => c.rootCause === 'unprocured_hardware'),
                hasUnapprovedPo,
                unapprovedPos,
            });
        }
    }
    // Sort orders so that critical board mismatches and unapproved POs appear at the very top!
    ordersWithShortage.sort((a, b) => {
        if (a.hasBoardMismatch && !b.hasBoardMismatch)
            return -1;
        if (!a.hasBoardMismatch && b.hasBoardMismatch)
            return 1;
        if (a.hasUnapprovedPo && !b.hasUnapprovedPo)
            return -1;
        if (!a.hasUnapprovedPo && b.hasUnapprovedPo)
            return 1;
        if (a.hasAwaitingBoardIntake && !b.hasAwaitingBoardIntake)
            return -1;
        if (!a.hasAwaitingBoardIntake && b.hasAwaitingBoardIntake)
            return 1;
        return b.missingComponents.length - a.missingComponents.length;
    });
    const summary = {
        generatedAt: new Date().toISOString(),
        totalActiveMosScanned: activeMos.length,
        totalMosLackingStock: ordersWithShortage.length,
        criticalBoardMismatchesCount: totalBoardMismatches,
        awaitingBoardIntakeCount: totalAwaitingBoardIntake,
        pendingReceiptCount: totalPendingReceipts,
        unprocuredHardwareCount: totalUnprocuredHardware,
        totalUnapprovedPosCount: totalUnapprovedPos,
        automationSettings,
        orders: ordersWithShortage,
    };
    cachedSummary = { data: summary, expiresAt: now + SUMMARY_CACHE_TTL_MS };
    return summary;
}
async function updateMoStockShortageAutomationSettings(input) {
    const settings = await (0, repositories_1.getSettings)();
    let found = false;
    const updatedList = [];
    for (const a of settings.mail.automations) {
        if (a.systemKey === 'mo-stock-shortage-report' || a.id === 'mo-stock-shortage-report') {
            if (found) {
                // Skip duplicate
                continue;
            }
            found = true;
            updatedList.push({
                ...a,
                id: 'mo-stock-shortage-report',
                name: 'Daily MO stock shortage & board mismatch report',
                systemKey: 'mo-stock-shortage-report',
                enabled: input.enabled !== undefined ? input.enabled : a.enabled,
                frequency: input.frequency || a.frequency,
                hour: input.hour !== undefined ? Math.min(23, Math.max(0, input.hour)) : a.hour,
                interval: input.interval !== undefined ? Math.max(1, input.interval) : a.interval,
                recipients: input.recipients !== undefined ? input.recipients.trim() : a.recipients,
            });
        }
        else {
            updatedList.push(a);
        }
    }
    if (!found) {
        updatedList.push({
            id: 'mo-stock-shortage-report',
            name: 'Daily MO stock shortage & board mismatch report',
            systemKey: 'mo-stock-shortage-report',
            enabled: input.enabled !== undefined ? input.enabled : true,
            frequency: input.frequency || 'daily',
            interval: input.interval || 1,
            dayOfWeek: 1,
            hour: input.hour !== undefined ? Math.min(23, Math.max(0, input.hour)) : 8,
            recipients: input.recipients || '',
            subject: 'Daily Manufacturing Orders Stock Shortage & Board Audit Report',
            body: '',
            lastSentAt: '',
        });
    }
    settings.mail.automations = updatedList;
    await (0, repositories_1.saveSettings)({
        baseUrl: settings.odoo.baseUrl,
        database: settings.odoo.database,
        username: settings.odoo.username,
        apiKey: '',
        keepExistingApiKey: true,
        mail: settings.mail,
    });
    // Clear RAM cache so updated settings are reflected immediately
    cachedSummary = null;
    await (0, logService_1.logEvent)('info', 'Updated MO stock shortage report automation settings', {
        enabled: input.enabled,
        frequency: input.frequency,
        hour: input.hour,
        recipients: input.recipients,
    });
    return settings.mail.automations.find((a) => a.systemKey === 'mo-stock-shortage-report');
}
function renderMoStockShortageReportHtml(summary, options = { isWebPage: true }) {
    const nairobiDate = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Nairobi',
        dateStyle: 'full',
        timeStyle: 'short',
    }).format(new Date(summary.generatedAt));
    const criticalOrders = summary.orders.filter((o) => o.hasBoardMismatch);
    const unapprovedPoOrders = summary.orders.filter((o) => o.hasUnapprovedPo);
    const autoFreq = summary.automationSettings?.frequency || 'daily';
    const autoHour = summary.automationSettings?.hour ?? 8;
    const autoEnabled = summary.automationSettings?.enabled ?? true;
    const autoRecipients = summary.automationSettings?.recipients || '';
    const configBarHtml = options.isWebPage
        ? `
    <!-- Top Configuration & Actions Bar -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <span style="font-size: 13px; font-weight: bold; color: #2d3748;">📅 Automated Delivery:</span>
        <span style="font-size: 12px; background: ${autoEnabled ? '#c6f6d5' : '#fed7d7'}; color: ${autoEnabled ? '#22543d' : '#742a2a'}; padding: 2px 8px; border-radius: 12px; font-weight: 600;">
          ${autoEnabled ? 'Active' : 'Paused'}
        </span>
        <span style="font-size: 12px; color: #4a5568;">
          Schedule: <strong>${autoFreq.toUpperCase()} at ${String(autoHour).padStart(2, '0')}:00 Nairobi Time</strong>
        </span>
        <span style="font-size: 12px; color: #718096;">
          | Recipients: <strong>${autoRecipients ? autoRecipients.split(/[,;]+/).length + ' user(s)' : 'Default Administrators'}</strong>
        </span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <button type="button" onclick="toggleConfigPanel()" style="background: #ffffff; border: 1px solid #cbd5e0; color: #2d3748; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
          ⚙️ Change Users / Time
        </button>
        <form method="POST" action="/reports/mo-stock-shortage/send" style="display: inline; margin: 0;">
          <button type="submit" style="background: #2b6cb0; border: none; color: #ffffff; padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
            ✉️ Send Report Now
          </button>
        </form>
        <a href="/reports/mo-stock-shortage?refresh=true" style="background: #edf2f7; border: 1px solid #e2e8f0; color: #4a5568; padding: 6px 12px; border-radius: 6px; font-size: 12px; text-decoration: none; font-weight: 600;">
          🔄 Live Refresh
        </a>
      </div>
    </div>

    <!-- Collapsible Settings Panel -->
    <div id="configPanel" style="display: none; background: #ebf8ff; border: 1px solid #bee3f8; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <h3 style="margin: 0; font-size: 15px; color: #2c5282;">
          ⚙️ Configure Delivery Schedule & Recipient Users
        </h3>
        <button type="button" onclick="toggleConfigPanel()" style="background: none; border: none; font-size: 16px; cursor: pointer; color: #718096;">✕</button>
      </div>
      <p style="margin: 0 0 14px 0; font-size: 12px; color: #2b6cb0;">
        Set which users receive this daily stock shortage & board mismatch report, the Nairobi send hour, and frequency.
      </p>
      <form method="POST" action="/reports/mo-stock-shortage/settings">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display: block; font-size: 12px; font-weight: bold; color: #2d3748; margin-bottom: 4px;">Frequency</label>
            <select name="frequency" style="width: 100%; padding: 6px 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px;">
              <option value="daily" ${autoFreq === 'daily' ? 'selected' : ''}>Daily</option>
              <option value="weekly" ${autoFreq === 'weekly' ? 'selected' : ''}>Weekly</option>
              <option value="hourly" ${autoFreq === 'hourly' ? 'selected' : ''}>Hourly</option>
            </select>
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: bold; color: #2d3748; margin-bottom: 4px;">Send Hour (0–23, Nairobi Time)</label>
            <input type="number" min="0" max="23" name="hour" value="${autoHour}" style="width: 100%; padding: 6px 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px;" />
          </div>
          <div>
            <label style="display: block; font-size: 12px; font-weight: bold; color: #2d3748; margin-bottom: 4px;">Status</label>
            <select name="enabled" style="width: 100%; padding: 6px 8px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px;">
              <option value="true" ${autoEnabled ? 'selected' : ''}>Active (Scheduled)</option>
              <option value="false" ${!autoEnabled ? 'selected' : ''}>Paused</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom: 14px;">
          <label style="display: block; font-size: 12px; font-weight: bold; color: #2d3748; margin-bottom: 4px;">
            Recipient Email Addresses (comma separated)
          </label>
          <input type="text" name="recipients" id="recipientsInput" value="${autoRecipients}" placeholder="charles@urbanvibeinteriordesign.co.ke, leoivard@urbanvibeinteriordesign.co.ke" style="width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #cbd5e0; border-radius: 4px; font-size: 13px;" />
          <div style="margin-top: 6px; font-size: 11px; color: #4a5568;">
            Quick add:
            <button type="button" onclick="addRecipient('charles@urbanvibeinteriordesign.co.ke')" style="background: none; border: 1px solid #cbd5e0; border-radius: 12px; padding: 1px 8px; font-size: 11px; cursor: pointer; color: #2b6cb0;">+ Charles</button>
            <button type="button" onclick="addRecipient('leoivard@urbanvibeinteriordesign.co.ke')" style="background: none; border: 1px solid #cbd5e0; border-radius: 12px; padding: 1px 8px; font-size: 11px; cursor: pointer; color: #2b6cb0;">+ Leoivard</button>
            <button type="button" onclick="addRecipient('raphael@urbanvibeinteriordesign.co.ke')" style="background: none; border: 1px solid #cbd5e0; border-radius: 12px; padding: 1px 8px; font-size: 11px; cursor: pointer; color: #2b6cb0;">+ Raphael</button>
            <button type="button" onclick="addRecipient('dbadmin@urbanvibeinteriordesign.co.ke')" style="background: none; border: 1px solid #cbd5e0; border-radius: 12px; padding: 1px 8px; font-size: 11px; cursor: pointer; color: #2b6cb0;">+ dbadmin</button>
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button type="submit" style="background: #2b6cb0; color: #ffffff; border: none; padding: 8px 16px; border-radius: 4px; font-size: 13px; font-weight: bold; cursor: pointer;">
            💾 Save Schedule & Recipients
          </button>
          <button type="button" onclick="toggleConfigPanel()" style="background: #ffffff; color: #4a5568; border: 1px solid #cbd5e0; padding: 8px 14px; border-radius: 4px; font-size: 13px; cursor: pointer;">
            Cancel
          </button>
        </div>
      </form>
    </div>
  `
        : '';
    const criticalAlertSection = criticalOrders.length > 0
        ? `
    <div style="background-color: #fff5f5; border: 2px solid #e53e3e; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="background-color: #e53e3e; color: #ffffff; font-weight: bold; font-size: 11px; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; margin-right: 10px;">
          CRITICAL ALERT
        </span>
        <h3 style="margin: 0; color: #9b2c2c; font-size: 16px;">
          Wrong Type / Size of Board Logged for ${criticalOrders.length} Manufacturing Order${criticalOrders.length > 1 ? 's' : ''}!
        </h3>
      </div>
      <p style="margin: 0 0 12px 0; color: #742a2a; font-size: 13px;">
        Action required immediately: A board was entered into the Board Intake App that shares the same color family as the required material, but has an <strong>incompatible substrate or thickness</strong> (e.g. White Particle vs White MDF). Verify physical stock before cutting begins.
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; background: #ffffff; border-radius: 4px; overflow: hidden;">
        <thead>
          <tr style="background: #fed7d7; color: #742a2a; text-align: left;">
            <th style="padding: 8px 10px;">MO / Origin</th>
            <th style="padding: 8px 10px;">Client</th>
            <th style="padding: 8px 10px;">Required Board</th>
            <th style="padding: 8px 10px;">Logged Board in Intake</th>
            <th style="padding: 8px 10px;">Discrepancy</th>
          </tr>
        </thead>
        <tbody>
          ${criticalOrders
            .flatMap((o) => o.missingComponents
            .filter((c) => c.rootCause === 'board_mismatch' && c.mismatchDetails)
            .map((c) => `
            <tr style="border-bottom: 1px solid #feb2b2;">
              <td style="padding: 8px 10px; font-weight: bold; color: #2d3748;">
                ${o.moName}<br/><span style="color: #718096; font-size: 11px; font-weight: normal;">${o.origin || 'No SO'}</span>
              </td>
              <td style="padding: 8px 10px; color: #2d3748;">${o.clientName}</td>
              <td style="padding: 8px 10px; color: #c53030; font-weight: bold;">
                ${c.productName} (${c.missingQty} sh)
              </td>
              <td style="padding: 8px 10px; color: #2b6cb0;">
                ${c.mismatchDetails.loggedProductName} (${c.mismatchDetails.loggedQuantity} sh)
              </td>
              <td style="padding: 8px 10px; color: #9b2c2c; font-weight: 500;">
                ${c.mismatchDetails.discrepancy}
              </td>
            </tr>
          `))
            .join('')}
        </tbody>
      </table>
    </div>
  `
        : '';
    const unapprovedPoAlertSection = unapprovedPoOrders.length > 0
        ? `
    <div style="background-color: #fffaf0; border: 2px solid #dd6b20; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
      <div style="display: flex; align-items: center; margin-bottom: 8px;">
        <span style="background-color: #dd6b20; color: #ffffff; font-weight: bold; font-size: 11px; padding: 4px 8px; border-radius: 4px; text-transform: uppercase; margin-right: 10px;">
          PO APPROVAL REQUIRED
        </span>
        <h3 style="margin: 0; color: #7b341e; font-size: 16px;">
          ${unapprovedPoOrders.length} Active Manufacturing Order${unapprovedPoOrders.length > 1 ? 's' : ''} Waiting on Unapproved Purchase Orders!
        </h3>
      </div>
      <p style="margin: 0 0 12px 0; color: #7b341e; font-size: 13px;">
        These manufacturing orders are ready or in progress on the shop floor, but their required Purchase Orders have not yet been approved. <strong>Charles and Leoivard have been tagged in Odoo log notes</strong> to check if the PO needs to be approved immediately.
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px; background: #ffffff; border-radius: 4px; overflow: hidden;">
        <thead>
          <tr style="background: #feebc8; color: #7b341e; text-align: left;">
            <th style="padding: 8px 10px;">MO / Status</th>
            <th style="padding: 8px 10px;">Client</th>
            <th style="padding: 8px 10px;">Unapproved Purchase Order</th>
            <th style="padding: 8px 10px;">Supplier</th>
            <th style="padding: 8px 10px;">PO State</th>
          </tr>
        </thead>
        <tbody>
          ${unapprovedPoOrders
            .flatMap((o) => o.unapprovedPos.map((po) => `
            <tr style="border-bottom: 1px solid #fbd38d;">
              <td style="padding: 8px 10px; font-weight: bold; color: #2d3748;">
                ${o.moName} (${o.moState})<br/><span style="color: #718096; font-size: 11px; font-weight: normal;">${o.origin || 'No SO'}</span>
              </td>
              <td style="padding: 8px 10px; color: #2d3748;">${o.clientName}</td>
              <td style="padding: 8px 10px; color: #c05621; font-weight: bold;">
                ${po.name}
              </td>
              <td style="padding: 8px 10px; color: #4a5568;">
                ${po.supplierName}
              </td>
              <td style="padding: 8px 10px;">
                <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #feebc8; color: #9c4221; font-weight: bold; text-transform: uppercase;">
                  ${po.state}
                </span>
              </td>
            </tr>
          `))
            .join('')}
        </tbody>
      </table>
    </div>
  `
        : '';
    const moCardsHtml = summary.orders.length === 0
        ? `
    <div style="background: #f0fff4; border: 1px solid #9ae6b4; border-radius: 8px; padding: 24px; text-align: center; color: #22543d;">
      <h3 style="margin: 0 0 6px 0; font-size: 18px;">All Active Manufacturing Orders Have 100% Stock Reserved!</h3>
      <p style="margin: 0; font-size: 13px; color: #276749;">There are no unreserved board shortages, pending receipt bottlenecks, board mismatches, or unapproved POs at this time.</p>
    </div>
  `
        : summary.orders
            .map((order) => {
            const statusBg = order.hasBoardMismatch
                ? '#fff5f5'
                : order.hasUnapprovedPo
                    ? '#fffaf0'
                    : '#ffffff';
            const borderCol = order.hasBoardMismatch
                ? '#feb2b2'
                : order.hasUnapprovedPo
                    ? '#fbd38d'
                    : '#e2e8f0';
            const unapprovedPill = order.hasUnapprovedPo
                ? order.unapprovedPos
                    .map((p) => `<span style="margin-left: 8px; font-size: 11px; color: #9c4221; background: #feebc8; padding: 2px 8px; border-radius: 12px; font-weight: bold;">⚠️ PO ${p.name} (${p.state})</span>`)
                    .join(' ')
                : '';
            const compRows = order.missingComponents
                .map((c) => {
                let badgeStyle = 'background-color: #e2e8f0; color: #4a5568;';
                if (c.badgeColor === 'danger')
                    badgeStyle = 'background-color: #fed7d7; color: #9b2c2c; font-weight: bold;';
                if (c.badgeColor === 'warning')
                    badgeStyle = 'background-color: #feebc8; color: #7b341e; font-weight: bold;';
                if (c.badgeColor === 'info')
                    badgeStyle = 'background-color: #bee3f8; color: #2c5282; font-weight: bold;';
                return `
              <tr style="border-bottom: 1px solid #edf2f7;">
                <td style="padding: 8px 12px; font-weight: 500; color: #2d3748;">
                  ${c.productName}
                </td>
                <td style="padding: 8px 12px; text-align: center;">
                  <span style="font-size: 11px; padding: 2px 6px; border-radius: 4px; background: ${c.isBoard ? '#ebf8ff' : '#f7fafc'}; color: ${c.isBoard ? '#2b6cb0' : '#4a5568'};">
                    ${c.isBoard ? 'Board' : 'Hardware'}
                  </span>
                </td>
                <td style="padding: 8px 12px; text-align: right; color: #e53e3e; font-weight: bold;">
                  ${c.missingQty} ${c.uom}
                </td>
                <td style="padding: 8px 12px; text-align: right; color: #718096; font-size: 11px;">
                  ${c.reservedQty} / ${c.requiredQty}
                </td>
                <td style="padding: 8px 12px;">
                  <span style="font-size: 10px; padding: 3px 8px; border-radius: 12px; text-transform: uppercase; ${badgeStyle}">
                    ${c.badgeLabel}
                  </span>
                  <div style="font-size: 11px; color: #718096; margin-top: 3px;">
                    ${c.explanation}
                  </div>
                </td>
              </tr>
            `;
            })
                .join('');
            return `
          <div style="background: ${statusBg}; border: 1px solid ${borderCol}; border-radius: 8px; margin-bottom: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <div style="padding: 12px 16px; background: ${order.hasBoardMismatch ? '#fff5f5' : order.hasUnapprovedPo ? '#fffaf0' : '#f7fafc'}; border-bottom: 1px solid ${borderCol}; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div>
                <span style="font-size: 15px; font-weight: bold; color: #1a202c;">${order.moName}</span>
                <span style="margin-left: 8px; font-size: 12px; color: #4a5568; background: #edf2f7; padding: 2px 6px; border-radius: 4px;">SO: ${order.origin || 'None'}</span>
                <span style="margin-left: 8px; font-size: 12px; color: #2b6cb0; font-weight: 500;">Client: ${order.clientName}</span>
                ${unapprovedPill}
              </div>
              <div style="font-size: 12px; color: #718096;">
                Salesperson: <strong>${order.salespersonName}</strong> | State: <strong>${order.moState}</strong>
              </div>
            </div>
            ${order.missingComponents.length > 0
                ? `
            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
              <thead>
                <tr style="background: #ffffff; border-bottom: 1px solid #e2e8f0; color: #718096; text-align: left;">
                  <th style="padding: 6px 12px;">Component Product</th>
                  <th style="padding: 6px 12px; text-align: center;">Type</th>
                  <th style="padding: 6px 12px; text-align: right;">Shortage</th>
                  <th style="padding: 6px 12px; text-align: right;">Reserved / Total</th>
                  <th style="padding: 6px 12px;">Root Cause & Status</th>
                </tr>
              </thead>
              <tbody>
                ${compRows}
              </tbody>
            </table>
            `
                : `
            <div style="padding: 10px 16px; font-size: 12px; color: #276749; background: #f0fff4;">
              All current components are reserved, but linked Purchase Order is unapproved.
            </div>
            `}
          </div>
        `;
        })
            .join('');
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily MO Stock Shortage & Board Audit Report</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7fafc; margin: 0; padding: 20px; color: #2d3748;">
  <div style="max-width: 960px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); padding: 24px; border: 1px solid #e2e8f0;">

    ${configBarHtml}

    <!-- Header -->
    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #edf2f7; padding-bottom: 16px; margin-bottom: 20px; flex-wrap: wrap;">
      <div>
        <h1 style="margin: 0 0 4px 0; font-size: 20px; color: #1a202c; letter-spacing: -0.5px;">
          URBAN VIBE INTERIOR DESIGN
        </h1>
        <h2 style="margin: 0; font-size: 15px; color: #4a5568; font-weight: normal;">
          Daily Manufacturing Orders Stock Shortage & Board Audit Report
        </h2>
      </div>
      <div style="text-align: right; font-size: 12px; color: #718096;">
        <div>Generated: <strong>${nairobiDate}</strong></div>
        <div>Scope: <strong>Urban Vibe Factory (WH/MO)</strong></div>
      </div>
    </div>

    <!-- KPI Summary Cards -->
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 24px;">
      <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; color: #718096; font-weight: bold;">MOs Lacking Stock</div>
        <div style="font-size: 20px; font-weight: bold; color: ${summary.totalMosLackingStock > 0 ? '#e53e3e' : '#38a169'}; margin-top: 4px;">
          ${summary.totalMosLackingStock} <span style="font-size: 11px; font-weight: normal; color: #a0aec0;">/ ${summary.totalActiveMosScanned}</span>
        </div>
      </div>
      <div style="background: ${summary.criticalBoardMismatchesCount > 0 ? '#fff5f5' : '#f7fafc'}; border: 1px solid ${summary.criticalBoardMismatchesCount > 0 ? '#feb2b2' : '#e2e8f0'}; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; color: ${summary.criticalBoardMismatchesCount > 0 ? '#9b2c2c' : '#718096'}; font-weight: bold;">Wrong Board Logged</div>
        <div style="font-size: 20px; font-weight: bold; color: ${summary.criticalBoardMismatchesCount > 0 ? '#e53e3e' : '#4a5568'}; margin-top: 4px;">
          ${summary.criticalBoardMismatchesCount}
        </div>
      </div>
      <div style="background: ${summary.totalUnapprovedPosCount > 0 ? '#fffaf0' : '#f7fafc'}; border: 1px solid ${summary.totalUnapprovedPosCount > 0 ? '#fbd38d' : '#e2e8f0'}; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; color: ${summary.totalUnapprovedPosCount > 0 ? '#9c4221' : '#718096'}; font-weight: bold;">Unapproved POs</div>
        <div style="font-size: 20px; font-weight: bold; color: ${summary.totalUnapprovedPosCount > 0 ? '#dd6b20' : '#4a5568'}; margin-top: 4px;">
          ${summary.totalUnapprovedPosCount}
        </div>
      </div>
      <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; color: #718096; font-weight: bold;">Awaiting Boards</div>
        <div style="font-size: 20px; font-weight: bold; color: #2b6cb0; margin-top: 4px;">
          ${summary.awaitingBoardIntakeCount}
        </div>
      </div>
      <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; color: #718096; font-weight: bold;">Pending Receipts</div>
        <div style="font-size: 20px; font-weight: bold; color: #dd6b20; margin-top: 4px;">
          ${summary.pendingReceiptCount}
        </div>
      </div>
      <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center;">
        <div style="font-size: 11px; text-transform: uppercase; color: #718096; font-weight: bold;">Unprocured</div>
        <div style="font-size: 20px; font-weight: bold; color: #718096; margin-top: 4px;">
          ${summary.unprocuredHardwareCount}
        </div>
      </div>
    </div>

    <!-- Critical Section (if any mismatches) -->
    ${criticalAlertSection}

    <!-- Unapproved POs Alert Section (if any unapproved POs) -->
    ${unapprovedPoAlertSection}

    <!-- Order Breakdown -->
    <h3 style="margin: 0 0 12px 0; font-size: 15px; color: #2d3748;">
      Manufacturing Orders Requiring Material Resolution (${summary.orders.length})
    </h3>
    ${moCardsHtml}

    <!-- Footer -->
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #edf2f7; font-size: 11px; color: #a0aec0; text-align: center;">
      Urban Vibe Odoo Reconciler & Shop Floor System &bull; Automatic daily stock verification &bull; Strictly operating for Company ID 1
    </div>

  </div>

  <script>
    function toggleConfigPanel() {
      var p = document.getElementById('configPanel');
      if (p) p.style.display = (p.style.display === 'none' || !p.style.display) ? 'block' : 'none';
    }
    function addRecipient(email) {
      var inp = document.getElementById('recipientsInput');
      if (!inp) return;
      var current = inp.value.trim();
      if (!current) {
        inp.value = email;
      } else {
        var list = current.split(/[,;]+/).map(function(s){ return s.trim(); });
        if (list.indexOf(email) === -1) {
          list.push(email);
          inp.value = list.join(', ');
        }
      }
    }
  </script>
</body>
</html>
  `;
}
async function sendDailyMoStockShortageReport(recipientOverride = []) {
    const [settings, users] = await Promise.all([(0, repositories_1.getSettings)(), (0, repositories_1.getApprovedAuthUsers)()]);
    const summary = await generateMoStockShortageReport(undefined, { forceRefresh: true });
    let recipients = recipientOverride.filter(Boolean);
    if (!recipients.length) {
        const automation = settings.mail.automations.find((a) => a.systemKey === 'mo-stock-shortage-report');
        if (automation?.recipients) {
            recipients = automation.recipients
                .split(/[;,]+/)
                .map((r) => r.trim())
                .filter(Boolean);
        }
    }
    if (!recipients.length) {
        const adminEmails = users
            .filter((u) => u.active && (u.role === 'admin' || /charles|leo(?:i)?vard|raphael/i.test(u.email)))
            .map((u) => u.email.trim())
            .filter(Boolean);
        recipients = [...new Set(adminEmails)];
    }
    if (!recipients.length) {
        recipients = ['charles@urbanvibeinteriordesign.co.ke', 'leoivard@urbanvibeinteriordesign.co.ke'];
    }
    const html = renderMoStockShortageReportHtml(summary, { isWebPage: false });
    const subjectPrefix = summary.criticalBoardMismatchesCount > 0 ? '⚠️ [ALERT] ' : '';
    const subject = `${subjectPrefix}Daily MO Stock Shortage & Board Audit: ${summary.totalMosLackingStock} Orders (${summary.criticalBoardMismatchesCount} Board Mismatches, ${summary.totalUnapprovedPosCount} Unapproved POs)`;
    const plainText = `Daily MO Stock Shortage & Board Audit Report\n`
        + `Generated: ${new Date(summary.generatedAt).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })}\n`
        + `Total Active MOs Scanned: ${summary.totalActiveMosScanned}\n`
        + `Total MOs Lacking Stock / Needing Action: ${summary.totalMosLackingStock}\n`
        + `Critical Board Mismatches: ${summary.criticalBoardMismatchesCount}\n`
        + `Unapproved Purchase Orders: ${summary.totalUnapprovedPosCount}\n`
        + `Awaiting Board Intake: ${summary.awaitingBoardIntakeCount}\n`
        + `Pending Receipt App: ${summary.pendingReceiptCount}\n`
        + `Unprocured Items: ${summary.unprocuredHardwareCount}\n\n`
        + (summary.orders.length === 0
            ? 'All active MOs have 100% stock reserved.'
            : summary.orders.map((o) => `* MO: ${o.moName} (SO: ${o.origin || '-'}) | Client: ${o.clientName} | Shortages: ${o.missingComponents.length} | Unapproved POs: ${o.unapprovedPos.length}`).join('\n'));
    await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
        to: recipients.join(', '),
        subject,
        text: plainText,
        html,
    });
    await (0, logService_1.logEvent)('info', 'Daily MO stock shortage report sent', {
        recipients,
        totalMosLackingStock: summary.totalMosLackingStock,
        criticalBoardMismatchesCount: summary.criticalBoardMismatchesCount,
        totalUnapprovedPosCount: summary.totalUnapprovedPosCount,
        awaitingBoardIntakeCount: summary.awaitingBoardIntakeCount,
        pendingReceiptCount: summary.pendingReceiptCount,
        unprocuredHardwareCount: summary.unprocuredHardwareCount,
    });
    return true;
}
