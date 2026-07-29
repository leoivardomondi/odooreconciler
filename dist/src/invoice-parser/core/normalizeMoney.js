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
    return Number.isFinite(parsed) ? parsed : null;
}
function nearlyEqualMoney(left, right, tolerance = 1) {
    if (left === null || right === null) {
        return false;
    }
    return Math.abs(left - right) <= tolerance;
}
