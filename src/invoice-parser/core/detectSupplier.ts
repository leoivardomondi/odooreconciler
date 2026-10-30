import { SupplierKey } from '../types';
import { normalizeForSearch } from './normalizeText';

function titleCaseSupplier(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
    .replace(/\bLtd\b/g, 'LTD')
    .replace(/\bLimited\b/g, 'Limited');
}

function extractHeaderSupplier(text: string) {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[^A-Z0-9&.,' -]/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 4)
    .slice(0, 45);

  const blocked = /\b(receipt|invoice|billing|shipping|description|quantity|price|amount|vat|total|paybill|terms|tel|email|box|street|road|pin|buyer|date)\b/i;
  const companyPattern = /\b([A-Z][A-Z0-9&.,' -]{2,80}\b(?:ENTERPRISES?|TRADERS?|SUPPLIERS?|STATIONERS?|COMPANY|CO\.?|LTD|LIMITED|HARDWARE|TIMBER|SUPERMARKET)\b(?:\s+LTD|\s+LIMITED)?)\b/i;

  const candidates: { name: string; priority: number }[] = [];

  for (const line of lines) {
    // Ignore lines that are invoice title indicators e.g. "Sales Invoice", "Tax Invoice", "SalesInvoice Co"
    if (/\b(?:sales|tax|proforma|cash)\s*[li1]nvoice\b/i.test(line) || /sales[li1]nvoice/i.test(line) || /[li1]nvoice\s*co\b/i.test(line)) {
      continue;
    }
    if (blocked.test(line) && !/\b(LTD|LIMITED|ENTERPRISES?|COMPANY|CO\.?)\b/i.test(line)) {
      continue;
    }
    const match = line.match(companyPattern);
    const supplier = match?.[1]?.replace(/\b(RECEIPT|INVOICE)\b/gi, '').trim();
    if (supplier && supplier.length >= 5) {
      if (/\b(?:sales|tax|proforma|cash)\s*[li1]nvoice\b/i.test(supplier) || /sales[li1]nvoice/i.test(supplier) || /[li1]nvoice\s*co\b/i.test(supplier)) {
        continue;
      }
      let priority = 1;
      if (/\b(LTD|LIMITED)\b/i.test(supplier)) {
        priority = 3;
      } else if (/\b(ENTERPRISES?|SUPPLIERS?|TRADERS?)\b/i.test(supplier)) {
        priority = 2;
      }
      candidates.push({ name: titleCaseSupplier(supplier), priority });
    }
  }

  candidates.sort((left, right) => right.priority - left.priority);
  return candidates[0]?.name || null;
}

export function detectSupplier(text: string): { key: SupplierKey; supplier: string | null; confidence: number } {
  const normalized = normalizeForSearch(text);

  if (normalized.includes('comply industries')) {
    return { key: 'COMPLY', supplier: 'Comply Industries Limited', confidence: 0.98 };
  }
  if (normalized.includes('timsales limited')) {
    return { key: 'TIMSALES', supplier: 'Timsales Limited', confidence: 0.98 };
  }
  if (normalized.includes('p000591147n') || normalized.includes('po00s91147n')) {
    return { key: 'TIMSALES', supplier: 'Timsales Limited', confidence: 0.8 };
  }
  if (normalized.includes('vinyl supreme ceilings')) {
    return { key: 'VINYL_SUPREME', supplier: 'Vinyl Supreme Ceilings & Decor Limited', confidence: 0.98 };
  }
  if (normalized.includes('tiptop woods')) {
    return { key: 'TIPTOP', supplier: 'Tiptop Woods Co. Ltd', confidence: 0.98 };
  }
  if (normalized.includes('joinben company')) {
    return { key: 'JOINBEN', supplier: 'Joinben Company Limited', confidence: 0.98 };
  }

  const headerSupplier = extractHeaderSupplier(text);
  if (headerSupplier) {
    return { key: 'UNKNOWN', supplier: headerSupplier, confidence: 0.65 };
  }

  return { key: 'UNKNOWN', supplier: null, confidence: 0.15 };
}
