"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseVinylInvoice = parseVinylInvoice;
const confidence_1 = require("../core/confidence");
const extractCommon_1 = require("../core/extractCommon");
const extractTotals_1 = require("../core/extractTotals");
const normalizeMoney_1 = require("../core/normalizeMoney");
const splitSections_1 = require("../core/splitSections");
function findVinylCustomerPin(text, pins) {
    const clientPinMatches = [...text.matchAll(/\bCLIENT\s+PIN\s*:?\s*(P\d{9}[A-Z])/gi)]
        .map((match) => match[1].toUpperCase());
    const expectedBuyerPin = [...clientPinMatches, ...pins].find((pin) => /^P0524\d{2}994W$/.test(pin));
    return expectedBuyerPin || clientPinMatches[0] || pins.find((pin) => /^P\d{9}W$/.test(pin)) || null;
}
function normalizeSpacedEtimsMoney(text) {
    return text
        .replace(/(\d)\s*,\s*(\d{3})\s*[.,]\s*(?:(\d{2})|on|oo)/gi, (_, thousands, hundreds, cents) => `${thousands},${hundreds}.${cents || '00'}`)
        .replace(/\b(\d{1,4})\s*[.,]\s*(\d{2})\b/g, '$1.$2')
        .replace(/\b(\d)\.\s*(\d{3})\.\s*(\d{2})\b/g, '$1,$2.$3');
}
function extractVinylInvoiceNumber(text) {
    const kraNumber = (0, extractCommon_1.firstMatch)(text, [
        /\bINVOICE\s+NUMBER\s*:?\s*([A-Z0-9]{8,}(?:\s*\n?\s*\/\s*\d+)?)/i,
    ]);
    if (kraNumber) {
        return kraNumber.replace(/\s*\/\s*/g, '/').replace(/\s+/g, '').trim();
    }
    return (0, extractCommon_1.firstMatch)(text, [/\b(VS-\d+)\b/i]) || (0, extractCommon_1.extractInvoiceNumber)(text);
}
function extractVinylEtimsItems(rawText) {
    const text = normalizeSpacedEtimsMoney(rawText);
    const lines = text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    const items = [];
    for (let i = 0; i < lines.length; i += 1) {
        const qtyPriceMatch = lines[i].match(/([\d,]+(?:\.\d{2}))\s*x\s*(\d+(?:\.\d+)?)/i);
        if (!qtyPriceMatch)
            continue;
        const unitPrice = (0, normalizeMoney_1.normalizeMoney)(qtyPriceMatch[1]);
        const quantity = Number(qtyPriceMatch[2]);
        if (unitPrice === null || !Number.isFinite(quantity) || quantity <= 0)
            continue;
        let description = 'CONSTRUCTION MATERIALS';
        for (let j = i - 1; j >= Math.max(0, i - 3); j -= 1) {
            const candidate = lines[j];
            if (candidate.length >= 4 &&
                !/^(?:client|customer|buyer|pin|name|start|cashier|invoice|date|ke\?|ke\d)/i.test(candidate) &&
                /[A-Z]{3,}/i.test(candidate)) {
                description = candidate.replace(/\bKATERIALS\b/gi, 'MATERIALS');
                break;
            }
        }
        const computedNet = Number((unitPrice * quantity).toFixed(2));
        items.push({
            description,
            quantity,
            unit: 'Unit',
            unit_price: unitPrice,
            net_amount: computedNet,
            raw_text: `${description} ${lines[i]}`,
            confidence: 0.78,
        });
    }
    return items;
}
function extractVinylTotals(rawText, items) {
    const text = normalizeSpacedEtimsMoney(rawText);
    const baseTotals = (0, extractTotals_1.extractTotals)(text);
    const itemSum = items.reduce((sum, item) => sum + (item.net_amount || 0), 0);
    const decimalValues = [];
    for (const match of text.matchAll(/\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/g)) {
        const val = (0, normalizeMoney_1.normalizeMoney)(match[1]);
        if (typeof val === 'number' && val > 0) {
            decimalValues.push(val);
        }
    }
    const cashMatch = (0, extractCommon_1.firstMatch)(text, [/\bCAS[HI1]{1,2}\s*:?\s*([\d,]+\.\d{2})/i]);
    const cashTotal = (0, normalizeMoney_1.normalizeMoney)(cashMatch);
    const targetTotal = cashTotal || (itemSum > 0 ? Number(itemSum.toFixed(2)) : null);
    if (targetTotal !== null) {
        // Check if there is an explicit 16% VAT value in decimalValues where vat = targetTotal * 16 / 116
        const expectedVat = Number(((targetTotal * 0.16) / 1.16).toFixed(2));
        const matchedVat = decimalValues.find((v) => Math.abs(v - expectedVat) <= 1);
        if (typeof matchedVat === 'number') {
            const computedGoods = Number((targetTotal - matchedVat).toFixed(2));
            return {
                goods_total: computedGoods,
                vat: matchedVat,
                amount_due: targetTotal,
            };
        }
        for (const goodsCandidate of decimalValues) {
            if (goodsCandidate >= targetTotal)
                continue;
            for (const vatCandidate of decimalValues) {
                if (Math.abs(goodsCandidate + vatCandidate - targetTotal) <= 0.05 &&
                    Math.abs(vatCandidate - goodsCandidate * 0.16) <= 0.5) {
                    return {
                        goods_total: goodsCandidate,
                        vat: vatCandidate,
                        amount_due: targetTotal,
                    };
                }
            }
        }
        return {
            goods_total: baseTotals.goods_total || targetTotal,
            vat: baseTotals.vat,
            amount_due: targetTotal,
        };
    }
    return baseTotals;
}
function parseVinylInvoice(context) {
    const invoiceText = (0, splitSections_1.preferInvoiceSection)(context.text);
    const pins = (0, extractCommon_1.extractPins)(context.text);
    const customerPin = findVinylCustomerPin(context.text, pins);
    const genericItems = (0, extractCommon_1.extractGenericItems)(invoiceText);
    const items = genericItems.length > 0 ? genericItems : extractVinylEtimsItems(context.text);
    const totals = extractVinylTotals(context.text, items);
    const invoiceNumber = extractVinylInvoiceNumber(context.text);
    const base = {
        supplier: 'Vinyl Supreme Ceilings & Decor Limited',
        supplier_key: 'VINYL_SUPREME',
        document_type: context.documentType,
        invoice_number: invoiceNumber,
        serial_number: null,
        invoice_date: (0, extractCommon_1.extractCommonDate)(invoiceText) || (0, extractCommon_1.extractCommonDate)(context.text),
        customer: (0, extractCommon_1.extractCustomer)(invoiceText),
        customer_pin: customerPin,
        supplier_pin: pins.find((pin) => pin !== customerPin && /^P\d{9}[A-Z]$/.test(pin)) || null,
        currency: 'KES',
        items,
        totals,
        payment_note: (0, extractCommon_1.firstMatch)(context.text, [/payment\s*(?:note|terms)?\s*:?\s*([^\n]+)/i]),
        receipt: {
            kra_invoice_number: (0, extractCommon_1.firstMatch)(context.text, [/kra\s+invoice\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]) ||
                (invoiceNumber?.startsWith('KRA') ? invoiceNumber : null),
            receipt_number: (0, extractCommon_1.firstMatch)(context.text, [/receipt\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]),
            date: (0, extractCommon_1.extractCommonDate)(context.text),
            tax_system: /etims|kracu/i.test(context.text) ? 'eTIMS' : null,
        },
        warnings: [...context.warnings],
        raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] },
    };
    return { ...base, confidence: (0, confidence_1.computeConfidence)(base) };
}
