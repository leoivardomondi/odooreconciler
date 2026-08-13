import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { parseSupplierInvoice } from '../invoice-parser';
import {
  AttachmentInfo,
  PoBillAutomationCheck,
  PoBillAutomationCandidate,
  PoBillAutomationResult,
  PoBillProcessedDocumentEntry,
  PurchaseOrderLine,
  PurchaseOrderSummary,
} from '../models/types';
import {
  acquirePoBillProcessingLock,
  getPoBillProcessedDocumentsByInvoiceFingerprint,
  getPoBillProcessedDocumentsByAttachmentIds,
  getLatestPoBillProcessedDocumentsByPurchaseOrderIds,
  releasePoBillProcessingLock,
  upsertPoBillProcessedDocument,
} from '../models/repositories';
import { getRelationLabel } from '../utils/helpers';
import { resolveProjectFile } from '../utils/paths';
import { OdooClient } from './odooClient';
import {
  isUnreadableDocument,
  notifyUnreadableDocument,
} from './unreadableDocumentNotificationService';
import { notifyAiCredentialFailures } from './aiCredentialFailureNotificationService';

const TOTAL_TOLERANCE = 1;
const AUTO_MATCH_THRESHOLD = 90;
const CORE_MATCH_THRESHOLD = 90;
const PURCHASE_ORDER_SEARCH_PAGE_SIZE = 100;
const DOCUMENT_FOLDER_NAME = 'Finance';
const DELIVERY_NOTE_DOCUMENT_TAG_NAME = 'Delivery Note';
const RECENT_DOCUMENT_PDFS_SINCE = '2026-05-01 00:00:00';
export const PO_BILL_SUPPORTED_MIMETYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/tiff',
] as const;
const PO_BILL_EXTENSION_BY_MIMETYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/tiff': '.tiff',
};
const PO_BILL_CHATTER_MARKER = 'PO_BILL_AUTOMATION_VENDOR_BILL_CREATED';
const PO_UPLOAD_AFTER_APPROVAL_DELAY_MS = 3000;
const ALLOWED_NOTIFICATION_USER_NAME = 'Leoivard Ongule';
const URBAN_VIBE_BUYER_PIN_PATTERN = /^P0524\d{2}994W$/;
const KENYA_VAT_RATE = 0.16;
const COLOR_STOP_WORDS = new Set([
  'pb',
  'lam',
  'laminated',
  'board',
  'boards',
  'mm',
  'mdf',
  'piece',
  'pcs',
  'sheet',
  'sheets',
  'plain',
  'super',
  'grade',
]);

interface OdooActionResult {
  res_id?: number;
  res_model?: string;
  domain?: unknown;
  name?: string;
  type?: string;
  [key: string]: unknown;
}

