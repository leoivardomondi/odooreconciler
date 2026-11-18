"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEligibleStandaloneEtrPo = isEligibleStandaloneEtrPo;
exports.syncStandaloneEtrPoToCompany3 = syncStandaloneEtrPoToCompany3;
exports.syncAllPendingStandaloneEtrPos = syncAllPendingStandaloneEtrPos;
exports.discoverAndLogMovedCompany3EtrPos = discoverAndLogMovedCompany3EtrPos;
const logService_js_1 = require("./logService.js");
const repositories_js_1 = require("../models/repositories.js");
const URBAN_VIBE_2_COMPANY_ID = 3;
const URBAN_VIBE_1_COMPANY_ID = 1;
const COMPANY_3_BANK_JOURNAL_ID = 25; // Bank (BNK1)
const START_DATE_FILTER = '2026-11-01 00:00:00';
const PO_TAX_OPTION_FIELD = 'x_studio_selection_field_68_1k74mkea1';
/**
 * Checks if a purchase order is a standalone ETR PO from November 1st, 2026 onwards in Company 1.
 */
function isEligibleStandaloneEtrPo(po) {
    if (!po || po.company_id?.[0] !== URBAN_VIBE_1_COMPANY_ID) {
        return false;
    }
    const taxOption = String(po[PO_TAX_OPTION_FIELD] || '').trim().toUpperCase();
    if (taxOption !== 'ETR') {
        return false;
    }
    // Standalone: origin is false/empty or does not reference a Sales Order
    if (po.origin && (po.origin.trim().startsWith('S0') || po.origin.trim().toUpperCase().includes('SO'))) {
        return false;
    }
    const dateOrder = po.date_order || '';
    if (dateOrder < START_DATE_FILTER) {
        return false;
    }
    return true;
}
/**
 * Synchronizes standalone ETR Purchase Orders from Company 1 to Company 3 (URBAN VIBE 2).
 * - Creates identical mirror PO in Company 3.
 * - When approved/confirmed in Company 1: confirms mirror PO in Company 3, validates receipt,
 *   generates Vendor Bill, sets dates, posts it, and registers outbound payment via Journal 25 (Bank).
 */
