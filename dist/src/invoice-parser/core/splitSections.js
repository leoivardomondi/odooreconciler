"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preferInvoiceSection = preferInvoiceSection;
function preferInvoiceSection(text) {
    const invoiceIndex = text.search(/\binvoice\b/i);
    if (invoiceIndex === -1) {
        return text;
    }
    const deliveryIndex = text.search(/\bdelivery note\b/i);
    if (deliveryIndex !== -1 && deliveryIndex < invoiceIndex) {
        return text.slice(invoiceIndex);
    }
    return text.slice(Math.max(0, invoiceIndex - 500));
}
