"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const normalizeTotals_1 = require("./normalizeTotals");
function vinylReceipt(overrides = {}) {
    return {
        supplier: 'Vinyl Supreme Ceilings & Decor Limited',
        supplier_key: 'VINYL_SUPREME',
        document_type: 'receipt',
        invoice_number: 'KRACU0100078765/1691',
        invoice_date: '2026-06-05',
        customer: 'Urban Vibe',
        customer_pin: 'P052426994W',
        supplier_pin: 'P052407740E',
        currency: 'KES',
        items: [
            {
                description: 'CONSTRUCTION MATERIALS KE2NTXNOX0000001',
                quantity: 1,
                unit: 'item',
                unit_price: 10344.83,
                net_amount: 10344.83,
            },
        ],
        totals: {
            goods_total: 8689.66,
            vat: 1655.17,
            amount_due: 12000,
            ...overrides,
        },
        confidence: {
            supplier: 0.98,
            invoice_number: 0.9,
            date: 0.85,
            items: 0.57,
            totals: 0.9,
            overall: 0.83,
        },
        warnings: [],
        raw: {
            pdf_text: '',
            ocr_text: 'CONSTRUCTION MATERIALS 12,000.00x1 12,000.00 16% VAT 1,655.17 TOTAL 12,000.00',
            pages: [],
        },
    };
}
(0, node_test_1.default)('preserves the VAT-inclusive receipt total and derives the correct net total', () => {
    const normalized = (0, normalizeTotals_1.normalizeInvoiceTotals)(vinylReceipt());
    strict_1.default.deepEqual(normalized.totals, {
        goods_total: 10344.83,
        vat: 1655.17,
        amount_due: 12000,
    });
});
(0, node_test_1.default)('corrects a parser net subtotal when line net plus VAT matches the payable total', () => {
    const normalized = (0, normalizeTotals_1.normalizeInvoiceTotals)(vinylReceipt({ amount_due: 10344.83 }));
    strict_1.default.deepEqual(normalized.totals, {
        goods_total: 10344.83,
        vat: 1655.17,
        amount_due: 12000,
    });
});
