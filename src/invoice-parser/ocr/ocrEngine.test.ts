import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseGeminiVisionFallback } from './ocrEngine';

test('does not trigger Gemini OCR for clean invoice text', () => {
  const text = [
    'COMPLY INDUSTRIES LIMITED',
    'TAX INVOICE 026424',
    'Invoice date 26-05-2026',
    'PRE LAM CHIPBOARD 18MM LIGHT GREY',
    'Quantity 4 Unit price 2672.41 Net amount 10689.66',
    'VAT 1710.34 Total due 12400.00',
  ].join('\n');

  assert.equal(shouldUseGeminiVisionFallback(text), false);
});

test('triggers Gemini OCR for duplicated and fragmented OCR text', () => {
  const text = [
    'COMPLY INDUSTRIES LIMITED COMPLY INDUSTRIES LIMITED',
    'INVOICE INVOICEN INYOICE NUMBER N?MBER DATE DATE',
    'TOTAL TUTAL TOTAL TUTAL TOTAL TOTAL TOTAL',
    'QUAST DESUX AMQLENT RECETV',
    '10689.66 VAT 1710.34 AMOUNT DUE 12400.00',
  ].join('\n');

  assert.equal(shouldUseGeminiVisionFallback(text), true);
});