export interface RecentDocumentPdfsPage {
  items: AttachmentInfo[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  from: number;
  to: number;
  sinceDate: string;
}

export function isSupportedPoBillMimetype(mimetype: string | null | undefined) {
  return PO_BILL_SUPPORTED_MIMETYPES.includes(
    String(mimetype || '').toLowerCase() as (typeof PO_BILL_SUPPORTED_MIMETYPES)[number],
  );
}

function ensurePoBillFilenameExtension(filename: string, mimetype: string | null | undefined) {
  if (path.extname(filename)) {
    return filename;
  }

  return `${filename}${PO_BILL_EXTENSION_BY_MIMETYPE[String(mimetype || '').toLowerCase()] || ''}`;
}

interface VendorBillSummary {
  id: number;
  name?: string | null;
  ref?: string | null;
  state?: string | null;
  invoice_date?: string | null;
  invoice_origin?: string | null;
  amount_total?: number | null;
}

interface MailMessageSummary {
  id: number;
  res_id?: number | null;
  body?: string | null;
  date?: string | null;
  subtype_id?: [number, string] | false | null;
}

interface StockPickingSummary {
  id: number;
  name?: string | null;
  state?: string | null;
}

interface OdooModelSummary {
  id: number;
  model: string;
}

interface MailActivityTypeSummary {
  id: number;
  name: string;
}

interface MailActivityEvidenceSummary {
  id: number;
  res_id?: number | null;
  res_model?: string | null;
  summary?: string | null;
  note?: string | null;
  create_date?: string | null;
}

interface DocumentsDocumentSummary {
  id: number;
  name?: string | null;
  attachment_id?: [number, string] | false | null;
  tag_ids?: number[] | false | null;
}

interface DocumentsTagSummary {
  id: number;
  name: string;
}

function normalizeText(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const VENDOR_LEGAL_SUFFIXES = new Set([
  'co',
  'company',
  'corp',
  'corporation',
  'inc',
  'incorporated',
  'limited',
  'llc',
  'ltd',
  'plc',
]);

const GENERIC_VENDOR_WORDS = new Set([
  ...VENDOR_LEGAL_SUFFIXES,
  'enterprise',
  'enterprises',
  'trader',
  'traders',
  'supplier',
  'suppliers',
  'stationer',
  'stationers',
  'hardware',
  'supermarket',
  'store',
  'stores',
]);

function normalizeVendorName(value: string | null | undefined) {
  const words = normalizeText(value)
    .split(' ')
    .filter((word) => word && !VENDOR_LEGAL_SUFFIXES.has(word));

  return {
    name: words.join(' '),
    compact: words.join(''),
  };
}

function extractFilenameVendorHint(value: string | null | undefined) {
  const withoutExtension = path.basename(String(value || '')).replace(/\.[a-z0-9]{2,5}$/i, '');
  const hint = normalizeText(withoutExtension)
    .replace(/\b(?:receipt|invoice|bill|vendor|supplier|scan|scanned|copy|document)\b/g, ' ')
    .replace(/\b20\d{2}[-_ ]\d{1,2}[-_ ]\d{1,2}\b/g, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return hint && /[a-z]{4,}/.test(hint) ? hint : null;
}

function addCheck(
  checks: PoBillAutomationCheck[],
  label: string,
  status: PoBillAutomationCheck['status'],
  detail: string,
) {
  checks.push({ label, status, detail });
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isConfirmedPurchaseOrderState(state: string | null | undefined) {
  return state === 'purchase';
}

function isApprovablePurchaseOrderState(state: string | null | undefined) {
  return state === 'to approve';
}

function isSchedulerEligiblePurchaseOrder(
  order: PurchaseOrderSummary,
  hasExistingProcessedRecord = false,
) {
  if (!(isConfirmedPurchaseOrderState(order.state) || isApprovablePurchaseOrderState(order.state))) {
    return false;
  }
  if (order.invoice_status === 'invoiced') {
    return false;
  }
  if (Array.isArray(order.invoice_ids) && order.invoice_ids.length > 0) {
    return false;
  }
  if (typeof order.invoice_count === 'number' && order.invoice_count > 0) {
    return false;
  }
  if (hasExistingProcessedRecord) {
    return false;
  }
  return true;
}

function describeSchedulerEligibility(
  order: PurchaseOrderSummary,
  hasExistingProcessedRecord = false,
) {
  if (!(isConfirmedPurchaseOrderState(order.state) || isApprovablePurchaseOrderState(order.state))) {
    return `state is "${order.state || 'unknown'}"`;
  }
  if (order.invoice_status === 'invoiced') {
    return 'it is already invoiced in Odoo';
  }
  if (
    (Array.isArray(order.invoice_ids) && order.invoice_ids.length > 0) ||
    (typeof order.invoice_count === 'number' && order.invoice_count > 0)
  ) {
    return 'it already has a vendor bill attached in Odoo';
  }
  if (hasExistingProcessedRecord) {
    return 'a match was already found and vendor bill attached for this PO';
  }
  return `invoice status is "${order.invoice_status || 'unknown'}"`;
}

function describeAiExtractionStatus(
  aiConfig: Parameters<typeof parseSupplierInvoice>[0]['aiConfig'],
  logs: string[],
) {
  const aiLog = logs.find((entry) => entry.includes('AI invoice extraction'));

  if (aiLog) {
    if (aiLog.includes('used provider') || aiLog.includes('AI invoice extraction used')) {
      return { status: 'pass' as const, detail: aiLog };
    }
    if (aiLog.includes('failed') || aiLog.includes('skipped')) {
      return { status: 'warn' as const, detail: aiLog };
    }
    return { status: 'info' as const, detail: aiLog };
  }

  if (!aiConfig?.enabled || aiConfig.provider === 'disabled') {
    return { status: 'info' as const, detail: 'AI extraction is disabled in Settings.' };
  }

  const hasGeminiOAuth = aiConfig.provider === 'gemini' && Boolean(aiConfig.geminiOAuth?.connected);
  if (!aiConfig.apiKeys?.[aiConfig.provider] && !hasGeminiOAuth) {
    return {
      status: 'warn' as const,
      detail: `AI extraction is enabled for ${aiConfig.provider}, but no provider API key or OAuth connection is configured.`,
    };
  }

  return {
    status: 'info' as const,
    detail: 'AI extraction was configured, but the parser did not trigger it for this document.',
  };
}

function findUrbanVibeBuyerPin(value: string) {
  const isValidKraPin = (pin: string) => /^P\d{9}W$/.test(pin);
  const normalizePinCandidate = (candidate: string, options: { buyerContext?: boolean } = {}) => {
    const compact = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const windows = compact.length === 11
      ? [compact]
      : Array.from({ length: Math.max(0, compact.length - 10) }, (_value, index) => compact.slice(index, index + 11));

    for (const window of windows) {
      const first = options.buyerContext && /[FP]/.test(window[0]) ? 'P' : window[0];
      const last = options.buyerContext && /[4WV]/.test(window[10]) ? 'W' : window[10].replace(/VV/g, 'W');
      const middle = window
        .slice(1, 10)
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8')
        .replace(/^8/, options.buyerContext ? '0' : '8');
      const normalized = `${first}${middle}${last}`;

      if (isValidKraPin(normalized)) {
        return normalized;
      }
    }

    return null;
  };
  const collectPins = (source: string, options: { buyerContext?: boolean } = {}) => {
    const candidates: string[] = [];
    const directMatches = source.matchAll(/\b(P[A-Z0-9\s\-./]{9,18}[A-Z0-9])\b/gi);
    for (const match of directMatches) {
      candidates.push(match[1]);
    }

    const labelledMatches = source.matchAll(
      /\b(?:buyer|customer|client|supplier|vendor)?\s*(?:kra\s*)?(?:pin|p\.i\.n)\b[^A-Z0-9]{0,20}([A-Z0-9][A-Z0-9\s\-./]{8,28}[A-Z0-9]?)/gi,
    );
    for (const match of labelledMatches) {
      candidates.push(match[1]);
    }

    const labelledMissingPrefixMatches = source.matchAll(
      /\b(?:buyer|customer|client|supplier|vendor)?\s*(?:kra\s*)?(?:pin|p\.i\.n)\b[^A-Z0-9]{0,20}([0-9OSBIL\s\-./]{9,20}[A-Z0-9])/gi,
    );
    for (const match of labelledMissingPrefixMatches) {
      candidates.push(`P${match[1]}`);
    }

    const looseMatches = source.matchAll(/\b([A-Z][A-Z0-9\s\-./]{9,24}[A-Z])\b/gi);
    for (const match of looseMatches) {
      candidates.push(match[1]);
    }

    return [...new Set(candidates.map((candidate) => normalizePinCandidate(candidate, options)).filter(Boolean) as string[])];
  };

  const preferBestBuyerPin = (pins: string[]) => {
    if (pins.length === 0) {
      return null;
    }

    return pins.find((pin) => URBAN_VIBE_BUYER_PIN_PATTERN.test(pin)) || null;
  };

  const invoiceToBlocks = [
    ...value.matchAll(/\binvoice\s+to\b[\s\S]{0,260}/gi),
    ...value.matchAll(/\b(?:customer|buyer|client)\b[\s\S]{0,220}/gi),
    ...value.matchAll(/\burban\s+vibe\b[\s\S]{0,220}/gi),
    ...value.matchAll(/\b(?:tax\s*)?pin\b[\s\S]{0,120}\burban\s+vibe\b[\s\S]{0,180}/gi),
  ].map((match) => match[0]);

  const contextualPins: string[] = [];
  for (const block of invoiceToBlocks) {
    contextualPins.push(...collectPins(block, { buyerContext: true }));
  }
  const contextualPreferred = preferBestBuyerPin([...new Set(contextualPins)]);
  if (contextualPreferred) {
    return contextualPreferred;
  }

  const normalized = collectPins(value).filter(isValidKraPin);
  return preferBestBuyerPin(normalized);
}

function addUrbanVibePinCheck(checks: PoBillAutomationCheck[], detectedPin: string | null) {
  addCheck(
    checks,
    'Urban Vibe Tax PIN',
    detectedPin ? 'pass' : 'warn',
    detectedPin
      ? `Found accepted Urban Vibe buyer PIN ${detectedPin}; note will be ETR.`
      : 'Accepted Urban Vibe buyer PIN was not found; note will be NO PIN.',
  );
}

function isJobSummaryDocument(input: {
  attachmentName?: string | null;
  rawText?: string | null;
}) {
  const combined = normalizeText(`${input.attachmentName || ''}\n${input.rawText || ''}`);
  const hasJobSummary = /\bjob summary\b/.test(combined);
  const hasMaxCutSignals =
    /\boptimized sheets\b/.test(combined) ||
    /\btotal panels\b/.test(combined) ||
    /\bjob cut length\b/.test(combined) ||
    /\bsheet materials\b/.test(combined) ||
    /\bedging materials\b/.test(combined) ||
    /\bmaxcut\b/.test(combined);

  return hasJobSummary && hasMaxCutSignals;
}

export function isStandaloneDeliveryNoteDocument(input: {
  attachmentName?: string | null;
  rawText?: string | null;
}) {
  const rawText = normalizeText(input.rawText);
  const combined = normalizeText(`${input.attachmentName || ''}\n${input.rawText || ''}`);
  const hasDeliveryNoteLabel = /\bdelivery\s+note\b/.test(rawText);
  const hasInvoiceDocumentSignal =
    /\b(?:tax\s+invoice|invoice|vendor\s+bill|bill\s+(?:no|number)|receipt\s+(?:no|number))\b/.test(combined);

  return hasDeliveryNoteLabel && !hasInvoiceDocumentSignal;
}

function totalsMatch(left: number | null | undefined, right: number | null | undefined) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return false;
  }

  return Math.abs(left - right) <= TOTAL_TOLERANCE;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeFingerprintPart(value: string | number | null | undefined) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

function buildInvoiceFingerprint(input: {
  attachmentContent: Buffer;
  vendorName?: string | null;
  invoiceNumber?: string | null;
  grandTotal?: number | null;
}) {
  const contentHash = createHash('sha256').update(input.attachmentContent).digest('hex');
  const total =
    typeof input.grandTotal === 'number' && Number.isFinite(input.grandTotal)
      ? String(Math.round(input.grandTotal * 100))
      : '';
  const identity = [
    normalizeFingerprintPart(input.vendorName),
    normalizeFingerprintPart(input.invoiceNumber),
    total,
    contentHash,
  ].join('|');

  return createHash('sha256').update(identity).digest('hex');
}

function correctSubtotalAsAmountDue(input: {
  totals: { goods_total: number | null; vat: number | null; amount_due: number | null };
  items: Array<{ net_amount?: number | null }>;
  logs: string[];
}) {
  const itemNetTotal = input.items
    .map((item) => item.net_amount)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .reduce((sum, value) => sum + value, 0);
  const roundedItemNetTotal = itemNetTotal > 0 ? roundMoney(itemNetTotal) : null;
  const { goods_total: goodsTotal, vat, amount_due: amountDue } = input.totals;

  // Guard: if an explicit goods_total (SUB TOTAL) is already present and differs from
  // amount_due, then amount_due is already the VAT-inclusive grand total — do NOT add VAT
  // again. This prevents the false correction on invoices like Saradhy where items are
  // VAT-inclusive and their sum equals TOTAL (KES), not the untaxed subtotal.
  const hasExplicitSubtotal =
    typeof goodsTotal === 'number' &&
    Number.isFinite(goodsTotal) &&
    goodsTotal > 0 &&
    typeof amountDue === 'number' &&
    !totalsMatch(goodsTotal, amountDue);

  if (hasExplicitSubtotal) {
    return input.totals;
  }

  if (
    roundedItemNetTotal !== null &&
    typeof vat === 'number' &&
    vat > 0 &&
    typeof amountDue === 'number' &&
    totalsMatch(amountDue, roundedItemNetTotal)
  ) {
    const correctedAmountDue = roundMoney(roundedItemNetTotal + vat);
    input.logs.push(
      `Invoice total corrected: parser payable total ${amountDue} matched line-item subtotal; using ${roundedItemNetTotal} + VAT ${vat} = ${correctedAmountDue}.`,
    );

    return {
      goods_total: roundedItemNetTotal,
      vat,
      amount_due: correctedAmountDue,
    };
  }

  return input.totals;
}

function isValidDate(value: Date) {
  return Number.isFinite(value.getTime());
}

function formatDateOnly(value: Date) {
  if (!isValidDate(value)) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

function parseUtcDateParts(year: number, month: number, day: number): Date | null {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    !isValidDate(parsed) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function normalizeInvoiceDateForOdoo(value: string | null | undefined) {
  const parsed = parseLooseDate(value);
  return parsed ? formatDateOnly(parsed) : null;
}

function resolveVendorBillDateForOdoo(
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
  purchaseOrder: PurchaseOrderSummary,
) {
  return normalizeInvoiceDateForOdoo(parsedInvoice.invoiceDate) ||
    normalizeInvoiceDateForOdoo(purchaseOrder.date_order);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseLooseDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const isoDate = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return parseUtcDateParts(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
  }

  const dayFirst = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dayFirst) {
    const year = dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3];
    return parseUtcDateParts(Number(year), Number(dayFirst[2]), Number(dayFirst[1]));
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const year = parsed.getUTCFullYear();
  return year >= 2020 && year <= 2035 ? parsed : null;
}

function daysBetween(left: Date | null, right: Date | null): number | null {
  if (!left || !right) {
    return null;
  }

  const days = Math.abs(left.getTime() - right.getTime()) / 86_400_000;
  return Number.isFinite(days) ? days : null;
}

function vendorNamesMatch(left: string | null | undefined, right: string | null | undefined) {
  const first = normalizeVendorName(left);
  const second = normalizeVendorName(right);
  if (!first.name || !second.name) return false;
  if (
    first.name === second.name ||
    first.compact === second.compact ||
    first.name.includes(second.name) ||
    second.name.includes(first.name) ||
    first.compact.includes(second.compact) ||
    second.compact.includes(first.compact)
  ) {
    return true;
  }

  // Prefer distinctive identity words. Generic terms such as ENTERPRISES or
  // LTD must never match two unrelated vendors by themselves.
  const firstWords = first.name.split(' ').filter((word) => !GENERIC_VENDOR_WORDS.has(word));
  const secondWords = second.name.split(' ').filter((word) => !GENERIC_VENDOR_WORDS.has(word));
  if (firstWords.length === 0 || secondWords.length === 0) return false;

  const shorter = firstWords.length <= secondWords.length ? firstWords : secondWords;
  const longer = firstWords.length <= secondWords.length ? secondWords : firstWords;
  return shorter.some((word) =>
    word.length >= 5 &&
    longer.some((candidate) => candidate === word || candidate.startsWith(word) || word.startsWith(candidate)),
  );
}

function computeVendorScore(
  invoiceVendor: string | null,
  poVendor: string,
  filenameVendorHint?: string | null,
) {
  const invoice = normalizeVendorName(invoiceVendor);
  const po = normalizeVendorName(poVendor);
  const filename = normalizeVendorName(filenameVendorHint);

  if (!po.name) {
    return { score: 0, reason: `PO vendor was not readable; invoice vendor is "${invoiceVendor}".` };
  }

  if (vendorNamesMatch(invoiceVendor, poVendor)) {
    return { score: 40, reason: `Vendor matched "${invoiceVendor}" with "${poVendor}".` };
  }

  if (vendorNamesMatch(filenameVendorHint, poVendor)) {
    return {
      score: 32,
      reason: `Filename vendor hint "${filenameVendorHint}" matched PO vendor "${poVendor}" after ignoring scanner labels, dates, and truncated suffixes.`,
    };
  }

  if (!invoice.name && !filename.name) {
    return { score: 0, reason: `Invoice vendor was not readable; PO vendor is "${poVendor}".` };
  }

  return { score: 0, reason: `Vendor did not match "${poVendor}".` };
}

function computeTotalScore(
  invoiceTotal: number | null,
  poTotal: number | null | undefined,
  invoiceUntaxed?: number | null,
  poUntaxed?: number | null | undefined,
) {
  if (typeof invoiceTotal !== 'number' || typeof poTotal !== 'number') {
    return { score: 0, reason: 'Invoice or PO total was not readable.' };
  }

  const difference = Math.abs(invoiceTotal - poTotal);
  if (difference <= TOTAL_TOLERANCE) {
    return { score: 40, reason: `Total matched: invoice ${invoiceTotal}, PO ${poTotal}.` };
  }
  if (difference <= 10) {
    return { score: 30, reason: `Total is close: invoice ${invoiceTotal}, PO ${poTotal}.` };
  }
  if (poTotal > 0 && difference / poTotal <= 0.02) {
    return { score: 20, reason: `Total is within 2%: invoice ${invoiceTotal}, PO ${poTotal}.` };
  }

  return { score: 0, reason: `Total did not match: invoice ${invoiceTotal}, PO ${poTotal}.` };
}

function computeDateScore(invoiceDate: Date | null, poDateValue: string | null | undefined) {
  const poDate = parseLooseDate(poDateValue);
  const days = daysBetween(invoiceDate, poDate);

  if (days === null) {
    return { score: 0, reason: 'Invoice date or PO date was not readable.' };
  }
  if (days <= 1) {
    return { score: 15, reason: `Date matched within ${Math.round(days)} day(s).` };
  }
  if (days <= 7) {
    return { score: 12, reason: `Date is close within ${Math.round(days)} day(s).` };
  }
  if (days <= 30) {
    return { score: 8, reason: `Date is within ${Math.round(days)} day(s).` };
  }

  return { score: 0, reason: `Date is far apart by ${Math.round(days)} day(s).` };
}

async function findPurchaseOrderApprovalDates(client: OdooClient, purchaseOrderIds: number[]) {
  const approvalDates = new Map<number, string>();
  if (purchaseOrderIds.length === 0) {
    return approvalDates;
  }

  const messages = await client.searchReadRecords<MailMessageSummary>('mail.message', {
    domain: [
      ['model', '=', 'purchase.order'],
      ['res_id', 'in', purchaseOrderIds],
    ],
    fields: ['id', 'res_id', 'body', 'date', 'subtype_id'],
    limit: 2000,
    order: 'date asc, id asc',
  }).catch(() => []);

  for (const message of messages) {
    const purchaseOrderId = Number((message as MailMessageSummary & { res_id?: number }).res_id);
    const body = String(message.body || '').replace(/<[^>]+>/g, ' ');
    const subtypeName = Array.isArray(message.subtype_id) ? String(message.subtype_id[1] || '') : '';
    if (
      purchaseOrderIds.includes(purchaseOrderId) &&
      !approvalDates.has(purchaseOrderId) &&
      (isPurchaseOrderApprovalMessage(body, subtypeName)) &&
      message.date
    ) {
      approvalDates.set(purchaseOrderId, message.date);
    }
  }

  return approvalDates;
}

export function isPurchaseOrderApprovalMessage(body: string | null | undefined, subtypeName: string | null | undefined) {
  const normalizedBody = String(body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizedSubtype = String(subtypeName || '').replace(/\s+/g, ' ').trim();
  return /\brfq\s+approved\b/i.test(normalizedSubtype) ||
    /\brfq\b.*\bto\s+approve\b/i.test(normalizedBody) ||
    /\bto\s+approve\b.*\brfq\b/i.test(normalizedBody);
}

function normalizeProductText(value: string | null | undefined) {
  return normalizeText(value)
    .replace(/\b(\d+(?:\.\d+)?)\s*mm\b/g, ' $1mm ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractColorTokens(value: string | null | undefined) {
  return normalizeProductText(value)
    .split(' ')
    .filter((word) => word.length >= 3 && !COLOR_STOP_WORDS.has(word));
}

function extractColorPhrases(value: string | null | undefined) {
  const tokens = extractColorTokens(value);
  const phrases = new Set(tokens);

  for (let index = 0; index < tokens.length - 1; index += 1) {
    phrases.add(`${tokens[index]} ${tokens[index + 1]}`);
  }

  return phrases;
}

function getPoLineName(line: PurchaseOrderLine) {
  const productName = Array.isArray(line.product_id) && typeof line.product_id[1] === 'string'
    ? line.product_id[1]
    : '';
  return [line.name, productName].filter(Boolean).join(' ');
}

function nearlyEqualLineAmount(left: number, right: number) {
  const tolerance = Math.max(2, Math.abs(right) * 0.03);
  return Math.abs(left - right) <= tolerance;
}

function invoiceLineMatchesPoAmount(invoiceAmount: number | null, poLine: PurchaseOrderLine) {
  if (typeof invoiceAmount !== 'number' || !Number.isFinite(invoiceAmount) || invoiceAmount <= 0) {
    return false;
  }

  const poAmounts = [poLine.price_subtotal, poLine.price_total]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

  return poAmounts.some((poAmount) =>
    nearlyEqualLineAmount(invoiceAmount, poAmount) ||
    nearlyEqualLineAmount(invoiceAmount, poAmount / (1 + KENYA_VAT_RATE)) ||
    nearlyEqualLineAmount(invoiceAmount * (1 + KENYA_VAT_RATE), poAmount),
  );
}

export function computeItemScore(
  invoiceItems: PoBillAutomationResult['parsedInvoice']['items'],
  poLines: PurchaseOrderLine[],
) {
  if (invoiceItems.length === 0 || poLines.length === 0) {
    return { score: 0, reason: `Invoice has ${invoiceItems.length} readable item(s); PO has ${poLines.length}.` };
  }

  const matched: string[] = [];
  const usedPoLineIds = new Set<number>();

  for (const item of invoiceItems) {
    const invoicePhrases = extractColorPhrases(item.description);
    if (invoicePhrases.size === 0) {
      continue;
    }

    const best = poLines
      .filter((line) => !usedPoLineIds.has(line.id))
      .map((line) => {
        const poName = getPoLineName(line);
        const poPhrases = extractColorPhrases(poName);
        const phraseMatches = [...invoicePhrases].filter((phrase) => poPhrases.has(phrase));
        const amountMatches = invoiceLineMatchesPoAmount(item.amount, line);
        const quantityMatches =
          typeof item.quantity === 'number' && typeof line.product_qty === 'number'
            ? Math.abs(item.quantity - line.product_qty) <= 0.01
            : true;
        const phraseScore = phraseMatches.some((phrase) => phrase.includes(' ')) ? 2 : phraseMatches.length > 0 ? 1 : 0;
        return {
          line,
          poName,
          phraseMatches,
          amountMatches,
          quantityMatches,
          score: quantityMatches ? phraseScore + (amountMatches ? 1 : 0) : 0,
        };
      })
      .sort((left, right) => right.score - left.score || Number(right.amountMatches) - Number(left.amountMatches))[0];

    if (best && best.score >= 1 && best.phraseMatches.length > 0 && best.quantityMatches) {
      usedPoLineIds.add(best.line.id);
      const label = best.phraseMatches.find((phrase) => phrase.includes(' ')) || best.phraseMatches[0];
      matched.push(`${label.toUpperCase()}${best.amountMatches ? ' amount/VAT matched' : ''}${best.quantityMatches ? ' quantity matched' : ''}`);
    }
  }

  if (matched.length === 0) {
    return { score: 0, reason: 'No invoice item colors/grains matched PO line names.' };
  }

  const ratio = matched.length / Math.max(invoiceItems.length, 1);
  const score = ratio >= 0.8 ? 10 : ratio >= 0.5 ? 7 : 4;
  return {
    score,
    reason: `Matched ${matched.length}/${invoiceItems.length} invoice item color/grain name(s): ${matched.slice(0, 4).join(', ')}.`,
  };
}

function computeReceiptScore(poLines: PurchaseOrderLine[]) {
  const receivedQuantity = poLines.reduce((total, line) => {
    const received = typeof line.qty_received === 'number' && Number.isFinite(line.qty_received)
      ? line.qty_received
      : 0;
    return total + Math.max(0, received);
  }, 0);

  return receivedQuantity > 0
    ? {
        score: 8,
        reason: `PO receipt history shows ${receivedQuantity} unit(s) received.`,
      }
    : {
        score: 0,
        reason: 'PO receipt history shows no received quantity yet.',
      };
}

function buildCandidate(
  purchaseOrder: PurchaseOrderSummary,
  poLines: PurchaseOrderLine[],
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
  approvalDate?: string | null,
): PoBillAutomationCandidate {
  const poVendor = getRelationLabel(purchaseOrder.partner_id);
  const vendor = computeVendorScore(parsedInvoice.vendorName, poVendor, parsedInvoice.filenameVendorHint);
  const total = computeTotalScore(
    parsedInvoice.grandTotal,
    purchaseOrder.amount_total,
    parsedInvoice.untaxedTotal,
    purchaseOrder.amount_untaxed,
  );
  const matchingPoDate = approvalDate || purchaseOrder.date_order;
  const date = computeDateScore(parseLooseDate(parsedInvoice.invoiceDate), matchingPoDate);
  const itemScore = computeItemScore(parsedInvoice.items, poLines);
  const receipt = computeReceiptScore(poLines);
  const approvalDateReason = approvalDate
    ? `RFQ → To Approve transition date ${approvalDate} was used instead of PO creation date ${purchaseOrder.date_order || 'unknown'}.`
    : null;

  return {
    purchaseOrder,
    score: vendor.score + total.score + date.score + itemScore.score + receipt.score,
    vendorScore: vendor.score,
    totalScore: total.score,
    dateScore: date.score,
    itemScore: itemScore.score,
    receiptScore: receipt.score,
    reasons: [vendor.reason, total.reason, date.reason, approvalDateReason, itemScore.reason, receipt.reason].filter(Boolean) as string[],
  };
}

export function isReliablePoBillCandidate(candidate: PoBillAutomationCandidate) {
  return candidate.vendorScore > 0 &&
    candidate.totalScore >= 40 &&
    candidate.score >= AUTO_MATCH_THRESHOLD;
}

async function resolveVendorPartnerIds(
  client: OdooClient,
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
) {
  const hints = [parsedInvoice.vendorName, parsedInvoice.filenameVendorHint]
    .map((value) => normalizeVendorName(value).name)
    .filter(Boolean)
    .flatMap((value) => value.split(' ').filter((word) => word.length >= 4 && !GENERIC_VENDOR_WORDS.has(word)))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 3);
  if (hints.length === 0) return [];

  const partners = await Promise.all(hints.map((hint) =>
    client.searchReadRecords<{ id: number; name?: string | null }>('res.partner', {
      domain: [['name', 'ilike', hint]],
      fields: ['id', 'name'],
      limit: 100,
      order: 'id asc',
    }).catch(() => []),
  ));

  const ids = new Set<number>();
  for (const partner of partners.flat()) {
    if (
      typeof partner.id === 'number' &&
      (vendorNamesMatch(parsedInvoice.vendorName, partner.name || '') ||
        vendorNamesMatch(parsedInvoice.filenameVendorHint, partner.name || ''))
    ) {
      ids.add(partner.id);
    }
  }
  return [...ids];
}

async function searchPurchaseOrdersAcrossPages(
  client: OdooClient,
  domain: unknown[],
  fields: string[],
) {
  const count = await client.searchCountRecords('purchase.order', domain).catch(() => null);
  const orders: PurchaseOrderSummary[] = [];
  const targetCount = typeof count === 'number' && count >= 0 ? count : Number.MAX_SAFE_INTEGER;

  for (let offset = 0; offset < targetCount; offset += PURCHASE_ORDER_SEARCH_PAGE_SIZE) {
    const page = await client.searchReadRecords<PurchaseOrderSummary>('purchase.order', {
      domain,
      fields,
      limit: PURCHASE_ORDER_SEARCH_PAGE_SIZE,
      offset,
      order: 'date_order desc, id desc',
    });
    orders.push(...page);
    if (page.length < PURCHASE_ORDER_SEARCH_PAGE_SIZE) break;
    if (typeof count !== 'number' && orders.length >= 1000) break;
  }

  return orders;
}

function sumPurchaseOrderTotals(orders: PurchaseOrderSummary[]) {
  const values = orders.map((order) => order.amount_total);
  return values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce((sum, value) => sum + value, 0)
    : null;
}

function findCombinedPurchaseOrderMatch(
  candidates: PoBillAutomationCandidate[],
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
) {
  if (typeof parsedInvoice.grandTotal !== 'number') {
    return null;
  }

  const acceptable = candidates.filter((candidate) =>
    candidate.vendorScore > 0 &&
    candidate.dateScore >= 12 &&
    (
      isConfirmedPurchaseOrderState(candidate.purchaseOrder.state) ||
      isApprovablePurchaseOrderState(candidate.purchaseOrder.state)
    ) &&
    typeof candidate.purchaseOrder.amount_total === 'number' &&
    candidate.purchaseOrder.amount_total > 0,
  );
  const groups: PurchaseOrderSummary[][] = [];

  for (let first = 0; first < acceptable.length; first += 1) {
    for (let second = first + 1; second < acceptable.length; second += 1) {
      groups.push([acceptable[first].purchaseOrder, acceptable[second].purchaseOrder]);
      for (let third = second + 1; third < acceptable.length; third += 1) {
        groups.push([
          acceptable[first].purchaseOrder,
          acceptable[second].purchaseOrder,
          acceptable[third].purchaseOrder,
        ]);
      }
    }
  }

  return groups
    .map((orders) => {
      const total = sumPurchaseOrderTotals(orders);
      if (total === null) {
        return null;
      }

      const difference = Math.abs(parsedInvoice.grandTotal as number - total);
      const matched = difference <= Math.max(TOTAL_TOLERANCE, 10) ||
        (total > 0 && difference / total <= 0.02);
      return matched ? { purchaseOrders: orders, total, difference } : null;
    })
    .filter((group): group is { purchaseOrders: PurchaseOrderSummary[]; total: number; difference: number } => group !== null)
    .sort((left, right) => left.difference - right.difference || left.purchaseOrders.length - right.purchaseOrders.length)[0] || null;
}

function relationId(value: unknown): number | null {
  if (Array.isArray(value) && typeof value[0] === 'number') {
    return value[0];
  }
  return typeof value === 'number' ? value : null;
}

function relationName(value: unknown): string | null {
  if (Array.isArray(value) && typeof value[1] === 'string') {
    return value[1];
  }
  return null;
}

async function getAvailableModelFieldNames(
  client: OdooClient,
  model: string,
  fieldNames: string[],
): Promise<Set<string>> {
  try {
    const fields = await client.getModelFields(model, fieldNames);
    return new Set(fields.map((field) => field.name));
  } catch (error) {
    console.warn(
      `[po-bills] Could not inspect Odoo fields for ${model}.`,
      error instanceof Error ? error.message : error,
    );
    return new Set(fieldNames);
  }
}

async function findDocumentsDocumentForAttachment(
  client: OdooClient,
  attachment: Pick<AttachmentInfo, 'id' | 'documentId'>,
): Promise<DocumentsDocumentSummary | null> {
  const fields = await getAvailableModelFieldNames(client, 'documents.document', [
    'id',
    'name',
    'attachment_id',
    'tag_ids',
  ]);
  const readableFields = ['id', 'name', 'attachment_id', 'tag_ids'].filter((field) => fields.has(field));

  if (!fields.has('id')) {
    return null;
  }

  if (attachment.documentId) {
    const records = await client
      .readRecords<DocumentsDocumentSummary>('documents.document', [attachment.documentId], readableFields)
      .catch(() => []);
    if (records[0]) {
      return records[0];
    }
  }

  if (!fields.has('attachment_id')) {
    return null;
  }

  const documents = await client
    .searchReadRecords<DocumentsDocumentSummary>('documents.document', {
      domain: [['attachment_id', '=', attachment.id]],
      fields: readableFields,
      limit: 1,
      order: 'id desc',
    })
    .catch(() => []);

  return documents[0] || null;
}

async function findOrCreateValidatedDocumentTag(client: OdooClient): Promise<DocumentsTagSummary | null> {
  const fields = await getAvailableModelFieldNames(client, 'documents.tag', ['id', 'name']);
  if (!fields.has('id') || !fields.has('name')) {
    return null;
  }

  const existing = await client
    .searchReadRecords<DocumentsTagSummary>('documents.tag', {
      domain: [['name', 'ilike', 'Validated']],
      fields: ['id', 'name'],
      limit: 10,
      order: 'id asc',
    })
    .catch(() => []);
  const exact = existing.find((tag) => tag.name.toLowerCase() === 'validated');
  if (exact || existing[0]) {
    return exact || existing[0];
  }

  const tagId = await client.createRecord('documents.tag', { name: 'Validated' }).catch(() => null);
  return tagId ? { id: tagId, name: 'Validated' } : null;
}

async function findValidatedDocumentTagId(client: OdooClient): Promise<number | null> {
  const fields = await getAvailableModelFieldNames(client, 'documents.tag', ['id', 'name']);
  if (!fields.has('id') || !fields.has('name')) {
    return null;
  }

  const tags = await client.searchReadRecords<DocumentsTagSummary>('documents.tag', {
    domain: [['name', '=', 'Validated']],
    fields: ['id', 'name'],
    limit: 1,
    order: 'id asc',
  }).catch(() => []);

  return tags[0]?.id || null;
}

async function hasValidatedSourceDocument(client: OdooClient, attachment: AttachmentInfo) {
  const tagId = await findValidatedDocumentTagId(client);
  if (!tagId) {
    return false;
  }

  const document = await findDocumentsDocumentForAttachment(client, attachment);
  return Boolean(
    document?.tag_ids &&
    Array.isArray(document.tag_ids) &&
    document.tag_ids.some((value) => Number(value) === tagId),
  );
}

async function markSourceDocumentValidated(
  client: OdooClient,
  attachment: AttachmentInfo,
): Promise<{ marked: boolean; message: string }> {
  const fields = await getAvailableModelFieldNames(client, 'documents.document', ['id', 'tag_ids']);
  if (!fields.has('tag_ids')) {
    return {
      marked: false,
      message: 'Odoo Documents does not expose tag_ids on documents.document, so the source document could not be tagged Validated.',
    };
  }

  const document = await findDocumentsDocumentForAttachment(client, attachment);
  if (!document) {
    return {
      marked: false,
      message: 'The source Odoo Documents record was not found for this attachment.',
    };
  }

  const tag = await findOrCreateValidatedDocumentTag(client);
  if (!tag) {
    return {
      marked: false,
      message: 'The Odoo Documents tag "Validated" was not found and could not be created.',
    };
  }

  try {
    await client.writeRecord('documents.document', [document.id], {
      tag_ids: [[4, tag.id]],
    });
  } catch (error) {
    return {
      marked: false,
      message: `Could not tag source document ${document.name || document.id} as Validated: ${error instanceof Error ? error.message : 'unknown Odoo error'}.`,
    };
  }

  return {
    marked: true,
    message: `Marked source document ${document.name || document.id} as Validated in Odoo Documents.`,
  };
}

async function findDeliveryNoteDocumentTagId(client: OdooClient): Promise<number | null> {
  const fields = await getAvailableModelFieldNames(client, 'documents.tag', ['id', 'name']);
  if (!fields.has('id') || !fields.has('name')) {
    return null;
  }

  const tags = await client.searchReadRecords<DocumentsTagSummary>('documents.tag', {
    domain: [['name', 'ilike', DELIVERY_NOTE_DOCUMENT_TAG_NAME]],
    fields: ['id', 'name'],
    limit: 10,
    order: 'id asc',
  }).catch(() => []);
  const exact = tags.find((tag) => tag.name.trim().toLowerCase() === DELIVERY_NOTE_DOCUMENT_TAG_NAME.toLowerCase());
  return (exact || tags[0])?.id || null;
}

async function findOrCreateDeliveryNoteDocumentTag(client: OdooClient): Promise<DocumentsTagSummary | null> {
  const fields = await getAvailableModelFieldNames(client, 'documents.tag', ['id', 'name']);
  if (!fields.has('id') || !fields.has('name')) {
    return null;
  }

  const existing = await client.searchReadRecords<DocumentsTagSummary>('documents.tag', {
    domain: [['name', 'ilike', DELIVERY_NOTE_DOCUMENT_TAG_NAME]],
    fields: ['id', 'name'],
    limit: 10,
    order: 'id asc',
  }).catch(() => []);
  const exact = existing.find((tag) => tag.name.trim().toLowerCase() === DELIVERY_NOTE_DOCUMENT_TAG_NAME.toLowerCase());
  if (exact || existing[0]) {
    return exact || existing[0];
  }

  const tagId = await client.createRecord('documents.tag', { name: DELIVERY_NOTE_DOCUMENT_TAG_NAME }).catch(() => null);
  return tagId ? { id: tagId, name: DELIVERY_NOTE_DOCUMENT_TAG_NAME } : null;
}

async function hasDeliveryNoteSourceDocument(client: OdooClient, attachment: AttachmentInfo) {
  const tagId = await findDeliveryNoteDocumentTagId(client);
  if (!tagId) {
    return false;
  }

  const document = await findDocumentsDocumentForAttachment(client, attachment);
  return Boolean(
    document?.tag_ids &&
    Array.isArray(document.tag_ids) &&
    document.tag_ids.some((value) => Number(value) === tagId),
  );
}

async function markSourceDocumentDeliveryNote(
  client: OdooClient,
  attachment: AttachmentInfo,
): Promise<{ marked: boolean; message: string }> {
  const fields = await getAvailableModelFieldNames(client, 'documents.document', ['id', 'tag_ids']);
  if (!fields.has('tag_ids')) {
    return {
      marked: false,
      message: 'Odoo Documents does not expose tag_ids on documents.document, so the source document could not be tagged Delivery Note.',
    };
  }

  const document = await findDocumentsDocumentForAttachment(client, attachment);
  if (!document) {
    return {
      marked: false,
      message: 'The source Odoo Documents record was not found for this attachment, so the Delivery Note tag could not be applied.',
    };
  }

  const tag = await findOrCreateDeliveryNoteDocumentTag(client);
  if (!tag) {
    return {
      marked: false,
      message: 'The Odoo Documents tag "Delivery Note" was not found and could not be created.',
    };
  }

  try {
    await client.writeRecord('documents.document', [document.id], {
      tag_ids: [[4, tag.id]],
    });
  } catch (error) {
    return {
      marked: false,
      message: `Could not tag source document ${document.name || document.id} as Delivery Note: ${error instanceof Error ? error.message : 'unknown Odoo error'}.`,
    };
  }

  return {
    marked: true,
    message: `Marked source document ${document.name || document.id} as Delivery Note in Odoo Documents.`,
  };
}

async function findFinanceDocumentFolderIds(
  client: OdooClient,
  targetCompanyId: number,
): Promise<Array<{ id: number; name: string }>> {
  for (const model of ['documents.folder', 'documents.workspace']) {
    const fields = await getAvailableModelFieldNames(client, model, ['id', 'name', 'company_id']);
    if (!fields.has('id') || !fields.has('name')) {
      continue;
    }

    const domain: unknown[] = [['name', 'ilike', DOCUMENT_FOLDER_NAME]];
    if (fields.has('company_id')) {
      domain.push('|', ['company_id', '=', targetCompanyId], ['company_id', '=', false]);
    }

    try {
      const folders = await client.searchReadRecords<{ id: number; name: string; company_id?: unknown }>(model, {
        domain,
        fields: ['id', 'name', ...(fields.has('company_id') ? ['company_id'] : [])],
        limit: 50,
        order: 'name asc, id asc',
      });
      const filtered = folders.filter((folder) => folder.name?.toLowerCase() === DOCUMENT_FOLDER_NAME.toLowerCase());
      const matches = filtered.length > 0 ? filtered : folders;
      if (matches.length > 0) {
        return matches.map((folder) => ({ id: folder.id, name: folder.name }));
      }
    } catch (error) {
      console.warn(
        `[po-bills] Could not search ${model} for Finance folders.`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return [];
}

interface DocumentPdfsCacheEntry {
  items: AttachmentInfo[];
  fetchedAt: number;
}

let globalDocumentPdfsCache: DocumentPdfsCacheEntry | null = null;
const DOCUMENT_PDFS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function clearDocumentPdfsCache() {
  globalDocumentPdfsCache = null;
}

export async function getRecentDocumentPdfs(
  client: OdooClient,
  limit = 25,
  offset = 0,
  forceRefresh = false,
): Promise<AttachmentInfo[]> {
  const now = Date.now();
  if (
    !forceRefresh &&
    globalDocumentPdfsCache &&
    now - globalDocumentPdfsCache.fetchedAt < DOCUMENT_PDFS_CACHE_TTL_MS &&
    globalDocumentPdfsCache.items.length >= limit
  ) {
    return globalDocumentPdfsCache.items.slice(offset, offset + limit);
  }

  const page = await getRecentDocumentPdfsPage(client, { page: Math.floor(offset / limit) + 1, pageSize: limit });
  if (offset === 0) {
    globalDocumentPdfsCache = {
      items: page.items,
      fetchedAt: now,
    };
  }
  return page.items;
}

export async function getRecentDocumentPdfsPage(
  client: OdooClient,
  options: { page?: number; pageSize?: number } = {},
): Promise<RecentDocumentPdfsPage> {
  const requestedPageSize = Number(options.pageSize || 25);
  const pageSize = Number.isFinite(requestedPageSize) ? Math.min(Math.max(Math.floor(requestedPageSize), 1), 500) : 25;
  const requestedPage = Number(options.page || 1);
  const safeRequestedPage = Number.isFinite(requestedPage) ? Math.max(Math.floor(requestedPage), 1) : 1;
  const targetCompanyId = await client.getTargetCompanyIdValue();
  const documentFieldCandidates = [
    'id',
    'name',
    'attachment_id',
    'folder_id',
    'workspace_id',
    'company_id',
    'mimetype',
    'type',
    'tag_ids',
    'create_date',
    'write_date',
  ];
  const documentFields = await getAvailableModelFieldNames(client, 'documents.document', documentFieldCandidates);
  const folderField = documentFields.has('folder_id')
    ? 'folder_id'
    : documentFields.has('workspace_id')
      ? 'workspace_id'
      : null;
  const financeFolders = await findFinanceDocumentFolderIds(client, targetCompanyId);
  const financeFolderIds = financeFolders.map((folder) => folder.id);
  const domain: unknown[] = [];

  if (documentFields.has('mimetype')) {
    domain.push(['mimetype', 'in', [...PO_BILL_SUPPORTED_MIMETYPES]]);
  }
  if (documentFields.has('type')) {
    domain.push(['type', '=', 'binary']);
  }
  if (documentFields.has('create_date')) {
    domain.push(['create_date', '>=', RECENT_DOCUMENT_PDFS_SINCE]);
  }
  if (documentFields.has('company_id')) {
    domain.push('|', ['company_id', '=', targetCompanyId], ['company_id', '=', false]);
  }
  if (folderField) {
    if (financeFolderIds.length > 0) {
      domain.push([folderField, 'in', financeFolderIds]);
    } else {
      domain.push([`${folderField}.name`, 'ilike', DOCUMENT_FOLDER_NAME]);
    }
  }

  const total = await client.searchCountRecords('documents.document', domain);
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(safeRequestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  const fields = documentFieldCandidates.filter((field) => documentFields.has(field));
  const documents = await client.searchReadRecords<Record<string, unknown>>('documents.document', {
    domain,
    fields,
    limit: pageSize,
    offset,
    order: 'write_date desc, create_date desc, id desc',
  });
  const [validatedTagId, deliveryNoteTagId] = documents.length > 0
    ? await Promise.all([
        findValidatedDocumentTagId(client),
        findDeliveryNoteDocumentTagId(client),
      ])
    : [null, null];

  const attachmentIds = documents.map((doc) => relationId(doc.attachment_id)).filter((id): id is number => Boolean(id));
  const attachmentsById = new Map<number, AttachmentInfo>();
  if (attachmentIds.length > 0) {
    const attachments = await client.searchReadRecords<AttachmentInfo>('ir.attachment', {
      domain: [
        ['id', 'in', attachmentIds],
        ['mimetype', 'in', [...PO_BILL_SUPPORTED_MIMETYPES]],
      ],
      fields: ['id', 'name', 'mimetype', 'create_date', 'write_date', 'file_size'],
      limit: attachmentIds.length,
      order: 'write_date desc, create_date desc, id desc',
    });
    attachments.forEach((attachment) => attachmentsById.set(attachment.id, attachment));
  }

  const processedByAttachment = await getPoBillProcessedDocumentsByAttachmentIds(attachmentIds);
  const recentPdfs: AttachmentInfo[] = [];

  documents.forEach((doc) => {
    const attachmentId = relationId(doc.attachment_id);
    if (!attachmentId) {
      return;
    }
    const attachment = attachmentsById.get(attachmentId);
    if (!attachment) {
      return;
    }
    const processed = processedByAttachment[attachmentId];
    const hasValidatedTag = Boolean(
      validatedTagId &&
      Array.isArray(doc.tag_ids) &&
      doc.tag_ids.some((tagId) => Number(tagId) === validatedTagId),
    );
    const hasDeliveryNoteTag = Boolean(
      deliveryNoteTagId &&
      Array.isArray(doc.tag_ids) &&
      doc.tag_ids.some((tagId) => Number(tagId) === deliveryNoteTagId),
    );
    const effectiveProcessedStatus = hasDeliveryNoteTag
      ? 'delivery_note'
      : hasValidatedTag
      ? processed && ['processed', 'processed_with_warnings'].includes(processed.status)
        ? processed.status
        : 'processed_with_warnings'
      : processed?.status || null;
    recentPdfs.push({
      ...attachment,
      documentId: typeof doc.id === 'number' ? doc.id : null,
      name: attachment.name || String(doc.name || ''),
      create_date: attachment.create_date || (typeof doc.create_date === 'string' ? doc.create_date : null),
      write_date: attachment.write_date || (typeof doc.write_date === 'string' ? doc.write_date : null),
      folderName: folderField ? relationName(doc[folderField]) : null,
      companyName: relationName(doc.company_id),
      poBillStatus: effectiveProcessedStatus,
      poBillProcessedAt: processed?.processedAt || ((hasDeliveryNoteTag || hasValidatedTag)
        ? String(doc.write_date || doc.create_date || '')
        : null),
      poBillPurchaseOrderId: processed?.purchaseOrderId || null,
      poBillPurchaseOrderName: processed?.purchaseOrderName || null,
      poBillVendorBillId: processed?.vendorBillId || null,
      poBillVendorBillName: processed?.vendorBillName || null,
      poBillAttemptCount: processed?.attemptCount ?? null,
      poBillSummary: processed?.summary || (
        hasDeliveryNoteTag
          ? 'Odoo Documents tag is Delivery Note; scheduler will permanently skip this document.'
          : hasValidatedTag
            ? 'Odoo Documents tag is Validated; scheduler will skip this document.'
            : null
      ),
      poBillValidated: hasValidatedTag,
    });
  });

  return {
    items: recentPdfs,
    page,
    pageSize,
    total,
    totalPages,
    from: total === 0 ? 0 : offset + 1,
    to: total === 0 ? 0 : Math.min(offset + documents.length, total),
    sinceDate: RECENT_DOCUMENT_PDFS_SINCE,
  };
}

export async function markPoBillDocumentSkipped(input: {
  attachment: AttachmentInfo;
  status: 'skipped' | 'failed';
  summary: string;
  purchaseOrder?: PurchaseOrderSummary | null;
  vendorBillName?: string | null;
  invoiceFingerprint?: string | null;
  invoiceNumber?: string | null;
  invoiceVendor?: string | null;
  invoiceTotal?: number | null;
}) {
  await upsertPoBillProcessedDocument({
    attachmentId: input.attachment.id,
    attachmentName: input.attachment.name,
    documentId: input.attachment.documentId || null,
    folderName: input.attachment.folderName || null,
    companyName: input.attachment.companyName || null,
    purchaseOrderId: input.purchaseOrder?.id || null,
    purchaseOrderName: input.purchaseOrder?.name || null,
    vendorBillName: input.vendorBillName || null,
    invoiceFingerprint: input.invoiceFingerprint || null,
    invoiceNumber: input.invoiceNumber || null,
    invoiceVendor: input.invoiceVendor || null,
    invoiceTotal: input.invoiceTotal ?? null,
    status: input.status,
    mode: 'auto',
    summary: input.summary,
  });
}

export async function markPoBillDocumentAsDeliveryNote(input: {
  attachment: AttachmentInfo;
  summary: string;
  invoiceFingerprint?: string | null;
  invoiceNumber?: string | null;
  invoiceVendor?: string | null;
  invoiceTotal?: number | null;
  mode?: 'review' | 'auto';
}) {
  await upsertPoBillProcessedDocument({
    attachmentId: input.attachment.id,
    attachmentName: input.attachment.name,
    documentId: input.attachment.documentId || null,
    folderName: input.attachment.folderName || null,
    companyName: input.attachment.companyName || null,
    invoiceFingerprint: input.invoiceFingerprint || null,
    invoiceNumber: input.invoiceNumber || null,
    invoiceVendor: input.invoiceVendor || null,
    invoiceTotal: input.invoiceTotal ?? null,
    status: 'delivery_note',
    mode: input.mode || 'auto',
    summary: input.summary,
  });
}

export async function findPurchaseOrder(
  client: OdooClient,
  searchTerm: string,
): Promise<PurchaseOrderSummary | null> {
  const value = searchTerm.trim();
  if (!value) {
    return null;
  }

  const orders = await client.searchReadRecords<PurchaseOrderSummary>('purchase.order', {
    domain: ['|', ['name', '=', value], ['partner_ref', 'ilike', value]],
    fields: [
      'id',
      'name',
      'state',
      'date_order',
      'amount_total',
      'amount_untaxed',
      'partner_id',
      'currency_id',
      'invoice_status',
      'user_id',
      'picking_ids',
    ],
    limit: 2,
    order: 'date_order desc, id desc',
  });

  return orders.length === 1 ? orders[0] : null;
}

export async function findPurchaseOrderCandidates(
  client: OdooClient,
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
  options: {
    fromDate?: string;
    toDate?: string;
    onlyUnbilled?: boolean;
  } = {},
): Promise<PoBillAutomationCandidate[]> {
  const invoiceDate = parseLooseDate(parsedInvoice.invoiceDate);
  const domain: unknown[] = [];
  const hasReadableVendor = Boolean(
    normalizeVendorName(parsedInvoice.vendorName).name || normalizeVendorName(parsedInvoice.filenameVendorHint).name,
  );
  const vendorPartnerIds = hasReadableVendor
    ? await resolveVendorPartnerIds(client, parsedInvoice)
    : [];

  if (options.fromDate) {
    domain.push(['date_order', '>=', options.fromDate]);
  }
  if (options.toDate) {
    domain.push(['date_order', '<=', options.toDate]);
  }
  if (options.onlyUnbilled) {
    domain.push(['state', 'in', ['purchase', 'to approve']], ['invoice_status', '!=', 'invoiced']);
  }

  // Apply the vendor scope in Odoo before pagination. Searching the newest
  // 100 POs globally can hide an older exact match behind unrelated vendors.
  if (vendorPartnerIds.length > 0) {
    domain.push(['partner_id', 'in', vendorPartnerIds]);
  }

  if (hasReadableVendor) {
    if (invoiceDate) {
      const from = new Date(invoiceDate);
      from.setDate(from.getDate() - 90);
      const to = new Date(invoiceDate);
      to.setDate(to.getDate() + 90);
      domain.push(['date_order', '>=', from.toISOString().slice(0, 10)], ['date_order', '<=', to.toISOString().slice(0, 10)]);
    }
  } else if (typeof parsedInvoice.grandTotal === 'number') {
    domain.push(
      ['amount_total', '>=', parsedInvoice.grandTotal - Math.max(TOTAL_TOLERANCE, 10)],
      ['amount_total', '<=', parsedInvoice.grandTotal + Math.max(TOTAL_TOLERANCE, 10)],
    );
  } else if (invoiceDate) {
    const from = new Date(invoiceDate);
    from.setDate(from.getDate() - 45);
    const to = new Date(invoiceDate);
    to.setDate(to.getDate() + 45);
    domain.push(['date_order', '>=', from.toISOString().slice(0, 10)], ['date_order', '<=', to.toISOString().slice(0, 10)]);
  }

  const orders = await searchPurchaseOrdersAcrossPages(client, domain, [
    'id',
    'name',
    'state',
    'date_order',
    'amount_total',
    'amount_untaxed',
    'partner_id',
    'currency_id',
    'invoice_status',
    'user_id',
    'picking_ids',
    'invoice_ids',
    'invoice_count',
  ]);

  const orderIds = orders.map((order) => order.id);
  const processedByPo: Record<number, PoBillProcessedDocumentEntry> = await getLatestPoBillProcessedDocumentsByPurchaseOrderIds(orderIds).catch(() => ({}));

  let filteredOrders = orders;
  if (options.onlyUnbilled) {
    filteredOrders = orders.filter((order) => {
      const processed = processedByPo[order.id];
      const hasProcessed = Boolean(processed && ['processed', 'processed_with_warnings'].includes(processed.status));
      return isSchedulerEligiblePurchaseOrder(order, hasProcessed);
    });
  }

  const approvalDates = await findPurchaseOrderApprovalDates(
    client,
    filteredOrders.map((order) => order.id),
  );

  const candidates = await Promise.all(
    filteredOrders.map(async (order) => {
      const lines = await getPurchaseOrderLines(client, order.id).catch(() => []);
      return buildCandidate(order, lines, parsedInvoice, approvalDates.get(order.id) || null);
    }),
  );

  return candidates
    .filter((candidate) => !hasReadableVendor || candidate.vendorScore > 0)
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.purchaseOrder.id - left.purchaseOrder.id)
    .slice(0, 10);
}

export async function getPurchaseOrderLines(
  client: OdooClient,
  purchaseOrderId: number,
): Promise<PurchaseOrderLine[]> {
  return client.searchReadRecords<PurchaseOrderLine>('purchase.order.line', {
    domain: [['order_id', '=', purchaseOrderId]],
    fields: [
      'id',
      'name',
      'product_id',
      'product_qty',
      'qty_received',
      'qty_invoiced',
      'price_unit',
      'price_subtotal',
      'price_total',
    ],
    limit: 500,
    order: 'id asc',
  });
}

async function refreshPurchaseOrder(
  client: OdooClient,
  purchaseOrderId: number,
): Promise<PurchaseOrderSummary | null> {
  const orders = await client.readRecords<PurchaseOrderSummary>('purchase.order', [purchaseOrderId], [
    'id',
    'name',
    'state',
    'date_order',
    'amount_total',
    'amount_untaxed',
    'partner_id',
    'currency_id',
    'invoice_status',
    'user_id',
    'picking_ids',
  ]);

  return orders[0] || null;
}

async function approvePurchaseOrderForBilling(
  client: OdooClient,
  purchaseOrder: PurchaseOrderSummary,
): Promise<PurchaseOrderSummary> {
  let current = purchaseOrder;

  if (current.state === 'to approve') {
    await client.callRecordMethod<boolean | OdooActionResult | false>(
      'purchase.order',
      'button_approve',
      [current.id],
    );
    current = (await refreshPurchaseOrder(client, current.id)) || current;
  }

  if (!isConfirmedPurchaseOrderState(current.state)) {
    throw new Error(`Purchase Order ${current.name} is still in state "${current.state || 'unknown'}" after approval; expected "purchase".`);
  }

  return current;
}

async function createUploadAttachment(
  client: OdooClient,
  attachment: { name: string; content: Buffer; mimetype?: string | null },
) {
  return client.createRecord('ir.attachment', {
    name: attachment.name,
    datas: attachment.content.toString('base64'),
    mimetype: attachment.mimetype || 'application/pdf',
    type: 'binary',
  });
}

async function findVendorBillsForPurchaseOrder(client: OdooClient, purchaseOrderName: string) {
  return client.searchReadRecords<VendorBillSummary>('account.move', {
    domain: [
      ['move_type', '=', 'in_invoice'],
      ['invoice_origin', '=', purchaseOrderName],
    ],
    fields: ['id', 'name', 'ref', 'state', 'invoice_date', 'invoice_origin', 'amount_total'],
    limit: 20,
    order: 'id desc',
  });
}

async function findVendorBillsForPurchaseOrders(client: OdooClient, purchaseOrderNames: string[]) {
  const bills = await Promise.all(purchaseOrderNames.map((name) => findVendorBillsForPurchaseOrder(client, name)));
  const byId = new Map<number, VendorBillSummary>();
  bills.flat().forEach((bill) => byId.set(bill.id, bill));
  return [...byId.values()];
}

export function vendorBillMatchesParsedInvoice(
  bill: VendorBillSummary,
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
) {
  const invoiceNumber = normalizeFingerprintPart(parsedInvoice.invoiceNumber);
  const billRef = normalizeFingerprintPart(bill.ref);
  const billName = normalizeFingerprintPart(bill.name);
  const numberMatches = Boolean(invoiceNumber && (billRef === invoiceNumber || billName === invoiceNumber));
  const totalMatchesInvoice = totalsMatch(bill.amount_total, parsedInvoice.grandTotal);

  // Invoice numbers are useful supporting evidence, but they are frequently
  // unreadable or inconsistent on scanned vendor invoices. A matching vendor
  // bill total is sufficient to prevent a duplicate bill when the number is
  // missing or unreliable.
  return numberMatches || totalMatchesInvoice;
}

async function findVendorBillEvidence(
  client: OdooClient,
  input: {
    purchaseOrderName?: string | null;
    vendorBillId?: number | null;
    vendorBillName?: string | null;
  },
) {
  if (input.vendorBillId) {
    const records = await client.readRecords<VendorBillSummary>('account.move', [input.vendorBillId], [
      'id',
      'name',
      'ref',
      'state',
      'invoice_date',
      'invoice_origin',
      'amount_total',
    ]).catch(() => []);
    const record = records.find((bill) => bill.id === input.vendorBillId);
    if (record) {
      return record;
    }
  }

  const domain: unknown[] = [['move_type', '=', 'in_invoice']];
  const alternatives: unknown[] = [];
  if (input.vendorBillName) {
    alternatives.push(['name', '=', input.vendorBillName], ['ref', '=', input.vendorBillName]);
  }
  if (input.purchaseOrderName) {
    alternatives.push(['invoice_origin', '=', input.purchaseOrderName]);
  }

  if (alternatives.length === 0) {
    return null;
  }

  if (alternatives.length === 1) {
    domain.push(alternatives[0]);
  } else {
    for (let index = 0; index < alternatives.length - 1; index += 1) {
      domain.push('|');
    }
    domain.push(...alternatives);
  }

  const bills = await client.searchReadRecords<VendorBillSummary>('account.move', {
    domain,
    fields: ['id', 'name', 'ref', 'state', 'invoice_date', 'invoice_origin', 'amount_total'],
    limit: 10,
    order: 'id desc',
  }).catch(() => []);

  return bills.find((bill) =>
    (input.vendorBillName && (bill.name === input.vendorBillName || bill.ref === input.vendorBillName)) ||
    (input.purchaseOrderName && bill.invoice_origin === input.purchaseOrderName),
  ) || null;
}

async function findPoBillAutomationChatterEvidence(
  client: OdooClient,
  purchaseOrderId: number,
  input: {
    attachmentId?: number | null;
    documentId?: number | null;
    vendorBillId?: number | null;
    vendorBillName?: string | null;
  },
) {
  const messages = await client.searchReadRecords<MailMessageSummary>('mail.message', {
    domain: [
      ['model', '=', 'purchase.order'],
      ['res_id', '=', purchaseOrderId],
      ['body', 'ilike', PO_BILL_CHATTER_MARKER],
    ],
    fields: ['id', 'body', 'date'],
    limit: 20,
    order: 'id desc',
  }).catch(() => []);
  const expected = [
    input.attachmentId ? `Attachment ID: ${input.attachmentId}` : '',
    input.documentId ? `Document ID: ${input.documentId}` : '',
    input.vendorBillId ? `Vendor Bill ID: ${input.vendorBillId}` : '',
    input.vendorBillName ? `Vendor Bill: ${input.vendorBillName}` : '',
  ].filter(Boolean);

  return messages.find((message) => {
    const body = String(message.body || '');
    return expected.every((piece) => body.includes(piece));
  }) || null;
}

export function isCompletedPoBillActivityNote(note: string, attachmentName: string) {
  const content = normalizeText(note);
  const filename = normalizeText(path.basename(attachmentName));
  return Boolean(
    filename &&
    content.includes(filename) &&
    /\binvoice pdf\b/.test(content) &&
    /\bvendor bill\b/.test(content) &&
    !/\bvendor bill not created\b/.test(content) &&
    /\bno follow up pending\b/.test(content),
  );
}

async function findCompletedPoBillActivityEvidence(
  client: OdooClient,
  purchaseOrderId: number,
  attachmentName: string,
) {
  const activities = await client.searchReadRecords<MailActivityEvidenceSummary>('mail.activity', {
    domain: [
      ['res_model', '=', 'purchase.order'],
      ['res_id', '=', purchaseOrderId],
    ],
    fields: ['id', 'res_id', 'res_model', 'summary', 'note', 'create_date'],
    limit: 100,
    order: 'create_date desc, id desc',
  }).catch(() => []);
  const activity = activities.find((entry) =>
    isCompletedPoBillActivityNote(`${entry.summary || ''}\n${entry.note || ''}`, attachmentName),
  );
  if (!activity) {
    return null;
  }

  const note = String(activity.note || '');
  const billValue = note.match(/vendor\s+bill\s*:\s*([^<\r\n]+)/i)?.[1]?.trim() || null;
  const billId = billValue?.match(/^\d+$/)?.[0];
  return {
    activity,
    vendorBillId: billId ? Number(billId) : null,
    vendorBillName: billValue,
  };
}

export async function verifyPoBillProcessedEvidence(client: OdooClient, attachment: AttachmentInfo) {
  if (!attachment.poBillPurchaseOrderId || !attachment.poBillPurchaseOrderName) {
    return {
      valid: false,
      bill: null,
      chatter: null,
      reason: 'Local processed marker is missing the Purchase Order evidence.',
    };
  }

  const bill = await findVendorBillEvidence(client, {
    purchaseOrderName: attachment.poBillPurchaseOrderName,
    vendorBillId: attachment.poBillVendorBillId || null,
    vendorBillName: attachment.poBillVendorBillName || null,
  });
  if (!bill) {
    return {
      valid: false,
      bill: null,
      chatter: null,
      reason: 'Local processed marker exists, but the referenced Odoo vendor bill was not found.',
    };
  }

  const chatter = await findPoBillAutomationChatterEvidence(client, attachment.poBillPurchaseOrderId, {
    attachmentId: attachment.id,
    documentId: attachment.documentId || null,
    vendorBillId: bill.id,
    vendorBillName: bill.name || attachment.poBillVendorBillName || null,
  });
  if (!chatter) {
    return {
      valid: false,
      bill,
      chatter: null,
      reason: 'Vendor bill exists, but the PO chatter evidence marker was not found.',
    };
  }

  return { valid: true, bill, chatter, reason: 'Vendor bill and PO chatter evidence were verified in Odoo.' };
}

async function postVendorBillCreatedEvidence(
  client: OdooClient,
  input: {
    purchaseOrder: PurchaseOrderSummary;
    attachment: AttachmentInfo;
    uploadAttachmentId: number | null;
    vendorBill: VendorBillSummary;
  },
) {
  const vendorBillName = input.vendorBill.name || String(input.vendorBill.id);
  return client.postModelChatterMessage('purchase.order', input.purchaseOrder.id, [
    `<p><strong>${PO_BILL_CHATTER_MARKER}</strong></p>`,
    `<p>PO: ${escapeHtml(input.purchaseOrder.name)}</p>`,
    `<p>Source Attachment ID: ${input.attachment.id}</p>`,
    input.attachment.documentId ? `<p>Document ID: ${input.attachment.documentId}</p>` : '',
    input.uploadAttachmentId ? `<p>Uploaded Attachment ID: ${input.uploadAttachmentId}</p>` : '',
    `<p>Vendor Bill ID: ${input.vendorBill.id}</p>`,
    `<p>Vendor Bill: ${escapeHtml(vendorBillName)}</p>`,
    input.vendorBill.ref ? `<p>Vendor Bill Ref: ${escapeHtml(input.vendorBill.ref)}</p>` : '',
  ].filter(Boolean).join(''));
}

export function selectExistingVendorBillForMatchedPurchaseOrders(
  bills: VendorBillSummary[],
  purchaseOrders: PurchaseOrderSummary[],
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
) {
  const activeBills = bills.filter((bill) => String(bill.state || '').toLowerCase() !== 'cancel');
  if (activeBills.length === 0) {
    return null;
  }

  // A readable invoice total matching a bill whose invoice_origin is this PO
  // is strong evidence that billing already happened, even when the local
  // automation marker was lost or contains an obsolete bill ID.
  const totalMatch = activeBills.find((bill) => totalsMatch(bill.amount_total, parsedInvoice.grandTotal));
  if (totalMatch) {
    return totalMatch;
  }

  const invoiceNumber = normalizeFingerprintPart(parsedInvoice.invoiceNumber);
  const referenceMatch = invoiceNumber
    ? activeBills.find((bill) =>
        normalizeFingerprintPart(bill.ref) === invoiceNumber ||
        normalizeFingerprintPart(bill.name) === invoiceNumber,
      )
    : null;
  if (referenceMatch) {
    return referenceMatch;
  }

  // If Odoo itself says the PO is invoiced and there is exactly one active
  // bill for it, use that bill as the recovery evidence when the invoice
  // parser could not read a reliable total or number.
  const purchaseOrderShowsBilling = purchaseOrders.some((order) =>
    order.invoice_status === 'invoiced' ||
    Boolean(Array.isArray(order.invoice_ids) && order.invoice_ids.length > 0) ||
    Number(order.invoice_count || 0) > 0,
  );
  return purchaseOrderShowsBilling && activeBills.length === 1 ? activeBills[0] : null;
}

async function findExistingVendorBillForMatchedPurchaseOrders(
  client: OdooClient,
  purchaseOrders: PurchaseOrderSummary[],
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
  knownVendorBillIds: number[] = [],
) {
  const purchaseOrderNames = purchaseOrders.map((order) => order.name);
  const linkedBillIds = [...purchaseOrders
    .flatMap((order) => (Array.isArray(order.invoice_ids) ? order.invoice_ids : []))
    .filter((id): id is number => typeof id === 'number' && id > 0), ...knownVendorBillIds]
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const linkedBills = linkedBillIds.length > 0
    ? await client.readRecords<VendorBillSummary>('account.move', linkedBillIds, [
        'id',
        'name',
        'ref',
        'state',
        'invoice_date',
        'invoice_origin',
        'amount_total',
      ]).catch(() => [])
    : [];
  const billsById = new Map<number, VendorBillSummary>();
  [...linkedBills, ...(await findVendorBillsForPurchaseOrders(client, purchaseOrderNames))].forEach((bill) => {
    billsById.set(bill.id, bill);
  });

  return selectExistingVendorBillForMatchedPurchaseOrders(
    [...billsById.values()],
    purchaseOrders,
    parsedInvoice,
  );
}

async function repairAlreadyMatchedPoBillDocument(
  client: OdooClient,
  input: {
    attachment: AttachmentInfo;
    purchaseOrders: PurchaseOrderSummary[];
    parsedInvoice: PoBillAutomationResult['parsedInvoice'];
    invoiceFingerprint: string;
    mode: 'review' | 'auto';
  },
) {
  const completionActivity = await findCompletedPoBillActivityEvidence(
    client,
    input.purchaseOrders[0].id,
    input.attachment.name,
  );
  const vendorBillFromPo = await findExistingVendorBillForMatchedPurchaseOrders(
    client,
    input.purchaseOrders,
    input.parsedInvoice,
    completionActivity?.vendorBillId ? [completionActivity.vendorBillId] : [],
  );
  const vendorBill = vendorBillFromPo || (completionActivity?.vendorBillId
    ? {
        id: completionActivity.vendorBillId,
        name: completionActivity.vendorBillName || String(completionActivity.vendorBillId),
        ref: null,
        state: null,
        invoice_origin: input.purchaseOrders[0].name,
        amount_total: input.parsedInvoice.grandTotal,
      }
    : null);
  if (!vendorBill) {
    return null;
  }

  const primaryPurchaseOrder = input.purchaseOrders[0];
  const purchaseOrderName = input.purchaseOrders.map((order) => order.name).join(', ');
  let chatter = await findPoBillAutomationChatterEvidence(client, primaryPurchaseOrder.id, {
    attachmentId: input.attachment.id,
    documentId: input.attachment.documentId || null,
    vendorBillId: vendorBill.id,
    vendorBillName: vendorBill.name || null,
  });
  let chatterMessage: number | null = null;

  if (!chatter && input.mode === 'auto') {
    try {
      chatterMessage = await postVendorBillCreatedEvidence(client, {
        purchaseOrder: primaryPurchaseOrder,
        attachment: input.attachment,
        uploadAttachmentId: null,
        vendorBill,
      });
      chatter = await findPoBillAutomationChatterEvidence(client, primaryPurchaseOrder.id, {
        attachmentId: input.attachment.id,
        documentId: input.attachment.documentId || null,
        vendorBillId: vendorBill.id,
        vendorBillName: vendorBill.name || null,
      });
    } catch {
      // The durable local marker below is still useful; the next run will
      // retry the chatter repair without creating another vendor bill.
    }
  }

  const documentValidation = input.mode === 'auto'
    ? await markSourceDocumentValidated(client, input.attachment)
    : { marked: false, message: 'Document tag repair is only applied in auto mode.' };
  const summary = [
    `Recovered existing vendor bill ${vendorBill.name || vendorBill.id} for ${purchaseOrderName}; no duplicate bill was created.`,
    completionActivity ? `Completed PO activity evidence was found on activity ${completionActivity.activity.id}.` : '',
    chatter ? 'PO chatter evidence is present.' : 'PO chatter evidence is still pending repair.',
    documentValidation.marked ? documentValidation.message : documentValidation.message,
  ].filter(Boolean).join(' ');

  if (input.mode === 'auto') {
    await upsertPoBillProcessedDocument({
      attachmentId: input.attachment.id,
      attachmentName: input.attachment.name,
      documentId: input.attachment.documentId || null,
      folderName: input.attachment.folderName || null,
      companyName: input.attachment.companyName || null,
      purchaseOrderId: primaryPurchaseOrder.id,
      purchaseOrderName,
      vendorBillId: vendorBill.id,
      vendorBillName: vendorBill.name || String(vendorBill.id),
      invoiceFingerprint: input.invoiceFingerprint,
      invoiceNumber: input.parsedInvoice.invoiceNumber || null,
      invoiceVendor: input.parsedInvoice.vendorName || null,
      invoiceTotal: input.parsedInvoice.grandTotal ?? null,
      status: 'processed_with_warnings',
      mode: input.mode,
      summary,
    });
  }

  return { vendorBill, chatter, chatterMessage, documentValidation, summary };
}

async function createVendorBillFromPurchaseOrders(
  client: OdooClient,
  purchaseOrders: PurchaseOrderSummary[],
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
  attachmentId?: number,
) {
  const primaryPurchaseOrder = purchaseOrders[0];
  const purchaseOrderNames = purchaseOrders.map((order) => order.name);
  const before = await findVendorBillsForPurchaseOrders(client, purchaseOrderNames);
  const existingMatchingBill = before.find((bill) => vendorBillMatchesParsedInvoice(bill, parsedInvoice));
  if (existingMatchingBill) {
    return existingMatchingBill;
  }
  const beforeIds = new Set(before.map((bill) => bill.id));
  const action = await client.callRecordMethod<OdooActionResult | false>(
    'purchase.order',
    'action_create_invoice',
    purchaseOrders.map((order) => order.id),
    attachmentId ? { attachment_ids: attachmentId } : {},
  );

  let billId = action && typeof action === 'object' && typeof action.res_id === 'number' ? action.res_id : null;
  let bills = await findVendorBillsForPurchaseOrders(client, purchaseOrderNames);

  if (!billId) {
    const newBill = bills.find((bill) => !beforeIds.has(bill.id));
    billId = newBill?.id || bills[0]?.id || null;
  }

  if (!billId) {
    throw new Error('Odoo did not return or expose a vendor bill after action_create_invoice.');
  }

  const updatePayload: Record<string, unknown> = {};
  if (parsedInvoice.invoiceNumber) {
    updatePayload.ref = parsedInvoice.invoiceNumber;
  }
  const billDate = resolveVendorBillDateForOdoo(parsedInvoice, primaryPurchaseOrder);
  if (billDate) {
    updatePayload.invoice_date = billDate;
  }

  if (Object.keys(updatePayload).length > 0) {
    await client.writeRecord('account.move', [billId], updatePayload);
  }

  bills = await client.readRecords<VendorBillSummary>('account.move', [billId], [
    'id',
    'name',
    'ref',
    'state',
    'invoice_date',
    'invoice_origin',
    'amount_total',
  ]);

  return bills[0] || { id: billId };
}

async function createVendorBillFromPurchaseOrder(
  client: OdooClient,
  purchaseOrder: PurchaseOrderSummary,
  parsedInvoice: PoBillAutomationResult['parsedInvoice'],
  attachmentId?: number,
) {
  return createVendorBillFromPurchaseOrders(client, [purchaseOrder], parsedInvoice, attachmentId);
}

async function confirmVendorBill(
  client: OdooClient,
  vendorBillId: number,
): Promise<VendorBillSummary | null> {
  try {
    await client.callRecordMethod<unknown>('account.move', 'action_post', [vendorBillId]);
    const bills = await client.readRecords<VendorBillSummary>('account.move', [vendorBillId], [
      'id',
      'name',
      'ref',
      'state',
      'invoice_date',
      'invoice_origin',
      'amount_total',
    ]);
    return bills[0] || null;
  } catch (error) {
    console.warn(
      `[po-bills] Could not confirm vendor bill ${vendorBillId} in Odoo:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function findJournalByNameOrCode(
  client: OdooClient,
  ...searchTerms: string[]
): Promise<{ id: number; name: string; code: string } | null> {
  for (const term of searchTerms) {
    const journals = await client
      .searchReadRecords<{ id: number; name: string; code: string }>('account.journal', {
        domain: ['|', ['name', 'ilike', term], ['code', 'ilike', term]],
        fields: ['id', 'name', 'code'],
        limit: 1,
      })
      .catch(() => []);
    if (journals[0]) {
      return journals[0];
    }
  }
  return null;
}

async function registerPaymentForVendorBill(
  client: OdooClient,
  vendorBill: VendorBillSummary,
  pinNote: 'ETR' | 'NO PIN',
  parsedInvoiceDate?: string | null,
): Promise<{ success: boolean; message: string; paymentId?: number }> {
  // Vendor receipt date is the payment date for this workflow. Send it to Odoo
  // as ISO YYYY-MM-DD; Odoo formats it for display in the Pay dialog locale.
  const paymentDate =
    normalizeInvoiceDateForOdoo(parsedInvoiceDate) ||
    normalizeInvoiceDateForOdoo(vendorBill.invoice_date) ||
    formatDateOnly(new Date());

  let targetJournal: { id: number; name: string; code: string } | null = null;
  if (pinNote === 'NO PIN') {
    targetJournal = await findJournalByNameOrCode(client, 'MPESA', 'M-PESA');
  } else if (pinNote === 'ETR') {
    targetJournal = await findJournalByNameOrCode(client, '001215001007459');
  }

  if (!targetJournal) {
    const journalSearchTerm = pinNote === 'NO PIN' ? 'MPESA' : '001215001007459';
    return {
      success: false,
      message: `Could not register payment: Journal "${journalSearchTerm}" was not found in Odoo for PIN status ${pinNote}.`,
    };
  }

  const paymentAmount = vendorBill.amount_total ?? 0;
  if (paymentAmount <= 0) {
    return {
      success: false,
      message: `Skipped payment registration for vendor bill ${vendorBill.name || vendorBill.id} because bill total is 0.`,
    };
  }

  const ref = vendorBill.ref || vendorBill.name || `Bill-${vendorBill.id}`;

  let wizardErrorMessage = '';
  try {
    const wizardContext = await client.callRecordMethod<{
      res_id?: number;
      context?: Record<string, unknown>;
    } | false>('account.move', 'action_register_payment', [vendorBill.id]);

    const wizardContextData =
      wizardContext && typeof wizardContext === 'object' && wizardContext.context
        ? wizardContext.context
        : {};

    const wizardPayload: Record<string, unknown> = {
      amount: paymentAmount,
      payment_date: paymentDate,
      journal_id: targetJournal.id,
      payment_type: 'outbound',
      partner_type: 'supplier',
      communication: ref,
    };

    if (wizardContextData.default_payment_method_line_id) {
      wizardPayload.payment_method_line_id = wizardContextData.default_payment_method_line_id;
    }

    const wizardId = await client.createRecord('account.payment.register', wizardPayload, {
      active_model: 'account.move',
      active_ids: [vendorBill.id],
      ...wizardContextData,
    });

    if (wizardId) {
      await client.callRecordMethod<unknown>(
        'account.payment.register',
        'action_create_payments',
        [wizardId],
        {
          context: {
            active_model: 'account.move',
            active_ids: [vendorBill.id],
            ...wizardContextData,
          },
        },
      );

      return {
        success: true,
        message: `Registered payment on vendor bill ${vendorBill.name || vendorBill.id} for ${paymentAmount} on date ${paymentDate} via journal ${targetJournal.name} (${targetJournal.code}) [PIN status: ${pinNote}].`,
      };
    }
  } catch (wizardError) {
    wizardErrorMessage = wizardError instanceof Error ? wizardError.message : String(wizardError);
    console.warn(
      `[po-bills] account.payment.register wizard failed for bill ${vendorBill.id}:`,
      wizardErrorMessage,
    );
  }

  return {
    success: false,
    message: `Failed to create payment for vendor bill ${vendorBill.name || vendorBill.id} using the Odoo Pay dialog fields: ${wizardErrorMessage || 'Unknown payment wizard error.'}`,
  };
}

async function validatePurchaseOrderReceipts(client: OdooClient, purchaseOrder: PurchaseOrderSummary) {
  const order = (
    await client.readRecords<PurchaseOrderSummary>('purchase.order', [purchaseOrder.id], [
      'id',
      'name',
      'picking_ids',
    ])
  )[0];
  const pickingIds = Array.isArray(order?.picking_ids) ? order.picking_ids : [];

  if (pickingIds.length === 0) {
    return {
      validated: [] as StockPickingSummary[],
      skipped: [] as StockPickingSummary[],
      pending: ['No linked receipts were found on the Purchase Order.'],
    };
  }

  const pickings = await client.readRecords<StockPickingSummary>('stock.picking', pickingIds, [
    'id',
    'name',
    'state',
  ]);
  const validated: StockPickingSummary[] = [];
  const skipped: StockPickingSummary[] = [];
  const pending: string[] = [];

  for (const picking of pickings) {
    if (picking.state === 'done' || picking.state === 'cancel') {
      skipped.push(picking);
      continue;
    }

    const result = await client.callRecordMethod<OdooActionResult | boolean | false>(
      'stock.picking',
      'button_validate',
      [picking.id],
    );
    const refreshed = (
      await client.readRecords<StockPickingSummary>('stock.picking', [picking.id], ['id', 'name', 'state'])
    )[0];

    if (refreshed?.state === 'done') {
      validated.push(refreshed);
      continue;
    }

    if (result && typeof result === 'object' && result.res_model) {
      pending.push(`${picking.name || picking.id} requires Odoo wizard ${result.res_model}.`);
    } else {
      pending.push(`${picking.name || picking.id} was not marked done after validation.`);
    }
  }

  return { validated, skipped, pending };
}

async function getPurchaseOrderModelId(client: OdooClient) {
  const models = await client.searchReadRecords<OdooModelSummary>('ir.model', {
    domain: [['model', '=', 'purchase.order']],
    fields: ['id', 'model'],
    limit: 1,
  });
  const model = models[0];
  if (!model) {
    throw new Error('Could not find Odoo model metadata for purchase.order.');
  }
  return model.id;
}

async function getTodoActivityTypeId(client: OdooClient) {
  const todoTypes = await client.searchReadRecords<MailActivityTypeSummary>('mail.activity.type', {
    domain: ['|', ['name', 'ilike', 'To Do'], ['name', 'ilike', 'Todo']],
    fields: ['id', 'name'],
    limit: 1,
    order: 'id asc',
  });

  if (todoTypes[0]) {
    return todoTypes[0].id;
  }

  const fallbackTypes = await client.searchReadRecords<MailActivityTypeSummary>('mail.activity.type', {
    domain: [],
    fields: ['id', 'name'],
    limit: 1,
    order: 'id asc',
  });

  if (!fallbackTypes[0]) {
    throw new Error('Could not find a mail activity type in Odoo.');
  }

  return fallbackTypes[0].id;
}

async function createPurchaseOrderActivity(
  client: OdooClient,
  purchaseOrder: PurchaseOrderSummary,
  summary: string,
  noteLines: string[],
) {
  const resModelId = await getPurchaseOrderModelId(client);
  const activityTypeId = await getTodoActivityTypeId(client);
  const allowedUser = await client.findUserByNameLoginOrEmail(ALLOWED_NOTIFICATION_USER_NAME);
  if (!allowedUser) {
    throw new Error(`Could not create notification activity because ${ALLOWED_NOTIFICATION_USER_NAME} was not found in Odoo.`);
  }
  const values: Record<string, unknown> = {
    res_model_id: resModelId,
    res_id: purchaseOrder.id,
    activity_type_id: activityTypeId,
    user_id: allowedUser.id,
    summary,
    note: `<p>${noteLines.map(escapeHtml).join('<br/>')}</p>`,
    date_deadline: formatDateOnly(new Date()),
  };

  return client.createRecord('mail.activity', values);
}

export async function runPoBillAutomation(
  client: OdooClient,
  input: {
    attachmentId: number;
    purchaseOrderSearch?: string;
    mode: 'review' | 'auto';
    aiConfig?: Parameters<typeof parseSupplierInvoice>[0]['aiConfig'];
    matchFromDate?: string;
    matchToDate?: string;
    onlyUnbilledPurchaseOrders?: boolean;
    sourceAttachment?: AttachmentInfo;
  },
): Promise<PoBillAutomationResult> {
  const checks: PoBillAutomationCheck[] = [];
  const actionsTaken: string[] = [];
  const actionsPending: string[] = [];

  const downloadedAttachment = await client.downloadAttachment(input.attachmentId);
  const attachment: typeof downloadedAttachment & AttachmentInfo = {
    ...downloadedAttachment,
    documentId: input.sourceAttachment?.documentId || null,
    folderName: input.sourceAttachment?.folderName || null,
    companyName: input.sourceAttachment?.companyName || null,
  };
  if (!isSupportedPoBillMimetype(attachment.mimetype)) {
    throw new Error(`Attachment "${attachment.name}" is not a supported PDF or image document.`);
  }
  const tempDir = resolveProjectFile(process.env.TEMP_DIR || 'tmp', 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  const safeAttachmentName = ensurePoBillFilenameExtension(attachment.name, attachment.mimetype)
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  const tempFilePath = path.join(tempDir, `${Date.now()}-${safeAttachmentName}`);
  await fs.writeFile(tempFilePath, attachment.content);
  const supplierInvoice = await (async () => {
    try {
      return await parseSupplierInvoice({
        filePath: tempFilePath,
        originalFilename: attachment.name,
        preferredOcr: 'auto',
        aiConfig: input.aiConfig,
        alwaysOcr: true,
        forceAi: true,
      });
    } finally {
      await fs.unlink(tempFilePath).catch(() => undefined);
    }
  })();
  const invoiceRaw = supplierInvoice.raw || { ocr_text: '', pdf_text: '', ai_json: null };
  let invoiceTotals = supplierInvoice.totals || { goods_total: null, vat: null, amount_due: null };
  const invoiceItems = Array.isArray(supplierInvoice.items) ? supplierInvoice.items : [];
  const invoiceLogs = Array.isArray(supplierInvoice.warnings) ? [...supplierInvoice.warnings] : [];
  invoiceTotals = correctSubtotalAsAmountDue({
    totals: invoiceTotals,
    items: invoiceItems,
    logs: invoiceLogs,
  });
  const allExtractedText = [
    invoiceRaw.ocr_text,
    invoiceRaw.pdf_text,
    supplierInvoice.customer_pin,
    supplierInvoice.supplier_pin,
    JSON.stringify(invoiceRaw.ai_json || ''),
  ].filter(Boolean).join('\n\n');
  const detectedPin = findUrbanVibeBuyerPin(allExtractedText);
  const parsedInvoice = {
    vendorName: supplierInvoice.supplier,
    filenameVendorHint: extractFilenameVendorHint(attachment.name),
    invoiceDate: supplierInvoice.invoice_date,
    invoiceNumber: supplierInvoice.invoice_number,
    orderNumber: null,
    taxPin: detectedPin,
    pinNote: detectedPin ? ('ETR' as const) : ('NO PIN' as const),
    untaxedTotal: invoiceTotals.goods_total,
    vatTotal: invoiceTotals.vat,
    grandTotal: invoiceTotals.amount_due,
    itemCount: invoiceItems.length,
    items: invoiceItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      amount: item.net_amount,
    })),
    rawText: [invoiceRaw.ocr_text, invoiceRaw.pdf_text].filter(Boolean).join('\n\n'),
    logs: invoiceLogs,
    confidence: supplierInvoice.confidence,
    handwriting: supplierInvoice.handwriting,
  };
  try {
    const notification = await notifyAiCredentialFailures({
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      logs: parsedInvoice.logs,
    });
    if (notification.sent) {
      parsedInvoice.logs.push('AI credential failure notification sent to DB admins.');
    } else if (notification.skipped && notification.signals.length > 0) {
      parsedInvoice.logs.push('AI credential failure notification was already sent for this attachment.');
    }
  } catch (error) {
    parsedInvoice.logs.push(`AI credential failure notification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (isUnreadableDocument({
    attachmentId: attachment.id,
    attachmentName: attachment.name,
    vendorName: parsedInvoice.vendorName,
    grandTotal: parsedInvoice.grandTotal,
    itemCount: parsedInvoice.itemCount,
    rawText: parsedInvoice.rawText,
    confidenceOverall: parsedInvoice.confidence?.overall,
  })) {
    try {
      const notification = await notifyUnreadableDocument({
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        vendorName: parsedInvoice.vendorName,
        grandTotal: parsedInvoice.grandTotal,
        itemCount: parsedInvoice.itemCount,
        rawText: parsedInvoice.rawText,
        confidenceOverall: parsedInvoice.confidence?.overall,
      });
      if (notification.sent) {
        parsedInvoice.logs.push(`Unreadable document notification sent to ${notification.recipient}.`);
      } else if (notification.alreadyNotified) {
        parsedInvoice.logs.push('Unreadable document notification was already sent for this attachment.');
      }
    } catch (error) {
      parsedInvoice.logs.push(`Unreadable document notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const invoiceFingerprint = buildInvoiceFingerprint({
    attachmentContent: attachment.content,
    vendorName: parsedInvoice.vendorName,
    invoiceNumber: parsedInvoice.invoiceNumber,
    grandTotal: parsedInvoice.grandTotal,
  });
  const isStandaloneDeliveryNote = isStandaloneDeliveryNoteDocument({
    attachmentName: attachment.name,
    rawText: parsedInvoice.rawText,
  });
  const isNonBillJobSummary = isJobSummaryDocument({
    attachmentName: attachment.name,
    rawText: parsedInvoice.rawText,
  });

  if (isStandaloneDeliveryNote) {
    const deliveryNoteSummary =
      'Standalone Delivery Note detected. No invoice document was found; PO matching and billing were not attempted. Future scheduler runs will skip this document.';
    const checksForDeliveryNote: PoBillAutomationCheck[] = [];
    const actionsForDeliveryNote: string[] = [];
    const pendingForDeliveryNote: string[] = [];

    addCheck(checksForDeliveryNote, 'Document Type', 'pass', 'This document contains a Delivery Note and no invoice document signal.');
    addCheck(checksForDeliveryNote, 'Purchase Order', 'info', 'PO matching was not attempted because this is a standalone Delivery Note, not a vendor bill.');

    const documentTag = await markSourceDocumentDeliveryNote(client, attachment);
    if (documentTag.marked) {
      actionsForDeliveryNote.push(documentTag.message);
      addCheck(checksForDeliveryNote, 'Documents', 'pass', documentTag.message);
    } else {
      pendingForDeliveryNote.push(documentTag.message);
      addCheck(checksForDeliveryNote, 'Documents', 'warn', documentTag.message);
    }

    await markPoBillDocumentAsDeliveryNote({
      attachment,
      summary: deliveryNoteSummary,
      invoiceFingerprint,
      invoiceNumber: parsedInvoice.invoiceNumber,
      invoiceVendor: parsedInvoice.vendorName,
      invoiceTotal: parsedInvoice.grandTotal,
      mode: input.mode,
    });
    actionsForDeliveryNote.push(`Recorded ${attachment.name} as a Delivery Note; future scheduler runs will skip it.`);
    addCheck(checksForDeliveryNote, 'Processed Signature', 'pass', 'A dedicated Delivery Note signature was saved locally and will prevent repeated PO matching.');

    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder: null,
      purchaseOrders: [],
      candidates: [],
      parsedInvoice: {
        ...parsedInvoice,
        logs: [...parsedInvoice.logs, deliveryNoteSummary],
      },
      checks: checksForDeliveryNote,
      canAutoProceed: false,
      actionsTaken: actionsForDeliveryNote,
      actionsPending: pendingForDeliveryNote,
    };
  }

  if (isNonBillJobSummary) {
    const checksForNonBill: PoBillAutomationCheck[] = [];
    const actionsPendingForNonBill = [
      'Skipped before PO matching because this PDF is a Job Summary/MaxCut document, not a vendor bill.',
    ];
    addUrbanVibePinCheck(checksForNonBill, parsedInvoice.taxPin);
    addCheck(checksForNonBill, 'Document Type', 'fail', 'This PDF looks like a Job Summary/MaxCut document, not a supplier invoice or bill.');
    addCheck(checksForNonBill, 'Purchase Order', 'fail', 'PO matching was not attempted for this non-bill document.');

    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder: null,
      purchaseOrders: [],
      candidates: [],
      parsedInvoice: {
        ...parsedInvoice,
        vendorName: null,
        invoiceDate: null,
        invoiceNumber: null,
        taxPin: null,
        pinNote: 'NO PIN',
        untaxedTotal: null,
        vatTotal: null,
        grandTotal: null,
        itemCount: 0,
        items: [],
        logs: [
          ...parsedInvoice.logs,
          'PO bill automation skipped this file because it is a Job Summary/MaxCut document, not a vendor bill.',
        ],
      },
      checks: checksForNonBill,
      canAutoProceed: false,
      actionsTaken,
      actionsPending: actionsPendingForNonBill,
    };
  }

  if (input.mode === 'auto' && await hasValidatedSourceDocument(client, attachment)) {
    addCheck(checks, 'Documents', 'pass', 'This source document already has the Odoo Documents tag "Validated".');
    addCheck(checks, 'Processed Signature', 'pass', 'The Odoo Validated tag is being used as the durable processed signature; duplicate PO matching was skipped.');
    actionsTaken.push(`Skipped ${attachment.name} because its Odoo Documents record is already tagged Validated.`);
    actionsPending.push('Auto mode stopped because the source document already has a durable Validated signature.');
    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder: null,
      purchaseOrders: [],
      candidates: [],
      parsedInvoice,
      checks,
      canAutoProceed: false,
      actionsTaken,
      actionsPending,
    };
  }

  const overrideSearch = input.purchaseOrderSearch?.trim() || '';
  const overridePurchaseOrder = overrideSearch ? await findPurchaseOrder(client, overrideSearch) : null;
  const orderNumberPurchaseOrder =
    !overridePurchaseOrder && parsedInvoice.orderNumber
      ? await findPurchaseOrder(client, parsedInvoice.orderNumber)
      : null;
  const broadCandidates = input.onlyUnbilledPurchaseOrders
    ? await findPurchaseOrderCandidates(client, parsedInvoice, {
        fromDate: input.matchFromDate,
        toDate: input.matchToDate,
        onlyUnbilled: false,
      })
    : null;
  const candidates = await findPurchaseOrderCandidates(client, parsedInvoice, {
    fromDate: input.matchFromDate,
    toDate: input.matchToDate,
    onlyUnbilled: input.onlyUnbilledPurchaseOrders,
  });
  addUrbanVibePinCheck(checks, parsedInvoice.taxPin);
  const aiStatus = describeAiExtractionStatus(input.aiConfig, parsedInvoice.logs);
  addCheck(checks, 'AI Extraction', aiStatus.status, aiStatus.detail);

  const bestOverallCandidate = broadCandidates?.[0] || null;
  const bestEligibleCandidate = candidates[0] || null;
  const bestOverallWasExcluded =
    Boolean(input.onlyUnbilledPurchaseOrders && bestOverallCandidate) &&
    !candidates.some((candidate) => candidate.purchaseOrder.id === bestOverallCandidate?.purchaseOrder.id);

  // A PO can be filtered out as already invoiced even though the local
  // attachment marker/tag is missing. Recover that durable Odoo evidence
  // before allowing the scheduler to continue with a weaker PO candidate.
  if (input.mode === 'auto' && input.onlyUnbilledPurchaseOrders && bestOverallCandidate && bestOverallWasExcluded) {
    const recovered = await repairAlreadyMatchedPoBillDocument(client, {
      attachment,
      purchaseOrders: [bestOverallCandidate.purchaseOrder],
      parsedInvoice,
      invoiceFingerprint,
      mode: input.mode,
    });
    if (recovered) {
      addCheck(checks, 'Existing Odoo Match', 'pass', recovered.summary);
      if (recovered.documentValidation.marked) {
        actionsTaken.push(recovered.documentValidation.message);
        addCheck(checks, 'Documents', 'pass', recovered.documentValidation.message);
      } else {
        actionsPending.push(recovered.documentValidation.message);
        addCheck(checks, 'Documents', 'warn', recovered.documentValidation.message);
      }
      if (recovered.chatterMessage) {
        actionsTaken.push(`Repaired PO chatter evidence for existing vendor bill ${recovered.vendorBill.name || recovered.vendorBill.id}.`);
      }
      actionsTaken.push(`Repaired the processed signature for ${attachment.name}; future scheduler runs will skip this document.`);
      addCheck(checks, 'Processed Signature', 'pass', 'Existing PO/vendor-bill evidence was recorded locally to prevent duplicate processing.');
      actionsPending.push('Auto mode stopped because this document was already matched and billed in Odoo.');
      return {
        mode: input.mode,
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        purchaseOrder: bestOverallCandidate.purchaseOrder,
        purchaseOrders: [bestOverallCandidate.purchaseOrder],
        candidates: broadCandidates || candidates,
        parsedInvoice,
        checks,
        canAutoProceed: false,
        actionsTaken,
        actionsPending,
      };
    }
  }

  if (
    bestOverallCandidate &&
    bestOverallWasExcluded &&
    bestOverallCandidate.score >= AUTO_MATCH_THRESHOLD &&
    (!bestEligibleCandidate || bestEligibleCandidate.score < bestOverallCandidate.score)
  ) {
    const reason = describeSchedulerEligibility(bestOverallCandidate.purchaseOrder);
    addCheck(
      checks,
      'Best Overall Match',
      'warn',
      `${bestOverallCandidate.purchaseOrder.name} scored ${bestOverallCandidate.score}/100, but scheduler did not select it because ${reason}.`,
    );
    addCheck(
      checks,
      'Scheduler Eligibility',
      'fail',
      `Skipped weaker candidate matching because the strongest PO match ${bestOverallCandidate.purchaseOrder.name} is not scheduler-eligible: ${reason}.`,
    );
    actionsPending.push(
      `Scheduler skipped this PDF because the strongest match ${bestOverallCandidate.purchaseOrder.name} is not scheduler-eligible (${reason}); a weaker PO will not be used.`,
    );

    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder: bestOverallCandidate.purchaseOrder,
      purchaseOrders: [bestOverallCandidate.purchaseOrder],
      candidates: broadCandidates || candidates,
      parsedInvoice,
      checks,
      canAutoProceed: false,
      actionsTaken,
      actionsPending,
    };
  }

  const combinedMatch =
    !overridePurchaseOrder && !orderNumberPurchaseOrder
      ? findCombinedPurchaseOrderMatch(candidates, parsedInvoice)
      : null;
  const reliableCandidate = candidates.find((candidate) =>
    isReliablePoBillCandidate(candidate) &&
    (isConfirmedPurchaseOrderState(candidate.purchaseOrder.state) ||
      isApprovablePurchaseOrderState(candidate.purchaseOrder.state)),
  );
  const explicitPurchaseOrder = overridePurchaseOrder || orderNumberPurchaseOrder;
  if (!combinedMatch && !explicitPurchaseOrder && !reliableCandidate) {
    const strongestCandidate = candidates[0] || null;
    addCheck(
      checks,
      'PO Match Score',
      strongestCandidate ? 'warn' : 'fail',
      strongestCandidate
        ? `No reliable PO match reached ${AUTO_MATCH_THRESHOLD}/100 with a matching total. Strongest candidate ${strongestCandidate.purchaseOrder.name} scored ${strongestCandidate.score}/100.`
        : 'No PO candidates were found for the extracted vendor and invoice date.',
    );
    addCheck(
      checks,
      'Purchase Order',
      'fail',
      'No Purchase Order was selected because low-confidence or wrong-total candidates cannot be used as matches.',
    );
    actionsPending.push(
      strongestCandidate
        ? `Stopped before PO selection because ${strongestCandidate.purchaseOrder.name} did not meet the reliable-match threshold.`
        : 'Stopped because no reliable Purchase Order candidate was found.',
    );
    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder: null,
      purchaseOrders: [],
      candidates,
      parsedInvoice,
      checks,
      canAutoProceed: false,
      actionsTaken,
      actionsPending,
    };
  }
  let matchedPurchaseOrders = combinedMatch?.purchaseOrders ||
    (explicitPurchaseOrder || reliableCandidate?.purchaseOrder
      ? [explicitPurchaseOrder || reliableCandidate?.purchaseOrder].filter(Boolean) as PurchaseOrderSummary[]
      : []);
  let purchaseOrder = matchedPurchaseOrders[0] || null;
  const bestCandidate = candidates.find((candidate) => candidate.purchaseOrder.id === purchaseOrder?.id) || null;
  const combinedTotal = combinedMatch?.total ?? null;
  const hasReadableVendor = Boolean(normalizeVendorName(parsedInvoice.vendorName).name);

  if (!purchaseOrder) {
    if (hasReadableVendor && candidates.length === 0) {
      addCheck(
        checks,
        'Vendor',
        'fail',
        `No Purchase Order vendor matched extracted invoice vendor "${parsedInvoice.vendorName}".`,
      );
    }

    addCheck(checks, 'Purchase Order', 'fail', 'No unique Purchase Order match was found.');
    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder: null,
      purchaseOrders: [],
      candidates,
      parsedInvoice,
      checks,
      canAutoProceed: false,
      actionsTaken,
      actionsPending,
    };
  }

  const poVendor = getRelationLabel(purchaseOrder.partner_id);
  const vendorMatch = computeVendorScore(parsedInvoice.vendorName, poVendor, parsedInvoice.filenameVendorHint);
  const vendorMatches = !normalizeVendorName(parsedInvoice.vendorName).name || vendorMatch.score > 0;
  addCheck(
    checks,
    'PO Match Score',
    combinedMatch ? 'pass' : bestCandidate && bestCandidate.score >= AUTO_MATCH_THRESHOLD ? 'pass' : bestCandidate ? 'warn' : 'info',
    combinedMatch
      ? `${matchedPurchaseOrders.map((order) => order.name).join(' + ')} combined total ${combinedTotal} matched invoice total ${parsedInvoice.grandTotal}.`
      : bestCandidate
      ? `${purchaseOrder.name} scored ${bestCandidate.score}/100 from extracted vendor, date, amount, and item count.`
      : overridePurchaseOrder
        ? `${purchaseOrder.name} was selected from the manual override.`
        : `${purchaseOrder.name} was selected from the invoice order number.`,
  );

  if (!input.onlyUnbilledPurchaseOrders && !isSchedulerEligiblePurchaseOrder(purchaseOrder)) {
    addCheck(
      checks,
      'Scheduler Eligibility',
      'warn',
      `${purchaseOrder.name} is not scheduler-eligible because ${describeSchedulerEligibility(purchaseOrder)}. The scheduler will skip this PDF instead of using a weaker PO.`,
    );
  }

  addCheck(
    checks,
    'Vendor',
    vendorMatches ? 'pass' : 'fail',
    parsedInvoice.vendorName
      ? `Invoice vendor "${parsedInvoice.vendorName}" compared with PO vendor "${poVendor}".`
      : `Invoice vendor was not readable; PO vendor is "${poVendor}".`,
  );

  if (!vendorMatches) {
    actionsPending.push('Stopped because the extracted invoice vendor did not match the Purchase Order vendor.');

    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder: null,
      purchaseOrders: [],
      candidates,
      parsedInvoice,
      checks,
      canAutoProceed: false,
      actionsTaken,
      actionsPending,
    };
  }

  const existingProcessed = (await getPoBillProcessedDocumentsByAttachmentIds([attachment.id]))[attachment.id] || null;
  const processedEvidence = existingProcessed
    ? await verifyPoBillProcessedEvidence(client, {
        ...attachment,
        documentId: existingProcessed.documentId || null,
        folderName: existingProcessed.folderName || null,
        companyName: existingProcessed.companyName || null,
        poBillStatus: existingProcessed.status,
        poBillProcessedAt: existingProcessed.processedAt || null,
        poBillPurchaseOrderId: existingProcessed.purchaseOrderId || null,
        poBillPurchaseOrderName: existingProcessed.purchaseOrderName || null,
        poBillVendorBillId: existingProcessed.vendorBillId || null,
        poBillVendorBillName: existingProcessed.vendorBillName || null,
        poBillAttemptCount: existingProcessed.attemptCount ?? null,
        poBillSummary: existingProcessed.summary || null,
      })
    : null;
  addCheck(
    checks,
    'Processed Status',
    existingProcessed ? processedEvidence?.valid ? 'warn' : 'info' : 'pass',
    existingProcessed
      ? processedEvidence?.valid
        ? `This PDF was already processed${existingProcessed.vendorBillName ? ` as vendor bill ${existingProcessed.vendorBillName}` : ''}${existingProcessed.processedAt ? ` on ${existingProcessed.processedAt}` : ''}; Odoo vendor bill and chatter evidence were verified.`
        : `Local marker says this PDF was processed${existingProcessed.processedAt ? ` on ${existingProcessed.processedAt}` : ''}, but Odoo evidence is incomplete: ${processedEvidence?.reason || 'unknown verification issue'}. Auto mode may repeat the bill creation step.`
      : 'This PDF has not been marked processed by PO bill automation.',
  );

  if (existingProcessed && processedEvidence?.valid && input.mode === 'auto') {
    const documentValidation = await markSourceDocumentValidated(client, attachment);
    if (documentValidation.marked) {
      actionsTaken.push(documentValidation.message);
      addCheck(checks, 'Documents', 'pass', documentValidation.message);
    } else {
      actionsPending.push(documentValidation.message);
      addCheck(checks, 'Documents', 'warn', documentValidation.message);
    }
    actionsPending.push('Auto mode stopped because this PDF is already marked as processed and Odoo evidence was verified.');
    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder,
      purchaseOrders: matchedPurchaseOrders,
      candidates,
      parsedInvoice,
      checks,
      canAutoProceed: false,
      actionsTaken,
      actionsPending,
    };
  }
  if (existingProcessed && !processedEvidence?.valid && input.mode === 'auto') {
    actionsTaken.push('Local processed marker was ignored because Odoo vendor bill/chatter evidence could not be verified.');
  }

  if (input.mode === 'auto') {
    const recovered = await repairAlreadyMatchedPoBillDocument(client, {
      attachment,
      purchaseOrders: matchedPurchaseOrders,
      parsedInvoice,
      invoiceFingerprint,
      mode: input.mode,
    });
    if (recovered) {
      addCheck(checks, 'Existing Odoo Match', 'pass', recovered.summary);
      if (recovered.documentValidation.marked) {
        actionsTaken.push(recovered.documentValidation.message);
        addCheck(checks, 'Documents', 'pass', recovered.documentValidation.message);
      } else {
        actionsPending.push(recovered.documentValidation.message);
        addCheck(checks, 'Documents', 'warn', recovered.documentValidation.message);
      }
      if (recovered.chatterMessage) {
        actionsTaken.push(`Repaired PO chatter evidence for existing vendor bill ${recovered.vendorBill.name || recovered.vendorBill.id}.`);
      }
      actionsTaken.push(`Repaired the processed signature for ${attachment.name}; future scheduler runs will skip this document.`);
      addCheck(checks, 'Processed Signature', 'pass', 'Existing PO/vendor-bill evidence was recorded locally to prevent duplicate processing.');
      actionsPending.push('Auto mode stopped because this document was already matched and billed in Odoo.');
      return {
        mode: input.mode,
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        purchaseOrder,
        purchaseOrders: matchedPurchaseOrders,
        candidates,
        parsedInvoice,
        checks,
        canAutoProceed: false,
        actionsTaken,
        actionsPending,
      };
    }
  }

  const fingerprintMatches = await getPoBillProcessedDocumentsByInvoiceFingerprint(invoiceFingerprint);
  for (const match of fingerprintMatches) {
    if (match.attachmentId === attachment.id || !['processed', 'processed_with_warnings'].includes(match.status)) {
      continue;
    }

    const fingerprintEvidence = await verifyPoBillProcessedEvidence(client, {
      ...attachment,
      id: match.attachmentId,
      documentId: match.documentId || null,
      folderName: match.folderName || null,
      companyName: match.companyName || null,
      poBillStatus: match.status,
      poBillProcessedAt: match.processedAt || null,
      poBillPurchaseOrderId: match.purchaseOrderId || null,
      poBillPurchaseOrderName: match.purchaseOrderName || null,
      poBillVendorBillId: match.vendorBillId || null,
      poBillVendorBillName: match.vendorBillName || null,
      poBillAttemptCount: match.attemptCount ?? null,
      poBillSummary: match.summary || null,
    });

    if (!fingerprintEvidence.valid) {
      continue;
    }

    addCheck(
      checks,
      'Invoice Fingerprint',
      'warn',
      `This invoice fingerprint was already processed from attachment ${match.attachmentId}${match.vendorBillName ? ` as vendor bill ${match.vendorBillName}` : ''}; Odoo evidence was verified.`,
    );

    if (input.mode === 'auto') {
      await upsertPoBillProcessedDocument({
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        documentId: attachment.documentId || null,
        folderName: attachment.folderName || null,
        companyName: attachment.companyName || null,
        purchaseOrderId: match.purchaseOrderId || purchaseOrder.id,
        purchaseOrderName: match.purchaseOrderName || purchaseOrder.name,
        vendorBillId: match.vendorBillId || null,
        vendorBillName: match.vendorBillName || null,
        invoiceFingerprint,
        invoiceNumber: parsedInvoice.invoiceNumber || null,
        invoiceVendor: parsedInvoice.vendorName || null,
        invoiceTotal: parsedInvoice.grandTotal ?? null,
        status: 'processed_with_warnings',
        mode: input.mode,
        summary: `Duplicate invoice fingerprint matched attachment ${match.attachmentId}; reused verified vendor bill evidence instead of creating another bill.`,
      });
      actionsTaken.push(`Linked duplicate invoice fingerprint to existing vendor bill ${match.vendorBillName || match.vendorBillId || 'evidence'}.`);
    }

    actionsPending.push('Stopped because this invoice fingerprint already has verified Odoo vendor bill evidence.');
    return {
      mode: input.mode,
      attachmentId: attachment.id,
      attachmentName: attachment.name,
      purchaseOrder,
      purchaseOrders: matchedPurchaseOrders,
      candidates,
      parsedInvoice,
      checks,
      canAutoProceed: false,
      actionsTaken,
      actionsPending,
    };
  }

  const poLines = (await Promise.all(matchedPurchaseOrders.map((order) => getPurchaseOrderLines(client, order.id)))).flat();

  const poStateReady = matchedPurchaseOrders.every((order) => isConfirmedPurchaseOrderState(order.state));
  const poStateApprovable = matchedPurchaseOrders.every((order) =>
    isConfirmedPurchaseOrderState(order.state) || isApprovablePurchaseOrderState(order.state),
  ) && matchedPurchaseOrders.some((order) => isApprovablePurchaseOrderState(order.state));
  addCheck(
    checks,
    'PO State',
    poStateReady ? 'pass' : poStateApprovable ? 'warn' : 'fail',
    poStateReady
      ? `PO state is Purchase Order for ${matchedPurchaseOrders.map((order) => order.name).join(', ')}. Auto mode can proceed.`
      : poStateApprovable
        ? `One or more matched POs are To Approve. Auto mode will approve them before uploading the matched PDF.`
        : `PO state is "${purchaseOrder.state || 'unknown'}". Auto mode requires Purchase Order or To Approve.`,
  );

  const totalScore = computeTotalScore(
    parsedInvoice.grandTotal,
    combinedTotal ?? purchaseOrder.amount_total,
    parsedInvoice.untaxedTotal,
    matchedPurchaseOrders.length === 1 ? purchaseOrder.amount_untaxed : null,
  );
  const totalMatches = totalScore.score >= 35;
  addCheck(
    checks,
    'Total',
    totalMatches ? 'pass' : 'fail',
    totalMatches
      ? totalScore.reason
      : parsedInvoice.grandTotal === null
      ? `Invoice total was not readable. PO total is ${(combinedTotal ?? purchaseOrder.amount_total) ?? 'unknown'}.`
      : `Invoice total ${parsedInvoice.grandTotal} compared with PO total ${(combinedTotal ?? purchaseOrder.amount_total) ?? 'unknown'}.`,
  );

  const itemCountMatches = parsedInvoice.itemCount === 0 ? false : parsedInvoice.itemCount === poLines.length;
  const hasValidInvoiceItem = parsedInvoice.items.some((item) =>
    Boolean(item.description?.trim()) &&
    (typeof item.amount === 'number' || (typeof item.quantity === 'number' && typeof item.unitPrice === 'number')),
  );
  const hasUnreliableAiOutput = parsedInvoice.logs.some((log) =>
    /converted from markdown\/prose|malformed json|parsed from non-json ai response/i.test(log),
  );
  const handwritingReviewRequired = Boolean(parsedInvoice.handwriting?.reviewRequired);
  const extractionQualityPassed = hasValidInvoiceItem && !hasUnreliableAiOutput && !handwritingReviewRequired;
  addCheck(
    checks,
    'Extraction Quality',
    extractionQualityPassed ? 'pass' : 'fail',
    extractionQualityPassed
      ? 'Receipt contains at least one usable line item and AI output is structurally reliable.'
      : hasUnreliableAiOutput
        ? 'AI output was malformed or converted from prose; manual review is required.'
        : handwritingReviewRequired
          ? `Handwriting confidence is ${Math.round((parsedInvoice.handwriting?.confidence || 0) * 100)}%; manual review is required before auto-processing.`
        : 'No usable invoice line item was extracted; manual review is required.',
  );
  addCheck(
    checks,
    'Item Count',
    itemCountMatches ? 'pass' : parsedInvoice.itemCount === 0 ? 'warn' : 'fail',
    `Invoice has ${parsedInvoice.itemCount} readable item(s); PO has ${poLines.length} item(s).`,
  );

  const coreMatchScore = bestCandidate
    ? bestCandidate.vendorScore + (combinedMatch ? 40 : bestCandidate.totalScore) + bestCandidate.dateScore + bestCandidate.receiptScore
    : (vendorMatches ? 40 : 0) + (totalMatches ? 40 : 0) + 0;
  const coreMatchPassed = coreMatchScore >= CORE_MATCH_THRESHOLD;
  addCheck(
    checks,
    'Core Match',
    coreMatchPassed ? 'pass' : 'fail',
    `Vendor, total due, date, and receipt evidence scored ${coreMatchScore}/103. Auto mode requires ${CORE_MATCH_THRESHOLD}/103 or better.`,
  );

  const canAutoProceed =
    (poStateReady || poStateApprovable) &&
    totalMatches &&
    vendorMatches &&
    extractionQualityPassed &&
    coreMatchPassed &&
    (Boolean(overridePurchaseOrder) ||
      Boolean(orderNumberPurchaseOrder) ||
      Boolean(combinedMatch) ||
      Boolean(bestCandidate && bestCandidate.score >= AUTO_MATCH_THRESHOLD));

  if (input.mode === 'review') {
    actionsPending.push('Review mode stopped before attachment upload, bill creation, receipt validation, and activity creation.');
  } else if (canAutoProceed) {
    const lockAcquired = await acquirePoBillProcessingLock(attachment.id);
    if (!lockAcquired) {
      addCheck(checks, 'Processing Lock', 'warn', 'Another PO bill automation run is already processing this attachment.');
      actionsPending.push('Auto mode stopped because this attachment is already being processed.');
      return {
        mode: input.mode,
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        purchaseOrder,
        purchaseOrders: matchedPurchaseOrders,
        candidates,
        parsedInvoice,
        checks,
        canAutoProceed: false,
        actionsTaken,
        actionsPending,
      };
    }

    try {
    for (const order of matchedPurchaseOrders) {
      await client.postModelChatterMessage('purchase.order', order.id, parsedInvoice.pinNote);
    }
    actionsTaken.push(`Logged ${parsedInvoice.pinNote} note on ${matchedPurchaseOrders.map((order) => order.name).join(', ')}.`);

    if (poStateApprovable) {
      try {
        const approvedOrders = [];
        for (const order of matchedPurchaseOrders) {
          if (isApprovablePurchaseOrderState(order.state)) {
            const originalState = order.state || 'unknown';
            const approved = await approvePurchaseOrderForBilling(client, order);
            approvedOrders.push(approved);
            actionsTaken.push(`Approved ${approved.name} from "${originalState}" to "${approved.state}".`);
          } else {
            approvedOrders.push(order);
          }
        }
        matchedPurchaseOrders = approvedOrders;
        purchaseOrder = matchedPurchaseOrders[0];
        addCheck(checks, 'PO Approval', 'pass', `PO was approved before PDF upload; waiting ${PO_UPLOAD_AFTER_APPROVAL_DELAY_MS / 1000} seconds for Odoo to settle.`);
        await wait(PO_UPLOAD_AFTER_APPROVAL_DELAY_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown PO approval error.';
        addCheck(checks, 'PO Approval', 'fail', message);
        actionsPending.push(`PO approval failed: ${message}`);
        return {
          mode: input.mode,
          attachmentId: attachment.id,
          attachmentName: attachment.name,
          purchaseOrder,
          purchaseOrders: matchedPurchaseOrders,
          candidates,
          parsedInvoice,
          checks,
          canAutoProceed: false,
          actionsTaken,
          actionsPending,
        };
      }
    }

    let uploadAttachmentId: number | null = null;
    try {
      uploadAttachmentId = await createUploadAttachment(client, attachment);
      actionsTaken.push(`Uploaded ${attachment.name} through the PO bill upload flow as attachment ${uploadAttachmentId}.`);
      addCheck(checks, 'Bill Upload', 'pass', `PDF was passed to Odoo's Purchase Order bill upload flow.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown PDF upload error.';
      addCheck(checks, 'Bill Upload', 'fail', message);
      actionsPending.push(`PDF upload failed: ${message}`);
    }

    let vendorBill: VendorBillSummary | null = null;
    try {
      if (!uploadAttachmentId) {
        throw new Error('Cannot create a vendor bill because the upload attachment was not created.');
      }

      vendorBill = await createVendorBillFromPurchaseOrders(client, matchedPurchaseOrders, parsedInvoice, uploadAttachmentId);
      actionsTaken.push(
        `Odoo created vendor bill ${vendorBill.name || vendorBill.id}${vendorBill.ref ? ` with reference ${vendorBill.ref}` : ''}.`,
      );
      addCheck(
        checks,
        'Vendor Bill',
        'pass',
        `Vendor bill ${vendorBill.name || vendorBill.id} was created by Odoo's upload action and linked to ${matchedPurchaseOrders.map((order) => order.name).join(', ')}.`,
      );

      if (vendorBill && vendorBill.state !== 'posted') {
        const confirmed = await confirmVendorBill(client, vendorBill.id);
        if (confirmed && confirmed.state === 'posted') {
          vendorBill = confirmed;
          actionsTaken.push(`Confirmed vendor bill ${vendorBill.name || vendorBill.id} (posted state in Odoo).`);
          addCheck(
            checks,
            'Vendor Bill Confirmation',
            'pass',
            `Vendor bill ${vendorBill.name || vendorBill.id} was posted/confirmed in Odoo.`,
          );
        } else {
          actionsTaken.push(`Vendor bill ${vendorBill.name || vendorBill.id} was created in draft state.`);
          addCheck(
            checks,
            'Vendor Bill Confirmation',
            'info',
            `Vendor bill ${vendorBill.name || vendorBill.id} remains in draft state in Odoo.`,
          );
        }
      }

      if (vendorBill && vendorBill.state === 'posted') {
        const paymentResult = await registerPaymentForVendorBill(
          client,
          vendorBill,
          parsedInvoice.pinNote,
          parsedInvoice.invoiceDate,
        );
        if (paymentResult.success) {
          actionsTaken.push(paymentResult.message);
          addCheck(checks, 'Payment Registration', 'pass', paymentResult.message);
        } else {
          actionsPending.push(paymentResult.message);
          addCheck(checks, 'Payment Registration', 'warn', paymentResult.message);
        }
      }
      const evidenceMessageIds = [];
      for (const order of matchedPurchaseOrders) {
        evidenceMessageIds.push(await postVendorBillCreatedEvidence(client, {
          purchaseOrder: order,
          attachment,
          uploadAttachmentId,
          vendorBill,
        }));
      }
      actionsTaken.push(`Logged vendor bill evidence on ${matchedPurchaseOrders.map((order) => order.name).join(', ')} chatter as message(s) ${evidenceMessageIds.join(', ')}.`);
      addCheck(
        checks,
        'Odoo Evidence',
        'pass',
        `PO chatter now records attachment ${attachment.id}, document ${attachment.documentId || 'unknown'}, and vendor bill ${vendorBill.name || vendorBill.id}.`,
      );
      const documentValidation = await markSourceDocumentValidated(client, attachment);
      if (documentValidation.marked) {
        actionsTaken.push(documentValidation.message);
        addCheck(checks, 'Documents', 'pass', documentValidation.message);
      } else {
        actionsPending.push(documentValidation.message);
        addCheck(checks, 'Documents', 'warn', documentValidation.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown vendor bill creation error.';
      addCheck(checks, 'Vendor Bill', 'fail', message);
      actionsPending.push(`Vendor bill creation failed: ${message}`);
    }

    try {
      const receiptResults = await Promise.all(matchedPurchaseOrders.map((order) => validatePurchaseOrderReceipts(client, order)));
      const receiptResult = {
        validated: receiptResults.flatMap((result) => result.validated),
        skipped: receiptResults.flatMap((result) => result.skipped),
        pending: receiptResults.flatMap((result) => result.pending),
      };
      if (receiptResult.validated.length > 0) {
        actionsTaken.push(
          `Validated receipt(s): ${receiptResult.validated.map((picking) => picking.name || picking.id).join(', ')}.`,
        );
      }
      if (receiptResult.skipped.length > 0) {
        actionsTaken.push(
          `Skipped already closed receipt(s): ${receiptResult.skipped.map((picking) => picking.name || picking.id).join(', ')}.`,
        );
      }
      receiptResult.pending.forEach((message) => actionsPending.push(message));
      addCheck(
        checks,
        'Receipts',
        receiptResult.pending.length === 0 ? 'pass' : 'warn',
        receiptResult.pending.length === 0
          ? 'Linked receipts are validated or already closed.'
          : receiptResult.pending.join(' '),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown receipt validation error.';
      addCheck(checks, 'Receipts', 'fail', message);
      actionsPending.push(`Receipt validation failed: ${message}`);
    }

    try {
      const activityId = await createPurchaseOrderActivity(client, purchaseOrder, 'PO bill automation completed', [
        `Invoice PDF: ${attachment.name}`,
        `POs: ${matchedPurchaseOrders.map((order) => order.name).join(', ')}`,
        `Vendor bill: ${vendorBill?.name || vendorBill?.id || 'not created'}`,
        actionsPending.length > 0 ? `Follow-up: ${actionsPending.join(' ')}` : 'No follow-up pending.',
      ]);
      actionsTaken.push(`Created PO activity ${activityId} for automation follow-up.`);
      addCheck(checks, 'Activity', 'pass', `Activity ${activityId} was created on ${purchaseOrder.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown activity creation error.';
      addCheck(checks, 'Activity', 'fail', message);
      actionsPending.push(`Activity creation failed: ${message}`);
    }

    if (vendorBill) {
      const verification = await verifyPoBillProcessedEvidence(client, {
        ...attachment,
        poBillPurchaseOrderId: purchaseOrder.id,
        poBillPurchaseOrderName: purchaseOrder.name,
        poBillVendorBillId: vendorBill.id,
        poBillVendorBillName: vendorBill.name || String(vendorBill.id),
      });
      if (!verification.valid) {
        actionsPending.push(`Processed marker not saved: ${verification.reason}`);
        addCheck(checks, 'Processed Marker', 'fail', verification.reason);
      } else {
      const processedStatus = actionsPending.length > 0 ? 'processed_with_warnings' : 'processed';
      await upsertPoBillProcessedDocument({
        attachmentId: attachment.id,
        attachmentName: attachment.name,
        documentId: attachment.documentId || null,
        folderName: attachment.folderName || null,
        companyName: attachment.companyName || null,
        purchaseOrderId: purchaseOrder.id,
        purchaseOrderName: matchedPurchaseOrders.map((order) => order.name).join(', '),
        vendorBillId: vendorBill.id,
        vendorBillName: vendorBill.name || String(vendorBill.id),
        invoiceFingerprint,
        invoiceNumber: parsedInvoice.invoiceNumber || null,
        invoiceVendor: parsedInvoice.vendorName || null,
        invoiceTotal: parsedInvoice.grandTotal ?? null,
        status: processedStatus,
        mode: input.mode,
        summary: actionsPending.length > 0 ? actionsPending.join(' ') : `Vendor bill created successfully for ${matchedPurchaseOrders.map((order) => order.name).join(', ')}.`,
      });
      actionsTaken.push(`Marked ${attachment.name} as ${processedStatus.replace(/_/g, ' ')}.`);
      addCheck(checks, 'Processed Marker', 'pass', 'The PDF is now recorded locally after Odoo vendor bill and chatter evidence were verified.');
      }
    }
    } finally {
      await releasePoBillProcessingLock(attachment.id).catch(() => undefined);
    }
  } else {
    actionsPending.push('Auto mode stopped because one or more gates failed.');
    const processedByPo: Record<number, PoBillProcessedDocumentEntry> = await getLatestPoBillProcessedDocumentsByPurchaseOrderIds([purchaseOrder.id]).catch(() => ({}));
    const existingProcessed = processedByPo[purchaseOrder.id];
    const hasProcessed = Boolean(existingProcessed && ['processed', 'processed_with_warnings'].includes(existingProcessed.status));
    const isEligibleForReviewActivity = isSchedulerEligiblePurchaseOrder(purchaseOrder, hasProcessed);

    if (isEligibleForReviewActivity) {
      try {
        const activityId = await createPurchaseOrderActivity(client, purchaseOrder, 'Review PO bill automation', [
          `Invoice PDF: ${attachment.name}`,
          `POs: ${matchedPurchaseOrders.map((order) => order.name).join(', ')}`,
          `Failed checks: ${checks
            .filter((check) => check.status === 'fail')
            .map((check) => `${check.label}: ${check.detail}`)
            .join(' | ') || 'No failed checks were recorded.'}`,
        ]);
        actionsTaken.push(`Created PO review activity ${activityId}.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown activity creation error.';
        actionsPending.push(`Review activity creation failed: ${message}`);
      }
    } else {
      actionsTaken.push(`Skipped review activity creation on ${purchaseOrder.name} because a match was already found and vendor bill attached or PO is not eligible.`);
    }
  }

  return {
    mode: input.mode,
    attachmentId: attachment.id,
    attachmentName: attachment.name,
    purchaseOrder,
    purchaseOrders: matchedPurchaseOrders,
    candidates,
    parsedInvoice,
    checks,
    canAutoProceed,
    actionsTaken,
    actionsPending,
  };
}
