import { ParserContext, ParsedInvoice } from '../types';
import { computeConfidence } from '../core/confidence';
import { extractCommonDate, extractCustomer, extractGenericItems, extractInvoiceNumber, extractPins } from '../core/extractCommon';
import { extractTotals } from '../core/extractTotals';
import { preferInvoiceSection } from '../core/splitSections';

export function parseTiptopInvoice(context: ParserContext): ParsedInvoice {
  const invoiceText = preferInvoiceSection(context.text);
  const pins = extractPins(context.text);
  const base = {
    supplier: 'Tiptop Woods Co. Ltd',
    supplier_key: 'TIPTOP' as const,
    document_type: context.documentType,
    invoice_number: extractInvoiceNumber(invoiceText),
    serial_number: null,
    invoice_date: extractCommonDate(invoiceText),
    customer: extractCustomer(invoiceText),
    customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
    supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
    currency: 'KES' as const,
    items: extractGenericItems(invoiceText),
    totals: extractTotals(invoiceText),
    warnings: [...context.warnings],
    raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] as ParsedInvoice['raw']['pages'] },
  };

  return { ...base, confidence: computeConfidence(base) };
}
