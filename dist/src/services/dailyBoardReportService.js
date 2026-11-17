"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDailyBoardReport = buildDailyBoardReport;
exports.renderDailyBoardReportPdf = renderDailyBoardReportPdf;
exports.sendDailyBoardReport = sendDailyBoardReport;
const pdfkit_1 = __importDefault(require("pdfkit"));
const odooClient_1 = require("./odooClient");
const boardProductClassifier_1 = require("./boardProductClassifier");
const repositories_1 = require("../models/repositories");
const cuttingBoMReconciliationService_1 = require("./cuttingBoMReconciliationService");
const workOrderQuantityReconciliationService_1 = require("./workOrderQuantityReconciliationService");
const poJobSummaryAuditService_1 = require("./poJobSummaryAuditService");
const env_1 = require("../utils/env");
const mailTransport_1 = require("./mailTransport");
const logService_1 = require("./logService");
function getNairobiDateString(dateObj = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(dateObj);
}
function formatDisplayDate(dateStr) {
    try {
        const d = new Date(`${dateStr}T12:00:00Z`);
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi',
            weekday: 'long',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        }).format(d);
    }
    catch {
        return dateStr;
    }
}
/**
 * Builds the complete daily report of boards logged vs confirmed orders per client,
 * detailing unlogged boards with special emphasis on company-purchased boards.
 */
