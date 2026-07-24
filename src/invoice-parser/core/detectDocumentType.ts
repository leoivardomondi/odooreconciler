import { DocumentType } from '../types';
import { normalizeForSearch } from './normalizeText';

export function detectDocumentType(text: string): DocumentType {
  const normalized = normalizeForSearch(text);
  const hasInvoice = /\binvoice\b/.test(normalized);
  const hasCashSale = normalized.includes('cash sale');
  const hasDeliveryNote = normalized.includes('delivery note');
  const hasReceipt = normalized.includes('etims') || normalized.includes('kra') || normalized.includes('receipt');
  const count = [hasInvoice, hasCashSale, hasDeliveryNote, hasReceipt].filter(Boolean).length;

  if (count > 1) {
    return 'mixed';
  }
  if (hasCashSale) {
    return 'cash_sale';
  }
  if (hasInvoice) {
    return 'invoice';
  }
  if (hasDeliveryNote) {
    return 'delivery_note';
  }
  if (hasReceipt) {
    return 'receipt';
  }

  return 'unknown';
}
