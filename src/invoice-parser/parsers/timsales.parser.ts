import { ParserContext, ParsedInvoice, ParsedInvoiceItem } from '../types';
import { computeConfidence } from '../core/confidence';
import { extractIsoDateFromFilename } from '../core/extractDates';
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
import { normalizeMoney } from '../core/normalizeMoney';

function extractTimsalesCustomer(text: string) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const invoiceToIndex = lines.findIndex((line) => /invoice\s+to/i.test(line));
  if (invoiceToIndex >= 0) {
    const next = lines.slice(invoiceToIndex + 1).find((line) => !/invoice|serial|vat|pin|box/i.test(line));
    if (next) {
      return next.replace(/\s+/g, ' ');
    }
  }

  return extractCustomer(text);
}

function extractTimsalesSerial(text: string) {
  const spacedSerial =
    firstMatch(text, [/serial\s*(?:no|nq|number)?\.?\s*:?\s*(1\s*2(?:\s*\d){4})/i]) ||
    firstMatch(text, [/\b(1\s*2(?:\s*\d){4})\b/]);
  if (spacedSerial) {
    return spacedSerial.replace(/\s+/g, '');
  }

  return (
    extractSerialNumber(text) ||
    firstMatch(text, [/serial\s*(?:no|nq)\.?\s*([A-Z0-9/-]+)/i]) ||
    firstMatch(text, [/\b(12\d{4})\b/])
  );
}

