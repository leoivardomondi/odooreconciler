"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSupplier = detectSupplier;
const normalizeText_1 = require("./normalizeText");
function titleCaseSupplier(value) {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
        .replace(/\bLtd\b/g, 'LTD')
        .replace(/\bLimited\b/g, 'Limited');
}
function extractHeaderSupplier(text) {
    const lines = text
        .split('\n')
        .map((line) => line.replace(/[^A-Z0-9&.,' -]/gi, ' ').replace(/\s+/g, ' ').trim())
        .filter((line) => line.length >= 4)
        .slice(0, 45);
    const blocked = /\b(receipt|invoice|billing|shipping|description|quantity|price|amount|vat|total|paybill|terms|tel|email|box|street|road|pin|buyer|date)\b/i;
    const companyPattern = /\b([A-Z][A-Z0-9&.,' -]{2,80}\b(?:ENTERPRISES?|TRADERS?|SUPPLIERS?|STATIONERS?|COMPANY|CO\.?|LTD|LIMITED|HARDWARE|TIMBER|SUPERMARKET)\b(?:\s+LTD|\s+LIMITED)?)\b/i;
    for (const line of lines) {
        if (blocked.test(line) && !/\b(LTD|LIMITED|ENTERPRISES?|COMPANY|CO\.?)\b/i.test(line)) {
            continue;
        }
        const match = line.match(companyPattern);
        const supplier = match?.[1]?.replace(/\b(RECEIPT|INVOICE)\b/gi, '').trim();
        if (supplier && supplier.length >= 5 && !blocked.test(supplier)) {
            return titleCaseSupplier(supplier);
        }
        if (supplier && /\b(LTD|LIMITED|ENTERPRISES?)\b/i.test(supplier)) {
            return titleCaseSupplier(supplier);
        }
    }
    return null;
}
function detectSupplier(text) {
    const normalized = (0, normalizeText_1.normalizeForSearch)(text);
    if (normalized.includes('comply industries')) {
        return { key: 'COMPLY', supplier: 'Comply Industries Limited', confidence: 0.98 };
    }
    if (normalized.includes('timsales limited')) {
        return { key: 'TIMSALES', supplier: 'Timsales Limited', confidence: 0.98 };
    }
    if (normalized.includes('p000591147n') || normalized.includes('po00s91147n')) {
        return { key: 'TIMSALES', supplier: 'Timsales Limited', confidence: 0.8 };
    }
    if (normalized.includes('vinyl supreme ceilings')) {
        return { key: 'VINYL_SUPREME', supplier: 'Vinyl Supreme Ceilings & Decor Limited', confidence: 0.98 };
    }
    if (normalized.includes('tiptop woods')) {
        return { key: 'TIPTOP', supplier: 'Tiptop Woods Co. Ltd', confidence: 0.98 };
    }
    if (normalized.includes('joinben company')) {
        return { key: 'JOINBEN', supplier: 'Joinben Company Limited', confidence: 0.98 };
    }
    const headerSupplier = extractHeaderSupplier(text);
    if (headerSupplier) {
        return { key: 'UNKNOWN', supplier: headerSupplier, confidence: 0.65 };
    }
    return { key: 'UNKNOWN', supplier: null, confidence: 0.15 };
}
