import { normalizeMoney } from './normalizeMoney';

function findMoneyAfter(text: string, labels: string[]): number | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(new RegExp(`${escaped}\\s*(?:KSH|KES)?\\s*:?\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'));
    const value = normalizeMoney(match?.[1]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function maxMoneyAfter(text: string, pattern: RegExp, minimum = 0): number | null {
  const values = [...text.matchAll(pattern)]
    .map((match) => normalizeMoney(match[1]))
    .filter((value): value is number => value !== null && value >= minimum);

  return values.length > 0 ? Math.max(...values) : null;
}

function extractVatFromLines(text: string): number | null {
  const values = text
    .split('\n')
    .filter((line) => /\bVAT\b/i.test(line) && !/\b(reg|pin|no\.?|number)\b/i.test(line))
    .flatMap((line) => [...line.matchAll(/([\d,]+(?:\.\d{1,2})?)/g)])
    .map((match) => normalizeMoney(match[1]))
    .filter((value): value is number => value !== null && value >= 50 && value <= 100_000);

  return values.length > 0 ? Math.max(...values) : null;
}

function extractLabelledVatTotal(text: string): number | null {
  const patterns = [
    /\bVAT\s+TOTAL\s*[:#]?\s*([\d\s,]+(?:[.,]\d{1,3})?)/gi,
    /\bTOTAL\s+VAT\s*[:#]?\s*([\d\s,]+(?:[.,]\d{1,3})?)/gi,
    /\bTOTAL\s+TAX\s*[:#]?\s*([\d\s,]+(?:[.,]\d{1,3})?)/gi,
  ];
  const values: number[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/\s+/g, '');
      const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
      const value = normalizeMoney(normalizedRaw);
      if (value !== null && value >= 0 && value <= 100_000) {
        values.push(value);
      }
    }
  }

  return values.length > 0 ? values.at(-1) || null : null;
}

function extractGoodsFromTotalGoodsBlock(text: string): number | null {
  const patterns = [
    /\bTOTAL\s+([\d,]+(?:\.\d{1,2})?)\s*\n\s*GOODS\b/i,
    /\bTOTAL\s+GOODS\s+([\d,]+(?:\.\d{1,2})?)/i,
    /\bGOODS\s+TOTAL\s+([\d,]+(?:\.\d{1,2})?)/i,
  ];

  for (const pattern of patterns) {
    const value = normalizeMoney(text.match(pattern)?.[1]);
    if (value !== null && value >= 50) {
      return value;
    }
  }

  return null;
}

function findMoneyAfterLast(text: string, labels: string[]): number | null {
  const candidates: number[] = [];
  const totalKesMatches = text.matchAll(/\bTOTAL\s*\(\s*KES\s*\)\s*([\d\s,.]+)(?=\s|$)/gi);
  for (const match of totalKesMatches) {
    const raw = match[1].replace(/\s+/g, '');
    const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
    const value = normalizeMoney(normalizedRaw);
    if (value !== null && value >= 0) {
      candidates.push(value);
    }
  }
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}\\s*(?:KSH|KES)?\\s*:?\\s*([\\d\\s,]+(?:[.,]\\d{1,3})?)`, 'gi');
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/\s+/g, '');
      const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
      const value = normalizeMoney(normalizedRaw);
      if (value !== null && value >= 0) {
        candidates.push(value);
      }
    }
  }
  return candidates.length > 0 ? candidates.at(-1) || null : null;
}

