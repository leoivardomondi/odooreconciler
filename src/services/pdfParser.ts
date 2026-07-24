import pdfParse from 'pdf-parse';
import {
  ParsedEdgingItem,
  ParsedJobSummaryResult,
  ParsedVendorInvoiceLine,
  ParsedVendorInvoiceResult,
  ParserConfig,
} from '../models/types';
import { DEFAULT_PARSER_CONFIG, normalizeMultilineText } from '../utils/helpers';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function insertLineBreakBeforeLabel(text: string, label: string, options?: { excludePrefix?: string }) {
  const labelPattern = new RegExp(`${escapeRegExp(label)}\\s*:`, 'gim');

  return text.replace(labelPattern, (matchedLabel: string, offset: number, source: string) => {
    const precedingText = source.slice(0, offset);
    const previousChar = precedingText.slice(-1);

    if (!previousChar || previousChar === '\n') {
      return matchedLabel;
    }

    if (options?.excludePrefix) {
      const excludePattern = new RegExp(`${escapeRegExp(options.excludePrefix)}\\s+$`, 'i');
      if (excludePattern.test(precedingText)) {
        return matchedLabel;
      }
    }

    if (/\s/.test(previousChar)) {
      return `\n${matchedLabel}`;
    }

    return matchedLabel;
  });
}

function parseMillimetreValue(line: string, label: string): number | null {
  const regex = new RegExp(`^\\s*${escapeRegExp(label)}\\s*:?\\s*([\\d.,]+)\\s*mm\\b`, 'i');
  const match = line.match(regex);

  if (!match) {
    return null;
  }

  const numeric = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeWrappedLabels(text: string, labels: string[]): string {
  return labels.reduce((currentText, label) => {
    const labelWords = label
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join('\\s*\\n\\s*');
    const wrappedLabelRegex = new RegExp(labelWords, 'gi');

    return currentText.replace(wrappedLabelRegex, label);
  }, text);
}

function isConfiguredStopHeader(line: string, stopHeaders: string[]): boolean {
  return stopHeaders.some((header) => header.toLowerCase() === line.toLowerCase());
}

function flushCurrentItem(
  current: ParsedEdgingItem | null,
  items: ParsedEdgingItem[],
  logs: string[],
) {
  if (!current) {
    return null;
  }

  if (!current.color.trim()) {
    logs.push('Skipped an edging entry with no color value.');
    return null;
  }

  items.push({
    color: current.color.trim(),
    thickness_mm: current.thickness_mm,
    length_mm: current.length_mm,
    roll_length_mm: current.roll_length_mm,
  });

  return null;
}

export async function parseJobSummaryPdf(
  fileBuffer: Buffer,
  config: ParserConfig,
): Promise<ParsedJobSummaryResult> {
  const resolvedConfig = {
    ...DEFAULT_PARSER_CONFIG,
    ...config,
  };
  const logs: string[] = [];
  const parsed = await pdfParse(fileBuffer);
  const rawText = normalizeMultilineText(parsed.text || '');

  if (!rawText.trim()) {
    return {
      items: [],
      sectionFound: false,
      sectionText: '',
      rawText,
      logs: ['The PDF produced no readable text.'],
    };
  }

  const headerIndex = rawText.toLowerCase().indexOf(resolvedConfig.sectionHeader.toLowerCase());

  if (headerIndex === -1) {
    return {
      items: [],
      sectionFound: false,
      sectionText: '',
      rawText,
      logs: [`Section "${resolvedConfig.sectionHeader}" was not found.`],
    };
  }

  logs.push(`Found section header "${resolvedConfig.sectionHeader}".`);

  const sectionCandidate = rawText.slice(headerIndex);
  let normalizedSection = normalizeWrappedLabels(sectionCandidate, [
    resolvedConfig.rollLengthLabel,
    resolvedConfig.thicknessLabel,
    resolvedConfig.lengthLabel,
  ]);

  normalizedSection = insertLineBreakBeforeLabel(normalizedSection, resolvedConfig.rollLengthLabel);
  normalizedSection = insertLineBreakBeforeLabel(normalizedSection, resolvedConfig.thicknessLabel);
  normalizedSection = insertLineBreakBeforeLabel(normalizedSection, resolvedConfig.lengthLabel, {
    excludePrefix: 'Roll',
  });

  const lines = normalizedSection
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const stopHeaders = resolvedConfig.stopHeadersCsv
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  let productLineRegex: RegExp;
  try {
    productLineRegex = new RegExp(resolvedConfig.productLinePattern, 'i');
  } catch {
    productLineRegex = new RegExp(DEFAULT_PARSER_CONFIG.productLinePattern, 'i');
    logs.push('The configured product line regex was invalid, so the default regex was used.');
  }

  const sectionLines: string[] = [];
  const items: ParsedEdgingItem[] = [];
  let currentItem: ParsedEdgingItem | null = null;

  for (const line of lines.slice(1)) {
    if (stopHeaders.length > 0 && isConfiguredStopHeader(line, stopHeaders)) {
      logs.push(`Stopped parsing at configured stop header "${line}".`);
      break;
    }

    sectionLines.push(line);

    if (!line.includes(':')) {
      const match = line.match(productLineRegex);

      if (match) {
        currentItem = flushCurrentItem(currentItem, items, logs);

        const color = match[1]?.trim() || line.replace(productLineRegex, '$1').trim();

        currentItem = {
          color,
          thickness_mm: null,
          length_mm: null,
          roll_length_mm: null,
        };

        logs.push(`Detected edging entry "${line}".`);
        continue;
      }
    }

    if (!currentItem) {
      continue;
    }

    const rollLength = parseMillimetreValue(line, resolvedConfig.rollLengthLabel);
    if (rollLength !== null) {
      currentItem.roll_length_mm = rollLength;
      logs.push(`Captured roll length "${rollLength} mm" for "${currentItem.color}".`);
      continue;
    }

    const thickness = parseMillimetreValue(line, resolvedConfig.thicknessLabel);
    if (thickness !== null) {
      currentItem.thickness_mm = thickness;
      logs.push(`Captured thickness "${thickness} mm" for "${currentItem.color}".`);
      continue;
    }

    const length = parseMillimetreValue(line, resolvedConfig.lengthLabel);
    if (length !== null) {
      currentItem.length_mm = length;
      logs.push(`Captured used length "${length} mm" for "${currentItem.color}".`);
    }
  }

  flushCurrentItem(currentItem, items, logs);

  if (items.length === 0) {
    logs.push('No edging material items were extracted from the section.');
  } else {
    logs.push(`Extracted ${items.length} edging material item(s).`);
  }

  return {
    items,
    sectionFound: true,
    sectionText: sectionLines.join('\n'),
    rawText,
    logs,
  };
}

function parseMoneyValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^\d.,-]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value.replace(/\s+/g, ' ');
    }
  }

  return null;
}

