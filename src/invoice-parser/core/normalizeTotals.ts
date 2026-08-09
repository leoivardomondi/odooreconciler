import { ParsedInvoice } from '../types';
import { extractTotals } from './extractTotals';
import { nearlyEqualMoney, normalizeMoney } from './normalizeMoney';

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function positiveMoney(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nearlyEqualComputedMoney(left: number, right: number): boolean {
  return nearlyEqualMoney(left, right, Math.max(2, Math.abs(right) * 0.03));
}

function findLargestMoney(text: string): number | null {
  const values = [...text.matchAll(/(?:KSH|KES|SH)?\s*([\d,]+(?:\.\d{1,2})?)(?:\/=)?/gi)]
    .map((match) => normalizeMoney(match[1]))
    .filter((value): value is number => typeof value === 'number' && value >= 50);

  return values.length > 0 ? Math.max(...values) : null;
}

function chooseMostLikelyMoney(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const counts = new Map<number, number>();
  values.forEach((value) => {
    const rounded = roundMoney(value);
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
}

function inferGoodsFromGrossAndVat(gross: number | null, vat: number | null): number | null {
  if (gross === null || vat === null || gross <= vat) {
    return null;
  }

  return roundMoney(gross - vat);
}

function findExplicitAmountDueCandidates(text: string): number[] {
  const values: number[] = [];
  const patterns = [
    /\bTOTAL\s*\(\s*KES\s*\)\s*([\d\s,.]+)(?=\s|$)/gi,
    /\bTOTAL\b(?!\s+(?:A|B|C|D|E|TAX|VAT|GOODS|EX|EXCLUSIVE|INCLUSIVE|INCL|KES))\s*(?:KSH|KES)?\s*:?[^\d]{0,8}([\d\s,]+(?:[.,]\d{1,3})?)/gi,
    /\b(?:AMOUNT\s+DUE|TOTAL\s+AMOUNT|GRAND\s+TOTAL|AMOUNT\s+PAYABLE|INVOICE\s+TOTAL|TOTAL\s+INCL(?:USIVE)?|NET\s+PAYABLE|BALANCE\s+DUE)\b\s*(?:KSH|KES)?\s*:?[^\d]{0,8}([\d\s,]+(?:[.,]\d{1,3})?)/gi,
    /^\s*DUE\s*(?:\n\s*(?:KSH|KES))?\s*\n\s*([\d\s,]+(?:[.,]\d{1,3})?)\s*$/gim,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/\s+/g, '');
      const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
      const value = normalizeMoney(normalizedRaw);
      if (value !== null && value >= 50) {
        values.push(value);
      }
    }
  }

  return values;
}

function findStrongFinalTotal(text: string): number | null {
  const patterns = [
    /\bTOTAL\s*\(\s*KES\s*\)\s*([\d\s,.]+)(?=\s|$)/gi,
    /\b(?:AMOUNT\s+DUE|TOTAL\s+AMOUNT|GRAND\s+TOTAL|AMOUNT\s+PAYABLE|INVOICE\s+TOTAL|NET\s+PAYABLE|BALANCE\s+DUE)\b\s*(?:KSH|KES)?\s*:?[^\d]{0,8}([\d\s,]+(?:[.,]\d{1,3})?)/gi,
    /^\s*DUE\s*(?:\n\s*(?:KSH|KES))?\s*\n\s*([\d\s,]+(?:[.,]\d{1,3})?)\s*$/gim,
  ];
  const values: number[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/\s+/g, '');
      const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
      const value = normalizeMoney(normalizedRaw);
      if (value !== null && value >= 50) {
        values.push(value);
      }
    }
  }

  return chooseMostLikelyMoney(values);
}

function findWeakPaymentTotal(text: string): number | null {
  const values: number[] = [];
  const patterns = [
    /\b(?:CASH|PAID|CARD|MPESA|M-PESA)\b\s*(?:KSH|KES)?\s*:?[^\d]{0,8}([\d\s,]+(?:[.,]\d{1,3})?)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/\s+/g, '');
      const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
      const value = normalizeMoney(normalizedRaw);
      if (value !== null && value >= 50) {
        values.push(value);
      }
    }
  }

  return chooseMostLikelyMoney(values);
}

