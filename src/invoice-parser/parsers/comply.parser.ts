import { ParserContext, ParsedInvoice } from '../types';
import { computeConfidence } from '../core/confidence';
import {
  extractCommonDate,
  extractCustomer,
  extractDateOfSupply,
  extractGenericItems,
  extractInvoiceNumber,
  extractPins,
  firstMatch,
} from '../core/extractCommon';
import { extractTotals } from '../core/extractTotals';

export function parseComplyInvoice(context: ParserContext): ParsedInvoice {
  const pins = extractPins(context.text);
  const base = {
    supplier: 'Comply Industries Limited',
    supplier_key: 'COMPLY' as const,
    document_type: context.documentType,
    invoice_number: extractInvoiceNumber(context.text),
    serial_number: firstMatch(context.text, [/serial\s*(?:no|number)\.?\s*:?\s*([A-Z0-9/-]+)/i]),
    invoice_date: extractCommonDate(context.text),
    date_of_supply: extractDateOfSupply(context.text),
    customer: extractCustomer(context.text),
    customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
    supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
    currency: 'KES' as const,
    items: extractGenericItems(context.text),
    totals: extractTotals(context.text),
    payment_note: firstMatch(context.text, [/paid\s+via\s+(.+)/i]),
    warnings: [...context.warnings],
    raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] as ParsedInvoice['raw']['pages'] },
  };

  return { ...base, confidence: computeConfidence(base) };
}
