"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMoney = normalizeMoney;
exports.nearlyEqualMoney = nearlyEqualMoney;
function normalizeMoney(value) {
    if (!value) {
        return null;
    }
    const cleaned = value
        .replace(/KES|KSH|KSh|,/g, '')
        .replace(/[^\d.-]/g, '')
        .trim();
    if (!cleaned) {
        return null;
    }
    const parsed = Number(cleaned);
    // Guard against non-numeric or absurd values (> 50 million KES)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 50_000_000) {
        return null;
    }
    // Reject strings of more than 8 digits without a decimal point (e.g. barcodes, serial numbers, CU numbers, phone numbers)
    const digitsOnly = cleaned.replace(/[^0-9]/g, '');
    if (!cleaned.includes('.') && digitsOnly.length > 8) {
        return null;
    }
    // Reject strings with leading zeros followed by other digits (e.g. registration numbers, phone numbers, codes)
    const integerPart = cleaned.split('.')[0].replace(/^-/, '');
    if (integerPart.length > 1 && integerPart.startsWith('0')) {
        return null;
    }
    return parsed;
}
function nearlyEqualMoney(left, right, tolerance = 1) {
    if (left === null || right === null) {
        return false;
    }
    return Math.abs(left - right) <= tolerance;
}
