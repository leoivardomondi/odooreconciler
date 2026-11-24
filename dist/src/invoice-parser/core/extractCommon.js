"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstMatch = firstMatch;
exports.extractInvoiceNumber = extractInvoiceNumber;
exports.extractSerialNumber = extractSerialNumber;
exports.extractCustomer = extractCustomer;
exports.extractPins = extractPins;
exports.extractCommonDate = extractCommonDate;
exports.extractDateOfSupply = extractDateOfSupply;
exports.extractGenericItems = extractGenericItems;
const extractDates_1 = require("./extractDates");
const normalizeMoney_1 = require("./normalizeMoney");
function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const value = match?.[1]?.trim();
        if (value) {
            return value.replace(/\s+/g, ' ');
        }
    }
    return null;
}
function extractInvoiceNumber(text) {
    const direct = firstMatch(text, [
        /invoice\s*(?:no|number|#)\.?\s*:?\s*([A-Z0-9/-]+)/i,
        /cash\s*sale\s*(?:no|number|#)?\.?\s*:?\s*([A-Z0-9/-]+)/i,
        /serial\s*(?:no|number)\.?\s*:?\s*([A-Z0-9/-]+)/i,
        /supplier'?s?\s*ref\.?\s*[\s\S]{0,80}?\b(\d{3,6})\s*$/im,
        /(?<!(?:box|tel|phone|vat|pin|reg|order|po)\s*)(?:E&O\.?E\s*)?No\.?\s*(\d{2,6})\b/i,
    ]);
    if (direct &&
        direct.replace(/\D/g, '').length >= 3 &&
        !/^(?:dated|date)$/i.test(direct) &&
        !/^\d{1,2}-[A-Za-z]{3,9}-\d{2,4}$/.test(direct)) {
        return direct;
    }
    const idx = text.search(/invoice\s*(?:no|number|#)/i);
    if (idx !== -1) {
        const after = text
            .slice(idx, idx + 320)
            .replace(/\b(?:p\.?\s*o\.?\s*box)\s+\d+(?:\s+\d{4,6})?/gi, ' ')
            .replace(/\b07\d{2}\s*\d{3}\s*\d{3}\b/g, ' ');
        const tokens = after.match(/\b([A-Z0-9/-]{3,15})\b/g);
        if (tokens) {
            for (const token of tokens) {
                if (!/invoice|number|dated|date|delivery|note|payment|mode|terms|street|kisumu|nairobi/i.test(token) &&
                    !/^\d{1,2}-[A-Za-z]{3,9}-\d{2,4}$/.test(token) &&
                    !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(token) &&
                    token.replace(/\D/g, '').length >= 3) {
                    if (/^40100|00100$/i.test(token))
                        continue;
                    return token;
                }
            }
        }
    }
    return null;
}
function extractSerialNumber(text) {
    return firstMatch(text, [/serial\s*(?:no|number)\.?\s*:?\s*([A-Z0-9/-]+)/i]);
}
function extractCustomer(text) {
    return firstMatch(text, [
        /invoice\s+to\s*:?\s*([^\n]+)/i,
        /customer\s*:?\s*([^\n]+)/i,
        /sold\s+to\s*:?\s*([^\n]+)/i,
        /buyer\s*:?\s*([^\n]+)/i,
    ]);
}
function extractPins(text) {
    const pins = [...text.matchAll(/\b([AP]\d{9,11}[A-Z])\b/gi)].map((match) => match[1].toUpperCase());
    return [...new Set(pins)];
}
function extractCommonDate(text) {
    return (0, extractDates_1.extractDateNear)(text, ['invoice date', 'cash sale date', 'dated', 'date']);
}
function extractDateOfSupply(text) {
    return (0, extractDates_1.extractDateNear)(text, ['date of supply', 'supply date']);
}
function extractGenericItems(text) {
    const lines = text
        .split('\n')
        .map((line) => line
        .replace(/[|[\]]/g, ' ')
        .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
        .replace(/\s+/g, ' ')
        .trim())
        .filter((line) => line.length > 6);
    return lines
        .map((line) => {
        if (/\b(?:tel|phone|box|email|pin|date|invoice|delivery|note|total|vat|subtotal)\b/i.test(line) ||
            /\b07\d{2}\s*\d{3}\b/.test(line) ||
            /^\d{1,2}(?:\.\d+)?\s*%/.test(line)) {
            return null;
        }
        // Pattern: DESCRIPTION QTY UNIT_PRICE DISC AMOUNT (discount column between price and total)
        // Also handles optional leading CODE prefix (2–4 digit item code)
        // e.g. "154 DESK PEN STAND 3.00 150.00 0 450.00"
        // e.g. "PHOTOCOPY PAPER A4 AZHAR 3.00 480.00 0 1,440.00"
        const discMatch = line.match(/^(?:\d{2,4}\s+)?(.{3,80}?)\s+(\d{1,3}(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)\s+(\d{0,4}(?:[,.]\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/i);
        if (discMatch) {
            const description = discMatch[1].trim();
            const quantity = Number(discMatch[2]);
            const rawUnitPrice = discMatch[3].replace(/,/g, '');
            const unitPrice = Number(rawUnitPrice);
            const discountRaw = discMatch[4].replace(/,/g, '');
            const discount = Number(discountRaw) || 0;
            const rawAmount = discMatch[5].replace(/,/g, '');
            const amount = Number(rawAmount);
            if (Number.isFinite(quantity) && quantity > 0 &&
                Number.isFinite(unitPrice) && unitPrice > 0 &&
                Number.isFinite(amount) && amount > 0 &&
                description.length >= 3) {
                const computedAmount = Math.round((quantity * unitPrice - discount) * 100) / 100;
                const tolerance = Math.max(2, amount * 0.03);
                if (Math.abs(computedAmount - amount) <= tolerance) {
                    return {
                        description,
                        quantity,
                        unit: null,
                        unit_price: unitPrice,
                        net_amount: amount,
                        raw_text: line,
                        confidence: 0.75,
                    };
                }
            }
        }
        const unitFirstMatch = line.match(/^(.+?)\s+(Piece|Pcs?|Roll|Nos?|Unit|M|Each)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)(?:\s+\d{1,2})?$/i);
        if (unitFirstMatch) {
            return {
                description: unitFirstMatch[1].trim(),
                quantity: Number(unitFirstMatch[3]),
                unit: unitFirstMatch[2],
                unit_price: (0, normalizeMoney_1.normalizeMoney)(unitFirstMatch[4]),
                net_amount: (0, normalizeMoney_1.normalizeMoney)(unitFirstMatch[5]),
                raw_text: line,
                confidence: 0.72,
            };
        }
        const match = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(Piece|Pcs?|Roll|Nos?|Unit|M|Each)?\s+([\d,]+(?:\.\d{1,2})?)\s+([\d,]+(?:\.\d{1,2})?)$/i);
        if (match) {
            const qty = Number(match[2]);
            const unitPrice = (0, normalizeMoney_1.normalizeMoney)(match[4]);
            const netAmount = (0, normalizeMoney_1.normalizeMoney)(match[5]);
            if (Number.isFinite(qty) &&
                qty > 0 &&
                typeof unitPrice === 'number' &&
                typeof netAmount === 'number' &&
                Math.abs(qty * unitPrice - netAmount) <= Math.max(2, netAmount * 0.05)) {
                return {
                    description: match[1].trim(),
                    quantity: qty,
                    unit: match[3] || null,
                    unit_price: unitPrice,
                    net_amount: netAmount,
                    raw_text: line,
                    confidence: 0.65,
                };
            }
        }
        // Fallback when OCR garbles the narrow Rate column between Qty+Unit and Amount (e.g. "PROSAFE-COT/LEATHER GLOVES-10.5\" 12 PCS ii 3600.00")
        const qtyUnitAmountMatch = line.match(/^(?:\d{1,3}\s+)?(.{3,80}?)\s+(\d+(?:\.\d+)?)\s+(Piece|Pcs?|Roll|Nos?|Unit|Each|Box|Bag|Set|Pair|Kg|Ltr)(?:\s+[A-Za-z|~:;,.-]{1,6})*\s+([\d,]+(?:\.\d{2}))$/i);
        if (qtyUnitAmountMatch) {
            const desc = qtyUnitAmountMatch[1].trim();
            const qty = Number(qtyUnitAmountMatch[2]);
            const unit = qtyUnitAmountMatch[3];
            const amt = (0, normalizeMoney_1.normalizeMoney)(qtyUnitAmountMatch[4]);
            if (!/\b(?:total|subtotal|amount|chargeable|vat)\b/i.test(desc) &&
                Number.isFinite(qty) &&
                qty > 0 &&
                typeof amt === 'number' &&
                amt >= qty) {
                return {
                    description: desc,
                    quantity: qty,
                    unit,
                    unit_price: Math.round((amt / qty) * 100) / 100,
                    net_amount: amt,
                    raw_text: line,
                    confidence: 0.68,
                };
            }
        }
        return null;
    })
        .filter((item) => Boolean(item));
}