async function buildDailyBoardReport(options = {}) {
    const targetDate = options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date)
        ? options.date
        : getNairobiDateString();
    const settings = await (0, repositories_1.getSettings)();
    const client = new odooClient_1.OdooClient(settings.odoo);
    const targetCompanyId = await client.getTargetCompanyIdValue();
    const companyName = settings.odoo.companyName || 'Urban Vibe Interior Design LTD';
    // 1. Fetch board intake logs for target date from local database
    const intakeLogsToday = await (0, repositories_1.getBoardIntakesForDailyReport)(targetDate);
    // 2. Fetch all active cutting MOs in target company
    const rawActiveMos = await client.searchReadRecords('mrp.production', {
        domain: [
            ['company_id', '=', targetCompanyId],
            ['state', 'in', ['confirmed', 'progress', 'to_close']],
        ],
        fields: ['id', 'name', 'state', 'origin', 'product_id', 'product_qty', 'create_date'],
        limit: 500,
        order: 'create_date desc, id desc',
    });
    const activeMos = rawActiveMos.filter((mo) => {
        const moName = String(mo.name || '').toUpperCase();
        if (moName.startsWith('VA/'))
            return false;
        const prodName = Array.isArray(mo.product_id) ? mo.product_id[1] : '';
        return (0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)(prodName) || moName.includes('CUT');
    });
    const moIds = activeMos.map((mo) => mo.id);
    // 3. Fetch component moves for these active cutting MOs
    const rawMoves = moIds.length > 0
        ? await client.searchReadRecords('stock.move', {
            domain: [
                ['raw_material_production_id', 'in', moIds],
                ['company_id', '=', targetCompanyId],
                ['state', 'not in', ['cancel']],
            ],
            fields: ['id', 'raw_material_production_id', 'product_id', 'product_uom_qty', 'quantity', 'state'],
            limit: 2000,
        })
        : [];
    const boardMoves = rawMoves.filter((m) => {
        const pName = Array.isArray(m.product_id) ? m.product_id[1] : '';
        return (0, boardProductClassifier_1.isBoardProductName)(pName);
    });
    // Group moves by MO ID
    const movesByMoId = new Map();
    for (const move of boardMoves) {
        const mId = Array.isArray(move.raw_material_production_id)
            ? move.raw_material_production_id[0]
            : Number(move.raw_material_production_id);
        if (!mId)
            continue;
        const list = movesByMoId.get(mId) || [];
        list.push(move);
        movesByMoId.set(mId, list);
    }
    // 4. Fetch linked Sales Orders to resolve clients and salespeople
    const originNames = [...new Set(activeMos.map((m) => m.origin).filter(Boolean))];
    const saleOrders = originNames.length > 0
        ? await client.searchReadRecords('sale.order', {
            domain: [
                ['company_id', '=', targetCompanyId],
                ['name', 'in', originNames],
            ],
            fields: ['id', 'name', 'partner_id', 'user_id'],
            limit: originNames.length,
        })
        : [];
    const soClientMap = new Map();
    saleOrders.forEach((so) => {
        if (Array.isArray(so.partner_id)) {
            soClientMap.set(so.name, {
                partnerId: so.partner_id[0],
                partnerName: so.partner_id[1],
            });
        }
    });
    // 5. Fetch linked Purchase Orders to identify Purchased Boards vs Client Material
    const relevantOrigins = [
        ...originNames,
        ...activeMos.map((m) => m.name),
    ];
    const purchaseOrders = relevantOrigins.length > 0
        ? await client.searchReadRecords('purchase.order', {
            domain: [
                ['company_id', '=', targetCompanyId],
                ['state', '!=', 'cancel'],
            ],
            fields: ['id', 'name', 'origin', 'state', 'partner_id'],
            limit: 1000,
            order: 'id desc',
        })
        : [];
    // Map PO by origin string and SO name
    const poByOrigin = new Map();
    const activePoNames = new Set();
    const unapprovedPoSet = new Set();
    for (const po of purchaseOrders) {
        if (po.state === 'draft' || po.state === 'to approve' || po.state === 'sent') {
            unapprovedPoSet.add(po.name);
        }
        if (po.state !== 'cancel') {
            activePoNames.add(po.name);
        }
        if (po.origin) {
            const orig = String(po.origin).trim();
            poByOrigin.set(orig, po);
            const extracted = (0, poJobSummaryAuditService_1.extractSoNameFromOrigin)(orig);
            if (extracted) {
                poByOrigin.set(extracted, po);
            }
        }
    }
    // Also query PO line items to verify if board products are specifically purchased
    const poIds = purchaseOrders.map((p) => p.id);
    const poLines = poIds.length > 0
        ? await client.searchReadRecords('purchase.order.line', {
            domain: [['order_id', 'in', poIds]],
            fields: ['id', 'order_id', 'product_id', 'product_qty', 'qty_received'],
            limit: 2000,
        })
        : [];
    const poHasBoardLines = new Set();
    poLines.forEach((line) => {
        const prodName = Array.isArray(line.product_id) ? line.product_id[1] : '';
        if ((0, boardProductClassifier_1.isBoardProductName)(prodName) && Array.isArray(line.order_id)) {
            poHasBoardLines.add(line.order_id[0]);
        }
    });
    // 6. Query incoming Done PO receipts on target date
    const donePickingsToday = await client.searchReadRecords('stock.picking', {
        domain: [
            ['company_id', '=', targetCompanyId],
            ['picking_type_id.code', '=', 'incoming'],
            ['state', '=', 'done'],
            ['date_done', '>=', `${targetDate} 00:00:00`],
            ['date_done', '<=', `${targetDate} 23:59:59`],
        ],
        fields: ['id', 'name', 'origin', 'date_done', 'partner_id'],
        limit: 200,
    }).catch(() => []);
    const donePickingIds = donePickingsToday.map((p) => p.id);
    const doneReceiptMoves = donePickingIds.length > 0
        ? await client.searchReadRecords('stock.move', {
            domain: [
                ['picking_id', 'in', donePickingIds],
                ['state', '=', 'done'],
            ],
            fields: ['id', 'picking_id', 'product_id', 'quantity'],
            limit: 500,
        }).catch(() => [])
        : [];
    const doneBoardReceiptsByOrigin = new Map();
    doneReceiptMoves.forEach((rm) => {
        const pName = Array.isArray(rm.product_id) ? rm.product_id[1] : '';
        const pickingId = Array.isArray(rm.picking_id) ? rm.picking_id[0] : null;
        if (!(0, boardProductClassifier_1.isBoardProductName)(pName) || !pickingId)
            return;
        const picking = donePickingsToday.find((p) => p.id === pickingId);
        if (!picking || !picking.origin)
            return;
        const orig = picking.origin.trim();
        const list = doneBoardReceiptsByOrigin.get(orig) || [];
        list.push({
            pickingName: picking.name,
            productName: pName,
            quantity: Number(rm.quantity || 0),
            supplierName: Array.isArray(picking.partner_id) ? picking.partner_id[1] : 'Supplier',
        });
        doneBoardReceiptsByOrigin.set(orig, list);
    });
    // 7. Group confirmed orders and requirements by Client
    const clientMap = new Map();
    function getOrCreateClient(partnerId, partnerName) {
        const cleanName = (partnerName || 'Unknown Client').trim();
        const key = partnerId ? `id_${partnerId}` : cleanName.toLowerCase();
        if (!clientMap.has(key)) {
            clientMap.set(key, {
                clientId: partnerId,
                clientName: cleanName,
                confirmedMoCount: 0,
                totalBoardsNeeded: 0,
                totalBoardsReserved: 0,
                totalBoardsNotYetLogged: 0,
                requiredComponents: [],
                purchased: { expected: 0, logged: 0, notYetLogged: 0, items: [] },
                clientSupply: { expected: 0, logged: 0, notYetLogged: 0, items: [] },
                loggedEntriesToday: [],
                totalLoggedToday: 0,
            });
        }
        return clientMap.get(key);
    }
    // Iterate over active MOs and populate requirements
    for (const mo of activeMos) {
        const rawMoMoves = movesByMoId.get(mo.id) || [];
        if (!rawMoMoves.length)
            continue;
        // Filter duplicate cutting BOM components
        const filteredMoves = await (0, cuttingBoMReconciliationService_1.filterSingleBoardComponentForCuttingMo)({
            mo: {
                id: mo.id,
                name: mo.name,
                origin: mo.origin,
                product_id: mo.product_id,
                product_qty: mo.product_qty,
            },
            boardMoves: rawMoMoves,
            client,
            settings,
        });
        const soName = String(mo.origin || '').trim();
        const soClient = soClientMap.get(soName);
        const partnerId = soClient?.partnerId || null;
        const partnerName = soClient?.partnerName || (soName ? `Client (${soName})` : 'Internal / Stock Order');
        const clientReport = getOrCreateClient(partnerId, partnerName);
        clientReport.confirmedMoCount += 1;
        // Check if backed by a Purchase Order
        const po = (soName && poByOrigin.get(soName)) || poByOrigin.get(mo.name) || null;
        const isPurchase = Boolean(po && (poHasBoardLines.has(po.id) || po.state !== 'cancel'));
        for (const move of filteredMoves) {
            const needed = Number(move.product_uom_qty || 0);
            const reserved = Number(move.quantity || 0);
            const missing = Math.max(0, needed - reserved);
            const prodName = Array.isArray(move.product_id) ? move.product_id[1] : `Product #${move.product_id}`;
            const prodId = Array.isArray(move.product_id) ? move.product_id[0] : 0;
            if (needed <= 0)
                continue;
            clientReport.totalBoardsNeeded += needed;
            clientReport.totalBoardsReserved += reserved;
            clientReport.totalBoardsNotYetLogged += missing;
            const compItem = {
                moId: mo.id,
                moName: mo.name,
                soName,
                productId: prodId,
                productName: prodName,
                qtyNeeded: needed,
                qtyReserved: reserved,
                qtyMissing: missing,
                isPurchase,
            };
            if (isPurchase && po) {
                const isApproved = po.state === 'purchase' || po.state === 'done';
                compItem.purchaseDetails = {
                    poId: po.id,
                    poName: po.name,
                    supplierName: Array.isArray(po.partner_id) ? po.partner_id[1] : 'Vendor',
                    poState: po.state,
                    isApproved,
                };
                clientReport.purchased.expected += needed;
                clientReport.purchased.logged += reserved;
                clientReport.purchased.notYetLogged += missing;
                clientReport.purchased.items.push({
                    moName: mo.name,
                    soName,
                    productName: prodName,
                    qtyNeeded: needed,
                    qtyMissing: missing,
                    poName: po.name,
                    supplierName: Array.isArray(po.partner_id) ? po.partner_id[1] : 'Vendor',
                    poState: po.state,
                    receiptState: isApproved ? 'Approved · Awaiting Receipt' : 'PO Unapproved',
                });
            }
            else {
                clientReport.clientSupply.expected += needed;
                clientReport.clientSupply.logged += reserved;
                clientReport.clientSupply.notYetLogged += missing;
                clientReport.clientSupply.items.push({
                    moName: mo.name,
                    soName,
                    productName: prodName,
                    qtyNeeded: needed,
                    qtyMissing: missing,
                });
            }
            clientReport.requiredComponents.push(compItem);
        }
    }
    // 8. Distribute Gate Intakes logged on target date to each client
    const unknownOwnerLogs = [];
    let unknownOwnerTotalSheets = 0;
    for (const intake of intakeLogsToday) {
        const isUnknown = !intake.partner_id || Number(intake.partner_id) === 0 || intake.customer_name === 'Pending Client Matching';
        if (isUnknown) {
            unknownOwnerLogs.push({
                id: intake.id,
                productName: intake.product_name,
                quantity: Number(intake.quantity || 0),
                gate: intake.gate || undefined,
                time: intake.arrival_time || undefined,
                vehicle: intake.vehicle_registration || undefined,
                actorName: intake.actor_name || undefined,
            });
            unknownOwnerTotalSheets += Number(intake.quantity || 0);
            continue;
        }
        const clientReport = getOrCreateClient(Number(intake.partner_id), intake.customer_name);
        const qty = Number(intake.quantity || 0);
        clientReport.totalLoggedToday += qty;
        clientReport.loggedEntriesToday.push({
            id: intake.id,
            productName: intake.product_name,
            quantity: qty,
            isPurchase: Boolean(intake.is_purchase),
            purchaseOrderReference: intake.purchase_order_reference || undefined,
            gate: intake.gate || undefined,
            time: intake.arrival_time || undefined,
            vehicle: intake.vehicle_registration || undefined,
            actorName: intake.actor_name || undefined,
            matchedBy: intake.matched_by || undefined,
            source: 'gate_intake',
        });
    }
    // Also include Done PO Receipts on this date as logged entries
    doneBoardReceiptsByOrigin.forEach((receipts, poOrig) => {
        receipts.forEach((r) => {
            // Find client linked to this PO origin
            const client = Array.from(clientMap.values()).find((c) => c.requiredComponents.some((comp) => comp.purchaseDetails?.poName === poOrig || comp.soName === poOrig));
            if (client) {
                client.totalLoggedToday += r.quantity;
                client.loggedEntriesToday.push({
                    id: `po_rcpt_${poOrig}_${r.pickingName}`,
                    productName: r.productName,
                    quantity: r.quantity,
                    isPurchase: true,
                    purchaseOrderReference: poOrig,
                    actorName: `PO Receipt (${r.supplierName})`,
                    source: 'po_receipt',
                });
            }
        });
    });
    // Sort clients: Clients with pending shortages first, then alphabetically
    const clientsList = Array.from(clientMap.values()).sort((a, b) => {
        if (b.totalBoardsNotYetLogged !== a.totalBoardsNotYetLogged) {
            return b.totalBoardsNotYetLogged - a.totalBoardsNotYetLogged;
        }
        return a.clientName.localeCompare(b.clientName);
    });
    // Calculate Top-Level Totals
    const totalConfirmedMos = clientsList.reduce((sum, c) => sum + c.confirmedMoCount, 0);
    const totalBoardsNeeded = clientsList.reduce((sum, c) => sum + c.totalBoardsNeeded, 0);
    const totalBoardsLoggedToday = clientsList.reduce((sum, c) => sum + c.totalLoggedToday, 0) + unknownOwnerTotalSheets;
    const totalBoardsNotYetLogged = clientsList.reduce((sum, c) => sum + c.totalBoardsNotYetLogged, 0);
    const purchasedTotals = clientsList.reduce((acc, c) => {
        acc.expected += c.purchased.expected;
        acc.logged += c.purchased.logged;
        acc.notYetLogged += c.purchased.notYetLogged;
        return acc;
    }, {
        expected: 0,
        logged: 0,
        notYetLogged: 0,
        activePoCount: activePoNames.size,
        unapprovedPoCount: unapprovedPoSet.size,
        pendingDeliveryCount: activePoNames.size - unapprovedPoSet.size,
    });
    const clientSupplyTotals = clientsList.reduce((acc, c) => {
        acc.expected += c.clientSupply.expected;
        acc.logged += c.clientSupply.logged;
        acc.notYetLogged += c.clientSupply.notYetLogged;
        return acc;
    }, { expected: 0, logged: 0, notYetLogged: 0 });
    return {
        reportDate: targetDate,
        reportDateFormatted: formatDisplayDate(targetDate),
        companyId: targetCompanyId,
        companyName,
        generatedAt: new Date().toISOString(),
        totalClientsWithOrders: clientsList.filter((c) => c.confirmedMoCount > 0).length,
        totalConfirmedMos,
        totalBoardsNeeded,
        totalBoardsLoggedToday,
        totalBoardsNotYetLogged,
        purchasedTotals,
        clientSupplyTotals,
        unknownOwnerLogs,
        unknownOwnerTotalSheets,
        clients: clientsList,
    };
}
/**
 * Renders an executive A4 PDF of the Daily Board Report.
 */
