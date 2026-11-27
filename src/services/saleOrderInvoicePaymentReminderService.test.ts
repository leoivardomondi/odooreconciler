import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SO_MISSING_INVOICE_ACTIVITY_SUMMARY,
  SO_DRAFT_INVOICE_ACTIVITY_SUMMARY,
  SO_MISSING_PAYMENT_ACTIVITY_SUMMARY,
  evaluateSaleOrderInvoicePaymentStatus,
  applySaleOrderBillingEvaluation,
  isPoApprovedOrGoodsReceived,
  hasRegisteredInvoicePayment,
} from './saleOrderInvoicePaymentReminderService';

const NOW = new Date('2026-11-27T08:00:00Z'); // 11:00 AM EAT

test('saleOrderInvoicePaymentReminderService - PO Approved / Goods Received Rules', async (t) => {
  await t.test('approved PO with missing customer invoice triggers immediately from PO confirmation', () => {
    const evalResult = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4196,
        name: 'S04010',
        state: 'sale',
        company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
        partner_id: [617, 'JOY INTERIORS'],
        user_id: [2, 'Sharon Araka'],
        date_order: '2026-11-27 06:00:00', // only 2h ago — should still trigger immediately because PO is approved!
        amount_total: 17200,
        invoice_ids: [],
      },
      linkedPos: [
        {
          id: 1516,
          name: 'P01517',
          state: 'purchase',
          company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
          origin: 'S04010',
          date_approve: '2026-11-27 07:00:00',
          receipt_status: 'pending',
        },
      ],
      invoices: [],
      now: NOW,
    });

    assert.equal(evalResult.status, 'missing_invoice');
    assert.equal(evalResult.triggerType, 'po_approved_or_received');
    assert.equal(evalResult.salespersonUserId, 2);
    assert.equal(evalResult.requiredActivitySummary, SO_MISSING_INVOICE_ACTIVITY_SUMMARY);
    assert.deepEqual(evalResult.triggerPoNames, ['P01517']);
  });

  await t.test('PO with goods received (done picking) and posted unpaid invoice flags missing payment', () => {
    const evalResult = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4200,
        name: 'S04020',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [100, 'CLIENT A'],
        user_id: [13, 'Candy Venesa'],
        date_order: '2026-11-27 05:00:00',
        amount_total: 40000,
        invoice_ids: [7001],
      },
      linkedPos: [
        {
          id: 1600,
          name: 'P01600',
          state: 'purchase',
          company_id: [1, 'URBAN VIBE'],
          origin: 'S04020',
          date_approve: '2026-11-27 06:00:00',
          receipt_status: 'partial',
          picking_ids: [9001],
        },
      ],
      invoices: [
        {
          id: 7001,
          name: 'INV/2026/02001',
          move_type: 'out_invoice',
          state: 'posted',
          payment_state: 'not_paid',
          amount_total: 40000,
          amount_residual: 40000,
        },
      ],
      pickingsById: new Map([[9001, { id: 9001, state: 'done' }]]),
      now: NOW,
    });

    assert.equal(evalResult.status, 'missing_payment');
    assert.equal(evalResult.hasGoodsReceivedPo, true);
    assert.equal(evalResult.salespersonUserId, 13);
    assert.equal(evalResult.requiredActivitySummary, SO_MISSING_PAYMENT_ACTIVITY_SUMMARY);
  });

  await t.test('approved PO with only a draft invoice flags CONFIRM INVOICE & REGISTER PAYMENT', () => {
    const evalResult = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4201,
        name: 'S04021',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [101, 'CLIENT B'],
        user_id: [2, 'Sharon Araka'],
        date_order: '2026-11-27 05:00:00',
        amount_total: 15000,
        invoice_ids: [7002],
      },
      linkedPos: [
        { id: 1601, name: 'P01601', state: 'purchase', company_id: [1, 'URBAN VIBE'], origin: 'S04021', date_approve: '2026-11-27 06:30:00' },
      ],
      invoices: [
        { id: 7002, name: 'Draft', move_type: 'out_invoice', state: 'draft', payment_state: 'not_paid', amount_total: 15000, amount_residual: 15000 },
      ],
      now: NOW,
    });

    assert.equal(evalResult.status, 'draft_invoice_only');
    assert.equal(evalResult.requiredActivitySummary, SO_DRAFT_INVOICE_ACTIVITY_SUMMARY);
  });

  await t.test('approved PO with partial OR full customer payment registered is compliant', () => {
    const partialEval = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4186,
        name: 'S04000',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [762, 'DECEMBER KELI'],
        user_id: [2, 'Sharon Araka'],
        date_order: '2026-11-26 08:36:45',
        amount_total: 36610,
        invoice_ids: [6215],
      },
      linkedPos: [
        { id: 1512, name: 'P01513', state: 'purchase', company_id: [1, 'URBAN VIBE'], origin: 'S04000', date_approve: '2026-11-26 08:57:28' },
      ],
      invoices: [
        { id: 6215, name: 'INV/2026/01764', move_type: 'out_invoice', state: 'posted', payment_state: 'partial', amount_total: 36610, amount_residual: 16610 },
      ],
      now: NOW,
    });
    assert.equal(partialEval.status, 'compliant');
    assert.equal(partialEval.requiredActivitySummary, null);

    const paidEval = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4187,
        name: 'S04001',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [498, 'JUSTUS OCHIENG'],
        user_id: [13, 'Candy Venesa'],
        date_order: '2026-11-26 09:04:48',
        amount_total: 54500,
        invoice_ids: [6219],
      },
      linkedPos: [
        { id: 1514, name: 'P01515', state: 'purchase', company_id: [1, 'URBAN VIBE'], origin: 'S04001', date_approve: '2026-11-26 10:46:50' },
      ],
      invoices: [
        { id: 6219, name: 'INV/2026/01766', move_type: 'out_invoice', state: 'posted', payment_state: 'paid', amount_total: 54500, amount_residual: 0 },
      ],
      now: NOW,
    });
    assert.equal(paidEval.status, 'compliant');
  });
});

