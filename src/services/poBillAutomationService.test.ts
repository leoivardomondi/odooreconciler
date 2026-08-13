import assert from 'node:assert/strict';
import test from 'node:test';
import { ParsedVendorInvoiceResult, PurchaseOrderLine, PurchaseOrderSummary } from '../models/types';
import {
  computeItemScore,
  comparePoBillCandidates,
  isCompletedPoBillActivityNote,
  isPurchaseOrderApprovalMessage,
  isReliablePoBillCandidate,
  isStandaloneDeliveryNoteDocument,
  selectExistingVendorBillForMatchedPurchaseOrders,
  vendorBillMatchesParsedInvoice,
} from './poBillAutomationService';

const purchaseOrder: PurchaseOrderSummary = {
  id: 695,
  name: 'P00695',
  state: 'purchase',
  amount_total: 1440,
  invoice_status: 'invoiced',
  invoice_ids: [901],
  invoice_count: 1,
};

function parsedInvoice(overrides: Partial<ParsedVendorInvoiceResult> = {}): ParsedVendorInvoiceResult {
  return {
    vendorName: null,
    invoiceDate: '2026-04-30',
    invoiceNumber: null,
    orderNumber: null,
    taxPin: 'P052426994W',
    pinNote: 'ETR',
    untaxedTotal: 1440,
    vatTotal: null,
    grandTotal: 1440,
    itemCount: 0,
    items: [],
    rawText: '',
    logs: [],
    ...overrides,
  };
}

test('recovers an existing PO bill by total even when invoice items were not extracted', () => {
  const bill = {
    id: 901,
    name: 'BILL/2026/00901',
    ref: null,
    state: 'posted',
    invoice_origin: 'P00695',
    amount_total: 1440,
  };

  assert.equal(
    selectExistingVendorBillForMatchedPurchaseOrders([bill], [purchaseOrder], parsedInvoice()),
    bill,
  );
});

test('uses a matching vendor bill total even when the invoice number is unreadable', () => {
  assert.equal(
    vendorBillMatchesParsedInvoice(
      {
        id: 901,
        name: 'BILL/2026/00901',
        ref: null,
        state: 'posted',
        invoice_origin: 'P00695',
        amount_total: 1440,
      },
      parsedInvoice({ invoiceNumber: null, grandTotal: 1440 }),
    ),
    true,
  );
});

test('does not recover a cancelled bill as a successful match', () => {
  const bill = {
    id: 901,
    name: 'BILL/2026/00901',
    ref: null,
    state: 'cancel',
    invoice_origin: 'P00695',
    amount_total: 1440,
  };

  assert.equal(
    selectExistingVendorBillForMatchedPurchaseOrders([bill], [purchaseOrder], parsedInvoice()),
    null,
  );
});

test('recovers the single Odoo-linked bill when the invoice number and total are unreadable', () => {
  const bill = {
    id: 901,
    name: 'BILL/2026/00901',
    ref: null,
    state: 'posted',
    invoice_origin: 'P00695',
    amount_total: null,
  };

  assert.equal(
    selectExistingVendorBillForMatchedPurchaseOrders(
      [bill],
      [purchaseOrder],
      parsedInvoice({ invoiceNumber: null, grandTotal: null }),
    ),
    bill,
  );
});

test('recognizes a completed PO activity note as a prior bill signature', () => {
  const note = [
    'Invoice PDF: P-- RECEIPT SARADHY ENTER_2026-05-12_085209349.pdf',
    'Vendor bill: 2698',
    'No follow-up pending.',
  ].join('\n');

  assert.equal(
    isCompletedPoBillActivityNote(note, 'P-- RECEIPT SARADHY ENTER_2026-05-12_085209349.pdf'),
    true,
  );
  assert.equal(
    isCompletedPoBillActivityNote(note.replace('No follow-up pending.', 'Follow-up: receipt missing.'), 'P-- RECEIPT SARADHY ENTER_2026-05-12_085209349.pdf'),
    false,
  );
});

test('classifies a standalone delivery note without invoice signals', () => {
  assert.equal(
    isStandaloneDeliveryNoteDocument({
      attachmentName: 'SARADHY DELIVERY NOTE.pdf',
      rawText: 'SARADHY ENTERPRISES LTD\nDELIVERY\nNOTE\nD/N No. 393\n18mm Marine board',
    }),
    true,
  );
});