function findLabelledAmountDue(text: string): number | null {
  const candidates = findExplicitAmountDueCandidates(text);
  if (candidates.length > 0) {
    return chooseMostLikelyMoney(candidates);
  }

  const totalKesMatches = text.matchAll(/\bTOTAL\s*\(\s*KES\s*\)\s*([\d\s,.]+)(?=\s|$)/gi);
  let totalKesValue: number | null = null;
  for (const match of totalKesMatches) {
    const raw = match[1].replace(/\s+/g, '');
    const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
    const value = normalizeMoney(normalizedRaw);
    if (value !== null && value >= 50) {
      totalKesValue = value;
    }
  }
  if (totalKesValue !== null) {
    return totalKesValue;
  }

  const labels = [
    'amount due',
    'total amount',
    'grand total',
    'amount payable',
    'invoice total',
    'total incl',
    'total inclusive',
    'total inc',
    'net payable',
    'balance due',
    'total (kes)',
    'total kes',
  ];

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = text.matchAll(new RegExp(`\\b${escaped}\\b\\s*(?:KSH|KES)?\\s*:?\\s*([\\d\\s,]+(?:[.,]\\d{1,3})?)`, 'gi'));
    let lastValue: number | null = null;
    for (const match of matches) {
      const raw = match[1];
      const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
      const value = normalizeMoney(normalizedRaw);
      if (value !== null && value >= 50) {
        lastValue = value;
      }
    }
    if (lastValue !== null) {
      return lastValue;
    }
  }

  return null;
}

function sumLineNetAmounts(invoice: ParsedInvoice): number | null {
  const values = invoice.items
    .map((item) => positiveMoney(item.net_amount))
    .filter((value): value is number => value !== null);

  return values.length > 0 ? roundMoney(values.reduce((sum, value) => sum + value, 0)) : null;
}

function sumClearLineItems(invoice: ParsedInvoice): number | null {
  const values = invoice.items
    .filter((item) => {
      const quantity = positiveMoney(item.quantity);
      const unitPrice = positiveMoney(item.unit_price);
      const netAmount = positiveMoney(item.net_amount);

      return (
        quantity !== null &&
        unitPrice !== null &&
        netAmount !== null &&
        nearlyEqualComputedMoney(roundMoney(quantity * unitPrice), netAmount)
      );
    })
    .map((item) => positiveMoney(item.net_amount))
    .filter((value): value is number => value !== null);

  return values.length > 0 ? roundMoney(values.reduce((sum, value) => sum + value, 0)) : null;
}

function inferKenyaVatInclusiveTotal(vat: number | null): number | null {
  if (vat === null) {
    return null;
  }

  const gross = roundMoney((vat / 0.16) * 1.16);
  return gross >= 50 ? gross : null;
}