function findReceiptPayableTotal(text: string): number | null {
  const candidates: number[] = [];
  const patterns = [
    /\b(?:CASH|PAID|CARD|MPESA|M-PESA)\b\s*(?:KSH|KES)?\s*:?\s*([\d\s,]+(?:[.,]\d{1,3})?)/gi,
    /\bTOTAL\b(?!\s+(?:A|B|C|D|E|TAX|VAT|GOODS|EX|EXCLUSIVE|INCLUSIVE|INCL|KES))\s*(?:KSH|KES)?\s*:?\s*([\d\s,]+(?:[.,]\d{1,3})?)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/\s+/g, '');
      const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
      const value = normalizeMoney(normalizedRaw);
      if (value !== null && value >= 50) {
        candidates.push(value);
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const counts = new Map<number, number>();
  candidates.forEach((value) => {
    const rounded = Math.round(value * 100) / 100;
    counts.set(rounded, (counts.get(rounded) || 0) + 1);
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
}

function findStandaloneDueTotal(text: string): number | null {
  const values: number[] = [];
  const pattern = /^\s*DUE\s*(?:\n\s*(?:KSH|KES))?\s*\n\s*([\d\s,]+(?:[.,]\d{1,3})?)\s*$/gim;

  for (const match of text.matchAll(pattern)) {
    const raw = match[1].replace(/\s+/g, '');
    const normalizedRaw = /[.,]\d{3}$/.test(raw) ? raw.replace(/[.,](\d{3})$/, '.$1') : raw;
    const value = normalizeMoney(normalizedRaw);
    if (value !== null && value >= 50) {
      values.push(value);
    }
  }

  return values.length > 0 ? values.at(-1) || null : null;
}

function extractConsistentTaxTableTotals(text: string) {
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of rows) {
    const values = [...line.matchAll(/([\d,]+(?:\.\d{2}))/g)]
      .map((match) => normalizeMoney(match[1]))
      .filter((value): value is number => value !== null);

    for (let index = 0; index <= values.length - 3; index += 1) {
      const goods = values[index];
      const tax = values[index + 1];
      const total = values[index + 2];

      if (
        goods >= 50 &&
        tax >= 0 &&
        total >= goods &&
        Math.abs(Math.round((goods + tax) * 100) / 100 - total) <= 1
      ) {
        return {
          goods_total: goods,
          vat: tax,
          amount_due: total,
        };
      }
    }
  }

  return null;
}

function extractConcatenatedTaxTableTotals(text: string) {
  const patterns = [
    /(\d{1,3}(?:,\d{3})+\.\d{2})(\d{1,3}(?:,\d{3})+\.\d{2})(\d{1,3}(?:,\d{3})+[.,]\d{2})?/g,
    /(\d+\.\d{2})(\d{1,3}(?:,\d{3})+\.\d{2})(\d{1,3}(?:,\d{3})+[.,]\d{2})?/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const goods = normalizeMoney(match[1]);
      const tax = normalizeMoney(match[2]);
      const visibleTotal = normalizeMoney(match[3]?.replace(/,/g, ','));

      if (
        typeof goods === 'number' &&
        typeof tax === 'number' &&
        goods >= 50 &&
        tax >= 0 &&
        tax / goods > 0.05 &&
        tax / goods < 0.25
      ) {
        const computedTotal = Math.round((goods + tax) * 100) / 100;
        return {
          goods_total: goods,
          vat: tax,
          amount_due:
            typeof visibleTotal === 'number' && Math.abs(visibleTotal - computedTotal) <= 1
              ? visibleTotal
              : computedTotal,
        };
      }
    }
  }

  return null;
}

export function extractTotals(text: string) {
  const taxTableTotals = extractConsistentTaxTableTotals(text) || extractConcatenatedTaxTableTotals(text);
  const goodsFromLoosePattern = maxMoneyAfter(text, /\bGOODS\D{0,30}([\d,]+(?:\.\d{1,2})?)/gi, 50);
  const vatFromLoosePattern = extractLabelledVatTotal(text) || extractVatFromLines(text) || maxMoneyAfter(text, /\bVAT\D{0,20}([\d,]+(?:\.\d{1,2})?)/gi, 10);
  const labelledTotal = findMoneyAfterLast(text, ['total (kes)', 'total kes']);
  const receiptPayableTotal = findReceiptPayableTotal(text);
  const standaloneDueTotal = findStandaloneDueTotal(text);
  const goods_total = taxTableTotals?.goods_total || extractGoodsFromTotalGoodsBlock(text) || goodsFromLoosePattern || findMoneyAfter(text, [
    'total goods',
    'goods total',
    'subtotal',
    'sub total',
    'total exclusive',
  ]);
  const vat = taxTableTotals?.vat || vatFromLoosePattern || findMoneyAfter(text, ['sales tax', 'vat amount', 'vat']);
  const amountDueFromLabel = findMoneyAfter(text, [
    'amount due',
    'total amount',
    'grand total',
    'amount payable',
  ]);
  const kshMatches = [...text.matchAll(/KSH\s*([\d,]+(?:\.\d{1,2})?)/gi)]
    .map((match) => normalizeMoney(match[1]))
    .filter((value): value is number => value !== null);
  const shMatches = [...text.matchAll(/\bSH\s*([\d,]+)(?:\/=)?/gi)]
    .map((match) => normalizeMoney(match[1]))
    .filter((value): value is number => value !== null);
  const amount_due =
    taxTableTotals?.amount_due ||
    labelledTotal ||
    standaloneDueTotal ||
    receiptPayableTotal ||
    amountDueFromLabel ||
    kshMatches.at(-1) ||
    shMatches.at(-1) ||
    findMoneyAfter(text, ['total']);

  return { goods_total, vat, amount_due };
}
