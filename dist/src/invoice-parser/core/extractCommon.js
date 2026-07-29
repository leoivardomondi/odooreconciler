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
    const value = firstMatch(text, [
        /invoice\s*(?:no|number|#)\.?\s*:?\s*([A-Z0-9/-]+)/i,
        /cash\s*sale\s*(?:no|number|#)?\.?\s*:?\s*([A-Z0-9/-]+)/i,
        /serial\s*(?:no|number)\.?\s*:?\s*([A-Z0-9/-]+)/i,
    ]);
    return value && value.replace(/\D/g, '').length >= 3 ? value : null;
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
    return (0, extractDates_1.extractDateNear)(text, ['invoice date', 'cash sale date', 'date']);
}
function extractDateOfSupply(text) {
    return (0, extractDates_1.extractDateNear)(text, ['date of supply', 'supply date']);
}
function extractGenericItems(text) {
    const lines = text
        .split('\n')
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line.length > 6);
    return lines
        .map((line) => {
        if (/\b(?:tel|phone|box|email|pin|date|invoice|delivery|note)\b/i.test(line)) {
            return null;
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
        if (!match) {
            return null;
        }
        return {
            description: match[1].trim(),
            quantity: Number(match[2]),
            unit: match[3] || null,
            unit_price: (0, normalizeMoney_1.normalizeMoney)(match[4]),
            net_amount: (0, normalizeMoney_1.normalizeMoney)(match[5]),
            raw_text: line,
            confidence: 0.65,
        };
    })
        .filter((item) => Boolean(item));
}
