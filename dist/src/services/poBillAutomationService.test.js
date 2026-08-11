"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const poBillAutomationService_1 = require("./poBillAutomationService");
const purchaseOrder = {
    id: 695,
    name: 'P00695',
    state: 'purchase',
    amount_total: 1440,
    invoice_status: 'invoiced',
    invoice_ids: [901],
    invoice_count: 1,
};
function parsedInvoice(overrides = {}) {
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
(0, node_test_1.default)('recovers an existing PO bill by total even when invoice items were not extracted', () => {
    const bill = {
        id: 901,
        name: 'BILL/2026/00901',
        ref: null,
        state: 'posted',
        invoice_origin: 'P00695',
        amount_total: 1440,
    };
    strict_1.default.equal((0, poBillAutomationService_1.selectExistingVendorBillForMatchedPurchaseOrders)([bill], [purchaseOrder], parsedInvoice()), bill);
});
(0, node_test_1.default)('does not recover a cancelled bill as a successful match', () => {
    const bill = {
        id: 901,
        name: 'BILL/2026/00901',
        ref: null,
        state: 'cancel',
        invoice_origin: 'P00695',
        amount_total: 1440,
    };
    strict_1.default.equal((0, poBillAutomationService_1.selectExistingVendorBillForMatchedPurchaseOrders)([bill], [purchaseOrder], parsedInvoice()), null);
});
(0, node_test_1.default)('recovers the single Odoo-linked bill when the invoice number and total are unreadable', () => {
    const bill = {
        id: 901,
        name: 'BILL/2026/00901',
        ref: null,
        state: 'posted',
        invoice_origin: 'P00695',
        amount_total: null,
    };
    strict_1.default.equal((0, poBillAutomationService_1.selectExistingVendorBillForMatchedPurchaseOrders)([bill], [purchaseOrder], parsedInvoice({ invoiceNumber: null, grandTotal: null })), bill);
});
(0, node_test_1.default)('recognizes a completed PO activity note as a prior bill signature', () => {
    const note = [
        'Invoice PDF: P-- RECEIPT SARADHY ENTER_2026-05-12_085209349.pdf',
        'Vendor bill: 2698',
        'No follow-up pending.',
    ].join('\n');
    strict_1.default.equal((0, poBillAutomationService_1.isCompletedPoBillActivityNote)(note, 'P-- RECEIPT SARADHY ENTER_2026-05-12_085209349.pdf'), true);
    strict_1.default.equal((0, poBillAutomationService_1.isCompletedPoBillActivityNote)(note.replace('No follow-up pending.', 'Follow-up: receipt missing.'), 'P-- RECEIPT SARADHY ENTER_2026-05-12_085209349.pdf'), false);
});
(0, node_test_1.default)('classifies a standalone delivery note without invoice signals', () => {
    strict_1.default.equal((0, poBillAutomationService_1.isStandaloneDeliveryNoteDocument)({
        attachmentName: 'SARADHY DELIVERY NOTE.pdf',
        rawText: 'SARADHY ENTERPRISES LTD\nDELIVERY\nNOTE\nD/N No. 393\n18mm Marine board',
    }), true);
});
(0, node_test_1.default)('does not classify a delivery note that is accompanied by an invoice', () => {
    strict_1.default.equal((0, poBillAutomationService_1.isStandaloneDeliveryNoteDocument)({
        attachmentName: 'SARADHY DELIVERY NOTE AND INVOICE.pdf',
        rawText: 'DELIVERY NOTE No. 393\nINVOICE No. 302\nTOTAL 4,200',
    }), false);
});