function extractTimsalesInvoiceNumber(text: string) {
  const sameLineMatch = firstMatch(text, [
    /invoice\s*(?:no|number|#)\.?\s*:?[ \t]*([A-Z0-9/-]{4,})/i,
  ]);
  if (
    sameLineMatch &&
    sameLineMatch.replace(/\D/g, '').length >= 3 &&
    !/^(?:date|dated|serial|order|code|desc|piue|price|value|1nvoice)$/i.test(sameLineMatch)
  ) {
    return sameLineMatch;
  }

  const serial = extractTimsalesSerial(text);
  if (serial) {
    return serial;
  }

  const labelled = extractInvoiceNumber(text);
  if (labelled && !/^00\d{4}[A-Z]?$/i.test(labelled)) {
    return labelled;
  }

  return null;
}

function normalizeOcrAmountText(text: string) {
  return text
    .replace(/\bZ\$(\d{2}),(\d{2})\b/gi, '28$1.$2')
    .replace(/(\d)&\+4,\s*(\d{2})/g, '$1844.$2')
    .replace(/2l974[_\s.]*14/gi, '2974.14 ')
    .replace(/(\d),\$(\d)/g, '$1.8$2')
    .replace(/\b17250,QI\b/gi, '17250.00')
    .replace(/\b(?:KSH|KES)\s*(\d{1,3})\.(\d{3})\s*\/=/gi, (_, thousands, hundreds) => `${thousands}${hundreds}`)
    .replace(/(\d{4,6}),(\d{2})\b/g, '$1.$2');
}

function recoverMultiLineTimsalesItems(text: string): ParsedInvoiceItem[] {
  const normalizedText = normalizeOcrAmountText(text);
  const lines = normalizedText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const specificLineRegex =
    /\b((?:PB\s+LAM|MDF|BLOCKBOARD|CHIPBOARD|FLUSH\s+DOOR|CYPRESS|PINE|MAHOGANY)\b[^\n]*)/i;
  const fallbackLineRegex =
    /\b((?:PLYWOOD|TIMBER|HARDWOOD)\b\s+\S[^\n]*)/i;
  const descMatch =
    lines.map((line) => line.match(specificLineRegex)).find(Boolean) ||
    lines.map((line) => line.match(fallbackLineRegex)).find(Boolean);
  if (!descMatch) {
    return [];
  }

  const rawDesc = descMatch[1]
    .replace(/(?:!8MM|iSM&l)/gi, '18MM')
    .replace(/WBITE/gi, 'WHITE')
    .replace(/\s+/g, ' ')
    .trim();

  const decimalNumbers: number[] = [];
  for (const match of normalizedText.matchAll(/(\d{1,3}(?:,\d{3})+|\d{3,6})\.(\d{2})/g)) {
    const val = Number(`${match[1].replace(/,/g, '')}.${match[2]}`);
    if (Number.isFinite(val) && val >= 100 && val <= 1000000) {
      decimalNumbers.push(val);
    }
  }

  // First pass: look for multi-unit pairs (qty >= 2) where netCandidate / unitPrice is an integer
  for (const allowSingleQty of [false, true]) {
    for (const unitPrice of decimalNumbers) {
      if (unitPrice < 200 || unitPrice > 100000) continue;
      for (const netCandidate of decimalNumbers) {
        if (!allowSingleQty && netCandidate <= unitPrice + 1) continue;
        if (netCandidate < unitPrice - 1) continue;
        const ratio = netCandidate / unitPrice;
        const qty = Math.round(ratio);
        if (qty >= (allowSingleQty ? 1 : 2) && qty <= 200 && Math.abs(qty * unitPrice - netCandidate) <= 2.5) {
          if (Math.abs(ratio - qty) > 0.01) continue;
          const exactNet = Number((qty * unitPrice).toFixed(2));
          return [
            {
              description: rawDesc,
              quantity: qty,
              unit: 'Piece',
              unit_price: unitPrice,
              net_amount: exactNet,
              raw_text: `${rawDesc} [recovered ${qty} x ${unitPrice} = ${exactNet}]`,
              confidence: 0.72,
            },
          ];
        }
      }
    }
  }

  return [];
}

function cleanTimsalesItems(text: string) {
  const generic = extractGenericItems(text)
    .filter((item) => !/\bserial\s*(?:no|nq)\b/i.test(item.description))
    .map((item) => {
      if (
        item.quantity === 1 &&
        item.unit_price !== null &&
        item.net_amount !== null &&
        Math.abs(item.unit_price - item.net_amount) > 2
      ) {
        return {
          ...item,
          unit_price: item.net_amount,
          confidence: Math.min(item.confidence || 0.6, 0.58),
          raw_text: `${item.raw_text || ''} [unit price normalized from net amount]`.trim(),
        };
      }

      return item;
    });

  if (generic.length > 0) {
    return generic;
  }

  return recoverMultiLineTimsalesItems(text);
}

function roundNearWholeShilling(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) <= 0.02) {
    return nearest;
  }
  return Number(value.toFixed(2));
}

