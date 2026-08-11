import assert from 'node:assert/strict';
import test from 'node:test';
import { ParsedVendorInvoiceResult, PurchaseOrderSummary } from '../models/types';
import {
  isCompletedPoBillActivityNote,
  isStandaloneDeliveryNoteDocument,
  selectExistingVendorBillForMatchedPurchaseOrders,
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