function extractInvoiceLines(rawText: string): ParsedVendorInvoiceLine[] {
  const lines = rawText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return lines
    .map((line): ParsedVendorInvoiceLine | null => {
      const match = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+(?:Piece|Pcs?|Unit|No\.?)?\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/i);
      if (!match) {
        return null;
      }

      return {
        description: match[1].trim(),
        quantity: Number(match[2]),
        unitPrice: parseMoneyValue(match[3]),
        amount: parseMoneyValue(match[4]),
      };
    })
    .filter((line): line is ParsedVendorInvoiceLine => Boolean(line));
}

export async function parseVendorInvoicePdf(fileBuffer: Buffer): Promise<ParsedVendorInvoiceResult> {
  const parsed = await pdfParse(fileBuffer);
  const rawText = normalizeMultilineText(parsed.text || '');
  const logs: string[] = [];

  if (!rawText.trim()) {
    return {
      vendorName: null,
      invoiceDate: null,
      invoiceNumber: null,
      orderNumber: null,
      taxPin: null,
      pinNote: 'NO PIN',
      untaxedTotal: null,
      vatTotal: null,
      grandTotal: null,
      itemCount: 0,
      items: [],
      rawText,
      logs: ['The PDF produced no readable text. OCR is required for scanned invoices.'],
    };
  }

  const taxPin = firstMatch(rawText, [/\b(P05242[A-Z0-9]*W)\b/i]);
  const vendorName = firstMatch(rawText, [
    /^\s*([A-Z0-9 &.'-]+(?:LIMITED|LTD|COMPANY|CO\.?))\s*$/im,
    /Supplier\s*:?\s*([^\n]+)/i,
    /Vendor\s*:?\s*([^\n]+)/i,
  ]);
  const invoiceDate = firstMatch(rawText, [
    /Invoice\s+Date\s*:?\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
    /Date\s+of\s+Supply\s*:?\s*([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i,
    /\b([0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})\b/i,
  ]);
  const invoiceNumber = firstMatch(rawText, [
    /Invoice\s+(?:No|Number)\.?\s*:?\s*([A-Z0-9/-]+)/i,
    /Serial\s+No\.?\s*:?\s*([A-Z0-9/-]+)/i,
  ]);
  const orderNumber = firstMatch(rawText, [
    /Order\s+(?:No|Number)\.?\s*:?\s*([A-Z0-9/-]+)/i,
    /\b(P0\d{3,})\b/i,
  ]);
  const grandTotal = parseMoneyValue(
    firstMatch(rawText, [
      /Amount\s+Due\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /Total\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /Due\s*(?:KSH|KES)?\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i,
    ]) || undefined,
  );
  const vatTotal = parseMoneyValue(firstMatch(rawText, [/VAT\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i]) || undefined);
  const untaxedTotal = parseMoneyValue(
    firstMatch(rawText, [/(?:Total\s+)?Goods\s*:?\s*([\d,]+(?:\.\d{1,2})?)/i]) || undefined,
  );
  const items = extractInvoiceLines(rawText);

  logs.push(taxPin ? 'Matched tax PIN rule P05242...W.' : 'Tax PIN rule P05242...W was not found.');
  logs.push(`Extracted ${items.length} invoice line candidate(s).`);

  return {
    vendorName,
    invoiceDate,
    invoiceNumber,
    orderNumber,
    taxPin,
    pinNote: taxPin ? 'ETR' : 'NO PIN',
    untaxedTotal,
    vatTotal,
    grandTotal,
    itemCount: items.length,
    items,
    rawText,
    logs,
  };
}