function findVatConsistentMoney(text: string, vat: number | null): number | null {
  const targetGross = inferKenyaVatInclusiveTotal(vat);
  if (targetGross === null) {
    return null;
  }

  const values = [...text.matchAll(/\b(\d[\d\s,]*(?:[.,]\s*\d{1,3})?)\b/g)]
    .map((match) => normalizeMoney(match[1].replace(/\s+/g, '')))
    .filter((value): value is number =>
      typeof value === 'number' &&
      value >= Math.max(50, targetGross * 0.75) &&
      value <= targetGross * 1.25,
    );

  if (values.length === 0) {
    return null;
  }

  const counts = new Map<number, number>();
  values.forEach((value) => {
    const rounded = roundMoney(value);
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => {
      if (left[1] !== right[1]) {
        return right[1] - left[1];
      }

      return Math.abs(left[0] - targetGross) - Math.abs(right[0] - targetGross);
    })[0]?.[0] ?? null;
}

export function normalizeInvoiceTotals(invoice: ParsedInvoice): ParsedInvoice {
  const text = [invoice.raw?.ocr_text, invoice.raw?.pdf_text, invoice.raw?.pages?.map((page) => page.text).join('\n\n')]
    .filter(Boolean)
    .join('\n\n');
  const extracted = text ? extractTotals(text) : { goods_total: null, vat: null, amount_due: null };
  const currentAmountDue = positiveMoney(invoice.totals?.amount_due);
  const extractedVat = positiveMoney(extracted.vat);
  const suppliedVat = positiveMoney(invoice.totals?.vat);
  const vat =
    suppliedVat !== null && currentAmountDue !== null && suppliedVat > currentAmountDue
      ? extractedVat
      : suppliedVat ?? extractedVat;
  const goodsTotal = positiveMoney(invoice.totals?.goods_total) ?? positiveMoney(extracted.goods_total) ?? sumLineNetAmounts(invoice);
  const labelledAmountDue = text ? findLabelledAmountDue(text) : null;
  const strongFinalTotal = text ? findStrongFinalTotal(text) : null;
  const weakPaymentTotal = text ? findWeakPaymentTotal(text) : null;
  const clearLineItemsTotal = sumClearLineItems(invoice);
  const largestMoney = text ? findLargestMoney(text) : null;
  const hasExplicitFinalTotal = text ? findExplicitAmountDueCandidates(text).length > 0 : false;
  const computedAmountDue =
    goodsTotal !== null && vat !== null ? roundMoney(goodsTotal + vat) : null;
  const arithmeticallySupportedAmountDue =
    (computedAmountDue !== null && currentAmountDue !== null && nearlyEqualComputedMoney(computedAmountDue, currentAmountDue)) ||
    (clearLineItemsTotal !== null && currentAmountDue !== null && nearlyEqualComputedMoney(clearLineItemsTotal, currentAmountDue));
  const currentLooksLikeWeakPayment =
    currentAmountDue !== null &&
    weakPaymentTotal !== null &&
    nearlyEqualMoney(currentAmountDue, weakPaymentTotal, 1) &&
    !arithmeticallySupportedAmountDue &&
    (
      (clearLineItemsTotal !== null && clearLineItemsTotal > currentAmountDue) ||
      (computedAmountDue !== null && computedAmountDue > currentAmountDue) ||
      (strongFinalTotal !== null && strongFinalTotal > currentAmountDue)
    );
  const vatInferredAmountDue = inferKenyaVatInclusiveTotal(vat);
  const currentLooksUntaxed =
    currentAmountDue !== null &&
    goodsTotal !== null &&
    nearlyEqualMoney(currentAmountDue, goodsTotal, 1) &&
    computedAmountDue !== null &&
    computedAmountDue > currentAmountDue;
  const currentInconsistent =
    currentAmountDue !== null &&
    goodsTotal !== null &&
    vat !== null &&
    !nearlyEqualMoney(goodsTotal + vat, currentAmountDue, 2);
  const vatInferenceLooksBetter =
    vatInferredAmountDue !== null &&
    currentAmountDue !== null &&
    vatInferredAmountDue > currentAmountDue &&
    vatInferredAmountDue / currentAmountDue <= 1.5;
  const vatConsistentAmountDue = text ? findVatConsistentMoney(text, vat) : null;
  const labelledAmountDueLooksImplausible =
    labelledAmountDue !== null &&
    vatInferredAmountDue !== null &&
    labelledAmountDue > vatInferredAmountDue * 1.25 &&
    strongFinalTotal === null;
  const currentLooksLikeVat =
    currentAmountDue !== null &&
    vat !== null &&
    nearlyEqualMoney(currentAmountDue, vat, 1) &&
    ((strongFinalTotal !== null && strongFinalTotal > currentAmountDue) ||
      (computedAmountDue !== null && computedAmountDue > currentAmountDue));
  const recoveredAmountDue =
    (currentLooksLikeWeakPayment ? strongFinalTotal ?? clearLineItemsTotal ?? computedAmountDue : null) ??
    (currentLooksLikeVat ? strongFinalTotal ?? computedAmountDue : null) ??
    strongFinalTotal ??
    clearLineItemsTotal ??
    computedAmountDue ??
    (labelledAmountDueLooksImplausible ? vatConsistentAmountDue : labelledAmountDue) ??
    vatConsistentAmountDue ??
    (!hasExplicitFinalTotal && currentLooksUntaxed ? computedAmountDue : null) ??
    (!hasExplicitFinalTotal && vatInferenceLooksBetter ? vatInferredAmountDue : null) ??
    (!hasExplicitFinalTotal && currentInconsistent && computedAmountDue !== null ? computedAmountDue : null) ??
    currentAmountDue ??
    largestMoney;
  const recoveredGoodsTotal =
    goodsTotal === null
      ? inferGoodsFromGrossAndVat(recoveredAmountDue, vat)
      : vatInferenceLooksBetter && recoveredAmountDue !== null && vat !== null
      ? roundMoney(recoveredAmountDue - vat)
      : goodsTotal;

  const recovered = {
    goods_total: recoveredGoodsTotal,
    vat,
    amount_due: recoveredAmountDue,
  };
  const changed =
    recovered.goods_total !== invoice.totals?.goods_total ||
    recovered.vat !== invoice.totals?.vat ||
    recovered.amount_due !== invoice.totals?.amount_due;

  return {
    ...invoice,
    totals: recovered,
    warnings: [
      ...invoice.warnings,
      ...(suppliedVat !== null && currentAmountDue !== null && suppliedVat > currentAmountDue
        ? ['AI VAT exceeded the invoice total and was discarded in favor of VAT found in the receipt text.']
        : []),
      ...(changed ? ['Invoice totals were normalized from labels, VAT, line totals, or OCR fallback.'] : []),
    ],
  };
}
