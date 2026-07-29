"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGenericInvoice = parseGenericInvoice;
const confidence_1 = require("../core/confidence");
const extractCommon_1 = require("../core/extractCommon");
const extractTotals_1 = require("../core/extractTotals");
function parseGenericInvoice(context) {
    const pins = (0, extractCommon_1.extractPins)(context.text);
    const base = {
        supplier: null,
        supplier_key: context.supplierKey,
        document_type: context.documentType,
        invoice_number: (0, extractCommon_1.extractInvoiceNumber)(context.text),
        serial_number: (0, extractCommon_1.extractSerialNumber)(context.text),
        invoice_date: (0, extractCommon_1.extractCommonDate)(context.text),
        date_of_supply: (0, extractCommon_1.extractDateOfSupply)(context.text),
        customer: (0, extractCommon_1.extractCustomer)(context.text),
        customer_pin: pins[0] || null,
        supplier_pin: pins[1] || null,
        currency: 'KES',
        items: (0, extractCommon_1.extractGenericItems)(context.text),
        totals: (0, extractTotals_1.extractTotals)(context.text),
        payment_note: (0, extractCommon_1.firstMatch)(context.text, [/payment\s*(?:note|terms)?\s*:?\s*([^\n]+)/i]),
        warnings: [...context.warnings],
        raw: {
            pdf_text: context.pdfText,
            ocr_text: context.ocrText,
            pages: [],
        },
    };
    return { ...base, confidence: (0, confidence_1.computeConfidence)(base) };
}
