"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTimsalesInvoice = parseTimsalesInvoice;
const confidence_1 = require("../core/confidence");
const extractDates_1 = require("../core/extractDates");
const extractCommon_1 = require("../core/extractCommon");
const extractTotals_1 = require("../core/extractTotals");
const normalizeMoney_1 = require("../core/normalizeMoney");
function extractTimsalesCustomer(text) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const invoiceToIndex = lines.findIndex((line) => /invoice\s+to/i.test(line));
    if (invoiceToIndex >= 0) {
        const next = lines.slice(invoiceToIndex + 1).find((line) => !/invoice|serial|vat|pin|box/i.test(line));
        if (next) {
            return next.replace(/\s+/g, ' ');
        }
    }
    return (0, extractCommon_1.extractCustomer)(text);
}
function extractTimsalesInvoiceNumber(text) {
    const labelled = (0, extractCommon_1.extractInvoiceNumber)(text);
    if (labelled) {
        return labelled;
    }
    const serial = (0, extractCommon_1.firstMatch)(text, [/serial\s*no\.?\s*(\d{4,})/i]);
    return null;
}
function extractTimsalesSerial(text) {
    return ((0, extractCommon_1.extractSerialNumber)(text) ||
        (0, extractCommon_1.firstMatch)(text, [/serial\s*no\.?\s*([A-Z0-9/-]+)/i]) ||
        (0, extractCommon_1.firstMatch)(text, [/\b(12\d{4})\b/]));
}
function cleanTimsalesItems(text) {
    return (0, extractCommon_1.extractGenericItems)(text).map((item) => {
        if (item.quantity === 1 &&
            item.unit_price !== null &&
            item.net_amount !== null &&
            Math.abs(item.unit_price - item.net_amount) > 2) {
            return {
                ...item,
                unit_price: item.net_amount,
                confidence: Math.min(item.confidence || 0.6, 0.58),
                raw_text: `${item.raw_text || ''} [unit price normalized from net amount]`.trim(),
            };
        }
        return item;
    });
}
function cleanTimsalesTotals(text, items) {
    const totals = (0, extractTotals_1.extractTotals)(text);
    const goodsFromItems = items.reduce((sum, item) => sum + (item.net_amount || 0), 0);
    const itemGoodsTotal = goodsFromItems > 0 ? Number(goodsFromItems.toFixed(2)) : null;
    const vatBeforeLabel = (0, extractCommon_1.firstMatch)(text, [/([\d,]+(?:\.\d{1,2})?)\s*\n\s*VAT\b/i]);
    const vatAfterLabel = (0, extractCommon_1.firstMatch)(text, [/\bVAT\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i]);
    const amountDueLabel = (0, extractCommon_1.firstMatch)(text, [
        /\bAMOUNT\s+DUE\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
        /\bTOTAL\s+AMOUNT\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
        /\bGRAND\s+TOTAL\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]);
    const vatCandidate = (0, normalizeMoney_1.normalizeMoney)(vatAfterLabel) || (0, normalizeMoney_1.normalizeMoney)(vatBeforeLabel);
    const saneExtractedVat = totals.vat !== null && totals.amount_due !== null && totals.vat > totals.amount_due * 0.35
        ? null
        : totals.vat;
    const vat = saneExtractedVat ||
        vatCandidate ||
        (itemGoodsTotal !== null && totals.amount_due !== null
            ? (0, normalizeMoney_1.normalizeMoney)(String((totals.amount_due - itemGoodsTotal).toFixed(2)))
            : null);
    const computedAmountDueFromItems = itemGoodsTotal !== null && typeof vat === 'number'
        ? (0, normalizeMoney_1.normalizeMoney)(String((itemGoodsTotal + vat).toFixed(2)))
        : null;
    const extractedAmountLooksLikeGoodsTotal = typeof totals.amount_due === 'number' &&
        itemGoodsTotal !== null &&
        Math.abs(totals.amount_due - itemGoodsTotal) <= 1 &&
        typeof computedAmountDueFromItems === 'number' &&
        computedAmountDueFromItems > totals.amount_due;
    const goods_total = (extractedAmountLooksLikeGoodsTotal ? itemGoodsTotal : null) ||
        (totals.amount_due !== null && vat !== null ? (0, normalizeMoney_1.normalizeMoney)(String((totals.amount_due - vat).toFixed(2))) : null) ||
        totals.goods_total ||
        itemGoodsTotal;
    const labelledAmountDue = (0, normalizeMoney_1.normalizeMoney)(amountDueLabel);
    const computedAmountDue = typeof goods_total === 'number' && typeof vat === 'number'
        ? (0, normalizeMoney_1.normalizeMoney)(String((goods_total + vat).toFixed(2)))
        : null;
    const extractedLooksUntaxed = typeof totals.amount_due === 'number' &&
        typeof goods_total === 'number' &&
        Math.abs(totals.amount_due - goods_total) <= 1 &&
        typeof computedAmountDue === 'number' &&
        computedAmountDue > totals.amount_due;
    const amount_due = labelledAmountDue ||
        (extractedAmountLooksLikeGoodsTotal ? computedAmountDueFromItems : null) ||
        (extractedLooksUntaxed ? computedAmountDue : null) ||
        totals.amount_due ||
        computedAmountDue;
    return { goods_total, vat, amount_due };
}
function parseTimsalesInvoice(context) {
    const pins = (0, extractCommon_1.extractPins)(context.text);
    const items = cleanTimsalesItems(context.text);
    const totals = cleanTimsalesTotals(context.text, items);
    const invoiceDate = (0, extractCommon_1.extractCommonDate)(context.text) || (0, extractDates_1.extractIsoDateFromFilename)(context.originalFilename);
    const base = {
        supplier: 'Timsales Limited',
        supplier_key: 'TIMSALES',
        document_type: context.documentType,
        invoice_number: extractTimsalesInvoiceNumber(context.text),
        serial_number: extractTimsalesSerial(context.text),
        invoice_date: invoiceDate,
        date_of_supply: (0, extractCommon_1.extractDateOfSupply)(context.text),
        customer: extractTimsalesCustomer(context.text),
        customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
        supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
        currency: 'KES',
        items,
        totals,
        payment_note: (0, extractCommon_1.firstMatch)(context.text, [/paid\s+via\s+(.+)/i]),
        warnings: [...context.warnings],
        raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] },
    };
    return { ...base, confidence: (0, confidence_1.computeConfidence)(base) };
}