test('does not classify a delivery note that is accompanied by an invoice', () => {
  assert.equal(
    isStandaloneDeliveryNoteDocument({
      attachmentName: 'SARADHY DELIVERY NOTE AND INVOICE.pdf',
      rawText: 'DELIVERY NOTE No. 393\nINVOICE No. 302\nTOTAL 4,200',
    }),
    false,
  );
});

test('reads RFQ approval chatter from the Odoo subtype when the body is empty', () => {
  assert.equal(isPurchaseOrderApprovalMessage('', 'RFQ Approved'), true);
  assert.equal(isPurchaseOrderApprovalMessage('<p>RFQ -&gt; To Approve</p>', ''), true);
  assert.equal(isPurchaseOrderApprovalMessage('', 'RFQ Confirmed'), false);
});

test('distinguishes white 3mm MDF from black 18mm MDF and checks quantity', () => {
  const invoiceItems = [{
    description: 'PRE-LAM MDF 3MM WHITE 1/S',
    quantity: 3,
    unitPrice: 1293.1,
    amount: 3879.31,
  }];
  const po590Lines: PurchaseOrderLine[] = [{
    id: 1051,
    name: 'Backer White MDF 3mm',
    product_id: [294, 'Backer White MDF 3mm'],
    product_qty: 3,
    qty_received: 3,
    price_subtotal: 4500,
    price_total: 4500,
  }];
  const po784Lines: PurchaseOrderLine[] = [{
    id: 1369,
    name: 'Black MDF 18mm',
    product_id: [889, 'Black MDF 18mm'],
    product_qty: 1,
    qty_received: 1,
    price_subtotal: 3250,
    price_total: 3250,
  }];

  assert.equal(computeItemScore(invoiceItems, po590Lines).score, 10);
  assert.equal(computeItemScore(invoiceItems, po784Lines).score, 0);
});

test('does not treat a wrong-total low-score candidate as reliable', () => {
  assert.equal(isReliablePoBillCandidate({
    purchaseOrder: { id: 784, name: 'P00784', state: 'purchase' },
    score: 58,
    vendorScore: 40,
    totalScore: 0,
    dateScore: 0,
    itemScore: 10,
    receiptScore: 8,
    reasons: [],
  }), false);
  assert.equal(isReliablePoBillCandidate({
    purchaseOrder: { id: 590, name: 'P00590', state: 'purchase' },
    score: 110,
    vendorScore: 40,
    totalScore: 40,
    dateScore: 12,
    itemScore: 10,
    receiptScore: 8,
    reasons: [],
  }), true);
});

test('ranks the closer approval date before a higher PO id when score bands tie', () => {
  const olderAndCloser = {
    purchaseOrder: { id: 590, name: 'P00590', create_date: '2026-05-26 06:51:29' },
    score: 110,
    vendorScore: 40,
    totalScore: 40,
    dateScore: 12,
    itemScore: 10,
    receiptScore: 8,
    matchingDate: '2026-05-29 12:25:47',
    dateDistanceDays: 3,
    creationDateDistanceDays: 0,
    reasons: [],
  };
  const newerAndFurther = {
    purchaseOrder: { id: 574, name: 'P00574', create_date: '2026-05-20 06:45:45' },
    score: 110,
    vendorScore: 40,
    totalScore: 40,
    dateScore: 12,
    itemScore: 10,
    receiptScore: 8,
    matchingDate: '2026-05-21 13:55:15',
    dateDistanceDays: 5,
    creationDateDistanceDays: 6,
    reasons: [],
  };

  assert.ok(comparePoBillCandidates(olderAndCloser, newerAndFurther) < 0);
  assert.ok(comparePoBillCandidates(newerAndFurther, olderAndCloser) > 0);
});

test('uses PO creation-date proximity when approval-date distances tie', () => {
  const createdOnInvoiceDate = {
    purchaseOrder: { id: 590, name: 'P00590' },
    score: 110,
    vendorScore: 40,
    totalScore: 40,
    dateScore: 12,
    itemScore: 10,
    receiptScore: 8,
    dateDistanceDays: 3,
    creationDateDistanceDays: 0,
    reasons: [],
  };
  const createdLater = {
    purchaseOrder: { id: 700, name: 'P00700' },
    score: 110,
    vendorScore: 40,
    totalScore: 40,
    dateScore: 12,
    itemScore: 10,
    receiptScore: 8,
    dateDistanceDays: 3,
    creationDateDistanceDays: 8,
    reasons: [],
  };

  assert.ok(comparePoBillCandidates(createdOnInvoiceDate, createdLater) < 0);
});
