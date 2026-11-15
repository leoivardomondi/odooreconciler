"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEligibleStandaloneEtrPo = isEligibleStandaloneEtrPo;
exports.syncStandaloneEtrPoToCompany3 = syncStandaloneEtrPoToCompany3;
exports.syncAllPendingStandaloneEtrPos = syncAllPendingStandaloneEtrPos;
const logService_js_1 = require("./logService.js");
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
    return {
        timestamp: new Date().toISOString(),
        processedCount: results.length,
        results,
    };
}