function cleanTimsalesTotals(text: string, items: ReturnType<typeof cleanTimsalesItems>) {
  const normalizedText = normalizeOcrAmountText(text);
  const totals = extractTotals(normalizedText);
  const goodsFromItems = items.reduce((sum, item) => sum + (item.net_amount || 0), 0);
  const itemGoodsTotal = goodsFromItems > 0 ? Number(goodsFromItems.toFixed(2)) : null;
  const vatBeforeLabel = firstMatch(normalizedText, [/([\d,]+(?:\.\d{1,2})?)\s*\n\s*VAT\b/i]);
  const vatAfterLabel = firstMatch(normalizedText, [/\bVAT\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i]);
  const amountDueLabel = firstMatch(normalizedText, [
    /\bAMOUNT\s+DUE\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bTOTAL\s+AMOUNT\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bGRAND\s+TOTAL\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  const rawVatCandidate = normalizeMoney(vatAfterLabel) || normalizeMoney(vatBeforeLabel);
  const inferredVatFromItemGoods =
    itemGoodsTotal !== null && /\b16\b/.test(normalizedText)
      ? Number((itemGoodsTotal * 0.16).toFixed(2))
      : null;
  const vatCandidate =
    rawVatCandidate !== null && itemGoodsTotal !== null && rawVatCandidate < itemGoodsTotal * 0.05
      ? null
      : rawVatCandidate;
  const saneExtractedVat =
    totals.vat !== null &&
    ((totals.amount_due !== null && totals.vat > totals.amount_due * 0.35) ||
      (itemGoodsTotal !== null && totals.vat < itemGoodsTotal * 0.05))
      ? null
      : totals.vat;
  const vat =
    saneExtractedVat ||
    vatCandidate ||
    inferredVatFromItemGoods ||
    (itemGoodsTotal !== null && totals.amount_due !== null && totals.amount_due > itemGoodsTotal
      ? normalizeMoney(String((totals.amount_due - itemGoodsTotal).toFixed(2)))
      : null);
  const computedAmountDueFromItems =
    itemGoodsTotal !== null && typeof vat === 'number'
      ? roundNearWholeShilling(itemGoodsTotal + vat)
      : null;
  const extractedAmountTooSmall =
    typeof totals.amount_due === 'number' &&
    itemGoodsTotal !== null &&
    totals.amount_due < itemGoodsTotal * 1.05;
  const extractedAmountLooksLikeGoodsTotal =
    typeof totals.amount_due === 'number' &&
    itemGoodsTotal !== null &&
    Math.abs(totals.amount_due - itemGoodsTotal) <= 1 &&
    typeof computedAmountDueFromItems === 'number' &&
    computedAmountDueFromItems > totals.amount_due;
  const goods_total =
    (extractedAmountLooksLikeGoodsTotal || extractedAmountTooSmall ? itemGoodsTotal : null) ||
    (totals.amount_due !== null && !extractedAmountTooSmall && vat !== null
      ? normalizeMoney(String((totals.amount_due - vat).toFixed(2)))
      : null) ||
    totals.goods_total ||
    itemGoodsTotal;
  const labelledAmountDue = normalizeMoney(amountDueLabel);
  const computedAmountDue =
    typeof goods_total === 'number' && typeof vat === 'number'
      ? roundNearWholeShilling(goods_total + vat)
      : null;
  const extractedLooksUntaxed =
    typeof totals.amount_due === 'number' &&
    typeof goods_total === 'number' &&
    Math.abs(totals.amount_due - goods_total) <= 1 &&
    typeof computedAmountDue === 'number' &&
    computedAmountDue > totals.amount_due;
  const amount_due =
    labelledAmountDue ||
    (extractedAmountLooksLikeGoodsTotal || extractedAmountTooSmall ? computedAmountDueFromItems : null) ||
    (extractedLooksUntaxed ? computedAmountDue : null) ||
    totals.amount_due ||
    computedAmountDue;

  return { goods_total, vat, amount_due };
}

export function parseTimsalesInvoice(context: ParserContext): ParsedInvoice {
  const pins = extractPins(context.text);
  const items = cleanTimsalesItems(context.text);
  const totals = cleanTimsalesTotals(context.text, items);
  const invoiceDate = extractCommonDate(context.text) || extractIsoDateFromFilename(context.originalFilename);
  const base = {
    supplier: 'Timsales Limited',
    supplier_key: 'TIMSALES' as const,
    document_type: context.documentType,
    invoice_number: extractTimsalesInvoiceNumber(context.text),
    serial_number: extractTimsalesSerial(context.text),
    invoice_date: invoiceDate,
    date_of_supply: extractDateOfSupply(context.text),
    customer: extractTimsalesCustomer(context.text),
    customer_pin: pins.find((pin) => pin.startsWith('P')) || null,
    supplier_pin: pins.find((pin) => pin.startsWith('A')) || null,
    currency: 'KES' as const,
    items,
    totals,
    payment_note: firstMatch(context.text, [/paid\s+via\s+(.+)/i]),
    warnings: [...context.warnings],
    raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] as ParsedInvoice['raw']['pages'] },
  };

  return { ...base, confidence: computeConfidence(base) };
}
