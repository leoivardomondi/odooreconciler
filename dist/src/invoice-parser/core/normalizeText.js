"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeText = normalizeText;
exports.normalizeForSearch = normalizeForSearch;
exports.looksReadableInvoiceText = looksReadableInvoiceText;
function normalizeText(value) {
    return value
        .replace(/\r/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function normalizeForSearch(value) {
    return normalizeText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function looksReadableInvoiceText(text) {
    const normalized = normalizeText(text);
    if (normalized.length < 100) {
        return false;
    }
    const symbolCount = (normalized.match(/[�□■_]{1}/g) || []).length;
    if (symbolCount / Math.max(normalized.length, 1) > 0.08) {
        return false;
    }
    const strangeCount = (normalized.match(/[{}[\]|€£©®~`^<>]/g) || []).length;
    if (strangeCount / Math.max(normalized.length, 1) > 0.03) {
        return false;
    }
    const moneyLikeCount = (normalized.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})\b/g) || []).length;
    if (moneyLikeCount < 2 && normalized.length < 1500) {
        return false;
    }
    const keywordPattern = /\b(invoice|cash sale|delivery note|receipt|amount due|total|vat|pin|serial|date of supply)\b/i;
    return keywordPattern.test(normalized);
}
