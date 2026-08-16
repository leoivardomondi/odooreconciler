"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const ocrEngine_1 = require("./ocrEngine");
(0, node_test_1.default)('does not trigger Gemini fallback for a complete readable invoice', () => {
    const text = [
        'Tax Invoice INV-1042',
        'Supplier: Example Supplies Limited',
        'Invoice date: 2026-08-16',
        'Item description Quantity Unit price Amount',
        'Office chair 2 12500.00 25000.00',
        'VAT 16% 4000.00',
        'Total KES 29000.00',
    ].join('\n');
    strict_1.default.equal((0, ocrEngine_1.shouldUseGeminiVisionFallback)(text), false);
});
(0, node_test_1.default)('triggers Gemini fallback for fragmented OCR text', () => {
    strict_1.default.equal((0, ocrEngine_1.shouldUseGeminiVisionFallback)('I n v o i c e t u t a l a m q l e n t d a t e'), true);
});
(0, node_test_1.default)('triggers Gemini fallback when OCR repeats invoice totals', () => {
    strict_1.default.equal((0, ocrEngine_1.shouldUseGeminiVisionFallback)('Total 100.00 Total 100.00 Total 100.00 Total 100.00'), true);
});
