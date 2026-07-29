"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseComplyInvoice = parseComplyInvoice;
const confidence_1 = require("../core/confidence");
const extractCommon_1 = require("../core/extractCommon");
const extractTotals_1 = require("../core/extractTotals");
function parseComplyInvoice(context) {
    const pins = (0, extractCommon_1.extractPins)(context.text);
    const base = {
        supplier: 'Comply Industries Limited',
        supplier_key: 'COMPLY',
        document_type: context.documentType,
        invoice_number: (0, extractCommon_1.extractInvoiceNumber)(context.text),
        serial_number: (0, extractCommon_1.firstMatch)(context.text, [/serial\s*(?:no|number)\.?\s*:?\s*([A-Z0-9/-]+)/i]),
        invoice_date: (0, extractCommon_1.extractCommonDate)(context.text),
        date_of_supply: (0, extractCommon_1.extractDateOfSupply)(context.text),
        customer: (0, extractCommon_1.extractCustomer)(context.text),
        customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
        supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
        currency: 'KES',
        items: (0, extractCommon_1.extractGenericItems)(context.text),
        totals: (0, extractTotals_1.extractTotals)(context.text),
        payment_note: (0, extractCommon_1.firstMatch)(context.text, [/paid\s+via\s+(.+)/i]),
        warnings: [...context.warnings],
        raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] },
    };
    return { ...base, confidence: (0, confidence_1.computeConfidence)(base) };
}
