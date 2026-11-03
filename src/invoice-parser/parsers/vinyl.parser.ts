import { ParserContext, ParsedInvoice, ParsedInvoiceItem } from '../types';
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
import { normalizeMoney } from '../core/normalizeMoney';
import { preferInvoiceSection } from '../core/splitSections';

function findVinylCustomerPin(text: string, pins: string[]) {
  const clientPinMatches = [...text.matchAll(/\bCLIENT\s+PIN\s*:?\s*(P\d{9}[A-Z])/gi)]
    .map((match) => match[1].toUpperCase());
  const expectedBuyerPin = [...clientPinMatches, ...pins].find((pin) => /^P0524\d{2}994W$/.test(pin));

  return expectedBuyerPin || clientPinMatches[0] || pins.find((pin) => /^P\d{9}W$/.test(pin)) || null;
}

function normalizeSpacedEtimsMoney(text: string) {
  return text
    .replace(/(\d)\s*,\s*(\d{3})\s*[.,]\s*(?:(\d{2})|on|oo)/gi, (_, thousands, hundreds, cents) => `${thousands},${hundreds}.${cents || '00'}`)
    .replace(/\b(\d{1,4})\s*[.,]\s*(\d{2})\b/g, '$1.$2')
    .replace(/\b(\d)\.\s*(\d{3})\.\s*(\d{2})\b/g, '$1,$2.$3');
}

function extractVinylInvoiceNumber(text: string) {
  const kraNumber = firstMatch(text, [
    /\bINVOICE\s+NUMBER\s*:?\s*([A-Z0-9]{8,}(?:\s*\n?\s*\/\s*\d+)?)/i,
  ]);
  if (kraNumber) {
    return kraNumber.replace(/\s*\/\s*/g, '/').replace(/\s+/g, '').trim();
  }

  return firstMatch(text, [/\b(VS-\d+)\b/i]) || extractInvoiceNumber(text);
}

function extractVinylEtimsItems(rawText: string): ParsedInvoiceItem[] {
  const text = normalizeSpacedEtimsMoney(rawText);
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const items: ParsedInvoiceItem[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const qtyPriceMatch = lines[i].match(/([\d,]+(?:\.\d{2}))\s*x\s*(\d+(?:\.\d+)?)/i);
    if (!qtyPriceMatch) continue;

    const unitPrice = normalizeMoney(qtyPriceMatch[1]);
    const quantity = Number(qtyPriceMatch[2]);
    if (unitPrice === null || !Number.isFinite(quantity) || quantity <= 0) continue;

    let description = 'CONSTRUCTION MATERIALS';
    for (let j = i - 1; j >= Math.max(0, i - 3); j -= 1) {
      const candidate = lines[j];
      if (
        candidate.length >= 4 &&
        !/^(?:client|customer|buyer|pin|name|start|cashier|invoice|date|ke\?|ke\d)/i.test(candidate) &&
        /[A-Z]{3,}/i.test(candidate)
      ) {
        description = candidate.replace(/\bKATERIALS\b/gi, 'MATERIALS');
        break;
      }
    }

    const computedNet = Number((unitPrice * quantity).toFixed(2));
    items.push({
      description,
      quantity,
      unit: 'Unit',
      unit_price: unitPrice,
      net_amount: computedNet,
      raw_text: `${description} ${lines[i]}`,
      confidence: 0.78,
    });
  }

  return items;
}

function extractVinylTotals(rawText: string, items: ParsedInvoiceItem[]) {
  const text = normalizeSpacedEtimsMoney(rawText);
  const baseTotals = extractTotals(text);
  const itemSum = items.reduce((sum, item) => sum + (item.net_amount || 0), 0);

  const decimalValues: number[] = [];
  for (const match of text.matchAll(/\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/g)) {
    const val = normalizeMoney(match[1]);
    if (typeof val === 'number' && val > 0) {
      decimalValues.push(val);
    }
  }

  const cashMatch = firstMatch(text, [/\bCAS[HI1]{1,2}\s*:?\s*([\d,]+\.\d{2})/i]);
  const cashTotal = normalizeMoney(cashMatch);
  const targetTotal = cashTotal || (itemSum > 0 ? Number(itemSum.toFixed(2)) : null);

  if (targetTotal !== null) {
    // Check if there is an explicit 16% VAT value in decimalValues where vat = targetTotal * 16 / 116
    const expectedVat = Number(((targetTotal * 0.16) / 1.16).toFixed(2));
    const matchedVat = decimalValues.find((v) => Math.abs(v - expectedVat) <= 1);
    if (typeof matchedVat === 'number') {
      const computedGoods = Number((targetTotal - matchedVat).toFixed(2));
      return {
        goods_total: computedGoods,
        vat: matchedVat,
        amount_due: targetTotal,
      };
    }

    for (const goodsCandidate of decimalValues) {
      if (goodsCandidate >= targetTotal) continue;
      for (const vatCandidate of decimalValues) {
        if (
          Math.abs(goodsCandidate + vatCandidate - targetTotal) <= 0.05 &&
          Math.abs(vatCandidate - goodsCandidate * 0.16) <= 0.5
        ) {
          return {
            goods_total: goodsCandidate,
            vat: vatCandidate,
            amount_due: targetTotal,
          };
        }
      }
    }

    return {
      goods_total: baseTotals.goods_total || targetTotal,
      vat: baseTotals.vat,
      amount_due: targetTotal,
    };
  }

  return baseTotals;
}

export function parseVinylInvoice(context: ParserContext): ParsedInvoice {
  const invoiceText = preferInvoiceSection(context.text);
  const pins = extractPins(context.text);
  const customerPin = findVinylCustomerPin(context.text, pins);
  const genericItems = extractGenericItems(invoiceText);
  const items = genericItems.length > 0 ? genericItems : extractVinylEtimsItems(context.text);
  const totals = extractVinylTotals(context.text, items);
  const invoiceNumber = extractVinylInvoiceNumber(context.text);
  const base = {
    supplier: 'Vinyl Supreme Ceilings & Decor Limited',
    supplier_key: 'VINYL_SUPREME' as const,
    document_type: context.documentType,
    invoice_number: invoiceNumber,
    serial_number: null,
    invoice_date: extractCommonDate(invoiceText) || extractCommonDate(context.text),
    customer: extractCustomer(invoiceText),
    customer_pin: customerPin,
    supplier_pin: pins.find((pin) => pin !== customerPin && /^P\d{9}[A-Z]$/.test(pin)) || null,
    currency: 'KES' as const,
    items,
    totals,
    payment_note: firstMatch(context.text, [/payment\s*(?:note|terms)?\s*:?\s*([^\n]+)/i]),
    receipt: {
      kra_invoice_number:
        firstMatch(context.text, [/kra\s+invoice\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]) ||
        (invoiceNumber?.startsWith('KRA') ? invoiceNumber : null),
      receipt_number: firstMatch(context.text, [/receipt\s*(?:no|number)?\s*:?\s*([A-Z0-9/-]+)/i]),
      date: extractCommonDate(context.text),
      tax_system: /etims|kracu/i.test(context.text) ? 'eTIMS' : null,
    },
    warnings: [...context.warnings],
    raw: { pdf_text: context.pdfText, ocr_text: context.ocrText, pages: [] as ParsedInvoice['raw']['pages'] },
  };

  return { ...base, confidence: computeConfidence(base) };
}