async function syncStandaloneEtrPoToCompany3(client, sourcePoId) {
    const [sourcePo] = await client.searchReadRecords('purchase.order', {
        domain: [['id', '=', sourcePoId]],
        fields: [
            'id',
            'name',
            'partner_id',
            'company_id',
            'date_order',
            'date_approve',
            'origin',
            'state',
            'amount_total',
            'order_line',
            PO_TAX_OPTION_FIELD,
        ],
        limit: 1,
    });
    if (!sourcePo) {
        return {
            sourcePoId,
            sourcePoName: `PO#${sourcePoId}`,
            sourcePoState: 'unknown',
            action: 'skipped',
            message: `Purchase order ${sourcePoId} not found in Odoo.`,
        };
    }
    if (!isEligibleStandaloneEtrPo(sourcePo)) {
        return {
            sourcePoId,
            sourcePoName: sourcePo.name,
            sourcePoState: sourcePo.state,
            action: 'skipped',
            message: `PO ${sourcePo.name} is not an eligible standalone ETR PO in Company 1 (origin=${sourcePo.origin}, tax_option=${sourcePo[PO_TAX_OPTION_FIELD]}).`,
        };
    }
    // Check if mirror PO already exists in Company 3
    const existingMirrors = await client.searchReadRecords('purchase.order', {
        domain: [
            ['company_id', '=', URBAN_VIBE_2_COMPANY_ID],
            ['origin', '=', sourcePo.name],
        ],
        fields: ['id', 'name', 'state', 'company_id', 'origin', 'invoice_ids', 'picking_ids'],
        limit: 1,
    });
    let targetPo = existingMirrors[0] || null;
    // 1. Create target PO in Company 3 if it does not exist
    if (!targetPo) {
        const lines = await client.searchReadRecords('purchase.order.line', {
            domain: [['order_id', '=', sourcePo.id]],
            fields: ['product_id', 'name', 'product_qty', 'product_uom_id', 'price_unit', 'tax_ids', 'date_planned'],
        });
        const createOrderLines = lines.map((l) => [
            0,
            0,
            {
                product_id: l.product_id[0],
                name: l.name,
                product_qty: l.product_qty,
                product_uom_id: l.product_uom_id ? l.product_uom_id[0] : false,
                price_unit: l.price_unit,
                date_planned: l.date_planned || sourcePo.date_order,
            },
        ]);
        const newTargetPoId = await client.createRecord('purchase.order', {
            partner_id: sourcePo.partner_id[0],
            company_id: URBAN_VIBE_2_COMPANY_ID,
            origin: sourcePo.name,
            date_order: sourcePo.date_order,
            [PO_TAX_OPTION_FIELD]: 'ETR',
            order_line: createOrderLines,
        }, { allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID] });
        await client.postModelChatterMessage('purchase.order', newTargetPoId, `🔗 <b>Cross-Company Mirror:</b> Created in URBAN VIBE 2 to match standalone ETR PO <b>${sourcePo.name}</b> from Company 1.`);
        const [freshTarget] = await client.searchReadRecords('purchase.order', {
            domain: [['id', '=', newTargetPoId]],
            fields: ['id', 'name', 'state', 'company_id', 'origin', 'invoice_ids', 'picking_ids'],
            limit: 1,
        });
        targetPo = freshTarget;
    }
    // 2. If source PO is still draft or to approve, target PO stays in draft
    const isSourceApproved = ['purchase', 'done'].includes(sourcePo.state);
    if (!isSourceApproved) {
        await (0, repositories_js_1.upsertCrossCompanyPoLog)({
            source_po_id: sourcePo.id,
            source_po_name: sourcePo.name,
            source_company_id: URBAN_VIBE_1_COMPANY_ID,
            target_company_id: URBAN_VIBE_2_COMPANY_ID,
            target_po_id: targetPo.id,
            target_po_name: targetPo.name,
            partner_id: sourcePo.partner_id ? sourcePo.partner_id[0] : null,
            partner_name: sourcePo.partner_id ? sourcePo.partner_id[1] : null,
            tax_option: 'ETR',
            amount_total: sourcePo.amount_total,
            source_state: sourcePo.state,
            target_state: targetPo.state,
            origin: sourcePo.name,
            action: 'created_draft',
            message: `Mirror PO ${targetPo.name} created/kept in draft in Company 3 awaiting source PO approval.`,
            moved_at: sourcePo.date_order || undefined,
        }).catch(() => null);
        return {
            sourcePoId: sourcePo.id,
            sourcePoName: sourcePo.name,
            sourcePoState: sourcePo.state,
            targetPoId: targetPo.id,
            targetPoName: targetPo.name,
            action: 'created_draft',
            message: `Mirror PO ${targetPo.name} created/kept in draft in Company 3 awaiting source PO approval.`,
        };
    }
    // 3. Confirm target PO if not yet confirmed
    if (targetPo.state === 'draft' || targetPo.state === 'sent') {
        await client.callRecordMethod('purchase.order', 'button_confirm', [targetPo.id], {
            context: { allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID] },
        });
        if (sourcePo.date_approve) {
            await client.writeRecord('purchase.order', [targetPo.id], { date_approve: sourcePo.date_approve });
        }
    }
    // 4. Validate any incoming stock receipts for target PO so products can be billed
    const [refreshedTargetPo] = await client.searchReadRecords('purchase.order', {
        domain: [['id', '=', targetPo.id]],
        fields: ['id', 'name', 'state', 'picking_ids', 'invoice_ids'],
        limit: 1,
    });
    if (refreshedTargetPo?.picking_ids?.length) {
        const pickings = await client.searchReadRecords('stock.picking', {
            domain: [
                ['id', 'in', refreshedTargetPo.picking_ids],
                ['state', 'not in', ['done', 'cancel']],
            ],
            fields: ['id', 'name', 'state', 'move_ids'],
        });
        for (const picking of pickings) {
            if (picking.move_ids.length > 0) {
                const moves = await client.searchReadRecords('stock.move', {
                    domain: [['id', 'in', picking.move_ids]],
                    fields: ['id', 'product_uom_qty', 'quantity'],
                });
                for (const m of moves) {
                    await client.writeRecord('stock.move', [m.id], { quantity: m.product_uom_qty });
                }
            }
            await client.callRecordMethod('stock.picking', 'button_validate', [picking.id], {
                context: { allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID] },
            });
        }
    }
    // 5. Create Vendor Bill in Company 3 if needed
    let validBills = await client.searchReadRecords('account.move', {
        domain: [
            ['id', 'in', refreshedTargetPo.invoice_ids || []],
            ['move_type', '=', 'in_invoice'],
            ['state', '!=', 'cancel'],
            ['amount_total', '>', 0],
        ],
        fields: ['id', 'name', 'state', 'payment_state', 'amount_total', 'invoice_date'],
    });
    if (validBills.length === 0) {
        await client.callRecordMethod('purchase.order', 'action_create_invoice', [targetPo.id], {
            context: { allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID] },
        });
        const [afterBillTarget] = await client.searchReadRecords('purchase.order', {
            domain: [['id', '=', targetPo.id]],
            fields: ['invoice_ids'],
            limit: 1,
        });
        validBills = await client.searchReadRecords('account.move', {
            domain: [
                ['id', 'in', afterBillTarget?.invoice_ids || []],
                ['move_type', '=', 'in_invoice'],
                ['state', '!=', 'cancel'],
                ['amount_total', '>', 0],
            ],
            fields: ['id', 'name', 'state', 'payment_state', 'amount_total', 'invoice_date'],
        });
    }
    // Determine effective bill date from source approval / order date
    const billDate = sourcePo.date_approve
        ? sourcePo.date_approve.split(' ')[0]
        : sourcePo.date_order
            ? sourcePo.date_order.split(' ')[0]
            : false;
    let paidBillCount = 0;
    let lastBillId;
    let lastBillName;
    let lastPaymentId;
    let lastPaymentName;
    // 6. Post bills and register payment with Journal 25 (Bank)
    for (const bill of validBills) {
        lastBillId = bill.id;
        lastBillName = bill.name || `Bill#${bill.id}`;
        // Set dates and post if in draft
        if (bill.state === 'draft') {
            if (billDate) {
                await client.writeRecord('account.move', [bill.id], { invoice_date: billDate, date: billDate });
            }
            await client.callRecordMethod('account.move', 'action_post', [bill.id], {
                context: { allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID] },
            });
        }
        // Register payment if posted and not yet paid
        const [freshBill] = await client.searchReadRecords('account.move', {
            domain: [['id', '=', bill.id]],
            fields: ['id', 'name', 'state', 'payment_state', 'amount_total'],
            limit: 1,
        });
        lastBillName = freshBill?.name || lastBillName;
        if (freshBill && freshBill.state === 'posted' && ['not_paid', 'partial'].includes(freshBill.payment_state)) {
            const regContext = {
                active_model: 'account.move',
                active_ids: [freshBill.id],
                allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID],
            };
            const wizardVals = {
                journal_id: COMPANY_3_BANK_JOURNAL_ID,
                payment_method_line_id: 25, // Manual Outbound Payment for Journal 25
                x_paid_by: true,
            };
            if (billDate) {
                wizardVals.payment_date = billDate;
            }
            const wizardId = await client.createRecord('account.payment.register', wizardVals, regContext);
            if (wizardId) {
                await client.callRecordMethod('account.payment.register', 'action_create_payments', [wizardId], {
                    context: regContext,
                });
                // Find created payment
                const payments = await client.searchReadRecords('account.payment', {
                    domain: [
                        ['company_id', '=', URBAN_VIBE_2_COMPANY_ID],
                        ['journal_id', '=', COMPANY_3_BANK_JOURNAL_ID],
                    ],
                    fields: ['id', 'name'],
                    limit: 1,
                    order: 'id desc',
                });
                if (payments[0]) {
                    lastPaymentId = payments[0].id;
                    lastPaymentName = payments[0].name;
                }
                await client.postModelChatterMessage('account.move', freshBill.id, `💳 <b>Payment Registered:</b> Paid via Bank Journal (ABC Bank/Journal 25) on date ${billDate || 'current'} for bill ${freshBill.name}.`);
                paidBillCount++;
            }
        }
        else if (freshBill && ['paid', 'in_payment'].includes(freshBill.payment_state)) {
            paidBillCount++;
        }
    }
    const resultAction = paidBillCount > 0 ? 'approved_and_paid' : 'already_up_to_date';
    const message = `PO ${sourcePo.name} successfully mirrored to Company 3 (${targetPo.name}). Bill: ${lastBillName || 'none'}, Paid: ${paidBillCount > 0}.`;
    // Prevent duplicate chatter notes on the source PO
    const sourceChatterMessages = await client.searchReadRecords('mail.message', {
        domain: [
            ['model', '=', 'purchase.order'],
            ['res_id', '=', sourcePo.id],
        ],
        fields: ['id', 'body'],
        limit: 15,
        order: 'id desc',
    }).catch(() => []);
    const alreadyLoggedOnSource = sourceChatterMessages.some((m) => m.body && (m.body.includes('Cross-Company Transfer') || m.body.includes('URBAN VIBE 2') || (targetPo?.name && m.body.includes(targetPo.name))));
    if (!alreadyLoggedOnSource && targetPo) {
        await client.postModelChatterMessage('purchase.order', sourcePo.id, `🏢 <b>Cross-Company Transfer / Mirror:</b> This Purchase Order (Tax Option: <b>ETR</b>) has been mirrored to <b>URBAN VIBE 2 (Company 3)</b> as <b>${targetPo.name}</b>.` +
            (paidBillCount > 0 ? `<br>• Bill: <b>${lastBillName || 'Created'}</b> | Payment: <b>${lastPaymentName || 'Paid via Bank Journal 25'}</b>.` : '')).catch(() => null);
    }
    // Persist log of PO moved to Company 3
    await (0, repositories_js_1.upsertCrossCompanyPoLog)({
        source_po_id: sourcePo.id,
        source_po_name: sourcePo.name,
        source_company_id: URBAN_VIBE_1_COMPANY_ID,
        target_company_id: URBAN_VIBE_2_COMPANY_ID,
        target_po_id: targetPo?.id,
        target_po_name: targetPo?.name,
        partner_id: sourcePo.partner_id ? sourcePo.partner_id[0] : null,
        partner_name: sourcePo.partner_id ? sourcePo.partner_id[1] : null,
        tax_option: 'ETR',
        amount_total: sourcePo.amount_total,
        source_state: sourcePo.state,
        target_state: targetPo?.state,
        origin: sourcePo.name,
        bill_id: lastBillId,
        bill_name: lastBillName,
        payment_id: lastPaymentId,
        payment_name: lastPaymentName,
        action: resultAction,
        message,
        moved_at: sourcePo.date_order || undefined,
    }).catch((err) => {
        console.warn('[CrossCompanySync] Error saving cross-company PO log:', err);
    });
    await (0, logService_js_1.logEvent)('info', 'Standalone ETR PO mirrored to URBAN VIBE 2', {
        sourcePo: sourcePo.name,
        targetPo: targetPo.name,
        amountTotal: sourcePo.amount_total,
        billName: lastBillName,
        paymentName: lastPaymentName,
    });
    return {
        sourcePoId: sourcePo.id,
        sourcePoName: sourcePo.name,
        sourcePoState: sourcePo.state,
        targetPoId: targetPo.id,
        targetPoName: targetPo.name,
        billId: lastBillId,
        billName: lastBillName,
        paymentId: lastPaymentId,
        paymentName: lastPaymentName,
        action: resultAction,
        message,
    };
}
/**
 * Sweeps all standalone ETR POs in Company 1 from November 1st, 2026 onwards and mirrors them.
 */
