"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTiptopInvoice = parseTiptopInvoice;
const confidence_1 = require("../core/confidence");
const extractCommon_1 = require("../core/extractCommon");
const extractTotals_1 = require("../core/extractTotals");
const splitSections_1 = require("../core/splitSections");
function parseTiptopInvoice(context) {
    const invoiceText = (0, splitSections_1.preferInvoiceSection)(context.text);
    const pins = (0, extractCommon_1.extractPins)(context.text);
    const base = {
        supplier: 'Tiptop Woods Co. Ltd',
        supplier_key: 'TIPTOP',
        document_type: context.documentType,
        invoice_number: (0, extractCommon_1.extractInvoiceNumber)(invoiceText),
        serial_number: null,
        invoice_date: (0, extractCommon_1.extractCommonDate)(invoiceText),
        customer: (0, extractCommon_1.extractCustomer)(invoiceText),
        customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
        supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
        currency: 'KES',
        items: (0, extractCommon_1.extractGenericItems)(invoiceText),
        totals: (0, extractTotals_1.extractTotals)(invoiceText),
        warnings: [...context.warnings],
        raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] },
    };
    return { ...base, confidence: (0, confidence_1.computeConfidence)(base) };
}
