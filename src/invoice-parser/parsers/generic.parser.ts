import { ParserContext, ParsedInvoice } from '../types';
import { computeConfidence } from '../core/confidence';
import {
  extractCommonDate,
  extractCustomer,
  extractDateOfSupply,
  extractGenericItems,
  extractInvoiceNumber,
  extractPins,
  extractSerialNumber,
  firstMatch,
} from '../core/extractCommon';
import { extractTotals } from '../core/extractTotals';

export function parseGenericInvoice(context: ParserContext): ParsedInvoice {
  const pins = extractPins(context.text);
  const base = {
    supplier: null,
    supplier_key: context.supplierKey,
    document_type: context.documentType,
    invoice_number: extractInvoiceNumber(context.text),
    serial_number: extractSerialNumber(context.text),
    invoice_date: extractCommonDate(context.text),
    date_of_supply: extractDateOfSupply(context.text),
    customer: extractCustomer(context.text),
    customer_pin: pins[0] || null,
    supplier_pin: pins[1] || null,
    currency: 'KES' as const,
    items: extractGenericItems(context.text),
    totals: extractTotals(context.text),
    payment_note: firstMatch(context.text, [/payment\s*(?:note|terms)?\s*:?\s*([^\n]+)/i]),
    warnings: [...context.warnings],
    raw: {
      pdf_text: context.pdfText,
      ocr_text: context.ocrText,
      pages: [] as ParsedInvoice['raw']['pages'],
    },
  };

  return { ...base, confidence: computeConfidence(base) };
}
