import { ParserContext, ParsedInvoice } from '../types';
import { computeConfidence } from '../core/confidence';
import {
  extractCommonDate,
  extractCustomer,
  extractGenericItems,
  extractInvoiceNumber,
  extractPins,
  firstMatch,
} from '../core/extractCommon';
import { extractTotals } from '../core/extractTotals';
import { preferInvoiceSection } from '../core/splitSections';

function findVinylCustomerPin(text: string, pins: string[]) {
  const clientPinMatches = [...text.matchAll(/\bCLIENT\s+PIN\s*:?\s*(P\d{9}[A-Z])/gi)]
    .map((match) => match[1].toUpperCase());
  const expectedBuyerPin = [...clientPinMatches, ...pins].find((pin) => /^P0524\d{2}994W$/.test(pin));

  return expectedBuyerPin || clientPinMatches[0] || pins.find((pin) => /^P\d{9}W$/.test(pin)) || null;
}

export function parseVinylInvoice(context: ParserContext): ParsedInvoice {
  const invoiceText = preferInvoiceSection(context.text);
  const pins = extractPins(context.text);
  const customerPin = findVinylCustomerPin(context.text, pins);
  const base = {
    supplier: 'Vinyl Supreme Ceilings & Decor Limited',
    supplier_key: 'VINYL_SUPREME' as const,
    document_type: context.documentType,
    invoice_number: firstMatch(invoiceText, [/\b(VS-\d+)\b/i]) || extractInvoiceNumber(invoiceText),
    serial_number: null,
    invoice_date: extractCommonDate(invoiceText),
    customer: extractCustomer(invoiceText),
    customer_pin: customerPin,
    supplier_pin: pins.find((pin) => pin !== customerPin && /^P\d{9}[A-Z]$/.test(pin)) || null,
    currency: 'KES' as const,
    items: extractGenericItems(invoiceText),
    totals: extractTotals(invoiceText),
    payment_note: firstMatch(context.text, [/payment\s*(?:note|terms)?\s*:?\s*([^\n]+)/i]),
    receipt: {
      kra_invoice_number: firstMatch(context.text, [/kra\s+invoice\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]),
      receipt_number: firstMatch(context.text, [/receipt\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]),
      date: extractCommonDate(context.text),
      tax_system: /etims/i.test(context.text) ? 'eTIMS' : null,
    },
    warnings: [...context.warnings],
    raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] as ParsedInvoice['raw']['pages'] },
  };

  return { ...base, confidence: computeConfidence(base) };
}
