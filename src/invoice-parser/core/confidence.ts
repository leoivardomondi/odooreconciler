import { ParsedInvoice } from '../types';

function scorePresent(value: unknown, score: number) {
  return value === null || value === undefined || value === '' ? 0 : score;
}

export function computeConfidence(invoice: Omit<ParsedInvoice, 'confidence'>): ParsedInvoice['confidence'] {
  const supplier = invoice.supplier_key === 'UNKNOWN' ? 0.15 : 0.98;
  const invoice_number = invoice.invoice_number ? 0.9 : 0;
  const date = scorePresent(invoice.invoice_date, 0.85);
  const items = invoice.items.length > 0 ? Math.min(0.95, 0.45 + invoice.items.length * 0.12) : 0.1;
  const invoiceTotals = invoice.totals || { goods_total: null, vat: null, amount_due: null };
  const totals = invoiceTotals.amount_due !== null ? 0.9 : invoiceTotals.goods_total !== null ? 0.55 : 0.1;
  const overall = Number(((supplier + date + items + totals) / 4).toFixed(2));

  return { supplier, invoice_number, date, items, totals, overall };
}
