import assert from 'node:assert/strict';
import test from 'node:test';
import { ParsedInvoice } from '../types';
import { normalizeInvoiceTotals } from './normalizeTotals';

function vinylReceipt(overrides: Partial<ParsedInvoice['totals']> = {}): ParsedInvoice {
  return {
    supplier: 'Vinyl Supreme Ceilings & Decor Limited',
    supplier_key: 'VINYL_SUPREME',
    document_type: 'receipt',
    invoice_number: 'KRACU0100078765/1691',
    invoice_date: '2026-06-05',
    customer: 'Urban Vibe',
    customer_pin: 'P052426994W',
    supplier_pin: 'P052407740E',
    currency: 'KES',
    items: [
      {
        description: 'CONSTRUCTION MATERIALS KE2NTXNOX0000001',
        quantity: 1,
        unit: 'item',
        unit_price: 10344.83,
        net_amount: 10344.83,
      },
    ],
    totals: {
      goods_total: 8689.66,
      vat: 1655.17,
      amount_due: 12000,
      ...overrides,
    },
    confidence: {
      supplier: 0.98,
      invoice_number: 0.9,
      date: 0.85,
      items: 0.57,
      totals: 0.9,
      overall: 0.83,
    },
    warnings: [],
    raw: {
      pdf_text: '',
      ocr_text: 'CONSTRUCTION MATERIALS 12,000.00x1 12,000.00 16% VAT 1,655.17 TOTAL 12,000.00',
      pages: [],
    },
  };
}

test('preserves the VAT-inclusive receipt total and derives the correct net total', () => {
  const normalized = normalizeInvoiceTotals(vinylReceipt());

  assert.deepEqual(normalized.totals, {
    goods_total: 10344.83,
    vat: 1655.17,
    amount_due: 12000,
  });
});

test('handles non-VAT documents by setting goods_total equal to amount_due', () => {
  const noVatInvoice = vinylReceipt({
    goods_total: null,
    vat: null,
    amount_due: 2600,
  });
  noVatInvoice.items = [
    {
      description: 'STEEL RODS',
      quantity: 2,
      unit: 'pcs',
      unit_price: 1300,
      net_amount: 2600,
    },
  ];
  noVatInvoice.raw.ocr_text = 'OKHA STEEL & HARDWARE TOTAL 2600.00';

  const normalized = normalizeInvoiceTotals(noVatInvoice);
  assert.equal(normalized.totals.amount_due, 2600);
  assert.equal(normalized.totals.goods_total, 2600);
  assert.equal(normalized.totals.vat, null);
});

test('corrects a parser net subtotal when line net plus VAT matches the payable total', () => {
  const normalized = normalizeInvoiceTotals(vinylReceipt({ amount_due: 10344.83 }));

  assert.deepEqual(normalized.totals, {
    goods_total: 10344.83,
    vat: 1655.17,
    amount_due: 12000,
  });
});

test('normalizeMoney rejects leading-zero codes and phone numbers but preserves 0 and decimals', () => {
  const { normalizeMoney } = require('./normalizeMoney');
  assert.equal(normalizeMoney('0119048'), null);
  assert.equal(normalizeMoney('0733410055'), null);
  assert.equal(normalizeMoney('0512210841'), null);
  assert.equal(normalizeMoney('0'), 0);
  assert.equal(normalizeMoney('0.00'), 0);
  assert.equal(normalizeMoney('0.50'), 0.5);
  assert.equal(normalizeMoney('4500.00'), 4500);
  assert.equal(normalizeMoney('3879.31'), 3879.31);
});

test('ignores telephone numbers, serial numbers, and VAT registration numbers in totals fallback', () => {
  const complyInvoice: ParsedInvoice = {
    supplier: 'COMPLY INDUSTRIES LIMITED',
    supplier_key: 'COMPLY',
    document_type: 'invoice',
    invoice_number: '026579',
    invoice_date: '2026-06-18',
    customer: 'URBAN VIBE',
    customer_pin: null,
    supplier_pin: null,
    currency: 'KES',
    items: [
      {
        description: 'PRE-LAM MDF 3MM WHITE 1/S',
        quantity: 1,
        unit_price: 1293.1,
        net_amount: 1293.1,
      },
      {
        description: 'PRE-LAM MDF 3MM WHITE 1/S',
        quantity: 2,
        unit_price: 1293.1,
        net_amount: 2586.21,
      },
    ],
    totals: {
      goods_total: null,
      vat: null,
      amount_due: null,
    },
    confidence: {
      supplier: 0.98,
      invoice_number: 0.9,
      date: 0.85,
      items: 0.7,
      totals: 0.8,
      overall: 0.85,
    },
    warnings: [],
    raw: {
      pdf_text: '',
      ocr_text: `
        COMPLY INDUSTRIES LIMITED
        Telephone : 051- 2210841/2
        Branch No: +254 755 634404
        Mobile : 0733 410055 / 0722 205920
        Mw S/N: ERAM MW002202207050454
        VAT Reg No. 0119048J
        PIN NO. P051136980H
        TOTAL GOODS 3879.31
      `,
      pages: [],
    },
  };

  const normalized = normalizeInvoiceTotals(complyInvoice);
  assert.equal(normalized.totals.goods_total, 3879.31);
  assert.equal(normalized.totals.vat, null);
  assert.equal(normalized.totals.amount_due, 3879.31);

  // When AI extraction provides VAT and grand total (4500), it should replace parser subtotal
  const { mergeAiInvoiceExtraction } = require('../aiInvoiceExtractor');
  const merged = mergeAiInvoiceExtraction(normalized, {
    supplier: 'COMPLY INDUSTRIES LIMITED',
    supplier_key: 'COMPLY',
    invoice_number: '026579',
    invoice_date: '2026-06-18',
    totals: { goods_total: 3879.31, vat: 620.69, amount_due: 4500 },
    confidence: 0.95,
    notes: ['Amount due matches visible total.'],
    items: [
      { description: 'PRE-LAM MDF 3MM WHITE 1/S', quantity: 1, unit_price: 1293.1, amount: 1293.1 },
      { description: 'PRE-LAM MDF 3MM WHITE 1/S', quantity: 2, unit_price: 1293.1, amount: 2586.21 },
    ],
  });

  assert.equal(merged.totals.amount_due, 4500);
  assert.equal(merged.totals.goods_total, 3879.31);
  assert.equal(merged.totals.vat, 620.69);
});