async function syncAllPendingStandaloneEtrPos(client) {
    const eligiblePos = await client.searchReadRecords('purchase.order', {
        domain: [
            ['company_id', '=', URBAN_VIBE_1_COMPANY_ID],
            ['date_order', '>=', START_DATE_FILTER],
            [PO_TAX_OPTION_FIELD, '=', 'ETR'],
        ],
        fields: [
            'id',
            'name',
            'partner_id',
            'company_id',
            'date_order',
            'date_approve',
            'origin',
            'state',
            'amount_total',
            'order_line',
            PO_TAX_OPTION_FIELD,
        ],
        order: 'date_order asc',
    });
    const standalonePos = eligiblePos.filter(isEligibleStandaloneEtrPo);
    const results = [];
    for (const po of standalonePos) {
        try {
            const res = await syncStandaloneEtrPoToCompany3(client, po.id);
            results.push(res);
        }
        catch (err) {
            results.push({
                sourcePoId: po.id,
                sourcePoName: po.name,
                sourcePoState: po.state,
                action: 'error',
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }
    // Also sweep Company 3 to discover and log any already moved ETR POs
    await discoverAndLogMovedCompany3EtrPos(client).catch((err) => {
        console.warn('[CrossCompanySync] Error discovering Company 3 ETR POs:', err);
    });
    return {
        timestamp: new Date().toISOString(),
        processedCount: results.length,
        results,
    };
}
/**
 * Scans Odoo Company 3 to discover all Purchase Orders that have Tax Option ETR or originated from Company 1,
 * ensuring they are all persistently tracked in cross_company_po_logs and logged in Odoo chatter.
 */
async function discoverAndLogMovedCompany3EtrPos(client) {
    const company3Pos = await client.searchReadRecords('purchase.order', {
        domain: [['company_id', '=', URBAN_VIBE_2_COMPANY_ID]],
        fields: [
            'id',
            'name',
            'partner_id',
            'company_id',
            'date_order',
            'origin',
            'state',
            'amount_total',
            'invoice_ids',
            PO_TAX_OPTION_FIELD,
        ],
        order: 'date_order desc',
        limit: 200,
        context: { allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID] },
    }).catch(() => []);
    const entries = [];
    for (const c3Po of company3Pos) {
        const taxOption = String(c3Po[PO_TAX_OPTION_FIELD] || '').trim().toUpperCase();
        const origin = String(c3Po.origin || '').trim();
        // Check if origin matches a Company 1 PO name (e.g. P01432)
        let sourcePo = null;
        if (origin && origin.startsWith('P')) {
            const [found] = await client.searchReadRecords('purchase.order', {
                domain: [
                    ['company_id', '=', URBAN_VIBE_1_COMPANY_ID],
                    ['name', '=', origin],
                ],
                fields: [
                    'id',
                    'name',
                    'partner_id',
                    'company_id',
                    'date_order',
                    'origin',
                    'state',
                    'amount_total',
                    PO_TAX_OPTION_FIELD,
                ],
                limit: 1,
            }).catch(() => []);
            sourcePo = found || null;
        }
        const effectiveTaxOption = sourcePo
            ? String(sourcePo[PO_TAX_OPTION_FIELD] || '').trim().toUpperCase() || taxOption || 'ETR'
            : (taxOption || 'ETR');
        // Only log if it involves ETR
        if (effectiveTaxOption !== 'ETR')
            continue;
        // Check bills in Company 3 if any
        let billName;
        let billId;
        if (c3Po.invoice_ids && c3Po.invoice_ids.length > 0) {
            const bills = await client.searchReadRecords('account.move', {
                domain: [['id', 'in', c3Po.invoice_ids], ['move_type', '=', 'in_invoice']],
                fields: ['id', 'name'],
                limit: 1,
                context: { allowed_company_ids: [URBAN_VIBE_2_COMPANY_ID] },
            }).catch(() => []);
            if (bills[0]) {
                billId = bills[0].id;
                billName = bills[0].name;
            }
        }
        const sourcePoId = sourcePo?.id ?? c3Po.id;
        const sourcePoName = sourcePo?.name ?? origin ?? c3Po.name;
        await (0, repositories_js_1.upsertCrossCompanyPoLog)({
            source_po_id: sourcePoId,
            source_po_name: sourcePoName,
            source_company_id: URBAN_VIBE_1_COMPANY_ID,
            target_company_id: URBAN_VIBE_2_COMPANY_ID,
            target_po_id: c3Po.id,
            target_po_name: c3Po.name,
            partner_id: c3Po.partner_id ? c3Po.partner_id[0] : (sourcePo?.partner_id ? sourcePo.partner_id[0] : null),
            partner_name: c3Po.partner_id ? c3Po.partner_id[1] : (sourcePo?.partner_id ? sourcePo.partner_id[1] : null),
            tax_option: 'ETR',
            amount_total: c3Po.amount_total,
            source_state: sourcePo?.state ?? 'unknown',
            target_state: c3Po.state,
            origin: origin || null,
            bill_id: billId,
            bill_name: billName,
            action: c3Po.state === 'purchase' || c3Po.state === 'done' ? 'approved_and_paid' : 'created_draft',
            message: `Discovered and logged ETR PO moved to Company 3 (${c3Po.name}) from ${sourcePoName}.`,
            moved_at: c3Po.date_order || sourcePo?.date_order || undefined,
        }).catch(() => null);
        // Also check and ensure log note on source PO in Company 1
        if (sourcePo) {
            const sourceMessages = await client.searchReadRecords('mail.message', {
                domain: [
                    ['model', '=', 'purchase.order'],
                    ['res_id', '=', sourcePo.id],
                ],
                fields: ['id', 'body'],
                limit: 15,
                order: 'id desc',
            }).catch(() => []);
            const alreadyHasNote = sourceMessages.some((m) => m.body && (m.body.includes('Cross-Company') || m.body.includes('URBAN VIBE 2') || m.body.includes(c3Po.name)));
            if (!alreadyHasNote) {
                await client.postModelChatterMessage('purchase.order', sourcePo.id, `🏢 <b>Cross-Company Transfer / Mirror:</b> This Purchase Order (Tax Option: <b>ETR</b>) has been mirrored to <b>URBAN VIBE 2 (Company 3)</b> as <b>${c3Po.name}</b>.` +
                    (billName ? `<br>• Vendor Bill: <b>${billName}</b>` : '')).catch(() => null);
            }
        }
        entries.push({ sourcePoName, targetPoName: c3Po.name, taxOption: 'ETR' });
    }
    return { loggedCount: entries.length, entries };
}