async function renderDailyBoardReportPdf(report) {
    const document = new pdfkit_1.default({ size: 'A4', margin: 40, bufferPages: true });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise((resolve, reject) => {
        document.on('end', () => resolve(Buffer.concat(chunks)));
        document.on('error', reject);
    });
    const navy = '#1e293b';
    const copper = '#d97706';
    const ink = '#0f172a';
    const muted = '#64748b';
    const border = '#cbd5e1';
    const pageWidth = 595.28;
    const contentWidth = pageWidth - 80;
    const ensureSpace = (height) => {
        if (document.y + height > 760) {
            document.addPage();
        }
    };
    const section = (title, subtitle) => {
        ensureSpace(subtitle ? 45 : 30);
        document.moveDown(0.5);
        document.font('Helvetica-Bold').fontSize(12).fillColor(navy).text(title, 40, document.y, { width: contentWidth });
        document.moveTo(40, document.y + 2).lineTo(pageWidth - 40, document.y + 2).strokeColor(copper).lineWidth(1.5).stroke();
        document.moveDown(0.4);
        if (subtitle) {
            document.font('Helvetica').fontSize(8).fillColor(muted).text(subtitle, 40, document.y, { width: contentWidth });
            document.moveDown(0.3);
        }
    };
    const card = (x, y, width, label, value, note, accent) => {
        document.roundedRect(x, y, width, 58, 6).fillAndStroke('#f8fafc', border);
        document.rect(x, y, 4, 58).fill(accent);
        document.font('Helvetica-Bold').fontSize(16).fillColor(ink).text(value, x + 10, y + 8, { width: width - 16 });
        document.font('Helvetica-Bold').fontSize(6.8).fillColor(muted).text(label.toUpperCase(), x + 10, y + 29, { width: width - 16 });
        document.font('Helvetica').fontSize(6.5).fillColor(muted).text(note, x + 10, y + 42, { width: width - 16, lineBreak: false });
    };
    // Header Banner
    document.rect(0, 0, pageWidth, 95).fill(navy);
    document.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text('Daily Board Intake & Order Report', 40, 24);
    document.font('Helvetica-Bold').fontSize(9).fillColor(copper).text(`${report.companyName} · Date: ${report.reportDateFormatted}`, 40, 48);
    document.font('Helvetica').fontSize(7.5).fillColor('#94a3b8').text(`Confirmed Orders vs Boards Logged vs Deficit | Emphasizing Company-Purchased Boards | Generated ${new Date().toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi' })}`, 40, 64);
    document.y = 110;
    // Top KPI Cards
    const cardGap = 8;
    const cardWidth = (contentWidth - cardGap * 3) / 4;
    const cardY = document.y;
    card(40, cardY, cardWidth, 'Confirmed Orders', `${report.totalBoardsNeeded} bds`, `${report.totalConfirmedMos} active cutting MOs`, '#2563eb');
    card(40 + (cardWidth + cardGap), cardY, cardWidth, 'Logged on Date', `${report.totalBoardsLoggedToday} bds`, 'Gate + PO receipts', '#16a34a');
    card(40 + (cardWidth + cardGap) * 2, cardY, cardWidth, 'Not Yet Logged', `${report.totalBoardsNotYetLogged} bds`, 'Awaiting delivery', report.totalBoardsNotYetLogged > 0 ? '#dc2626' : '#16a34a');
    card(40 + (cardWidth + cardGap) * 3, cardY, cardWidth, 'PO Purchased Deficit', `${report.purchasedTotals.notYetLogged} bds`, `${report.purchasedTotals.unapprovedPoCount} unapproved POs`, report.purchasedTotals.notYetLogged > 0 ? '#ea580c' : '#16a34a');
    document.y = cardY + 70;
    // Section 1: Especially Purchased Boards (PO Backed)
    section('1. Company-Purchased Boards Status (PO Backed)', 'Cutting orders that depend on materials procured by the company from vendors.');
    const purchasedClients = report.clients.filter((c) => c.purchased.items.length > 0);
    if (!purchasedClients.length) {
        document.font('Helvetica-Oblique').fontSize(8.5).fillColor(muted).text('No confirmed cutting orders currently depend on unreceived company-purchased boards.', 40, document.y);
        document.moveDown(0.8);
    }
    else {
        // Table Header
        const y = document.y;
        document.rect(40, y, contentWidth, 18).fill(navy);
        document.font('Helvetica-Bold').fontSize(7).fillColor('#ffffff');
        document.text('CLIENT', 45, y + 5, { width: 95 });
        document.text('MO & SO', 145, y + 5, { width: 95 });
        document.text('BOARD MATERIAL', 245, y + 5, { width: 110 });
        document.text('PO & VENDOR', 360, y + 5, { width: 105 });
        document.text('NEEDED', 470, y + 5, { width: 40, align: 'right' });
        document.text('MISSING', 515, y + 5, { width: 35, align: 'right' });
        document.y = y + 20;
        for (const client of purchasedClients) {
            for (const item of client.purchased.items) {
                ensureSpace(16);
                const rowY = document.y;
                document.rect(40, rowY, contentWidth, 16).fill(rowY % 32 === 0 ? '#f8fafc' : '#ffffff');
                document.font('Helvetica-Bold').fontSize(7).fillColor(ink).text(client.clientName, 45, rowY + 4, { width: 95, lineBreak: false });
                document.font('Helvetica').fontSize(6.8).fillColor(muted).text(`${item.moName} (${item.soName || 'SO'})`, 145, rowY + 4, { width: 95, lineBreak: false });
                document.font('Helvetica').fontSize(6.8).fillColor(ink).text(item.productName, 245, rowY + 4, { width: 110, lineBreak: false });
                document.font('Helvetica-Bold').fontSize(6.8).fillColor(copper).text(`${item.poName} · ${item.supplierName}`, 360, rowY + 4, { width: 105, lineBreak: false });
                document.font('Helvetica').fontSize(7).fillColor(ink).text(String(item.qtyNeeded), 470, rowY + 4, { width: 40, align: 'right' });
                document.font('Helvetica-Bold').fontSize(7).fillColor(item.qtyMissing > 0 ? '#dc2626' : '#16a34a').text(String(item.qtyMissing), 515, rowY + 4, { width: 35, align: 'right' });
                document.y = rowY + 16;
            }
        }
        document.moveDown(0.6);
    }
    // Section 2: Client-by-Client Summary
    section('2. Client Supply vs Confirmed Orders Breakdown', 'Customer-provided materials logged at the gate vs confirmed orders.');
    for (const client of report.clients.filter((c) => c.confirmedMoCount > 0 || c.totalLoggedToday > 0)) {
        ensureSpace(40);
        const boxY = document.y;
        document.roundedRect(40, boxY, contentWidth, 34, 4).fillAndStroke('#ffffff', border);
        document.rect(40, boxY, 4, 34).fill(client.totalBoardsNotYetLogged > 0 ? '#ea580c' : '#16a34a');
        document.font('Helvetica-Bold').fontSize(9).fillColor(ink).text(client.clientName, 50, boxY + 6);
        document.font('Helvetica').fontSize(7.5).fillColor(muted).text(`Orders: ${client.confirmedMoCount} MOs | Needed: ${client.totalBoardsNeeded} | Logged Today: ${client.totalLoggedToday} | Deficit: ${client.totalBoardsNotYetLogged}`, 50, boxY + 19);
        const badgeText = client.totalBoardsNotYetLogged > 0 ? `DEFICIT: ${client.totalBoardsNotYetLogged} BOARDS` : '✓ FULLY LOGGED';
        const badgeColor = client.totalBoardsNotYetLogged > 0 ? '#dc2626' : '#16a34a';
        document.font('Helvetica-Bold').fontSize(7.5).fillColor(badgeColor).text(badgeText, pageWidth - 160, boxY + 12, { width: 110, align: 'right' });
        document.y = boxY + 38;
    }
    // Section 3: Owner Unknown Intakes
    if (report.unknownOwnerLogs.length > 0) {
        section('3. Unassigned Intakes (Owner Unknown · Pending Match)', 'Boards physically received at the gate today that still require matching to a client.');
        for (const u of report.unknownOwnerLogs) {
            ensureSpace(16);
            const rowY = document.y;
            document.font('Helvetica-Bold').fontSize(7.5).fillColor(copper).text(`⚠️ ${u.quantity} × ${u.productName}`, 45, rowY);
            document.font('Helvetica').fontSize(7).fillColor(muted).text(`Gate: ${u.gate || '-'} · Arrived: ${u.time || '-'} · Vehicle: ${u.vehicle || '-'} · Logged by: ${u.actorName || 'Operator'}`, 220, rowY);
            document.y = rowY + 14;
        }
    }
    document.end();
    return done;
}
/**
 * Sends the daily board intake report to specified recipients.
 */
