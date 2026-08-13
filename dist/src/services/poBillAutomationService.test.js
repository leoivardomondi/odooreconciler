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
(0, node_test_1.default)('uses a matching vendor bill total even when the invoice number is unreadable', () => {
    strict_1.default.equal((0, poBillAutomationService_1.vendorBillMatchesParsedInvoice)({
        id: 901,
        name: 'BILL/2026/00901',
        ref: null,
        state: 'posted',
        invoice_origin: 'P00695',
        amount_total: 1440,
    }, parsedInvoice({ invoiceNumber: null, grandTotal: 1440 })), true);
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
(0, node_test_1.default)('reads RFQ approval chatter from the Odoo subtype when the body is empty', () => {
    strict_1.default.equal((0, poBillAutomationService_1.isPurchaseOrderApprovalMessage)('', 'RFQ Approved'), true);
    strict_1.default.equal((0, poBillAutomationService_1.isPurchaseOrderApprovalMessage)('<p>RFQ -&gt; To Approve</p>', ''), true);
    strict_1.default.equal((0, poBillAutomationService_1.isPurchaseOrderApprovalMessage)('', 'RFQ Confirmed'), false);
});
(0, node_test_1.default)('distinguishes white 3mm MDF from black 18mm MDF and checks quantity', () => {
    const invoiceItems = [{
            description: 'PRE-LAM MDF 3MM WHITE 1/S',
            quantity: 3,
            unitPrice: 1293.1,
            amount: 3879.31,
        }];
    const po590Lines = [{
            id: 1051,
            name: 'Backer White MDF 3mm',
            product_id: [294, 'Backer White MDF 3mm'],
            product_qty: 3,
            qty_received: 3,
            price_subtotal: 4500,
            price_total: 4500,
        }];
    const po784Lines = [{
            id: 1369,
            name: 'Black MDF 18mm',
            product_id: [889, 'Black MDF 18mm'],
            product_qty: 1,
            qty_received: 1,
            price_subtotal: 3250,
            price_total: 3250,
        }];
    strict_1.default.equal((0, poBillAutomationService_1.computeItemScore)(invoiceItems, po590Lines).score, 10);
    strict_1.default.equal((0, poBillAutomationService_1.computeItemScore)(invoiceItems, po784Lines).score, 0);
});
(0, node_test_1.default)('does not treat a wrong-total low-score candidate as reliable', () => {
    strict_1.default.equal((0, poBillAutomationService_1.isReliablePoBillCandidate)({
        purchaseOrder: { id: 784, name: 'P00784', state: 'purchase' },
        score: 58,
        vendorScore: 40,
        totalScore: 0,
        dateScore: 0,
        itemScore: 10,
        receiptScore: 8,
        reasons: [],
    }), false);
    strict_1.default.equal((0, poBillAutomationService_1.isReliablePoBillCandidate)({
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
(0, node_test_1.default)('ranks the closer approval date before a higher PO id when score bands tie', () => {
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
    strict_1.default.ok((0, poBillAutomationService_1.comparePoBillCandidates)(olderAndCloser, newerAndFurther) < 0);
    strict_1.default.ok((0, poBillAutomationService_1.comparePoBillCandidates)(newerAndFurther, olderAndCloser) > 0);
});
(0, node_test_1.default)('uses PO creation-date proximity when approval-date distances tie', () => {
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
    strict_1.default.ok((0, poBillAutomationService_1.comparePoBillCandidates)(createdOnInvoiceDate, createdLater) < 0);
});
