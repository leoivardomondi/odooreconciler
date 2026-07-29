"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJoinbenInvoice = parseJoinbenInvoice;
const confidence_1 = require("../core/confidence");
const extractCommon_1 = require("../core/extractCommon");
const extractTotals_1 = require("../core/extractTotals");
function parseJoinbenInvoice(context) {
    const pins = (0, extractCommon_1.extractPins)(context.text);
    const warnings = [...context.warnings, 'Joinben cash sales are often handwritten; review item descriptions carefully.'];
    const base = {
        supplier: 'Joinben Company Limited',
        supplier_key: 'JOINBEN',
        document_type: 'cash_sale',
        invoice_number: (0, extractCommon_1.extractInvoiceNumber)(context.text),
        serial_number: null,
        invoice_date: (0, extractCommon_1.extractCommonDate)(context.text),
        customer: (0, extractCommon_1.extractCustomer)(context.text),
        customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
        supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
        currency: 'KES',
        items: (0, extractCommon_1.extractGenericItems)(context.text).map((item) => ({ ...item, confidence: Math.min(item.confidence || 0.4, 0.45) })),
        totals: (0, extractTotals_1.extractTotals)(context.text),
        warnings,
        raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] },
    };
    return { ...base, confidence: (0, confidence_1.computeConfidence)(base) };
}