test('saleOrderInvoicePaymentReminderService - Non-PO 48-Hour Rule & Exclusions', async (t) => {
  await t.test('SO without PO waits until 48 hours have elapsed since confirmation', () => {
    const within48h = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4074,
        name: 'S03892',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [21, 'JEREMIAH ODERA'],
        user_id: [13, 'Candy Venesa'],
        date_order: '2026-11-26 14:00:00', // 18h before NOW -> < 48h
        amount_total: 38020,
        invoice_ids: [],
      },
      linkedPos: [],
      invoices: [],
      now: NOW,
    });
    assert.equal(within48h.status, 'waiting_48h_window');
    assert.equal(within48h.requiredActivitySummary, null);

    // Draft/unapproved PO with no received goods does NOT bypass 48h wait
    const draftPoOnly = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4075,
        name: 'S03893',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [21, 'JEREMIAH ODERA'],
        user_id: [13, 'Candy Venesa'],
        date_order: '2026-11-26 14:00:00',
        amount_total: 20000,
        invoice_ids: [],
      },
      linkedPos: [
        { id: 1700, name: 'P01700', state: 'draft', company_id: [1, 'URBAN VIBE'], origin: 'S03893', receipt_status: 'pending' },
      ],
      invoices: [],
      now: NOW,
    });
    assert.equal(draftPoOnly.status, 'waiting_48h_window');
  });

  await t.test('SO without PO after 48+ hours flags missing invoice or missing payment', () => {
    const past48hMissingInvoice = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4050,
        name: 'S03850',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [50, 'CLIENT 48H'],
        user_id: [2, 'Sharon Araka'],
        date_order: '2026-11-25 06:00:00', // 50h before NOW -> >= 48h
        amount_total: 12000,
        invoice_ids: [],
      },
      linkedPos: [],
      invoices: [],
      now: NOW,
    });
    assert.equal(past48hMissingInvoice.status, 'missing_invoice');
    assert.equal(past48hMissingInvoice.triggerType, 'no_po_48h');
    assert.equal(past48hMissingInvoice.requiredActivitySummary, SO_MISSING_INVOICE_ACTIVITY_SUMMARY);

    const past48hUnpaidInvoice = evaluateSaleOrderInvoicePaymentStatus({
      order: {
        id: 4051,
        name: 'S03851',
        state: 'sale',
        company_id: [1, 'URBAN VIBE'],
        partner_id: [51, 'CLIENT 48H UNPAID'],
        user_id: [13, 'Candy Venesa'],
        date_order: '2026-11-24 08:00:00', // 72h before NOW
        amount_total: 9500,
        invoice_ids: [8001],
      },
      linkedPos: [],
      invoices: [
        { id: 8001, name: 'INV/2026/01700', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_total: 9500, amount_residual: 9500 },
      ],
      now: NOW,
    });
    assert.equal(past48hUnpaidInvoice.status, 'missing_payment');
    assert.equal(past48hUnpaidInvoice.triggerType, 'no_po_48h');
    assert.equal(past48hUnpaidInvoice.requiredActivitySummary, SO_MISSING_PAYMENT_ACTIVITY_SUMMARY);
  });

  await t.test('excludes Company 3 / VA/ orders and unconfirmed quotations', () => {
    const company3 = evaluateSaleOrderInvoicePaymentStatus({
      order: { id: 9001, name: 'VA/S0010', state: 'sale', company_id: [3, 'URBAN VIBE 2'], date_order: '2026-11-20 08:00:00', amount_total: 50000 },
      linkedPos: [],
      invoices: [],
      now: NOW,
    });
    assert.equal(company3.status, 'skipped_excluded');

    const draftSo = evaluateSaleOrderInvoicePaymentStatus({
      order: { id: 9002, name: 'S04999', state: 'draft', company_id: [1, 'URBAN VIBE'], date_order: '2026-11-20 08:00:00', amount_total: 50000 },
      linkedPos: [],
      invoices: [],
      now: NOW,
    });
    assert.equal(draftSo.status, 'skipped_not_confirmed');

    assert.equal(isPoApprovedOrGoodsReceived({ id: 1, name: 'VA/P001', state: 'purchase', company_id: [3, 'URBAN VIBE 2'] }).triggered, false);
    assert.equal(hasRegisteredInvoicePayment({ id: 1, name: 'INV', state: 'posted', payment_state: 'not_paid', amount_total: 1000, amount_residual: 400 }), true);
  });
});