async function sendDailyBoardReport(recipients, targetDate) {
    const settings = await (0, repositories_1.getSettings)();
    const report = await buildDailyBoardReport({ date: targetDate });
    const pdfBuffer = await renderDailyBoardReportPdf(report);
    const defaultRecipients = ['dbadmin@urbanvibe.co.ke', 'charles@urbanvibe.co.ke', 'raphael@urbanvibe.co.ke'];
    const toList = recipients && recipients.length > 0 ? recipients : defaultRecipients;
    const subject = `[Daily Report] Boards Logged vs Confirmed Orders - ${report.reportDateFormatted}`;
    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a; margin-bottom: 4px;">Daily Board Intake & Confirmed Orders Report</h2>
      <p style="color: #64748b; font-size: 14px; margin-top: 0;">Date: <strong>${report.reportDateFormatted}</strong> | Target: ${report.companyName}</p>

      <div style="background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin-top: 0; font-size: 15px; color: #0f172a;">Executive Summary</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0;">Total Confirmed Cutting Orders:</td>
            <td style="padding: 6px 0; font-weight: bold; text-align: right;">${report.totalConfirmedMos} MOs (${report.totalBoardsNeeded} boards needed)</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;">Total Boards Logged on Date:</td>
            <td style="padding: 6px 0; font-weight: bold; text-align: right; color: #16a34a;">${report.totalBoardsLoggedToday} boards</td>
          </tr>
          <tr>
            <td style="padding: 6px 0;">Total Deficit (Not Yet Logged):</td>
            <td style="padding: 6px 0; font-weight: bold; text-align: right; color: ${report.totalBoardsNotYetLogged > 0 ? '#dc2626' : '#16a34a'};">${report.totalBoardsNotYetLogged} boards</td>
          </tr>
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="padding: 8px 0 4px 0; font-weight: bold; color: #ea580c;">🛒 Company-Purchased Boards (PO):</td>
            <td style="padding: 8px 0 4px 0; font-weight: bold; text-align: right; color: #ea580c;">${report.purchasedTotals.expected} needed | ${report.purchasedTotals.notYetLogged} missing</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; font-weight: bold; color: #059669;">📦 Client-Supplied Boards:</td>
            <td style="padding: 4px 0; font-weight: bold; text-align: right; color: #059669;">${report.clientSupplyTotals.expected} needed | ${report.clientSupplyTotals.notYetLogged} missing</td>
          </tr>
        </table>
      </div>

      ${report.unknownOwnerLogs.length > 0
        ? `<div style="background-color: #fef08a; border: 1px solid #fde047; border-radius: 8px; padding: 12px; margin: 16px 0;">
              <strong>⚠️ ${report.unknownOwnerTotalSheets} boards logged at gate with Owner Unknown (Pending Client Matching)</strong>. Please review on the shop floor portal.
             </div>`
        : ''}

      <p style="font-size: 13px; color: #64748b;">The complete PDF report with itemized breakdowns is attached.</p>
    </div>
  `;
    await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
        to: toList.join(', '),
        subject,
        html,
        attachments: [
            {
                filename: `Daily-Board-Report-${report.reportDate}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
            },
        ],
    });
    await (0, logService_1.logEvent)('info', 'Daily board report emailed', {
        reportDate: report.reportDate,
        recipients: toList,
        totalNeeded: report.totalBoardsNeeded,
        totalLogged: report.totalBoardsLoggedToday,
        notYetLogged: report.totalBoardsNotYetLogged,
    });
    return { ok: true, message: `Daily board report sent to ${toList.join(', ')}.` };
}
