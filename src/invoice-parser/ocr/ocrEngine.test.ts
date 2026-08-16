import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldUseGeminiVisionFallback } from './ocrEngine';

test('does not trigger Gemini fallback for a complete readable invoice', () => {
  const text = [
    'Tax Invoice INV-1042',
    'Supplier: Example Supplies Limited',
    'Invoice date: 2026-08-16',
    'Item description Quantity Unit price Amount',
    'Office chair 2 12500.00 25000.00',
    'VAT 16% 4000.00',
    'Total KES 29000.00',
  ].join('\n');

  assert.equal(shouldUseGeminiVisionFallback(text), false);
});

test('triggers Gemini fallback for fragmented OCR text', () => {
  assert.equal(
    shouldUseGeminiVisionFallback('I n v o i c e t u t a l a m q l e n t d a t e'),
    true,
  );
});

test('triggers Gemini fallback when OCR repeats invoice totals', () => {
  assert.equal(
    shouldUseGeminiVisionFallback('Total 100.00 Total 100.00 Total 100.00 Total 100.00'),
    true,
  );
});
