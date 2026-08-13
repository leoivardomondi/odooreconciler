"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const ocrEngine_1 = require("./ocrEngine");
(0, node_test_1.default)('does not trigger Gemini OCR for clean invoice text', () => {
    const text = [
        'COMPLY INDUSTRIES LIMITED',
        'TAX INVOICE 026424',
        'Invoice date 26-05-2026',
        'PRE LAM CHIPBOARD 18MM LIGHT GREY',
        'Quantity 4 Unit price 2672.41 Net amount 10689.66',
        'VAT 1710.34 Total due 12400.00',
    ].join('\n');
    strict_1.default.equal((0, ocrEngine_1.shouldUseGeminiVisionFallback)(text), false);
});
(0, node_test_1.default)('triggers Gemini OCR for duplicated and fragmented OCR text', () => {
    const text = [
        'COMPLY INDUSTRIES LIMITED COMPLY INDUSTRIES LIMITED',
        'INVOICE INVOICEN INYOICE NUMBER N?MBER DATE DATE',
        'TOTAL TUTAL TOTAL TUTAL TOTAL TOTAL TOTAL',
        'QUAST DESUX AMQLENT RECETV',
        '10689.66 VAT 1710.34 AMOUNT DUE 12400.00',
    ].join('\n');
    strict_1.default.equal((0, ocrEngine_1.shouldUseGeminiVisionFallback)(text), true);
});
