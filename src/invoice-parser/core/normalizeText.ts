export function normalizeText(value: string) {
  return value
    .replace(/\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeForSearch(value: string) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function looksReadableInvoiceText(text: string) {
  const normalized = normalizeText(text);
  if (normalized.length < 100) {
    return false;
  }

  const symbolCount = (normalized.match(/[�□■_]{1}/g) || []).length;
  if (symbolCount / Math.max(normalized.length, 1) > 0.08) {
    return false;
  }

  const strangeCount = (normalized.match(/[{}[\]|€£©®~`^<>]/g) || []).length;
  if (strangeCount / Math.max(normalized.length, 1) > 0.03) {
    return false;
  }

  const moneyLikeCount = (normalized.match(/\b\d{1,3}(?:,\d{3})*(?:\.\d{1,2})\b/g) || []).length;
  if (moneyLikeCount < 2 && normalized.length < 1500) {
    return false;
  }

  const keywordPattern = /\b(invoice|cash sale|delivery note|receipt|amount due|total|vat|pin|serial|date of supply)\b/i;
  return keywordPattern.test(normalized);
}
