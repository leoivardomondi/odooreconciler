import { ParserContext, ParsedInvoice } from '../types';
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

function extractTimsalesInvoiceNumber(text: string) {
  const labelled = extractInvoiceNumber(text);
  if (labelled) {
    return labelled;
  }

  const serial = firstMatch(text, [/serial\s*no\.?\s*(\d{4,})/i]);
  return null;
}

function extractTimsalesSerial(text: string) {
  return (
    extractSerialNumber(text) ||
    firstMatch(text, [/serial\s*no\.?\s*([A-Z0-9/-]+)/i]) ||
    firstMatch(text, [/\b(12\d{4})\b/])
  );
}

function cleanTimsalesItems(text: string) {
  return extractGenericItems(text).map((item) => {
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
}

function cleanTimsalesTotals(text: string, items: ReturnType<typeof cleanTimsalesItems>) {
  const totals = extractTotals(text);
  const goodsFromItems = items.reduce((sum, item) => sum + (item.net_amount || 0), 0);
  const itemGoodsTotal = goodsFromItems > 0 ? Number(goodsFromItems.toFixed(2)) : null;
  const vatBeforeLabel = firstMatch(text, [/([\d,]+(?:\.\d{1,2})?)\s*\n\s*VAT\b/i]);
  const vatAfterLabel = firstMatch(text, [/\bVAT\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i]);
  const amountDueLabel = firstMatch(text, [
    /\bAMOUNT\s+DUE\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bTOTAL\s+AMOUNT\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bGRAND\s+TOTAL\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ]);
  const vatCandidate = normalizeMoney(vatAfterLabel) || normalizeMoney(vatBeforeLabel);
  const saneExtractedVat =
    totals.vat !== null && totals.amount_due !== null && totals.vat > totals.amount_due * 0.35
      ? null
      : totals.vat;
  const vat =
    saneExtractedVat ||
    vatCandidate ||
    (itemGoodsTotal !== null && totals.amount_due !== null
      ? normalizeMoney(String((totals.amount_due - itemGoodsTotal).toFixed(2)))
      : null);
  const computedAmountDueFromItems =
    itemGoodsTotal !== null && typeof vat === 'number'
      ? normalizeMoney(String((itemGoodsTotal + vat).toFixed(2)))
      : null;
  const extractedAmountLooksLikeGoodsTotal =
    typeof totals.amount_due === 'number' &&
    itemGoodsTotal !== null &&
    Math.abs(totals.amount_due - itemGoodsTotal) <= 1 &&
    typeof computedAmountDueFromItems === 'number' &&
    computedAmountDueFromItems > totals.amount_due;
  const goods_total =
    (extractedAmountLooksLikeGoodsTotal ? itemGoodsTotal : null) ||
    (totals.amount_due !== null && vat !== null ? normalizeMoney(String((totals.amount_due - vat).toFixed(2))) : null) ||
    totals.goods_total ||
    itemGoodsTotal;
  const labelledAmountDue = normalizeMoney(amountDueLabel);
  const computedAmountDue =
    typeof goods_total === 'number' && typeof vat === 'number'
      ? normalizeMoney(String((goods_total + vat).toFixed(2)))
      : null;
  const extractedLooksUntaxed =
    typeof totals.amount_due === 'number' &&
    typeof goods_total === 'number' &&
    Math.abs(totals.amount_due - goods_total) <= 1 &&
    typeof computedAmountDue === 'number' &&
    computedAmountDue > totals.amount_due;
  const amount_due =
    labelledAmountDue ||
    (extractedAmountLooksLikeGoodsTotal ? computedAmountDueFromItems : null) ||
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