test('saleOrderInvoicePaymentReminderService - Activity Lifecycle (Create, Deduplicate, Transition, Auto-Close)', async (t) => {
  await t.test('transitions stale missing-invoice activity to missing-payment and auto-closes when paid', async () => {
    const closedIds: number[][] = [];
    const createdPayloads: any[] = [];
    const mockClient = {
      searchReadRecords: async (model: string) => {
        if (model === 'ir.model') return [{ id: 10, model: 'sale.order' }];
        if (model === 'mail.activity.type') return [{ id: 4, name: 'To Do' }];
        return [];
      },
      createRecord: async (_model: string, vals: any) => {
        createdPayloads.push(vals);
        return 555;
      },
      callRecordMethod: async (_model: string, _method: string, ids: number[]) => {
        closedIds.push(ids);
        return true;
      },
    } as any;

    // 1. Order now has posted unpaid invoice, while old "CREATE CUSTOMER INVOICE" activity #77 is still open
    const missingPaymentEval = evaluateSaleOrderInvoicePaymentStatus({
      order: { id: 4196, name: 'S04010', state: 'sale', company_id: [1, 'URBAN VIBE'], user_id: [2, 'Sharon Araka'], date_order: '2026-11-26 10:00:00', amount_total: 17200, invoice_ids: [7100] },
      linkedPos: [{ id: 1516, name: 'P01517', state: 'purchase', company_id: [1, 'URBAN VIBE'], origin: 'S04010', date_approve: '2026-11-26 11:00:00' }],
      invoices: [{ id: 7100, name: 'INV/2026/01800', move_type: 'out_invoice', state: 'posted', payment_state: 'not_paid', amount_total: 17200, amount_residual: 17200 }],
      now: NOW,
    });

    const transitionOutcome = await applySaleOrderBillingEvaluation(mockClient, missingPaymentEval, {
      preloadedOpenActivities: [{ id: 77, summary: `${SO_MISSING_INVOICE_ACTIVITY_SUMMARY} · 26 Nov 14:00` }],
    });
    assert.equal(transitionOutcome.action, 'created_activity');
    assert.equal(transitionOutcome.activityId, 555);
    assert.deepEqual(closedIds[0], [77]); // closed superseded missing-invoice activity
    assert.equal(createdPayloads[0].user_id, 2);
    assert.match(createdPayloads[0].summary, /CONFIRM & REGISTER CUSTOMER PAYMENT/);

    // 2. Payment is registered -> auto-closes open activity #555
    const compliantEval = evaluateSaleOrderInvoicePaymentStatus({
      order: { id: 4196, name: 'S04010', state: 'sale', company_id: [1, 'URBAN VIBE'], user_id: [2, 'Sharon Araka'], date_order: '2026-11-26 10:00:00', amount_total: 17200, invoice_ids: [7100] },
      linkedPos: [{ id: 1516, name: 'P01517', state: 'purchase', company_id: [1, 'URBAN VIBE'], origin: 'S04010', date_approve: '2026-11-26 11:00:00' }],
      invoices: [{ id: 7100, name: 'INV/2026/01800', move_type: 'out_invoice', state: 'posted', payment_state: 'partial', amount_total: 17200, amount_residual: 7200 }],
      now: NOW,
    });

    const closeOutcome = await applySaleOrderBillingEvaluation(mockClient, compliantEval, {
      preloadedOpenActivities: [{ id: 555, summary: `${SO_MISSING_PAYMENT_ACTIVITY_SUMMARY} · 27 Nov 11:00` }],
    });
    assert.equal(closeOutcome.action, 'closed_activities');
    assert.equal(closeOutcome.closedCount, 1);
    assert.deepEqual(closedIds[1], [555]);
  });
});
