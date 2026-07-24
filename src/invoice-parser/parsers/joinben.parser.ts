import { ParserContext, ParsedInvoice } from '../types';
import { computeConfidence } from '../core/confidence';
import { extractCommonDate, extractCustomer, extractGenericItems, extractInvoiceNumber, extractPins } from '../core/extractCommon';
import { extractTotals } from '../core/extractTotals';

export function parseJoinbenInvoice(context: ParserContext): ParsedInvoice {
  const pins = extractPins(context.text);
  const warnings = [...context.warnings, 'Joinben cash sales are often handwritten; review item descriptions carefully.'];
  const base = {
    supplier: 'Joinben Company Limited',
    supplier_key: 'JOINBEN' as const,
    document_type: 'cash_sale' as const,
    invoice_number: extractInvoiceNumber(context.text),
    serial_number: null,
    invoice_date: extractCommonDate(context.text),
    customer: extractCustomer(context.text),
    customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
    supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
    currency: 'KES' as const,
    items: extractGenericItems(context.text).map((item) => ({ ...item, confidence: Math.min(item.confidence || 0.4, 0.45) })),
    totals: extractTotals(context.text),
    warnings,
    raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] as ParsedInvoice['raw']['pages'] },
  };

  return { ...base, confidence: computeConfidence(base) };
}
