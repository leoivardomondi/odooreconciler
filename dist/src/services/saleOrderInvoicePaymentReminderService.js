"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SWEEP_LOOKBACK_DAYS = exports.NON_PO_INVOICE_REMINDER_DELAY_HOURS = exports.SO_MISSING_PAYMENT_ACTIVITY_SUMMARY = exports.SO_DRAFT_INVOICE_ACTIVITY_SUMMARY = exports.SO_MISSING_INVOICE_ACTIVITY_SUMMARY = void 0;
exports.isPoApprovedOrGoodsReceived = isPoApprovedOrGoodsReceived;
exports.hasRegisteredInvoicePayment = hasRegisteredInvoicePayment;
exports.evaluateSaleOrderInvoicePaymentStatus = evaluateSaleOrderInvoicePaymentStatus;
exports.applySaleOrderBillingEvaluation = applySaleOrderBillingEvaluation;
exports.checkSaleOrderInvoiceAndPayment = checkSaleOrderInvoiceAndPayment;
exports.checkSaleOrderInvoicePaymentForPurchaseOrder = checkSaleOrderInvoicePaymentForPurchaseOrder;
exports.checkSaleOrderInvoicePaymentForInvoice = checkSaleOrderInvoicePaymentForInvoice;
exports.checkSaleOrderInvoicePaymentForPayment = checkSaleOrderInvoicePaymentForPayment;
exports.checkSaleOrderInvoicePaymentForPicking = checkSaleOrderInvoicePaymentForPicking;
exports.runSaleOrderInvoicePaymentSweep = runSaleOrderInvoicePaymentSweep;
exports.startSaleOrderInvoicePaymentReminderInterval = startSaleOrderInvoicePaymentReminderInterval;
exports.stopSaleOrderInvoicePaymentReminderInterval = stopSaleOrderInvoicePaymentReminderInterval;
const repositories_1 = require("../models/repositories");
const helpers_1 = require("../utils/helpers");
const logService_1 = require("./logService");
const odooActivityService_1 = require("./odooActivityService");
const odooClient_1 = require("./odooClient");
exports.SO_MISSING_INVOICE_ACTIVITY_SUMMARY = 'CREATE CUSTOMER INVOICE & REGISTER PAYMENT';
exports.SO_DRAFT_INVOICE_ACTIVITY_SUMMARY = 'CONFIRM INVOICE & REGISTER PAYMENT';
exports.SO_MISSING_PAYMENT_ACTIVITY_SUMMARY = 'CONFIRM & REGISTER CUSTOMER PAYMENT';
const ALL_INVOICE_PAYMENT_ACTIVITY_SUMMARIES = [
    exports.SO_MISSING_INVOICE_ACTIVITY_SUMMARY,
    exports.SO_DRAFT_INVOICE_ACTIVITY_SUMMARY,
    exports.SO_MISSING_PAYMENT_ACTIVITY_SUMMARY,
];
exports.NON_PO_INVOICE_REMINDER_DELAY_HOURS = 48;
exports.DEFAULT_SWEEP_LOOKBACK_DAYS = 14;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
function relationId(value) {
    return Array.isArray(value) ? Number(value[0]) || null : null;
}
function relationLabel(value) {
    return Array.isArray(value) ? String(value[1] || '').trim() : '';
}
function parseOdooUtcDate(value) {
    if (!value || typeof value !== 'string')
        return null;
    const raw = value.trim();
    if (!raw)
        return null;
    const normalized = raw.includes('T')
        ? (raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`)
        : `${raw.replace(' ', 'T')}Z`;
    const parsed = new Date(normalized);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function formatKes(value) {
    return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: 'KES',
        maximumFractionDigits: 2,
    }).format(Number(value || 0));
}
function formatEatDateTime(value) {
    const dt = parseOdooUtcDate(value);
    if (!dt)
        return '-';
    return new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    }).format(dt);
}
function isPoApprovedOrGoodsReceived(po, pickingsById) {
    const companyId = relationId(po.company_id);
    if (companyId === 3 || String(po.name || '').toUpperCase().startsWith('VA/')) {
        return { triggered: false, isApproved: false, isGoodsReceived: false, confirmedAt: null };
    }
    const state = String(po.state || '').toLowerCase();
    if (state === 'cancel') {
        return { triggered: false, isApproved: false, isGoodsReceived: false, confirmedAt: null };
    }
    const isApproved = state === 'purchase' || state === 'done' || Boolean(po.date_approve);
    const receiptStatus = String(po.receipt_status || '').toLowerCase();
    let isGoodsReceived = receiptStatus === 'full' || receiptStatus === 'partial';
    if (!isGoodsReceived && pickingsById && Array.isArray(po.picking_ids)) {
        isGoodsReceived = po.picking_ids.some((pid) => {
            const p = pickingsById.get(Number(pid));
            return p && String(p.state || '').toLowerCase() === 'done';
        });
    }
    const confirmedAt = (po.date_approve || po.date_order || po.create_date || null);
    return {
        triggered: isApproved || isGoodsReceived,
        isApproved,
        isGoodsReceived,
        confirmedAt,
    };
}
function hasRegisteredInvoicePayment(invoice) {
    if (String(invoice.state || '').toLowerCase() !== 'posted') {
        return false;
    }
    const paymentState = String(invoice.payment_state || '').toLowerCase();
    if (paymentState === 'paid' || paymentState === 'in_payment' || paymentState === 'partial') {
        return true;
    }
    const total = Number(invoice.amount_total || 0);
    const residual = Number(invoice.amount_residual ?? total);
    if (total > 0 && residual < total - 0.01) {
        return true;
    }
    return false;
}
/**
 * Pure business-rule evaluator for Sales Order customer invoice & payment accountability:
 * 1. If the Sales Order has a linked Purchase Order that is approved/confirmed OR has goods received:
 *    - Immediately (from the time the PO was confirmed), the SO must have a posted customer invoice
 *      with payment registered (partial or full).
 *    - Otherwise, assign a To-Do activity to the Salesperson to create/confirm the invoice or
 *      confirm & register customer payment.
 * 2. If the Sales Order has NO approved/received PO:
 *    - Wait 48 hours from SO confirmation (`date_order` / `create_date`).
 *    - After 48 hours, if invoice or payment (partial/full) is still missing, create the activity.
 */
function evaluateSaleOrderInvoicePaymentStatus(input) {
    const { order, linkedPos, invoices, pickingsById } = input;
    const now = input.now || new Date();
    const nonPoDelayHours = input.nonPoDelayHours ?? exports.NON_PO_INVOICE_REMINDER_DELAY_HOURS;
    const salespersonUserId = relationId(order.user_id) || relationId(order.create_uid);
    const salespersonName = relationLabel(order.user_id) || relationLabel(order.create_uid) || 'Salesperson';
    const customerName = relationLabel(order.partner_id) || 'Customer';
    const amountTotal = Number(order.amount_total || 0);
    const base = {
        orderId: order.id,
        orderName: order.name,
        salespersonUserId,
        salespersonName,
        customerName,
        amountTotal,
        triggerType: 'none',
        triggerPoNames: [],
        hasGoodsReceivedPo: false,
        poConfirmedAt: null,
        hoursSinceOrderConfirmed: null,
    };
    const companyId = relationId(order.company_id);
    if (companyId === 3 || String(order.name || '').toUpperCase().startsWith('VA/')) {
        return {
            ...base,
            status: 'skipped_excluded',
            requiredActivitySummary: null,
            noteLines: [],
            compliantSummary: 'Excluded company (URBAN VIBE 2 / VA prefix).',
        };
    }
    const orderState = String(order.state || '').toLowerCase();
    if (orderState !== 'sale' && orderState !== 'done') {
        return {
            ...base,
            status: 'skipped_not_confirmed',
            requiredActivitySummary: null,
            noteLines: [],
            compliantSummary: `Sales Order ${order.name} is in "${orderState}" state (not confirmed).`,
        };
    }
    if (amountTotal <= 0) {
        return {
            ...base,
            status: 'skipped_zero_amount',
            requiredActivitySummary: null,
            noteLines: [],
            compliantSummary: `Sales Order ${order.name} has zero total amount.`,
        };
    }
    // Filter valid customer invoices (exclude cancelled & vendor bills/credit notes)
    const customerInvoices = invoices.filter((inv) => {
        const moveType = String(inv.move_type || 'out_invoice').toLowerCase();
        const state = String(inv.state || '').toLowerCase();
        return (moveType === 'out_invoice' || moveType === 'out_receipt') && state !== 'cancel';
    });
    const postedInvoices = customerInvoices.filter((inv) => String(inv.state || '').toLowerCase() === 'posted');
    const draftInvoices = customerInvoices.filter((inv) => String(inv.state || '').toLowerCase() === 'draft');
    const paidOrPartialInvoices = postedInvoices.filter(hasRegisteredInvoicePayment);
    // Determine PO trigger status
    const activePoTriggers = linkedPos
        .map((po) => ({ po, check: isPoApprovedOrGoodsReceived(po, pickingsById) }))
        .filter((entry) => entry.check.triggered);
    const hasTriggeredPo = activePoTriggers.length > 0;
    const triggerPoNames = activePoTriggers.map((entry) => entry.po.name);
    const hasGoodsReceivedPo = activePoTriggers.some((entry) => entry.check.isGoodsReceived);
    // Earliest PO confirmation time among triggered POs
    const sortedPoConfirmDates = activePoTriggers
        .map((entry) => ({ raw: entry.check.confirmedAt, dt: parseOdooUtcDate(entry.check.confirmedAt) }))
        .filter((x) => Boolean(x.raw && x.dt))
        .sort((a, b) => a.dt.getTime() - b.dt.getTime());
    const poConfirmedAt = sortedPoConfirmDates[0]?.raw || null;
    // Compute hours elapsed since Sales Order confirmation
    const orderConfirmDate = parseOdooUtcDate((order.date_order || order.create_date || null));
    const hoursSinceOrderConfirmed = orderConfirmDate
        ? Math.max(0, (now.getTime() - orderConfirmDate.getTime()) / 3_600_000)
        : null;
    // If invoice is posted and partial/full payment is registered -> ALWAYS compliant (and close open reminders)
    if (paidOrPartialInvoices.length > 0) {
        const invSummary = paidOrPartialInvoices
            .map((inv) => `${inv.name} (${String(inv.payment_state || 'paid')})`)
            .join(', ');
        return {
            ...base,
            triggerType: hasTriggeredPo ? 'po_approved_or_received' : 'no_po_48h',
            triggerPoNames,
            hasGoodsReceivedPo,
            poConfirmedAt,
            hoursSinceOrderConfirmed,
            status: 'compliant',
            requiredActivitySummary: null,
            noteLines: [],
            compliantSummary: `Customer invoice and payment registered on ${order.name}: ${invSummary}.`,
        };
    }
    // Check if rule is due right now
    if (hasTriggeredPo) {
        const poConfirmDate = parseOdooUtcDate(poConfirmedAt);
        if (poConfirmDate && poConfirmDate.getTime() > now.getTime() + 60_000) {
            // Defensive guard against future-dated PO confirmation
            return {
                ...base,
                triggerType: 'po_approved_or_received',
                triggerPoNames,
                hasGoodsReceivedPo,
                poConfirmedAt,
                hoursSinceOrderConfirmed,
                status: 'waiting_48h_window',
                requiredActivitySummary: null,
                noteLines: [],
                compliantSummary: `PO ${triggerPoNames.join(', ')} confirmation timestamp is in the future.`,
            };
        }
    }
    else {
        // No approved/received PO -> enforce 48-hour waiting period from SO confirmation
        if (hoursSinceOrderConfirmed === null || hoursSinceOrderConfirmed < nonPoDelayHours) {
            return {
                ...base,
                triggerType: 'none',
                triggerPoNames: [],
                hasGoodsReceivedPo: false,
                poConfirmedAt: null,
                hoursSinceOrderConfirmed,
                status: 'waiting_48h_window',
                requiredActivitySummary: null,
                noteLines: [],
                compliantSummary: `No linked PO; waiting for ${nonPoDelayHours}h elapsed (${hoursSinceOrderConfirmed !== null ? `${hoursSinceOrderConfirmed.toFixed(1)}h` : 'unknown'} elapsed).`,
            };
        }
    }
    const triggerType = hasTriggeredPo
        ? 'po_approved_or_received'
        : 'no_po_48h';
    const triggerReasonLine = hasTriggeredPo
        ? `Trigger: Linked Purchase Order ${triggerPoNames.join(', ')} is ${hasGoodsReceivedPo ? 'approved with goods received' : 'approved/confirmed'}${poConfirmedAt ? ` (confirmed ${formatEatDateTime(poConfirmedAt)} EAT)` : ''}.`
        : `Trigger: Sales Order confirmed over ${nonPoDelayHours} hours ago (${hoursSinceOrderConfirmed !== null ? `${Math.floor(hoursSinceOrderConfirmed)}h elapsed` : `${nonPoDelayHours}h+`}, no linked PO).`;
    const commonHeaderLines = [
        `Sales Order: ${order.name} — Client: ${customerName} (${formatKes(amountTotal)})`,
        triggerReasonLine,
    ];
    // Missing invoice completely
    if (customerInvoices.length === 0) {
        return {
            ...base,
            triggerType,
            triggerPoNames,
            hasGoodsReceivedPo,
            poConfirmedAt,
            hoursSinceOrderConfirmed,
            status: 'missing_invoice',
            requiredActivitySummary: exports.SO_MISSING_INVOICE_ACTIVITY_SUMMARY,
            noteLines: [
                ...commonHeaderLines,
                'Issue: No customer invoice has been created for this Sales Order yet.',
                'Action Required: Please create and post the customer invoice immediately, and confirm if payment (partial or full) has been made and register it in Odoo.',
            ],
            compliantSummary: '',
        };
    }
    // Only draft invoice(s) exist (not posted yet)
    if (postedInvoices.length === 0 && draftInvoices.length > 0) {
        const draftNames = draftInvoices.map((i) => i.name || `Draft #${i.id}`).join(', ');
        return {
            ...base,
            triggerType,
            triggerPoNames,
            hasGoodsReceivedPo,
            poConfirmedAt,
            hoursSinceOrderConfirmed,
            status: 'draft_invoice_only',
            requiredActivitySummary: exports.SO_DRAFT_INVOICE_ACTIVITY_SUMMARY,
            noteLines: [
                ...commonHeaderLines,
                `Issue: Customer invoice (${draftNames}) is still in Draft state and has no payment registered.`,
                'Action Required: Please confirm/post the invoice and confirm if payment (partial or full) has been made and register it in Odoo.',
            ],
            compliantSummary: '',
        };
    }
    // Posted invoice(s) exist, but NO partial or full payment registered
    const unpaidDetails = postedInvoices
        .map((inv) => `${inv.name} (Total: ${formatKes(Number(inv.amount_total || 0))}, Unpaid: ${formatKes(Number(inv.amount_residual ?? inv.amount_total ?? 0))})`)
        .join('; ');
    return {
        ...base,
        triggerType,
        triggerPoNames,
        hasGoodsReceivedPo,
        poConfirmedAt,
        hoursSinceOrderConfirmed,
        status: 'missing_payment',
        requiredActivitySummary: exports.SO_MISSING_PAYMENT_ACTIVITY_SUMMARY,
        noteLines: [
            ...commonHeaderLines,
            `Issue: Customer invoice is posted (${unpaidDetails}), but no partial or full payment is registered in Odoo.`,
            'Action Required: Please confirm whether payment (partial or full) has been received from the client and register it on the invoice in Odoo.',
        ],
        compliantSummary: '',
    };
}
function matchesActivitySummary(activity, targetSummary) {
    const raw = String(activity.summary || '').trim();
    if (!raw)
        return false;
    const cleanAct = (0, odooActivityService_1.stripSummaryTimestamp)(raw);
    const cleanTarget = (0, odooActivityService_1.stripSummaryTimestamp)(targetSummary);
    return (cleanAct === cleanTarget ||
        cleanAct.includes(cleanTarget) ||
        cleanTarget.includes(cleanAct));
}
function findMatchingBillingActivities(activities, summary) {
    if (summary) {
        return activities.filter((act) => matchesActivitySummary(act, summary));
    }
    return activities.filter((act) => ALL_INVOICE_PAYMENT_ACTIVITY_SUMMARIES.some((s) => matchesActivitySummary(act, s)));
}
async function applySaleOrderBillingEvaluation(client, evaluation, options) {
    const dryRun = Boolean(options?.dryRun);
    if (evaluation.status === 'skipped_excluded' ||
        evaluation.status === 'skipped_not_confirmed' ||
        evaluation.status === 'skipped_zero_amount' ||
        evaluation.status === 'waiting_48h_window') {
        return { orderId: evaluation.orderId, orderName: evaluation.orderName, evaluation, action: 'no_action' };
    }
    const allOpenForSo = options?.preloadedOpenActivities !== undefined
        ? findMatchingBillingActivities(options.preloadedOpenActivities)
        : findMatchingBillingActivities(await (0, odooActivityService_1.findOpenActivities)(client, { modelName: 'sale.order', recordId: evaluation.orderId }));
    // Compliant -> close any open billing/payment reminder activities
    if (evaluation.status === 'compliant') {
        if (allOpenForSo.length === 0) {
            return { orderId: evaluation.orderId, orderName: evaluation.orderName, evaluation, action: 'no_action', closedCount: 0 };
        }
        if (dryRun) {
            return { orderId: evaluation.orderId, orderName: evaluation.orderName, evaluation, action: 'dry_run', closedCount: allOpenForSo.length };
        }
        const closeResult = await (0, odooActivityService_1.closeActivities)(client, allOpenForSo.map((a) => a.id), evaluation.compliantSummary || 'Customer invoice and payment registered.');
        await (0, logService_1.logEvent)('info', 'Auto-closed Sales Order invoice/payment reminder activity after payment registered', {
            orderId: evaluation.orderId,
            orderName: evaluation.orderName,
            closedCount: closeResult.closedCount,
            summary: evaluation.compliantSummary,
        }).catch(() => undefined);
        return {
            orderId: evaluation.orderId,
            orderName: evaluation.orderName,
            evaluation,
            action: 'closed_activities',
            closedCount: closeResult.closedCount,
        };
    }
    // Action required: missing_invoice | draft_invoice_only | missing_payment
    const targetSummary = evaluation.requiredActivitySummary;
    const matchingExisting = findMatchingBillingActivities(allOpenForSo, targetSummary);
    const obsoleteOther = allOpenForSo.filter((act) => !matchesActivitySummary(act, targetSummary));
    // If the order progressed (e.g. invoice created/posted, now only missing payment), close obsolete activity
    if (obsoleteOther.length > 0 && !dryRun) {
        await (0, odooActivityService_1.closeActivities)(client, obsoleteOther.map((a) => a.id), `Superseded by updated status on ${evaluation.orderName}: ${targetSummary}.`).catch(() => undefined);
    }
    if (matchingExisting.length > 0) {
        return {
            orderId: evaluation.orderId,
            orderName: evaluation.orderName,
            evaluation,
            action: 'activity_already_open',
            activityId: matchingExisting[0].id,
            closedCount: obsoleteOther.length,
        };
    }
    if (!evaluation.salespersonUserId) {
        return {
            orderId: evaluation.orderId,
            orderName: evaluation.orderName,
            evaluation,
            action: 'missing_assignee',
        };
    }
    if (dryRun) {
        return {
            orderId: evaluation.orderId,
            orderName: evaluation.orderName,
            evaluation,
            action: 'dry_run',
        };
    }
    const activityId = await (0, odooActivityService_1.createTodoActivity)(client, {
        modelName: 'sale.order',
        recordId: evaluation.orderId,
        userId: evaluation.salespersonUserId,
        summary: targetSummary,
        noteLines: evaluation.noteLines,
    });
    await (0, logService_1.logEvent)('info', 'Created Sales Order invoice/payment reminder activity for salesperson', {
        orderId: evaluation.orderId,
        orderName: evaluation.orderName,
        activityId,
        summary: targetSummary,
        assignedUserId: evaluation.salespersonUserId,
        salespersonName: evaluation.salespersonName,
        triggerType: evaluation.triggerType,
        triggerPoNames: evaluation.triggerPoNames,
        status: evaluation.status,
    }).catch(() => undefined);
    return {
        orderId: evaluation.orderId,
        orderName: evaluation.orderName,
        evaluation,
        action: 'created_activity',
        activityId,
        closedCount: obsoleteOther.length,
    };
}
// ─── Single-Record Triggers (Webhooks & Direct Calls) ────────────────
async function checkSaleOrderInvoiceAndPayment(client, saleOrderId, options) {
    const companyId = await client.getTargetCompanyIdValue();
    const orders = await client.readRecords('sale.order', [saleOrderId], ['id', 'name', 'state', 'company_id', 'partner_id', 'user_id', 'create_uid', 'date_order', 'create_date', 'amount_total', 'invoice_ids', 'invoice_status']);
    const order = orders[0];
    if (!order)
        return null;
    const orderCompanyId = relationId(order.company_id);
    if ((orderCompanyId && orderCompanyId !== companyId) || String(order.name || '').toUpperCase().startsWith('VA/')) {
        return null;
    }
    const invoiceIds = Array.isArray(order.invoice_ids) ? order.invoice_ids.map(Number).filter(Boolean) : [];
    const [directPos, linkedMos, invoices] = await Promise.all([
        client.searchReadRecords('purchase.order', {
            domain: [
                ['company_id', '=', companyId],
                ['origin', 'ilike', order.name],
                ['state', '!=', 'cancel'],
            ],
            fields: ['id', 'name', 'state', 'company_id', 'origin', 'date_approve', 'date_order', 'create_date', 'receipt_status', 'picking_ids'],
            limit: 30,
        }).catch(() => []),
        client.searchReadRecords('mrp.production', {
            domain: [
                ['company_id', '=', companyId],
                ['origin', '=', order.name],
                ['state', '!=', 'cancel'],
            ],
            fields: ['id', 'name'],
            limit: 30,
        }).catch(() => []),
        invoiceIds.length > 0
            ? client.readRecords('account.move', invoiceIds, ['id', 'name', 'move_type', 'state', 'payment_state', 'amount_total', 'amount_residual', 'invoice_origin']).catch(() => [])
            : Promise.resolve([]),
    ]);
    const linkedPos = [...directPos];
    if (linkedMos.length > 0) {
        const moPos = await client.searchReadRecords('purchase.order', {
            domain: [
                ['company_id', '=', companyId],
                ['origin', 'in', linkedMos.map((m) => m.name)],
                ['state', '!=', 'cancel'],
            ],
            fields: ['id', 'name', 'state', 'company_id', 'origin', 'date_approve', 'date_order', 'create_date', 'receipt_status', 'picking_ids'],
            limit: 30,
        }).catch(() => []);
        for (const po of moPos) {
            if (!linkedPos.some((existing) => existing.id === po.id)) {
                linkedPos.push(po);
            }
        }
    }
    // Only fetch pickings if any PO isn't already marked approved/received via state/receipt_status
    const pickingsNeededIds = linkedPos
        .filter((po) => !isPoApprovedOrGoodsReceived(po).triggered && Array.isArray(po.picking_ids))
        .flatMap((po) => (Array.isArray(po.picking_ids) ? po.picking_ids : []));
    const pickingsById = new Map();
    if (pickingsNeededIds.length > 0) {
        const pickings = await client.readRecords('stock.picking', [...new Set(pickingsNeededIds)], ['id', 'state']).catch(() => []);
        pickings.forEach((p) => pickingsById.set(p.id, p));
    }
    const evaluation = evaluateSaleOrderInvoicePaymentStatus({
        order,
        linkedPos,
        invoices,
        pickingsById,
        now: options?.now,
    });
    return applySaleOrderBillingEvaluation(client, evaluation, { dryRun: options?.dryRun });
}
async function checkSaleOrderInvoicePaymentForPurchaseOrder(client, purchaseOrderId, options) {
    const companyId = await client.getTargetCompanyIdValue();
    const pos = await client.readRecords('purchase.order', [purchaseOrderId], ['id', 'name', 'state', 'company_id', 'origin', 'date_approve', 'date_order', 'create_date', 'receipt_status', 'picking_ids']);
    const po = pos[0];
    if (!po)
        return null;
    const poCompanyId = relationId(po.company_id);
    if ((poCompanyId && poCompanyId !== companyId) || String(po.name || '').toUpperCase().startsWith('VA/')) {
        return null;
    }
    const origin = String(po.origin || '').trim();
    let soName = (0, helpers_1.extractSoNameFromOrigin)(origin);
    if (!soName && /^WH\/MO\//i.test(origin)) {
        const mos = await client.searchReadRecords('mrp.production', {
            domain: [['company_id', '=', companyId], ['name', '=', origin]],
            fields: ['id', 'origin'],
            limit: 1,
        }).catch(() => []);
        if (mos[0]?.origin) {
            soName = (0, helpers_1.extractSoNameFromOrigin)(String(mos[0].origin));
        }
    }
    if (!soName)
        return null;
    const sos = await client.searchReadRecords('sale.order', {
        domain: [['company_id', '=', companyId], ['name', '=', soName]],
        fields: ['id'],
        limit: 1,
    }).catch(() => []);
    if (!sos[0]?.id)
        return null;
    return checkSaleOrderInvoiceAndPayment(client, sos[0].id, options);
}
async function checkSaleOrderInvoicePaymentForInvoice(client, invoiceId, options) {
    const companyId = await client.getTargetCompanyIdValue();
    const invs = await client.readRecords('account.move', [invoiceId], ['id', 'move_type', 'invoice_origin', 'company_id']).catch(() => []);
    const inv = invs[0];
    if (!inv || !['out_invoice', 'out_receipt'].includes(String(inv.move_type || '')))
        return null;
    const soName = (0, helpers_1.extractSoNameFromOrigin)(String(inv.invoice_origin || ''));
    if (!soName)
        return null;
    const sos = await client.searchReadRecords('sale.order', {
        domain: [['company_id', '=', companyId], ['name', '=', soName]],
        fields: ['id'],
        limit: 1,
    }).catch(() => []);
    if (!sos[0]?.id)
        return null;
    return checkSaleOrderInvoiceAndPayment(client, sos[0].id, options);
}
async function checkSaleOrderInvoicePaymentForPayment(client, paymentId, options) {
    const payments = await client.readRecords('account.payment', [paymentId], ['id', 'reconciled_invoice_ids']).catch(() => []);
    const invoiceIds = Array.isArray(payments[0]?.reconciled_invoice_ids)
        ? payments[0].reconciled_invoice_ids.map(Number).filter(Boolean)
        : [];
    const outcomes = [];
    for (const invId of invoiceIds.slice(0, 10)) {
        const outcome = await checkSaleOrderInvoicePaymentForInvoice(client, invId, options).catch(() => null);
        if (outcome)
            outcomes.push(outcome);
    }
    return outcomes;
}
async function checkSaleOrderInvoicePaymentForPicking(client, pickingId, options) {
    const companyId = await client.getTargetCompanyIdValue();
    const pickings = await client.readRecords('stock.picking', [pickingId], ['id', 'state', 'origin', 'purchase_id']).catch(() => []);
    const picking = pickings[0];
    if (!picking)
        return null;
    const poId = relationId(picking.purchase_id);
    if (poId) {
        return checkSaleOrderInvoicePaymentForPurchaseOrder(client, poId, options);
    }
    const origin = String(picking.origin || '').trim();
    if (/^P\d{3,}|^PO\d{3,}/i.test(origin)) {
        const pos = await client.searchReadRecords('purchase.order', {
            domain: [['company_id', '=', companyId], ['name', '=', origin]],
            fields: ['id'],
            limit: 1,
        }).catch(() => []);
        if (pos[0]?.id) {
            return checkSaleOrderInvoicePaymentForPurchaseOrder(client, pos[0].id, options);
        }
    }
    return null;
}
async function runSaleOrderInvoicePaymentSweep(options) {
    const now = options?.now || new Date();
    const lookbackDays = Math.max(2, Number(options?.lookbackDays || exports.DEFAULT_SWEEP_LOOKBACK_DAYS));
    const dryRun = Boolean(options?.dryRun);
    let client = options?.client;
    if (!client) {
        const settings = await (0, repositories_1.getSettings)();
        client = new odooClient_1.OdooClient(settings.odoo);
    }
    const companyId = await client.getTargetCompanyIdValue();
    const sinceDate = new Date(now.getTime() - lookbackDays * 86_400_000);
    const sinceUtcStr = sinceDate.toISOString().slice(0, 19).replace('T', ' ');
    // 1. Fetch confirmed Sales Orders in Company 1 within lookback window (1 RPC)
    const orders = await client.searchReadRecords('sale.order', {
        domain: [
            ['company_id', '=', companyId],
            ['state', 'in', ['sale', 'done']],
            ['date_order', '>=', sinceUtcStr],
            ['amount_total', '>', 0],
        ],
        fields: ['id', 'name', 'state', 'company_id', 'partner_id', 'user_id', 'create_uid', 'date_order', 'create_date', 'amount_total', 'invoice_ids', 'invoice_status'],
        limit: 250,
        order: 'date_order desc, id desc',
    });
    const validOrders = orders.filter((o) => !String(o.name || '').toUpperCase().startsWith('VA/'));
    if (!validOrders.length) {
        return {
            scannedOrders: 0,
            poTriggeredChecked: 0,
            nonPo48hChecked: 0,
            waiting48hCount: 0,
            compliantCount: 0,
            activitiesCreated: 0,
            activitiesAlreadyOpen: 0,
            activitiesClosed: 0,
            missingInvoiceCount: 0,
            draftInvoiceOnlyCount: 0,
            missingPaymentCount: 0,
            outcomes: [],
        };
    }
    const orderIds = validOrders.map((o) => o.id);
    const orderNames = validOrders.map((o) => o.name);
    const allInvoiceIds = [...new Set(validOrders.flatMap((o) => (Array.isArray(o.invoice_ids) ? o.invoice_ids.map(Number) : [])).filter(Boolean))];
    // 2. Bulk-fetch linked POs, MOs, customer invoices, and open activities (4 RPCs total for ALL orders!)
    const [recentPos, linkedMos, allInvoices, openActivities] = await Promise.all([
        client.searchReadRecords('purchase.order', {
            domain: [
                ['company_id', '=', companyId],
                ['state', '!=', 'cancel'],
                ['create_date', '>=', new Date(sinceDate.getTime() - 7 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')],
            ],
            fields: ['id', 'name', 'state', 'company_id', 'origin', 'date_approve', 'date_order', 'create_date', 'receipt_status', 'picking_ids'],
            limit: 500,
            order: 'id desc',
        }).catch(() => []),
        client.searchReadRecords('mrp.production', {
            domain: [
                ['company_id', '=', companyId],
                ['origin', 'in', orderNames],
                ['state', '!=', 'cancel'],
            ],
            fields: ['id', 'name', 'origin'],
            limit: 1000,
        }).catch(() => []),
        allInvoiceIds.length > 0
            ? client.readRecords('account.move', allInvoiceIds, ['id', 'name', 'move_type', 'state', 'payment_state', 'amount_total', 'amount_residual', 'invoice_origin']).catch(() => [])
            : Promise.resolve([]),
        client.searchReadRecords('mail.activity', {
            domain: [
                ['res_model', '=', 'sale.order'],
                ['res_id', 'in', orderIds],
            ],
            fields: ['id', 'res_id', 'summary', 'note', 'user_id', 'date_deadline', 'create_date'],
            limit: 500,
        }).catch(() => []),
    ]);
    // Map MO name -> SO name so MO-origin POs link accurately
    const moNameToSoName = new Map();
    for (const mo of linkedMos) {
        const soName = (0, helpers_1.extractSoNameFromOrigin)(String(mo.origin || ''));
        if (soName && mo.name) {
            moNameToSoName.set(String(mo.name).trim().toUpperCase(), soName.toUpperCase());
        }
    }
    // Group POs by Sales Order name
    const posBySoName = new Map();
    for (const po of recentPos) {
        if (String(po.name || '').toUpperCase().startsWith('VA/'))
            continue;
        const rawOrigin = String(po.origin || '').trim();
        let soName = (0, helpers_1.extractSoNameFromOrigin)(rawOrigin);
        if (!soName && rawOrigin) {
            soName = moNameToSoName.get(rawOrigin.toUpperCase()) || null;
        }
        if (!soName)
            continue;
        const key = soName.toUpperCase();
        const list = posBySoName.get(key) || [];
        list.push(po);
        posBySoName.set(key, list);
    }
    const invoicesById = new Map();
    for (const inv of allInvoices) {
        invoicesById.set(inv.id, inv);
    }
    const activitiesByOrderId = new Map();
    for (const act of openActivities) {
        const rid = Number(act.res_id || 0);
        if (!rid)
            continue;
        const list = activitiesByOrderId.get(rid) || [];
        list.push(act);
        activitiesByOrderId.set(rid, list);
    }
    // Fetch pickings only for draft/unapproved POs that might still have done pickings
    const unapprovedPickingIds = recentPos
        .filter((po) => !isPoApprovedOrGoodsReceived(po).triggered && Array.isArray(po.picking_ids))
        .flatMap((po) => (Array.isArray(po.picking_ids) ? po.picking_ids : []));
    const pickingsById = new Map();
    if (unapprovedPickingIds.length > 0) {
        const pickings = await client.readRecords('stock.picking', [...new Set(unapprovedPickingIds)].slice(0, 300), ['id', 'state']).catch(() => []);
        pickings.forEach((p) => pickingsById.set(p.id, p));
    }
    const summary = {
        scannedOrders: validOrders.length,
        poTriggeredChecked: 0,
        nonPo48hChecked: 0,
        waiting48hCount: 0,
        compliantCount: 0,
        activitiesCreated: 0,
        activitiesAlreadyOpen: 0,
        activitiesClosed: 0,
        missingInvoiceCount: 0,
        draftInvoiceOnlyCount: 0,
        missingPaymentCount: 0,
        outcomes: [],
    };
    for (const order of validOrders) {
        const linkedPos = posBySoName.get(String(order.name || '').trim().toUpperCase()) || [];
        const orderInvoices = (Array.isArray(order.invoice_ids) ? order.invoice_ids : [])
            .map((id) => invoicesById.get(Number(id)))
            .filter((inv) => Boolean(inv));
        const evaluation = evaluateSaleOrderInvoicePaymentStatus({
            order,
            linkedPos,
            invoices: orderInvoices,
            pickingsById,
            now,
        });
        if (evaluation.triggerType === 'po_approved_or_received')
            summary.poTriggeredChecked += 1;
        else if (evaluation.triggerType === 'no_po_48h')
            summary.nonPo48hChecked += 1;
        if (evaluation.status === 'waiting_48h_window')
            summary.waiting48hCount += 1;
        else if (evaluation.status === 'compliant')
            summary.compliantCount += 1;
        else if (evaluation.status === 'missing_invoice')
            summary.missingInvoiceCount += 1;
        else if (evaluation.status === 'draft_invoice_only')
            summary.draftInvoiceOnlyCount += 1;
        else if (evaluation.status === 'missing_payment')
            summary.missingPaymentCount += 1;
        try {
            const outcome = await applySaleOrderBillingEvaluation(client, evaluation, {
                preloadedOpenActivities: activitiesByOrderId.get(order.id) || [],
                dryRun,
            });
            summary.outcomes.push(outcome);
            if (outcome.action === 'created_activity')
                summary.activitiesCreated += 1;
            else if (outcome.action === 'activity_already_open')
                summary.activitiesAlreadyOpen += 1;
            else if (outcome.action === 'closed_activities')
                summary.activitiesClosed += (outcome.closedCount || 0);
        }
        catch (err) {
            await (0, logService_1.logEvent)('warn', 'Failed to apply Sales Order invoice/payment reminder action', {
                orderId: order.id,
                orderName: order.name,
                error: err instanceof Error ? err.message : String(err),
            }).catch(() => undefined);
        }
    }
    return summary;
}
// ─── Background Interval Runner ──────────────────────────────────────
let sweepTimer = null;
let sweepRunning = false;
async function runScheduledSweepOnce() {
    if (sweepRunning || (0, odooClient_1.isOdooTrafficPaused)() || (0, odooClient_1.isSchedulerRunActive)()) {
        return;
    }
    sweepRunning = true;
    try {
        await (0, odooClient_1.runWithOdooPriority)('background', async () => {
            const result = await runSaleOrderInvoicePaymentSweep({ lookbackDays: exports.DEFAULT_SWEEP_LOOKBACK_DAYS });
            if (result.activitiesCreated > 0 || result.activitiesClosed > 0) {
                await (0, logService_1.logEvent)('info', 'Sales Order invoice & payment accountability sweep completed', {
                    scannedOrders: result.scannedOrders,
                    poTriggeredChecked: result.poTriggeredChecked,
                    nonPo48hChecked: result.nonPo48hChecked,
                    activitiesCreated: result.activitiesCreated,
                    activitiesClosed: result.activitiesClosed,
                    missingInvoiceCount: result.missingInvoiceCount,
                    draftInvoiceOnlyCount: result.draftInvoiceOnlyCount,
                    missingPaymentCount: result.missingPaymentCount,
                }).catch(() => undefined);
            }
        });
    }
    catch (err) {
        console.warn('[so-invoice-payment-reminder] Scheduled sweep failed:', err instanceof Error ? err.message : err);
    }
    finally {
        sweepRunning = false;
    }
}
function startSaleOrderInvoicePaymentReminderInterval() {
    if (sweepTimer)
        return;
    // Defer first run well after server boot so it never competes with cold starts or user traffic
    setTimeout(() => {
        void runScheduledSweepOnce();
    }, 90_000).unref();
    sweepTimer = setInterval(() => {
        void runScheduledSweepOnce();
    }, SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
}
function stopSaleOrderInvoicePaymentReminderInterval() {
    if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
}
