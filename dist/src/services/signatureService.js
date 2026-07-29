"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePdfSignature = computePdfSignature;
exports.compareSignature = compareSignature;
exports.getSignatureComparisonLabel = getSignatureComparisonLabel;
const node_crypto_1 = require("node:crypto");
function computePdfSignature(pdfBuffer) {
    return (0, node_crypto_1.createHash)('sha256').update(pdfBuffer).digest('hex');
}
function compareSignature(computed, stored) {
    const normalizedComputed = String(computed || '').trim();
    const normalizedStored = String(stored || '').trim();
    if (!normalizedStored) {
        return 'missing';
    }
    return normalizedComputed === normalizedStored ? 'match' : 'different';
}
function getSignatureComparisonLabel(value) {
    if (value === 'match') {
        return 'MATCH';
    }
    if (value === 'different') {
        return 'DIFFERENT';
    }
    if (value === 'missing') {
        return 'MISSING IN ODOO';
    }
    return 'NOT COMPARED';
}
