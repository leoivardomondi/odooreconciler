"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateInvoice = validateInvoice;
const normalizeMoney_1 = require("./normalizeMoney");
function validateInvoice(invoice) {
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
            if (!(0, normalizeMoney_1.nearlyEqualMoney)(expected, item.net_amount, 2)) {
                warnings.push(`Line ${index + 1} quantity x unit price does not match net amount.`);
            }
        }
    });
    const totals = invoice.totals || { goods_total: null, vat: null, amount_due: null };
    if (totals.goods_total !== null &&
        totals.vat !== null &&
        totals.amount_due !== null &&
        !(0, normalizeMoney_1.nearlyEqualMoney)(totals.goods_total + totals.vat, totals.amount_due, 2)) {
        warnings.push('Goods total plus VAT does not match amount due.');
    }
    return [...new Set(warnings)];
}
