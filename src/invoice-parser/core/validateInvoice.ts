import { ParsedInvoice } from '../types';
import { nearlyEqualMoney } from './normalizeMoney';

export function validateInvoice(invoice: ParsedInvoice) {
  const warnings = [...invoice.warnings];

  if (!invoice.invoice_date) {
    warnings.push('Invoice date was not found.');
  }
  if (invoice.items.length === 0) {
    warnings.push('No invoice line items were extracted.');
  }

  invoice.items.forEach((item, index) => {
    if (item.quantity !== null && item.unit_price !== null && item.net_amount !== null) {
      const expected = item.quantity * item.unit_price;
      if (!nearlyEqualMoney(expected, item.net_amount, 2)) {
        warnings.push(`Line ${index + 1} quantity x unit price does not match net amount.`);
      }
    }
  });

  const totals = invoice.totals || { goods_total: null, vat: null, amount_due: null };
  if (
    totals.goods_total !== null &&
    totals.vat !== null &&
    totals.amount_due !== null &&
    !nearlyEqualMoney(totals.goods_total + totals.vat, totals.amount_due, 2)
  ) {
    warnings.push('Goods total plus VAT does not match amount due.');
  }

  return [...new Set(warnings)];
}
