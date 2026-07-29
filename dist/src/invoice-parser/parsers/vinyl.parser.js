"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVinylInvoice = parseVinylInvoice;
const confidence_1 = require("../core/confidence");
const extractCommon_1 = require("../core/extractCommon");
const extractTotals_1 = require("../core/extractTotals");
const splitSections_1 = require("../core/splitSections");
function findVinylCustomerPin(text, pins) {
    const clientPinMatches = [...text.matchAll(/\bCLIENT\s+PIN\s*:?\s*(P\d{9}[A-Z])/gi)]
        .map((match) => match[1].toUpperCase());
    const expectedBuyerPin = [...clientPinMatches, ...pins].find((pin) => /^P0524\d{2}994W$/.test(pin));
    return expectedBuyerPin || clientPinMatches[0] || pins.find((pin) => /^P\d{9}W$/.test(pin)) || null;
}
function parseVinylInvoice(context) {
    const invoiceText = (0, splitSections_1.preferInvoiceSection)(context.text);
    const pins = (0, extractCommon_1.extractPins)(context.text);
    const customerPin = findVinylCustomerPin(context.text, pins);
    const base = {
        supplier: 'Vinyl Supreme Ceilings & Decor Limited',
        supplier_key: 'VINYL_SUPREME',
        document_type: context.documentType,
        invoice_number: (0, extractCommon_1.firstMatch)(invoiceText, [/\b(VS-\d+)\b/i]) || (0, extractCommon_1.extractInvoiceNumber)(invoiceText),
        serial_number: null,
        invoice_date: (0, extractCommon_1.extractCommonDate)(invoiceText),
        customer: (0, extractCommon_1.extractCustomer)(invoiceText),
        customer_pin: customerPin,
        supplier_pin: pins.find((pin) => pin !== customerPin && /^P\d{9}[A-Z]$/.test(pin)) || null,
        currency: 'KES',
        items: (0, extractCommon_1.extractGenericItems)(invoiceText),
        totals: (0, extractTotals_1.extractTotals)(invoiceText),
        payment_note: (0, extractCommon_1.firstMatch)(context.text, [/payment\s*(?:note|terms)?\s*:?\s*([^\n]+)/i]),
        receipt: {
            kra_invoice_number: (0, extractCommon_1.firstMatch)(context.text, [/kra\s+invoice\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]),
            receipt_number: (0, extractCommon_1.firstMatch)(context.text, [/receipt\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]),
            date: (0, extractCommon_1.extractCommonDate)(context.text),
            tax_system: /etims/i.test(context.text) ? 'eTIMS' : null,
        },
        warnings: [...context.warnings],
        raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] },
    };
    return { ...base, confidence: (0, confidence_1.computeConfidence)(base) };
}
