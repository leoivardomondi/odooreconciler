import PDFDocument from 'pdfkit';
import {
  deleteShopFloorSharedCachePrefix,
  getActiveBoardIntakesInRange,
  getApprovedAuthUsers,
  getBoardIntakeLoggingReport,
  getSettings,
  getShopFloorSharedCache,
  saveShopFloorSharedCache,
  type BoardIntakeQueueEntry,
} from '../models/repositories';
import { OdooClient, isSchedulerRunActive, runWithOdooPriority } from './odooClient';
import { sendMailWithConfig } from './mailTransport';
import { logEvent } from './logService';
import { findExcludedPoBillVendor, PO_BILL_SUPPORTED_MIMETYPES } from './poBillAutomationService';
import { isBoardProductName } from './boardProductClassifier';
import { isMatchingBoardProduct, isMatchingClient } from './boardLogStockMatcher';
import { env } from '../utils/env';
import { clampShopFloorReportingDate, isExcludedFromBoardLogs, isExcludedFromOperators } from '../utils/shopFloorReporting';
import { resolveFromProjectRoot } from '../utils/paths';
import { extractSoNameFromOrigin } from '../utils/helpers';
import { completedAttendanceCoversWorkday, classifyAttendanceRecords, type AttendanceRecord } from '../utils/attendanceReconciliation';
import { queryAll } from '../models/db';
import { drawPdfPieChart, PIE_CHART_PALETTE, type PdfPieSlice } from '../utils/pdfPieChart';

const OPERATIONS_DEPARTMENT_NAME = 'Operations';
const RECIPIENT_NAMES = ['dbadmin', 'charles', 'raphael'];
const CLOCK_SKEW_GRACE_MS = 2 * 60 * 1000;

function dateOnly(date: Date) { return date.toISOString().slice(0, 10); }
function productName(value: unknown) { return Array.isArray(value) ? String(value[1] || '') : String(value || ''); }

export function parseOdooDateTime(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  // Odoo JSON-2 returns naive UTC datetimes such as "2026-08-24 16:57:04".
  const normalized = raw.includes('T')
    ? (raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}Z`)
    : `${raw.replace(' ', 'T')}Z`;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function parseAppDateTime(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.includes('T') && (raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw))) {
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  // App DB timestamps (board_intake_queue.created_at) are stored in Africa/Nairobi (+03:00).
  const normalized = raw.includes('T') ? `${raw}+03:00` : `${raw.replace(' ', 'T')}+03:00`;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function formatNairobiDateTimeFromDate(date: Date | null) {
  if (!date || !Number.isFinite(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

function nairobiDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return formatNairobiDateTimeFromDate(parseOdooDateTime(value));
}

function nairobiAppDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return formatNairobiDateTimeFromDate(parseAppDateTime(value));
}

function isSundayCheckIn(value: string | null) {
  if (!value) return false;
  const date = parseOdooDateTime(value);
  if (!date) return false;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', weekday: 'short' }).formatToParts(date);
  return parts.find((part) => part.type === 'weekday')?.value === 'Sun';
}

function isOffHoursCheckIn(value: string | null) {
  if (!value) return false;
  const date = parseOdooDateTime(value);
  if (!date) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  if (weekday === 'Sun') return true;
  if (weekday === 'Sat' && hour >= 13) return true;
  return hour >= 17;
}

function isOvernightRecord(entry: AttendanceRecord) {
  if (!entry.check_in || !entry.check_out) return false;
  return nairobiDateKey(entry.check_in) !== nairobiDateKey(entry.check_out);
}

function isOvertimeOrOffHoursRecord(entry: AttendanceRecord) {
  return isSundayCheckIn(entry.check_in) || isOffHoursCheckIn(entry.check_in) || isOvernightRecord(entry);
}

function isLateCheckIn(value: string | null) {
  if (!value) return false;
  const date = parseOdooDateTime(value);
  if (!date) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return get('hour') > 8 || (get('hour') === 8 && get('minute') > 20);
}

function nairobiDateKey(value: string | Date | null | undefined) {
  if (!value) return '';
  const date = parseOdooDateTime(value);
  return date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '';
}

function eatWeekdayIndex(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

function previousDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateOnly(date);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
}

function defaultReportWindow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const today = nairobiDateKey(now);
  const daysSinceWednesday = (weekday - 3 + 7) % 7;

  if (weekday === 3) {
    return { start: addDays(today, -7), end: previousDate(today) };
  }

  const end = Number(get('hour')) >= 18 ? today : previousDate(today);
  return { start: addDays(today, -daysSinceWednesday), end };
}

export function isOperationsDept(dept: unknown): boolean {
  if (!dept) return false;
  const raw = Array.isArray(dept) ? String(dept[1] || '') : String(dept);
  const leaf = raw.includes('/') ? raw.split('/').pop()?.trim() : raw.trim();
  return leaf?.toLowerCase() === 'operations';
}

export function isSharonOrCandyName(name: string | null | undefined): boolean {
  return /\b(sharon|candy)\b/i.test(String(name || ''));
}

// ─── Monday–Saturday PO vs Finance Documents Reconciliation ──────────

export interface MonSatWeekWindow {
  monday: string;
  saturday: string;
  label: string;
  isPrimary: boolean;
}

export interface MonSatPoVsDocsWeekRow {
  monday: string;
  saturday: string;
  label: string;
  isPrimary: boolean;
  posTotal: number;
  posConfirmed: number;
  posDraftOrCancel: number;
  posBilledInOdoo: number;
  posUnbilledInOdoo: number;
  docsTotal: number;
  docsEligibleInvoices: number;
  docsValidated: number;
  docsDeliveryNotes: number;
  docsExcludedVendor: number;
  netGap: number; // docsEligibleInvoices - posConfirmed (negative = missing)
  minMissingReceipts: number; // max(0, posConfirmed - docsEligibleInvoices)
}

export interface PoVsFinanceDocsReport {
  primaryMonday: string;
  primarySaturday: string;
  rangeStartMonday: string;
  rangeEndSaturday: string;
  weeks: MonSatPoVsDocsWeekRow[];
  primaryWeek: MonSatPoVsDocsWeekRow;
  totals: {
    posTotal: number;
    posConfirmed: number;
    posDraftOrCancel: number;
    posBilledInOdoo: number;
    posUnbilledInOdoo: number;
    docsTotal: number;
    docsEligibleInvoices: number;
    docsValidated: number;
    docsDeliveryNotes: number;
    docsExcludedVendor: number;
    netGap: number;
    minMissingReceipts: number;
  };
  unfiledNoFolderDocsPrimaryWeek: number;
  unfiledNoFolderDocsInRange: number;
  fetchError?: string | null;
}

/**
 * Computes Monday–Saturday reporting weeks anchored to the latest completed
 * Saturday on or before `reportEnd`.
 * Note: Intentionally uses Monday–Saturday (6 working days) which is different
 * from the main Wednesday–Tuesday shop-floor report period.
 */
export function getMondayToSaturdayPoWindows(
  reportStart: string,
  reportEnd: string,
  defaultRollingWeeks = 4,
): {
  primaryMonday: string;
  primarySaturday: string;
  windows: MonSatWeekWindow[];
} {
  const endWeekday = eatWeekdayIndex(reportEnd); // 0=Sun..6=Sat
  const daysSinceSat = (endWeekday - 6 + 7) % 7;
  const primarySaturday = addDays(reportEnd, -daysSinceSat);
  const primaryMonday = addDays(primarySaturday, -5);

  const startMs = new Date(`${reportStart}T12:00:00Z`).getTime();
  const endMs = new Date(`${reportEnd}T12:00:00Z`).getTime();
  const spanDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);

  const windows: MonSatWeekWindow[] = [];
  if (spanDays > 10) {
    // Multi-week custom scope: include Mon–Sat weeks covering the selected range (capped at 8 latest)
    const startWeekday = eatWeekdayIndex(reportStart);
    const daysSinceMon = (startWeekday - 1 + 7) % 7;
    let cursorMon = addDays(reportStart, -daysSinceMon);
    while (cursorMon <= primaryMonday) {
      const sat = addDays(cursorMon, 5);
      windows.push({
        monday: cursorMon,
        saturday: sat,
        label: `${cursorMon} to ${sat}`,
        isPrimary: cursorMon === primaryMonday,
      });
      cursorMon = addDays(cursorMon, 7);
    }
    const capped = windows.slice(-8);
    return { primaryMonday, primarySaturday, windows: capped };
  }

  const count = Math.max(1, defaultRollingWeeks);
  for (let i = count - 1; i >= 0; i -= 1) {
    const mon = addDays(primaryMonday, -7 * i);
    const sat = addDays(mon, 5);
    windows.push({
      monday: mon,
      saturday: sat,
      label: `${mon} to ${sat}`,
      isPrimary: i === 0,
    });
  }

  return { primaryMonday, primarySaturday, windows };
}

function emptyMonSatRow(w: MonSatWeekWindow): MonSatPoVsDocsWeekRow {
  return {
    monday: w.monday,
    saturday: w.saturday,
    label: w.label,
    isPrimary: w.isPrimary,
    posTotal: 0,
    posConfirmed: 0,
    posDraftOrCancel: 0,
    posBilledInOdoo: 0,
    posUnbilledInOdoo: 0,
    docsTotal: 0,
    docsEligibleInvoices: 0,
    docsValidated: 0,
    docsDeliveryNotes: 0,
    docsExcludedVendor: 0,
    netGap: 0,
    minMissingReceipts: 0,
  };
}

export function aggregateMonSatPoVsFinanceDocs(input: {
  windows: MonSatWeekWindow[];
  purchaseOrders: Array<{
    name?: string | null;
    state?: string | null;
    create_date?: string | false | null;
    date_order?: string | false | null;
    partner_id?: [number, string] | false | null;
    invoice_status?: string | false | null;
    invoice_count?: number | null;
  }>;
  financeDocuments: Array<{
    name?: string | null;
    create_date?: string | false | null;
    tag_ids?: number[] | false | null;
  }>;
  validatedTagIds: Set<number>;
  deliveryNoteTagIds: Set<number>;
  unfiledNoFolderDates?: string[];
}): PoVsFinanceDocsReport {
  const rows = input.windows.map(emptyMonSatRow);
  const findRow = (eatDate: string): MonSatPoVsDocsWeekRow | null => {
    if (!eatDate) return null;
    if (eatWeekdayIndex(eatDate) === 0) return null; // Strictly Monday–Saturday (exclude Sunday)
    return rows.find((r) => eatDate >= r.monday && eatDate <= r.saturday) || null;
  };

  for (const po of input.purchaseOrders) {
    if (String(po.name || '').toUpperCase().startsWith('VA/')) continue;
    const eatDate = nairobiDateKey((po.create_date || po.date_order || null) as string | null);
    const row = findRow(eatDate);
    if (!row) continue;

    row.posTotal += 1;
    const isConfirmed = po.state === 'purchase' || po.state === 'done';
    if (!isConfirmed) {
      row.posDraftOrCancel += 1;
      continue;
    }

    const vendorName = Array.isArray(po.partner_id) ? po.partner_id[1] : '';
    if (findExcludedPoBillVendor({ vendorName })) {
      continue;
    }

    row.posConfirmed += 1;
    const isBilled = Number(po.invoice_count || 0) > 0 || po.invoice_status === 'invoiced';
    if (isBilled) {
      row.posBilledInOdoo += 1;
    } else {
      row.posUnbilledInOdoo += 1;
    }
  }

  for (const doc of input.financeDocuments) {
    const eatDate = nairobiDateKey((doc.create_date || null) as string | null);
    const row = findRow(eatDate);
    if (!row) continue;

    row.docsTotal += 1;
    const tagList = Array.isArray(doc.tag_ids) ? doc.tag_ids.map(Number) : [];
    const isValidated = tagList.some((id) => input.validatedTagIds.has(id));
    const isDeliveryNote = tagList.some((id) => input.deliveryNoteTagIds.has(id))
      || /delivery\s*note|d\/n/i.test(String(doc.name || ''));
    const isExcluded = Boolean(findExcludedPoBillVendor({ attachmentName: doc.name || '' }));

    if (isValidated) row.docsValidated += 1;
    if (isDeliveryNote) row.docsDeliveryNotes += 1;
    if (isExcluded) row.docsExcludedVendor += 1;
    if (!isDeliveryNote && !isExcluded) {
      row.docsEligibleInvoices += 1;
    }
  }

  for (const row of rows) {
    row.netGap = row.docsEligibleInvoices - row.posConfirmed;
    row.minMissingReceipts = Math.max(0, row.posConfirmed - row.docsEligibleInvoices);
  }

  const primaryWeek = rows.find((r) => r.isPrimary) || rows[rows.length - 1];
  const totals = rows.reduce(
    (acc, r) => {
      acc.posTotal += r.posTotal;
      acc.posConfirmed += r.posConfirmed;
      acc.posDraftOrCancel += r.posDraftOrCancel;
      acc.posBilledInOdoo += r.posBilledInOdoo;
      acc.posUnbilledInOdoo += r.posUnbilledInOdoo;
      acc.docsTotal += r.docsTotal;
      acc.docsEligibleInvoices += r.docsEligibleInvoices;
      acc.docsValidated += r.docsValidated;
      acc.docsDeliveryNotes += r.docsDeliveryNotes;
      acc.docsExcludedVendor += r.docsExcludedVendor;
      return acc;
    },
    {
      posTotal: 0,
      posConfirmed: 0,
      posDraftOrCancel: 0,
      posBilledInOdoo: 0,
      posUnbilledInOdoo: 0,
      docsTotal: 0,
      docsEligibleInvoices: 0,
      docsValidated: 0,
      docsDeliveryNotes: 0,
      docsExcludedVendor: 0,
      netGap: 0,
      minMissingReceipts: 0,
    },
  );
  totals.netGap = totals.docsEligibleInvoices - totals.posConfirmed;
  totals.minMissingReceipts = Math.max(0, totals.posConfirmed - totals.docsEligibleInvoices);

  let unfiledPrimary = 0;
  let unfiledRange = 0;
  for (const dt of input.unfiledNoFolderDates || []) {
    if (!dt || eatWeekdayIndex(dt) === 0) continue;
    if (dt >= rows[0].monday && dt <= primaryWeek.saturday) {
      unfiledRange += 1;
      if (dt >= primaryWeek.monday && dt <= primaryWeek.saturday) {
        unfiledPrimary += 1;
      }
    }
  }

  return {
    primaryMonday: primaryWeek.monday,
    primarySaturday: primaryWeek.saturday,
    rangeStartMonday: rows[0].monday,
    rangeEndSaturday: primaryWeek.saturday,
    weeks: rows,
    primaryWeek,
    totals,
    unfiledNoFolderDocsPrimaryWeek: unfiledPrimary,
    unfiledNoFolderDocsInRange: unfiledRange,
    fetchError: null,
  };
}

async function fetchAllOdooPaginated<T>(
  client: OdooClient,
  model: string,
  domain: unknown[],
  fields: string[],
  order: string,
  maxRecords = 2000,
): Promise<T[]> {
  const all: T[] = [];
  const pageSize = 500;
  let offset = 0;
  while (all.length < maxRecords) {
    const batch = await client.searchReadRecords<T>(model, {
      domain,
      fields,
      limit: Math.min(pageSize, maxRecords - all.length),
      offset,
      order,
    });
    all.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function fetchMonSatPoVsFinanceDocsReport(
  client: OdooClient,
  companyId: number,
  reportStart: string,
  reportEnd: string,
): Promise<PoVsFinanceDocsReport> {
  const { primaryMonday, primarySaturday, windows } = getMondayToSaturdayPoWindows(reportStart, reportEnd, 4);
  const rangeStartMonday = windows[0].monday;
  const utcStart = `${previousDate(rangeStartMonday)} 21:00:00`;
  const utcEnd = `${primarySaturday} 20:59:59`;

  try {
    const [purchaseOrders, docFields, tags] = await Promise.all([
      fetchAllOdooPaginated<{
        id: number;
        name: string;
        state: string;
        date_order: string | false;
        create_date: string | false;
        partner_id: [number, string] | false;
        invoice_status: string | false;
        invoice_count: number;
      }>(
        client,
        'purchase.order',
        [
          ['company_id', '=', companyId],
          ['create_date', '>=', utcStart],
          ['create_date', '<=', utcEnd],
        ],
        ['id', 'name', 'state', 'date_order', 'create_date', 'partner_id', 'invoice_status', 'invoice_count'],
        'create_date asc, id asc',
      ),
      client.getModelFields('documents.document', [
        'id',
        'name',
        'folder_id',
        'workspace_id',
        'company_id',
        'mimetype',
        'type',
        'tag_ids',
        'create_date',
      ]).catch(() => []),
      client.searchReadRecords<{ id: number; name: string }>('documents.tag', {
        domain: [],
        fields: ['id', 'name'],
        limit: 100,
      }).catch(() => []),
    ]);

    const docFieldSet = new Set(docFields.map((f) => f.name));
    const folderField = docFieldSet.has('folder_id')
      ? 'folder_id'
      : docFieldSet.has('workspace_id')
        ? 'workspace_id'
        : null;

    const validatedTagIds = new Set(tags.filter((t) => t.name.trim().toLowerCase() === 'validated').map((t) => t.id));
    const deliveryNoteTagIds = new Set(tags.filter((t) => /delivery\s*note/i.test(t.name)).map((t) => t.id));

    const baseDocDomain: unknown[] = [
      ['create_date', '>=', utcStart],
      ['create_date', '<=', utcEnd],
    ];
    if (docFieldSet.has('mimetype')) baseDocDomain.push(['mimetype', 'in', [...PO_BILL_SUPPORTED_MIMETYPES]]);
    if (docFieldSet.has('type')) baseDocDomain.push(['type', '=', 'binary']);
    if (docFieldSet.has('company_id')) baseDocDomain.push('|', ['company_id', '=', companyId], ['company_id', '=', false]);

    const financeDocDomain = [...baseDocDomain];
    if (folderField) {
      financeDocDomain.push([`${folderField}.name`, 'ilike', 'Finance']);
    }

    const unfiledDocDomain = [...baseDocDomain];
    if (folderField) {
      unfiledDocDomain.push([folderField, '=', false]);
    }

    const readFields = ['id', 'name', 'create_date', 'tag_ids'].filter((f) => docFieldSet.has(f));
    const [financeDocuments, unfiledDocs] = await Promise.all([
      docFieldSet.has('id')
        ? fetchAllOdooPaginated<{
            id: number;
            name: string;
            create_date: string | false;
            tag_ids: number[] | false;
          }>(client, 'documents.document', financeDocDomain, readFields, 'create_date asc, id asc')
        : Promise.resolve([]),
      docFieldSet.has('id') && folderField
        ? fetchAllOdooPaginated<{ id: number; create_date: string | false }>(
            client,
            'documents.document',
            unfiledDocDomain,
            ['id', 'create_date'],
            'create_date asc, id asc',
            500,
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    return aggregateMonSatPoVsFinanceDocs({
      windows,
      purchaseOrders,
      financeDocuments,
      validatedTagIds,
      deliveryNoteTagIds,
      unfiledNoFolderDates: unfiledDocs.map((d) => nairobiDateKey((d.create_date || null) as string | null)),
    });
  } catch (err) {
    console.warn('[weekly-report] Failed to fetch Mon-Sat PO vs Finance Documents data:', err);
    const fallback = aggregateMonSatPoVsFinanceDocs({
      windows,
      purchaseOrders: [],
      financeDocuments: [],
      validatedTagIds: new Set(),
      deliveryNoteTagIds: new Set(),
    });
    return {
      ...fallback,
      fetchError: err instanceof Error ? err.message : 'Unable to fetch PO & Finance document counts from Odoo.',
    };
  }
}

// ─── Sharon & Candy Check-in / Check-out Attendance ──────────────────

export interface NamedStaffAttendanceSession {
  date: string;
  checkIn: string;
  checkOut: string | null;
  workedHours: number;
  late: boolean;
  multiDayUnclosed: boolean;
  status: 'Complete' | 'Late check-in' | 'Multi-day (unclosed)' | 'No check-out';
}

export interface NamedStaffAttendanceSummary {
  id: number;
  name: string;
  roleLabel: string;
  expectedWorkdays: number;
  daysWithCheckIn: number;
  daysWithSameDayCheckOut: number;
  lateCount: number;
  missingCheckoutCount: number;
  multiDaySessionCount: number;
  sessions: NamedStaffAttendanceSession[];
}

export async function getSalesCheckInStaff(
  client: OdooClient,
  companyId: number,
): Promise<Array<{ id: number; name: string; roleLabel: string }>> {
  const found = new Map<number, { id: number; name: string; roleLabel: string }>();

  try {
    const cached = await getShopFloorSharedCache<{
      allOperators: Array<{ id: number; name: string; jobTitle?: string | null; active?: boolean }>;
    }>('shop-floor:operators-list:v2');
    if (cached?.data?.allOperators?.length) {
      for (const op of cached.data.allOperators) {
        if (op?.id && op.name && isSharonOrCandyName(op.name)) {
          found.set(op.id, { id: op.id, name: op.name, roleLabel: op.jobTitle || 'Sales Optimizer' });
        }
      }
    }
  } catch {
    // Fall through to Odoo lookup
  }

  const hasSharon = [...found.values()].some((p) => /sharon/i.test(p.name));
  const hasCandy = [...found.values()].some((p) => /candy/i.test(p.name));
  if (hasSharon && hasCandy) {
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  try {
    const employees = await client.searchReadRecords<{
      id: number;
      name: string;
      job_title?: string | false;
    }>('hr.employee', {
      domain: [
        ['company_id', '=', companyId],
        ['active', '=', true],
        '|',
        ['name', 'ilike', 'Sharon'],
        ['name', 'ilike', 'Candy'],
      ],
      fields: ['id', 'name', 'job_title'],
      limit: 20,
    });
    for (const emp of employees) {
      if (emp?.id && emp.name && isSharonOrCandyName(emp.name)) {
        found.set(emp.id, {
          id: emp.id,
          name: emp.name,
          roleLabel: emp.job_title ? String(emp.job_title) : 'Sales Optimizer',
        });
      }
    }
  } catch (err) {
    console.warn('[weekly-report] Could not look up Sharon/Candy employees in Odoo:', err);
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function summarizeNamedStaffAttendance(
  staff: Array<{ id: number; name: string; roleLabel: string }>,
  allRecords: AttendanceRecord[],
  scheduledDates: string[],
  reportStart: string,
  reportEnd: string,
): NamedStaffAttendanceSummary[] {
  return staff.map((person) => {
    const personRecords = allRecords
      .filter((entry) => (Array.isArray(entry.employee_id) ? entry.employee_id[0] : entry.employee_id) === person.id)
      .filter((entry) => {
        if (!entry.check_in) return false;
        const inDate = nairobiDateKey(entry.check_in);
        const outDate = entry.check_out ? nairobiDateKey(entry.check_out) : '';
        // Include any session checked in during window, checked out during window,
        // spanning across the window, or opened earlier and still open.
        if (inDate >= reportStart && inDate <= reportEnd) return true;
        if (outDate && outDate >= reportStart && outDate <= reportEnd) return true;
        if (inDate < reportStart && outDate && outDate >= reportStart) return true;
        if (inDate <= reportEnd && !entry.check_out) return true;
        return false;
      })
      .sort((a, b) => String(a.check_in || '').localeCompare(String(b.check_in || '')));

    const sessions: NamedStaffAttendanceSession[] = personRecords.map((entry) => {
      const inDt = parseOdooDateTime(entry.check_in);
      const outDt = entry.check_out ? parseOdooDateTime(entry.check_out) : null;
      const computedHours = inDt && outDt ? Math.max(0, (outDt.getTime() - inDt.getTime()) / 3600000) : 0;
      const workedHours = Number(entry.worked_hours || computedHours || 0);
      const inDate = nairobiDateKey(entry.check_in);
      const outDate = entry.check_out ? nairobiDateKey(entry.check_out) : '';
      const late = isLateCheckIn(entry.check_in);
      const multiDayUnclosed = Boolean(entry.check_out && (workedHours > 16 || (outDate && outDate !== inDate)));

      let status: NamedStaffAttendanceSession['status'] = 'Complete';
      if (!entry.check_out) {
        status = 'No check-out';
      } else if (multiDayUnclosed) {
        status = 'Multi-day (unclosed)';
      } else if (late) {
        status = 'Late check-in';
      }

      return {
        date: inDate,
        checkIn: String(entry.check_in),
        checkOut: entry.check_out ? String(entry.check_out) : null,
        workedHours,
        late,
        multiDayUnclosed,
        status,
      };
    });

    const scheduledSet = new Set(scheduledDates);
    const checkInDays = new Set<string>();
    const sameDayCheckOutDays = new Set<string>();
    for (const s of sessions) {
      if (scheduledSet.has(s.date)) {
        checkInDays.add(s.date);
        if (s.checkOut && !s.multiDayUnclosed) {
          sameDayCheckOutDays.add(s.date);
        }
      }
    }

    return {
      id: person.id,
      name: person.name,
      roleLabel: person.roleLabel,
      expectedWorkdays: scheduledDates.length,
      daysWithCheckIn: checkInDays.size,
      daysWithSameDayCheckOut: sameDayCheckOutDays.size,
      lateCount: sessions.filter((s) => s.late && scheduledSet.has(s.date)).length,
      missingCheckoutCount: sessions.filter((s) => !s.checkOut).length,
      multiDaySessionCount: sessions.filter((s) => s.multiDayUnclosed).length,
      sessions,
    };
  });
}

// ─── Work Orders Started / Finished Before Board Logs ────────────────

export type PreBoardLogViolationType =
  | 'started_before_log'
  | 'started_and_finished_before_log'
  | 'started_no_log'
  | 'started_and_finished_no_log';

export interface WorkOrderBeforeBoardLogItem {
  moId: number;
  moName: string;
  origin: string;
  clientName: string;
  productName: string;
  missingBoardNames: string[];
  operatorName: string;
  moState: string;
  startedAt: string; // Odoo UTC string
  finishedAt: string | null; // Odoo UTC string
  firstBoardLogAt: string | null; // App EAT string or Odoo UTC string (ISO)
  firstBoardLogAtDisplay: string | null;
  violationType: PreBoardLogViolationType;
  violationLabel: string;
  delayMinutes: number | null;
}

export interface WorkOrderBeforeBoardLogAudit {
  totalChecked: number;
  compliantCount: number;
  startedBeforeLogCount: number;
  startedAndFinishedBeforeLogCount: number;
  noBoardLogCount: number;
  loggedAfterStartCount: number;
  byOperator: Array<{
    operatorName: string;
    total: number;
    startedOnly: number;
    startedAndFinished: number;
  }>;
  violations: WorkOrderBeforeBoardLogItem[];
  fetchError?: string | null;
}

function isCuttingBoardMoProductName(name: string): boolean {
  const clean = String(name || '').trim().toLowerCase();
  if (!clean.startsWith('cutting')) return false;
  if (/off\s*-?\s*cuts?/i.test(clean)) return false;
  return true;
}

function deriveBoardNameFromCuttingProduct(name: string): string {
  return String(name || '').replace(/^cutting\s+/i, '').trim();
}

function deriveClientFromWorkOrderName(woName: string | null | undefined): string {
  const raw = String(woName || '').trim();
  if (!raw) return '';
  const idx = raw.indexOf(' - ');
  if (idx > 0) {
    return raw.slice(0, idx).trim();
  }
  return '';
}

export function detectWorkOrdersStartedBeforeBoardLogs(input: {
  reportStart: string;
  reportEnd: string;
  mos: Array<{
    id: number;
    name: string;
    product_id: [number, string] | false | null;
    origin?: string | false | null;
    state: string;
    create_date?: string | false | null;
    date_start?: string | false | null;
    date_finished?: string | false | null;
    user_id?: [number, string] | false | null;
  }>;
  components: Array<{
    raw_material_production_id: [number, string] | false | null;
    product_id: [number, string] | false | null;
    product_uom_qty?: number | null;
  }>;
  workorders: Array<{
    id: number;
    name: string;
    production_id: [number, string] | false | null;
    state: string;
    date_start?: string | false | null;
    date_finished?: string | false | null;
  }>;
  productivityRows: Array<{
    workorder_id: [number, string] | false | null;
    employee_id: [number, string] | false | null;
    date_start?: string | false | null;
    date_end?: string | false | null;
  }>;
  saleOrders: Array<{
    id: number;
    name: string;
    partner_id: [number, string] | false | null;
    date_order?: string | false | null;
  }>;
  purchaseOrders: Array<{
    id: number;
    name: string;
    origin?: string | false | null;
  }>;
  incomingPoMoves: Array<{
    origin?: string | false | null;
    product_id: [number, string] | false | null;
    date?: string | false | null;
    state?: string | null;
  }>;
  boardIntakeLogs: Array<{
    id?: string;
    product_id?: number | null;
    product_name?: string | null;
    partner_id?: number | null;
    customer_name?: string | null;
    quantity?: number | null;
    purchase_order_reference?: string | null;
    created_at?: string | Date | null;
    reverted_at?: string | null;
    status?: string | null;
  }>;
}): WorkOrderBeforeBoardLogAudit {
  const soByName = new Map<string, { partnerId: number | null; partnerName: string; dateOrder: string | null }>();
  for (const so of input.saleOrders) {
    soByName.set(String(so.name || '').trim().toUpperCase(), {
      partnerId: Array.isArray(so.partner_id) ? Number(so.partner_id[0]) : null,
      partnerName: Array.isArray(so.partner_id) ? String(so.partner_id[1] || '') : '',
      dateOrder: so.date_order ? String(so.date_order) : null,
    });
  }

  const poNamesBySo = new Map<string, Set<string>>();
  for (const po of input.purchaseOrders) {
    const rawOrigin = String(po.origin || '').trim();
    const extracted = extractSoNameFromOrigin(rawOrigin) || rawOrigin;
    const key = extracted.trim().toUpperCase();
    if (!key) continue;
    if (!poNamesBySo.has(key)) poNamesBySo.set(key, new Set());
    poNamesBySo.get(key)!.add(String(po.name || '').trim().toUpperCase());
  }

  const incomingMovesByPo = new Map<string, Array<{ productId: number; productName: string; dateMs: number }>>();
  for (const mv of input.incomingPoMoves) {
    if (mv.state && mv.state !== 'done') continue;
    const poName = String(mv.origin || '').trim().toUpperCase();
    const dt = parseOdooDateTime((mv.date || null) as string | null);
    if (!poName || !dt || !Array.isArray(mv.product_id)) continue;
    if (!incomingMovesByPo.has(poName)) incomingMovesByPo.set(poName, []);
    incomingMovesByPo.get(poName)!.push({
      productId: Number(mv.product_id[0]),
      productName: String(mv.product_id[1] || ''),
      dateMs: dt.getTime(),
    });
  }

  const boardCompsByMo = new Map<number, Array<{ productId: number; productName: string }>>();
  for (const c of input.components) {
    if (!Array.isArray(c.raw_material_production_id) || !Array.isArray(c.product_id)) continue;
    const compName = String(c.product_id[1] || '');
    if (!isBoardProductName(compName)) continue;
    const moId = Number(c.raw_material_production_id[0]);
    if (!boardCompsByMo.has(moId)) boardCompsByMo.set(moId, []);
    boardCompsByMo.get(moId)!.push({ productId: Number(c.product_id[0]), productName: compName });
  }

  const wosByMo = new Map<number, typeof input.workorders>();
  for (const wo of input.workorders) {
    if (!Array.isArray(wo.production_id)) continue;
    const moId = Number(wo.production_id[0]);
    if (!wosByMo.has(moId)) wosByMo.set(moId, []);
    wosByMo.get(moId)!.push(wo);
  }

  const prodByWo = new Map<number, typeof input.productivityRows>();
  for (const pr of input.productivityRows) {
    if (!Array.isArray(pr.workorder_id)) continue;
    const woId = Number(pr.workorder_id[0]);
    if (!prodByWo.has(woId)) prodByWo.set(woId, []);
    prodByWo.get(woId)!.push(pr);
  }

  const activeLogs = input.boardIntakeLogs
    .filter((log) => !log.reverted_at && log.status !== 'reverted' && Number(log.quantity || 0) > 0)
    .map((log) => ({
      ...log,
      recordedDate: parseAppDateTime(log.created_at as string | null),
    }))
    .filter((log): log is typeof log & { recordedDate: Date } => Boolean(log.recordedDate));

  const violations: WorkOrderBeforeBoardLogItem[] = [];
  let totalChecked = 0;
  let compliantCount = 0;

  for (const mo of input.mos) {
    if (!['progress', 'to_close', 'done'].includes(mo.state)) continue;
    const moProdName = productName(mo.product_id);
    const boardComps = boardCompsByMo.get(mo.id) || [];
    const isCutting = isCuttingBoardMoProductName(moProdName);
    if (!isCutting && !boardComps.length) continue;

    // Resolve earliest true start time, finish time, and operator
    const moWos = wosByMo.get(mo.id) || [];
    const startCandidates: Array<{ raw: string; ms: number; operator?: string }> = [];
    const finishCandidates: Array<{ raw: string; ms: number }> = [];

    for (const wo of moWos) {
      const prods = prodByWo.get(wo.id) || [];
      for (const pr of prods) {
        if (pr.date_start) {
          const dt = parseOdooDateTime(String(pr.date_start));
          if (dt) {
            startCandidates.push({
              raw: String(pr.date_start),
              ms: dt.getTime(),
              operator: Array.isArray(pr.employee_id) ? String(pr.employee_id[1] || '') : undefined,
            });
          }
        }
      }
      if (wo.date_start) {
        const dt = parseOdooDateTime(String(wo.date_start));
        if (dt) startCandidates.push({ raw: String(wo.date_start), ms: dt.getTime() });
      }
      if (wo.date_finished) {
        const dt = parseOdooDateTime(String(wo.date_finished));
        if (dt) finishCandidates.push({ raw: String(wo.date_finished), ms: dt.getTime() });
      }
    }
    if (mo.date_start) {
      const dt = parseOdooDateTime(String(mo.date_start));
      if (dt) startCandidates.push({ raw: String(mo.date_start), ms: dt.getTime() });
    }
    if (mo.date_finished) {
      const dt = parseOdooDateTime(String(mo.date_finished));
      if (dt) finishCandidates.push({ raw: String(mo.date_finished), ms: dt.getTime() });
    }

    if (!startCandidates.length) continue;
    startCandidates.sort((a, b) => a.ms - b.ms);
    finishCandidates.sort((a, b) => b.ms - a.ms);

    const earliestStart = startCandidates[0];
    const latestFinish = (['done', 'to_close'].includes(mo.state) && finishCandidates.length)
      ? finishCandidates[0]
      : null;

    const startDayEat = nairobiDateKey(earliestStart.raw);
    const finishDayEat = latestFinish ? nairobiDateKey(latestFinish.raw) : '';
    const inPeriod = (startDayEat >= input.reportStart && startDayEat <= input.reportEnd)
      || (finishDayEat !== '' && finishDayEat >= input.reportStart && finishDayEat <= input.reportEnd);
    if (!inPeriod) continue;

    totalChecked += 1;

    // Resolve operator name from workcenter productivity timer (avoid falsely attributing untimed MOs to the Odoo API user)
    const prodWithOp = startCandidates.find((c) => c.operator);
    const operatorName = prodWithOp?.operator || 'No operator timer';

    // Resolve client & SO context
    const rawOrigin = String(mo.origin || '').trim();
    const extractedSo = (extractSoNameFromOrigin(rawOrigin) || rawOrigin).trim().toUpperCase();
    const soInfo = extractedSo ? soByName.get(extractedSo) : undefined;
    const woDerivedClient = moWos.map((w) => deriveClientFromWorkOrderName(w.name)).find(Boolean) || '';
    const clientPartnerId = soInfo?.partnerId ?? null;
    const clientName = soInfo?.partnerName || woDerivedClient || rawOrigin || 'Unknown client';
    const relatedPoNames = extractedSo ? (poNamesBySo.get(extractedSo) || new Set<string>()) : new Set<string>();

    // Anchor lower bound for valid board logs (14 days prior to SO/MO creation so ancient repeat-client logs do not falsely match)
    const anchorDate = parseOdooDateTime(soInfo?.dateOrder || (mo.create_date ? String(mo.create_date) : null) || earliestStart.raw);
    const logLookbackFloorMs = anchorDate ? anchorDate.getTime() - 14 * 86400000 : earliestStart.ms - 30 * 86400000;

    // Required boards to verify
    const requiredBoards = boardComps.length
      ? boardComps
      : [{ productId: 0, productName: deriveBoardNameFromCuttingProduct(moProdName) || moProdName }];

    const missingBoardNames: string[] = [];
    let latestLateLog: { ms: number; display: string; raw: string } | null = null;
    let allRequiredBoardsCompliant = true;

    for (const reqBoard of requiredBoards) {
      let earliestValidEvidenceMs: number | null = null;
      let earliestLateLogMs: { ms: number; display: string; raw: string } | null = null;

      // Check PO incoming receipts for this SO's board POs
      for (const poName of relatedPoNames) {
        const moves = incomingMovesByPo.get(poName) || [];
        for (const mv of moves) {
          if (!isMatchingBoardProduct(reqBoard.productName, mv.productName, reqBoard.productId, mv.productId)) continue;
          if (mv.dateMs < logLookbackFloorMs) continue;
          if (earliestValidEvidenceMs === null || mv.dateMs < earliestValidEvidenceMs) {
            earliestValidEvidenceMs = mv.dateMs;
          }
        }
      }

      // Check non-reverted board_intake_queue logs
      for (const log of activeLogs) {
        if (log.recordedDate.getTime() < logLookbackFloorMs) continue;
        if (!isMatchingBoardProduct(reqBoard.productName, log.product_name, reqBoard.productId, log.product_id)) continue;

        const clientMatch = isMatchingClient(clientName, log.customer_name, clientPartnerId, log.partner_id);
        const logPo = String(log.purchase_order_reference || '').trim().toUpperCase();
        const poMatch = Boolean(logPo && relatedPoNames.has(logPo));
        if (!clientMatch && !poMatch) continue;

        const logMs = log.recordedDate.getTime();
        if (logMs <= earliestStart.ms + CLOCK_SKEW_GRACE_MS) {
          if (earliestValidEvidenceMs === null || logMs < earliestValidEvidenceMs) {
            earliestValidEvidenceMs = logMs;
          }
        } else if (!earliestLateLogMs || logMs < earliestLateLogMs.ms) {
          earliestLateLogMs = {
            ms: logMs,
            display: formatNairobiDateTimeFromDate(log.recordedDate),
            raw: String(log.created_at),
          };
        }
      }

      if (earliestValidEvidenceMs !== null && earliestValidEvidenceMs <= earliestStart.ms + CLOCK_SKEW_GRACE_MS) {
        continue;
      }

      allRequiredBoardsCompliant = false;
      missingBoardNames.push(reqBoard.productName);
      if (earliestLateLogMs && (!latestLateLog || earliestLateLogMs.ms > latestLateLog.ms)) {
        latestLateLog = earliestLateLogMs;
      }
    }

    if (allRequiredBoardsCompliant) {
      compliantCount += 1;
      continue;
    }

    const isFinished = ['done', 'to_close'].includes(mo.state) || Boolean(latestFinish);
    let violationType: PreBoardLogViolationType;
    let violationLabel: string;
    let delayMinutes: number | null = null;

    if (latestLateLog) {
      delayMinutes = Math.max(1, Math.round((latestLateLog.ms - earliestStart.ms) / 60000));
      if (isFinished && latestFinish && latestLateLog.ms >= latestFinish.ms - CLOCK_SKEW_GRACE_MS) {
        violationType = 'started_and_finished_before_log';
        violationLabel = 'Started & finished before board log';
      } else {
        violationType = 'started_before_log';
        violationLabel = 'Started before board log';
      }
    } else if (isFinished) {
      violationType = 'started_and_finished_no_log';
      violationLabel = 'Started & finished (no board log)';
    } else {
      violationType = 'started_no_log';
      violationLabel = 'Started (no board log)';
    }

    violations.push({
      moId: mo.id,
      moName: mo.name,
      origin: rawOrigin || '-',
      clientName,
      productName: moProdName,
      missingBoardNames: [...new Set(missingBoardNames)],
      operatorName,
      moState: mo.state,
      startedAt: earliestStart.raw,
      finishedAt: latestFinish?.raw || null,
      firstBoardLogAt: latestLateLog?.raw || null,
      firstBoardLogAtDisplay: latestLateLog?.display || null,
      violationType,
      violationLabel,
      delayMinutes,
    });
  }

  violations.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

  const startedBeforeLogCount = violations.filter((v) =>
    v.violationType === 'started_before_log' || v.violationType === 'started_no_log',
  ).length;
  const startedAndFinishedBeforeLogCount = violations.filter((v) =>
    v.violationType === 'started_and_finished_before_log' || v.violationType === 'started_and_finished_no_log',
  ).length;
  const noBoardLogCount = violations.filter((v) =>
    v.violationType === 'started_no_log' || v.violationType === 'started_and_finished_no_log',
  ).length;
  const loggedAfterStartCount = violations.length - noBoardLogCount;

  const opMap = new Map<string, { operatorName: string; total: number; startedOnly: number; startedAndFinished: number }>();
  for (const v of violations) {
    const cur = opMap.get(v.operatorName) || { operatorName: v.operatorName, total: 0, startedOnly: 0, startedAndFinished: 0 };
    cur.total += 1;
    if (v.violationType === 'started_and_finished_before_log' || v.violationType === 'started_and_finished_no_log') {
      cur.startedAndFinished += 1;
    } else {
      cur.startedOnly += 1;
    }
    opMap.set(v.operatorName, cur);
  }

  return {
    totalChecked,
    compliantCount,
    startedBeforeLogCount,
    startedAndFinishedBeforeLogCount,
    noBoardLogCount,
    loggedAfterStartCount,
    byOperator: [...opMap.values()].sort((a, b) => b.total - a.total || a.operatorName.localeCompare(b.operatorName)),
    violations,
    fetchError: null,
  };
}

async function fetchWorkOrdersBeforeBoardLogsAudit(
  client: OdooClient,
  companyId: number,
  warehouseId: number,
  reportStart: string,
  reportEnd: string,
): Promise<WorkOrderBeforeBoardLogAudit> {
  try {
    const warehouses = await client.searchReadRecords<{ id: number; code: string }>('stock.warehouse', {
      domain: [['id', '=', warehouseId], ['company_id', '=', companyId]],
      fields: ['id', 'code'],
      limit: 1,
    });
    const warehouseCode = String(warehouses[0]?.code || '').trim().toUpperCase();
    const expectedPrefix = warehouseCode ? `${warehouseCode}/MO/` : '';

    const utcStart = `${previousDate(reportStart)} 21:00:00`;
    const utcEnd = `${reportEnd} 20:59:59`;

    const [rawMos, boardIntakeLogs] = await Promise.all([
      fetchAllOdooPaginated<{
        id: number;
        name: string;
        product_id: [number, string] | false;
        origin: string | false;
        state: string;
        create_date: string | false;
        date_start: string | false;
        date_finished: string | false;
        user_id: [number, string] | false;
      }>(
        client,
        'mrp.production',
        [
          ['company_id', '=', companyId],
          ['picking_type_id.warehouse_id', '=', warehouseId],
          ['state', 'in', ['progress', 'to_close', 'done']],
          '|',
          ['date_start', '>=', utcStart],
          ['date_finished', '>=', utcStart],
        ],
        ['id', 'name', 'product_id', 'origin', 'state', 'create_date', 'date_start', 'date_finished', 'user_id'],
        'date_start desc, id desc',
        1000,
      ),
      getActiveBoardIntakesInRange(addDays(reportStart, -45), addDays(reportEnd, 1)).catch(() => [] as BoardIntakeQueueEntry[]),
    ]);

    const candidateMos = rawMos.filter((mo) => {
      if (expectedPrefix && !String(mo.name || '').toUpperCase().startsWith(expectedPrefix)) return false;
      if (!isCuttingBoardMoProductName(productName(mo.product_id))) return false;
      const startStr = mo.date_start ? String(mo.date_start) : '';
      const finishStr = mo.date_finished ? String(mo.date_finished) : '';
      return (startStr && startStr <= utcEnd) || (finishStr && finishStr <= utcEnd);
    });

    if (!candidateMos.length) {
      return {
        totalChecked: 0,
        compliantCount: 0,
        startedBeforeLogCount: 0,
        startedAndFinishedBeforeLogCount: 0,
        noBoardLogCount: 0,
        loggedAfterStartCount: 0,
        byOperator: [],
        violations: [],
        fetchError: null,
      };
    }

    const moIds = candidateMos.map((m) => m.id);
    const originNames = [...new Set(
      candidateMos
        .map((m) => extractSoNameFromOrigin(String(m.origin || '')) || String(m.origin || '').trim())
        .filter(Boolean),
    )];

    const [components, workorders, saleOrders, purchaseOrders] = await Promise.all([
      fetchAllOdooPaginated<{
        raw_material_production_id: [number, string] | false;
        product_id: [number, string] | false;
        product_uom_qty: number;
      }>(
        client,
        'stock.move',
        [['raw_material_production_id', 'in', moIds]],
        ['raw_material_production_id', 'product_id', 'product_uom_qty'],
        'id asc',
        2000,
      ).catch(() => []),
      fetchAllOdooPaginated<{
        id: number;
        name: string;
        production_id: [number, string] | false;
        state: string;
        date_start: string | false;
        date_finished: string | false;
      }>(
        client,
        'mrp.workorder',
        [['production_id', 'in', moIds]],
        ['id', 'name', 'production_id', 'state', 'date_start', 'date_finished'],
        'id asc',
        1500,
      ).catch(() => []),
      originNames.length
        ? fetchAllOdooPaginated<{
            id: number;
            name: string;
            partner_id: [number, string] | false;
            date_order: string | false;
          }>(
            client,
            'sale.order',
            [['company_id', '=', companyId], ['name', 'in', originNames]],
            ['id', 'name', 'partner_id', 'date_order'],
            'id desc',
            1000,
          ).catch(() => [])
        : Promise.resolve([]),
      originNames.length
        ? fetchAllOdooPaginated<{
            id: number;
            name: string;
            origin: string | false;
          }>(
            client,
            'purchase.order',
            [
              ['company_id', '=', companyId],
              ['origin', 'in', originNames],
              ['state', 'not in', ['cancel']],
            ],
            ['id', 'name', 'origin'],
            'id desc',
            1000,
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    const woIds = workorders.map((w) => w.id);
    const poNames = [...new Set(purchaseOrders.map((p) => p.name).filter(Boolean))];

    const [productivityRows, incomingPoMoves] = await Promise.all([
      woIds.length
        ? fetchAllOdooPaginated<{
            workorder_id: [number, string] | false;
            employee_id: [number, string] | false;
            date_start: string | false;
            date_end: string | false;
          }>(
            client,
            'mrp.workcenter.productivity',
            [['workorder_id', 'in', woIds]],
            ['workorder_id', 'employee_id', 'date_start', 'date_end'],
            'date_start asc, id asc',
            2000,
          ).catch(() => [])
        : Promise.resolve([]),
      poNames.length
        ? fetchAllOdooPaginated<{
            origin: string | false;
            product_id: [number, string] | false;
            date: string | false;
            state: string;
          }>(
            client,
            'stock.move',
            [
              ['company_id', '=', companyId],
              ['origin', 'in', poNames],
              ['state', '=', 'done'],
              ['purchase_line_id', '!=', false],
            ],
            ['origin', 'product_id', 'date', 'state'],
            'date asc, id asc',
            1500,
          ).catch(() => [])
        : Promise.resolve([]),
    ]);

    return detectWorkOrdersStartedBeforeBoardLogs({
      reportStart,
      reportEnd,
      mos: candidateMos,
      components,
      workorders,
      productivityRows,
      saleOrders,
      purchaseOrders,
      incomingPoMoves,
      boardIntakeLogs,
    });
  } catch (err) {
    console.warn('[weekly-report] Failed to build Work Orders before Board Logs audit:', err);
    return {
      totalChecked: 0,
      compliantCount: 0,
      startedBeforeLogCount: 0,
      startedAndFinishedBeforeLogCount: 0,
      noBoardLogCount: 0,
      loggedAfterStartCount: 0,
      byOperator: [],
      violations: [],
      fetchError: err instanceof Error ? err.message : 'Unable to audit work orders vs board logs.',
    };
  }
}

// ─── Board Logging Encouragement Note ────────────────────────────────

export interface OperatorBoardLoggingRow {
  name: string;
  email: string;
  records: number;
  boards: number;
  synced: number;
  failed: number;
  reverted: number;
  pending: number;
  lastLoggedAt: string | null;
}

export function mergeOperationsBoardLoggingRows(
  operators: Array<{ id: number; name: string }>,
  rawBoardLogging: Array<{
    name: string;
    email: string;
    records: number;
    boards: number;
    synced: number;
    failed: number;
    reverted: number;
    pending: number;
    lastLoggedAt: string;
  }>,
): OperatorBoardLoggingRow[] {
  const normalizeName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const eligibleOperators = operators.filter((op) => !isExcludedFromBoardLogs({ name: op.name }));
  const eligibleRawLogs = rawBoardLogging.filter((raw) => !isExcludedFromBoardLogs({ name: raw.name, email: raw.email }));
  const matchedRawIndices = new Set<number>();

  const merged: OperatorBoardLoggingRow[] = eligibleOperators.map((op) => {
    const opNorm = normalizeName(op.name);
    let email = '';
    let records = 0;
    let boards = 0;
    let synced = 0;
    let failed = 0;
    let reverted = 0;
    let pending = 0;
    let lastLoggedAt: string | null = null;

    eligibleRawLogs.forEach((raw, idx) => {
      if (matchedRawIndices.has(idx)) return;
      const rawNorm = normalizeName(raw.name || '');
      if (!rawNorm) return;
      if (rawNorm === opNorm || rawNorm.includes(opNorm) || opNorm.includes(rawNorm)) {
        matchedRawIndices.add(idx);
        email = email || raw.email || '';
        records += Number(raw.records || 0);
        boards += Number(raw.boards || 0);
        synced += Number(raw.synced || 0);
        failed += Number(raw.failed || 0);
        reverted += Number(raw.reverted || 0);
        pending += Number(raw.pending || 0);
        if (!lastLoggedAt || String(raw.lastLoggedAt || '') > lastLoggedAt) {
          lastLoggedAt = raw.lastLoggedAt || null;
        }
      }
    });

    return { name: op.name, email, records, boards, synced, failed, reverted, pending, lastLoggedAt };
  });

  return merged.sort((a, b) => b.records - a.records || b.boards - a.boards || a.name.localeCompare(b.name));
}

export function buildBoardLoggingEncouragementNote(rows: OperatorBoardLoggingRow[]): string {
  const eligibleRows = rows.filter((r) => !isExcludedFromBoardLogs({ name: r.name, email: r.email }));
  if (!eligibleRows.length) {
    return 'NOTE: Operations operators are encouraged to lock in and consistently record every incoming board at intake before work orders are started.';
  }

  const sorted = [...eligibleRows].sort((a, b) => b.records - a.records || b.boards - a.boards || a.name.localeCompare(b.name));
  const totalRecords = sorted.reduce((sum, r) => sum + r.records, 0);
  if (totalRecords === 0) {
    return 'NOTE: No Operations operators recorded board intake logs during this period. The entire team is encouraged to lock in and consistently log every incoming board before starting work orders.';
  }

  const avgRecords = totalRecords / sorted.length;
  const topCount = sorted[0].records;
  const topPerformers = sorted
    .filter((r) => r.records > 0 && r.records >= Math.max(1, Math.ceil(topCount * 0.6)))
    .slice(0, 2);
  const topNames = new Set(topPerformers.map((p) => p.name));

  // Flag operators with 0 logs OR below 50% of team average (and strictly below the top performer)
  const lowThreshold = Math.max(1, avgRecords * 0.5);
  const lowPerformers = sorted.filter((r) =>
    !topNames.has(r.name) && (r.records === 0 || (r.records < lowThreshold && r.records < topCount)),
  );

  const leaderSummary = topPerformers
    .map((p) => `${p.name} (${p.records} log${p.records === 1 ? '' : 's'}, ${p.boards} board${p.boards === 1 ? '' : 's'})`)
    .join(' and ');

  if (lowPerformers.length > 0) {
    const lowSummary = lowPerformers
      .map((p) => `${p.name} (${p.records} log${p.records === 1 ? '' : 's'})`)
      .join(', ');
    return `ENCOURAGEMENT NOTE: Great pace set by ${leaderSummary}. ${lowSummary} recorded low board log activity this period — we encourage you to lock in, stay consistent at board intake, and emulate your teammates so every board is logged before cutting work orders begin.`;
  }

  return `ENCOURAGEMENT NOTE: Well done to the Operations team for consistent board logging led by ${leaderSummary}. Keep locking in and maintaining this shared standard across every shift.`;
}

// ─── Operator System Usage & Knowledge Summary (for Pie Graph) ───────

export interface OperatorSystemUsageRow {
  id: number;
  name: string;
  shopFloorSessions: number;
  workOrdersWorked: number;
  boardLogRecords: number;
  attendanceActions: number;
  appActivityActions: number;
  totalUsageActions: number;
  usageSharePercent: number;
  knowledgeScore: number;
  knowledgeLevel: 'Advanced' | 'Proficient' | 'Developing' | 'Needs Training';
}

export interface OperatorSystemUsageSummary {
  totalTeamActions: number;
  operators: OperatorSystemUsageRow[];
  insightNote: string;
}

export function computeOperatorSystemUsageSummary(input: {
  operators: Array<{ id: number; name: string; email?: string | null }>;
  workcenterSessionsByOperatorId: Map<number, { sessions: number; workOrdersWorked: number; openTimers: number }>;
  boardLoggingByOperator: OperatorBoardLoggingRow[];
  attendance: Array<{
    name: string;
    days: Array<{ status: string; checkIn: string | null; checkOut: string | null }>;
  }>;
  appActivityByEmail?: Map<string, number>;
}): OperatorSystemUsageSummary {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const eligibleOps = input.operators.filter((op) => !isExcludedFromOperators({ name: op.name, email: op.email }));

  const rawRows = eligibleOps.map((op) => {
    const opNorm = norm(op.name);
    const wc = input.workcenterSessionsByOperatorId.get(op.id) || { sessions: 0, workOrdersWorked: 0, openTimers: 0 };
    const boardRow = input.boardLoggingByOperator.find((b) => {
      const bn = norm(b.name);
      return bn === opNorm || bn.includes(opNorm) || opNorm.includes(bn);
    });
    const attRow = input.attendance.find((a) => norm(a.name) === opNorm);
    const excludedFromBoards = isExcludedFromBoardLogs({ name: op.name, email: op.email || boardRow?.email });

    const boardLogRecords = excludedFromBoards ? 0 : Number(boardRow?.records || 0);
    const boardLogSynced = excludedFromBoards ? 0 : Number(boardRow?.synced || 0);
    const boardLogReverted = excludedFromBoards ? 0 : Number(boardRow?.reverted || 0);

    let checkIns = 0;
    let cleanCheckOuts = 0;
    let expectedDays = 0;
    if (attRow) {
      expectedDays = attRow.days.length;
      for (const day of attRow.days) {
        if (day.checkIn) checkIns += 1;
        if (day.checkIn && day.checkOut) cleanCheckOuts += 1;
      }
    }
    const attendanceActions = checkIns + cleanCheckOuts;

    const emailKey = String(op.email || boardRow?.email || '').trim().toLowerCase();
    const appActivityActions = emailKey && input.appActivityByEmail ? Number(input.appActivityByEmail.get(emailKey) || 0) : 0;

    // Total system interactions (weighted equally by real recorded system actions)
    const totalUsageActions = wc.sessions + boardLogRecords + attendanceActions + appActivityActions;

    // Knowledge / Proficiency Score (0-100):
    // Measures how broadly and accurately the operator uses the system:
    // - Shop Floor Work Orders (40 pts): active sessions + timer discipline
    // - Board Intake Logging (35 pts): active logs + clean sync accuracy (reallocated if excluded from board logs)
    // - Attendance & Portal Discipline (25 pts): check-in + clean check-out + app usage
    const sfUsagePts = wc.sessions > 0
      ? Math.min(25, Math.round((Math.min(wc.sessions, 6) / 6) * 25))
      : 0;
    const sfCleanRatio = wc.sessions > 0 ? Math.max(0, (wc.sessions - wc.openTimers) / wc.sessions) : 0;
    const sfDisciplinePts = wc.sessions > 0 ? Math.round(sfCleanRatio * 15) : 0;
    const sfScore = sfUsagePts + sfDisciplinePts; // max 40

    const blUsagePts = boardLogRecords > 0
      ? Math.min(20, Math.round((Math.min(boardLogRecords, 5) / 5) * 20))
      : 0;
    const blAccuracy = boardLogRecords > 0
      ? Math.max(0, (boardLogSynced - boardLogReverted) / boardLogRecords)
      : 0;
    const blQualityPts = boardLogRecords > 0 ? Math.round(blAccuracy * 15) : 0;
    const blScore = blUsagePts + blQualityPts; // max 35

    const attRatio = expectedDays > 0 ? Math.min(1, cleanCheckOuts / expectedDays) : (cleanCheckOuts > 0 ? 1 : 0);
    const attPts = Math.round(attRatio * 18);
    const portalPts = appActivityActions > 0 ? Math.min(7, Math.round((Math.min(appActivityActions, 5) / 5) * 7)) : (checkIns > 0 ? 3 : 0);
    const attAndPortalScore = Math.min(25, attPts + portalPts); // max 25

    const knowledgeScore = excludedFromBoards
      ? Math.min(100, Math.round(((sfScore + attAndPortalScore) / 65) * 100))
      : Math.min(100, sfScore + blScore + attAndPortalScore);

    const knowledgeLevel: OperatorSystemUsageRow['knowledgeLevel'] = knowledgeScore >= 80
      ? 'Advanced'
      : knowledgeScore >= 60
        ? 'Proficient'
        : knowledgeScore >= 35
          ? 'Developing'
          : 'Needs Training';

    return {
      id: op.id,
      name: op.name,
      shopFloorSessions: wc.sessions,
      workOrdersWorked: wc.workOrdersWorked,
      boardLogRecords,
      attendanceActions,
      appActivityActions,
      totalUsageActions,
      usageSharePercent: 0,
      knowledgeScore,
      knowledgeLevel,
    };
  });

  const totalTeamActions = rawRows.reduce((sum, r) => sum + r.totalUsageActions, 0);
  const operators = rawRows
    .map((r) => ({
      ...r,
      usageSharePercent: totalTeamActions > 0 ? Math.round((r.totalUsageActions / totalTeamActions) * 100) : 0,
    }))
    .sort((a, b) => b.totalUsageActions - a.totalUsageActions || b.knowledgeScore - a.knowledgeScore || a.name.localeCompare(b.name));

  let insightNote: string;
  if (!operators.length || totalTeamActions === 0) {
    insightNote = 'SYSTEM KNOWLEDGE INSIGHT: No system usage actions were recorded for Operations operators in this period. Conduct hands-on refresher training on Shop Floor timers, Board Logs, and Attendance.';
  } else {
    const leaders = operators.filter((o) => o.knowledgeScore >= 60).slice(0, 2);
    const needsTraining = operators.filter((o) => o.knowledgeScore < 50);
    const leaderText = leaders.length
      ? `Strongest system command: ${leaders.map((l) => `${l.name} (${l.usageSharePercent}% usage share, ${l.knowledgeScore}% knowledge)`).join(' and ')}.`
      : `Highest usage share: ${operators[0].name} (${operators[0].usageSharePercent}% of team actions).`;
    const trainingText = needsTraining.length
      ? ` Coaching / training recommended for ${needsTraining.map((n) => `${n.name} (${n.knowledgeScore}%)`).join(', ')} to improve consistent system adoption.`
      : ' All tracked operators demonstrated active system usage across the period.';
    insightNote = `SYSTEM KNOWLEDGE INSIGHT: ${leaderText}${trainingText}`;
  }

  return { totalTeamActions, operators, insightNote };
}

// ─── Operators Lookup ────────────────────────────────────────────────

export async function getOperators(client: OdooClient, companyId: number): Promise<Array<{ id: number; name: string }>> {
  // 1. Check persistent operator cache from MySQL (0 Odoo RPC calls, instant <5ms)
  try {
    const cached = await getShopFloorSharedCache<{
      allOperators: Array<{ id: number; name: string; workEmail?: string | null; active?: boolean; department?: string | null }>;
    }>('shop-floor:operators-list:v2');
    if (cached?.data?.allOperators && cached.data.allOperators.length > 0) {
      const valid = cached.data.allOperators.filter((op) => {
        if (!op || !op.id || !op.name) return false;
        if (isExcludedFromOperators({ name: op.name, workEmail: op.workEmail })) return false;
        const n = op.name.trim();
        const prefix = String(op.workEmail || '').split('@')[0].trim().toLowerCase();
        if (n.toLowerCase() === prefix) return false;
        // Wednesday report attendance must ONLY include people whose department is Operations
        return isOperationsDept(op.department);
      });
      if (valid.length > 0) {
        return valid.map((op) => ({ id: op.id, name: op.name }));
      }
    }
  } catch (err) {
    console.warn('[weekly-report] Failed to read cached operator list:', err);
  }

  // 2. Batch query fallback: 1 query for departments, 1 query for employees (2 calls instead of 10)
  try {
    const departments = await client.searchReadRecords<{ id: number; name: string; complete_name?: string }>('hr.department', {
      domain: [
        ['company_id', 'in', [companyId, false]],
        '|',
        ['name', '=', OPERATIONS_DEPARTMENT_NAME],
        ['complete_name', 'ilike', OPERATIONS_DEPARTMENT_NAME],
      ],
      fields: ['id', 'name', 'complete_name'],
    });
    const deptIds = departments.map((d) => d.id);
    if (!deptIds.length) return [];

    const employees = await client.searchReadRecords<{ id: number; name: string; department_id?: unknown }>('hr.employee', {
      domain: [
        ['company_id', '=', companyId],
        ['department_id', 'in', deptIds],
        ['active', '=', true],
      ],
      fields: ['id', 'name', 'department_id'],
      limit: 200,
    });
    const operationsEmployees = employees.filter((e) => !isExcludedFromOperators({ name: e.name }) && isOperationsDept(e.department_id));
    return [...new Map(operationsEmployees.map((e) => [e.id, { id: e.id, name: e.name }])).values()];
  } catch (err) {
    console.warn('[weekly-report] Batch department/employee search failed:', err);
    return [];
  }
}

// ─── Main Report Builder ─────────────────────────────────────────────

export async function buildWeeklyShopFloorReport(scope?: { fromDate?: string; toDate?: string }) {
  const settings = await getSettings();
  const client = new OdooClient(settings.odoo);
  const companyId = await client.getTargetCompanyIdValue();
  const warehouseId = Number(settings.stock.warehouseId || 0);
  if (!warehouseId) throw new Error('The Urban Vibe warehouse ID must be configured before generating the weekly report.');

  let reportStart: string;
  let reportEnd: string;
  const reportingBaseline = settings.mail.shopFloorReportingStartDate;

  if (scope?.fromDate && scope?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(String(scope.fromDate)) && /^\d{4}-\d{2}-\d{2}$/.test(String(scope.toDate))) {
    reportStart = clampShopFloorReportingDate(String(scope.fromDate), reportingBaseline);
    reportEnd = clampShopFloorReportingDate(String(scope.toDate), reportingBaseline);
  } else {
    const window = defaultReportWindow();
    reportStart = clampShopFloorReportingDate(window.start, reportingBaseline);
    reportEnd = clampShopFloorReportingDate(window.end, reportingBaseline);
  }

  const [
    boardSummary,
    penalties,
    moCompletion,
    operators,
    salesStaff,
    rawBoardLoggingByOperator,
    poVsFinanceDocs,
    workOrdersBeforeBoardLogs,
  ] = await Promise.all([
    client.getBoardRegistrationSummary({
      ...settings.stock,
      fromDate: reportStart,
      toDate: reportEnd,
    }),
    client.getTeamPenalties(settings.stock),
    client.getWarehouseManufacturingOrderCompletionSummary(warehouseId, reportStart, reportEnd),
    getOperators(client, companyId),
    getSalesCheckInStaff(client, companyId),
    getBoardIntakeLoggingReport(reportStart, reportEnd, reportingBaseline),
    fetchMonSatPoVsFinanceDocsReport(client, companyId, reportStart, reportEnd),
    fetchWorkOrdersBeforeBoardLogsAudit(client, companyId, warehouseId, reportStart, reportEnd),
  ]);

  // Include every active Operations operator (even those with 0 logs) so low performers are clearly tracked
  const boardLoggingByOperator = mergeOperationsBoardLoggingRows(operators, rawBoardLoggingByOperator);
  const boardLoggingEncouragementNote = buildBoardLoggingEncouragementNote(boardLoggingByOperator);

  const reportStartDate = new Date(`${reportStart}T12:00:00Z`);
  const reportEndDate = new Date(`${reportEnd}T12:00:00Z`);
  const reportingDayCount = Math.max(1, Math.floor((reportEndDate.getTime() - reportStartDate.getTime()) / 86400000) + 1);
  const dates = Array.from({ length: reportingDayCount }, (_, index) => {
    const value = new Date(reportStartDate);
    value.setUTCDate(reportStartDate.getUTCDate() + index);
    return dateOnly(value);
  }).filter((date) => new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Nairobi', weekday: 'short' }).format(new Date(`${date}T12:00:00Z`)) !== 'Sun');

  // Include lookback days so completed overnight overtime rows AND multi-day unclosed shifts
  // (e.g. Sharon/Candy checking in days earlier) are captured accurately in one bulk query.
  const opsEarliestDate = previousDate(reportStart);
  const salesEarliestDate = addDays(reportStart, -10);
  const latestDate = reportEnd;
  const allAttendanceEmployeeIds = [...new Set([...operators.map((o) => o.id), ...salesStaff.map((s) => s.id)])];
  const allAttendanceRecords = allAttendanceEmployeeIds.length
    ? ((await client.getBulkAttendanceRange(allAttendanceEmployeeIds, salesEarliestDate, latestDate).catch(() => [])) as AttendanceRecord[])
    : ([] as AttendanceRecord[]);

  const attendance = operators.map((operator) => {
    const employeeAllRecords = allAttendanceRecords.filter((entry) => {
      const empMatch = (Array.isArray(entry.employee_id) ? entry.employee_id[0] : entry.employee_id) === operator.id;
      if (!empMatch || !entry.check_in) return false;
      const inDate = nairobiDateKey(entry.check_in);
      const outDate = entry.check_out ? nairobiDateKey(entry.check_out) : inDate;
      return inDate >= opsEarliestDate || outDate >= reportStart;
    });

    const overtimeRecords = employeeAllRecords
      .filter((entry) => {
        const inDate = nairobiDateKey(entry.check_in);
        const outDate = entry.check_out ? nairobiDateKey(entry.check_out) : inDate;
        const inWindow = (inDate >= reportStart && inDate <= reportEnd) || (outDate >= reportStart && outDate <= reportEnd);
        return inWindow && isOvertimeOrOffHoursRecord(entry);
      })
      .sort((a, b) => String(a.check_in).localeCompare(String(b.check_in)))
      .map((entry) => {
        const inDate = nairobiDateKey(entry.check_in);
        const outDate = entry.check_out ? nairobiDateKey(entry.check_out) : inDate;
        const isSun = isSundayCheckIn(entry.check_in);
        const isOvernight = isOvernightRecord(entry);
        const shiftType = (isSun && isOvernight)
          ? 'Sunday / Overnight'
          : isSun
            ? 'Sunday Shift'
            : isOvernight
              ? 'Overnight Shift'
              : 'Night / Off-Hours';
        const workedHours = Number(entry.worked_hours || (entry.check_in && entry.check_out
          ? ((parseOdooDateTime(entry.check_out)?.getTime() || 0) - (parseOdooDateTime(entry.check_in)?.getTime() || 0)) / 3600000
          : 0));
        return {
          dateRange: inDate === outDate ? inDate : `${inDate} -> ${outDate}`,
          checkIn: entry.check_in,
          checkOut: entry.check_out || null,
          workedHours,
          shiftType,
        };
      });

    const totalOvertimeHours = overtimeRecords.reduce((sum, r) => sum + r.workedHours, 0);

    const days = dates.map((date) => {
      const regularRecords = employeeAllRecords.filter((entry) =>
        nairobiDateKey(entry.check_in) === date && !isOffHoursCheckIn(entry.check_in),
      );
      const classification = classifyAttendanceRecords(regularRecords);
      const overnightCoverage = employeeAllRecords.find((entry) =>
        completedAttendanceCoversWorkday(entry, date, nairobiDateKey),
      );
      const record = classification.record || overnightCoverage || null;

      return {
        date,
        status: classification.status === 'Absent' && overnightCoverage ? 'Overtime covered' : classification.status,
        late: Boolean(record && nairobiDateKey(record.check_in) === date && isLateCheckIn(record.check_in)),
        checkIn: record?.check_in || null,
        checkOut: record?.check_out || null,
        workedHours: Number(record?.worked_hours || (record?.check_in && record?.check_out ? ((parseOdooDateTime(record.check_out)?.getTime() || 0) - (parseOdooDateTime(record.check_in)?.getTime() || 0)) / 3600000 : 0)),
        missingCheckoutRecords: employeeAllRecords.filter((entry) => nairobiDateKey(entry.check_in) === date && !entry.check_out),
        overnight: Boolean(record && isOvernightRecord(record)),
      };
    });

    return {
      name: operator.name,
      overtimeRecords,
      totalOvertimeHours,
      days,
    };
  });

  const salesTeamAttendance = summarizeNamedStaffAttendance(
    salesStaff,
    allAttendanceRecords,
    dates,
    reportStart,
    reportEnd,
  );

  // Batch fetch workcenter productivity sessions + portal activity for System Usage & Knowledge Pie Graph
  const operatorIds = operators.map((o) => o.id).filter((id) => id > 0);
  const [wcProductivityRows, appActivityRows] = await Promise.all([
    operatorIds.length > 0
      ? client.searchReadRecords<{
          id: number;
          employee_id: [number, string] | number | false;
          workorder_id: [number, string] | false;
          date_end: string | false;
        }>('mrp.workcenter.productivity', {
          domain: [
            ['employee_id', 'in', operatorIds],
            ['date_start', '>=', `${reportStart} 00:00:00`],
            ['date_start', '<=', `${reportEnd} 23:59:59`],
          ],
          fields: ['id', 'employee_id', 'workorder_id', 'date_end'],
          limit: 1000,
        }).catch(() => [])
      : Promise.resolve([]),
    queryAll<{ email: string | null; cnt: number }>(
      `SELECT LOWER(email) as email, COUNT(*) as cnt
       FROM auth_login_events
       WHERE success = 1 AND created_at >= ? AND created_at <= ?
       GROUP BY LOWER(email)`,
      [`${reportStart} 00:00:00`, `${reportEnd} 23:59:59`],
    ).catch(() => []),
  ]);

  const wcMap = new Map<number, { sessions: number; woSet: Set<number>; openTimers: number }>();
  for (const row of wcProductivityRows) {
    const empId = Array.isArray(row.employee_id) ? Number(row.employee_id[0]) : Number(row.employee_id || 0);
    if (!empId) continue;
    const entry = wcMap.get(empId) || { sessions: 0, woSet: new Set<number>(), openTimers: 0 };
    entry.sessions += 1;
    if (Array.isArray(row.workorder_id) && row.workorder_id[0]) {
      entry.woSet.add(Number(row.workorder_id[0]));
    }
    if (!row.date_end) {
      entry.openTimers += 1;
    }
    wcMap.set(empId, entry);
  }
  const workcenterSessionsByOperatorId = new Map<number, { sessions: number; workOrdersWorked: number; openTimers: number }>();
  wcMap.forEach((v, k) => {
    workcenterSessionsByOperatorId.set(k, { sessions: v.sessions, workOrdersWorked: v.woSet.size, openTimers: v.openTimers });
  });

  const appActivityByEmail = new Map<string, number>();
  for (const row of appActivityRows) {
    if (row.email) appActivityByEmail.set(String(row.email).trim().toLowerCase(), Number(row.cnt || 0));
  }

  const operatorSystemUsage = computeOperatorSystemUsageSummary({
    operators,
    workcenterSessionsByOperatorId,
    boardLoggingByOperator,
    attendance,
    appActivityByEmail,
  });

  return {
    generatedAt: new Date(),
    start: reportStart,
    end: reportEnd,
    reportingBaseline,
    companyName: 'URBAN VIBE INTERIOR DESIGN COMPANY LTD',
    warehouseId,
    boardSummary,
    boardLoggingByOperator,
    boardLoggingEncouragementNote,
    operatorSystemUsage,
    penalties,
    moCompletion,
    poVsFinanceDocs,
    workOrdersBeforeBoardLogs,
    attendance,
    salesTeamAttendance,
  };
}

// ─── PDF Renderer ────────────────────────────────────────────────────

export function buildWeeklyPoSummaryPoint(poPrimary: MonSatPoVsDocsWeekRow): string {
  return `PO vs Finance receipts (Mon ${poPrimary.monday} to Sat ${poPrimary.saturday} — different day range from main report): ${poPrimary.posConfirmed} confirmed PO(s) created vs ${poPrimary.docsEligibleInvoices} eligible Finance invoice/receipt doc(s) uploaded (${poPrimary.minMissingReceipts} min. missing receipt(s)).`;
}

export function buildWeeklyReceiptsAndMoPoint(params: {
  undoneReceipts: number;
  completed: number;
  eligible: number;
  completionPercent: number;
  end: string;
}): string {
  const undoneReceipts = Math.max(0, Number(params.undoneReceipts || 0));
  const openMos = Math.max(0, Number(params.eligible || 0) - Number(params.completed || 0));
  const receiptReason = undoneReceipts > 0 || openMos > 0
    ? ' Reason: pending board intake logs automatically validate purchased-board receipts once recorded — operators, especially assistants/helpers, need to work on board intake logging promptly so receipts auto-validate and Manufacturing Orders are not delayed.'
    : ' All purchased-board receipts have been auto-validated via board intake logs.';
  return `${undoneReceipts} purchased-board receipt(s) need validation; ${params.completed} of ${params.eligible} eligible MO(s) created in the period were completed by ${params.end} (${params.completionPercent}%).${receiptReason}`;
}

export interface ProductionTeamOvertimeSummary {
  teamOvertimeCount: number;
  operatorShiftCount: number;
  overtimeDates: string[];
  byOperator: Array<{ name: string; count: number }>;
}

export function summarizeProductionTeamOvertimes(
  attendance: Array<{
    name: string;
    overtimeRecords: Array<{ dateRange: string; checkIn: string | null; checkOut: string | null; workedHours: number; shiftType: string }>;
  }>,
): ProductionTeamOvertimeSummary {
  const teamDates = new Set<string>();
  const operatorDates = new Map<string, Set<string>>();
  let operatorShiftCount = 0;

  for (const person of attendance) {
    for (const rec of person.overtimeRecords || []) {
      operatorShiftCount += 1;
      const dateKey = nairobiDateKey(rec.checkIn) || String(rec.dateRange || '').split(' -> ')[0].trim();
      if (!dateKey) continue;
      teamDates.add(dateKey);
      if (!operatorDates.has(person.name)) operatorDates.set(person.name, new Set());
      operatorDates.get(person.name)!.add(dateKey);
    }
  }

  const overtimeDates = [...teamDates].sort();
  const byOperator = [...operatorDates.entries()]
    .map(([name, dates]) => ({ name, count: dates.size }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    teamOvertimeCount: overtimeDates.length,
    operatorShiftCount,
    overtimeDates,
    byOperator,
  };
}

export function buildWeeklyOvertimeSummaryPoint(
  attendance: Array<{
    name: string;
    overtimeRecords: Array<{ dateRange: string; checkIn: string | null; checkOut: string | null; workedHours: number; shiftType: string }>;
  }>,
): string {
  const summary = summarizeProductionTeamOvertimes(attendance);
  if (summary.teamOvertimeCount === 0) {
    return 'Production team covered 0 overtimes during the period.';
  }
  const dateList = summary.overtimeDates.join(', ');
  const staffBreakdown = summary.byOperator.map((item) => `${item.name} (${item.count})`).join(', ');
  return `Production team covered ${summary.teamOvertimeCount} overtime(s) during the period (${dateList}) — covered by ${staffBreakdown}.`;
}

export async function renderWeeklyShopFloorReportPdf(
  reportInput?: Omit<Awaited<ReturnType<typeof buildWeeklyShopFloorReport>>, 'operatorSystemUsage'> & {
    operatorSystemUsage?: OperatorSystemUsageSummary;
  },
  scope?: { fromDate?: string; toDate?: string },
): Promise<Buffer> {
  const report = reportInput || await buildWeeklyShopFloorReport(scope);
  const document = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
  const chunks: Buffer[] = [];
  document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve, reject) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
  });

  const navy = '#22213f';
  const copper = '#cf8464';
  const ink = '#1e293b';
  const muted = '#64748b';
  const border = '#dbe2ea';
  const pageWidth = 595.28;
  const contentWidth = pageWidth - 84;
  const logoPath = resolveFromProjectRoot('src', 'public', 'icons', 'urban-vibe-logo-dark.png');

  const ensureSpace = (height: number) => {
    if (document.y + height > 756) document.addPage();
  };
  const section = (title: string, subtitle?: string) => {
    ensureSpace(subtitle ? 52 : 34);
    document.moveDown(0.65);
    document.x = 42;
    document.font('Helvetica-Bold').fontSize(13).fillColor(navy).text(title, 42, document.y, { width: contentWidth });
    document.moveTo(42, document.y + 3).lineTo(553, document.y + 3).strokeColor(copper).lineWidth(1.5).stroke();
    document.moveDown(0.55);
    if (subtitle) {
      document.font('Helvetica').fontSize(8).fillColor(muted).text(subtitle, 42, document.y, { width: contentWidth, lineGap: 2 });
      document.moveDown(0.25);
    }
  };
  const card = (x: number, y: number, width: number, label: string, value: string, note: string, accent: string) => {
    document.roundedRect(x, y, width, 66, 7).fillAndStroke('#f8fafc', border);
    document.rect(x, y, 4, 66).fill(accent);
    document.font('Helvetica-Bold').fontSize(18).fillColor(ink).text(value, x + 12, y + 11, { width: width - 20 });
    document.font('Helvetica-Bold').fontSize(7).fillColor(muted).text(label.toUpperCase(), x + 12, y + 34, { width: width - 20 });
    document.font('Helvetica').fontSize(6.8).fillColor(muted).text(note, x + 12, y + 47, { width: width - 20, lineBreak: false });
  };
  const tableHeader = (columns: Array<{ label: string; x: number; width: number; align?: 'left' | 'center' | 'right' }>) => {
    const y = document.y;
    document.rect(42, y, contentWidth, 22).fill(navy);
    columns.forEach((column) =>
      document.font('Helvetica-Bold').fontSize(6.8).fillColor('#ffffff').text(column.label, column.x, y + 7, {
        width: column.width,
        align: column.align || 'left',
        lineBreak: false,
      }),
    );
    document.y = y + 22;
  };
  const calloutBox = (text: string, opts: { bg: string; stroke: string; textColor: string; bold?: boolean }) => {
    document.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.6);
    const textHeight = document.heightOfString(text, { width: contentWidth - 18, lineGap: 2 });
    const boxHeight = Math.max(24, textHeight + 14);
    ensureSpace(boxHeight + 6);
    const y = document.y + 3;
    document.roundedRect(42, y, contentWidth, boxHeight, 5).fillAndStroke(opts.bg, opts.stroke);
    document.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.6).fillColor(opts.textColor).text(text, 51, y + 7, {
      width: contentWidth - 18,
      lineGap: 2,
    });
    document.y = y + boxHeight + 6;
  };

  // ── Header Banner ──
  document.rect(0, 0, pageWidth, 112).fill(navy);
  document.font('Helvetica-Bold').fontSize(20).fillColor('#ffffff').text('Wednesday Shop Floor Report', 42, 30);
  document.font('Helvetica-Bold').fontSize(9).fillColor(copper).text(report.companyName, 42, 59);
  document.font('Helvetica').fontSize(8).fillColor('#dbe2ea').text(
    `Warehouse ${report.warehouseId}  |  Period ${report.start} to ${report.end}  |  Data baseline ${report.reportingBaseline}  |  Generated ${report.generatedAt.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}`,
    42,
    78,
  );
  try {
    document.image(logoPath, pageWidth - 150, 24, { fit: [108, 62], align: 'right', valign: 'center' });
  } catch {
    // Allow rendering in environments without the logo file
  }
  document.y = 130;

  // ── Top KPI Cards ──
  const attendanceTotals = report.attendance.reduce((totals, person) => {
    person.days.forEach((day) => {
      if (day.status === 'Present' || day.status === 'Overtime covered') totals.present += 1;
      else if (day.status === 'Absent') totals.absent += 1;
      if (day.late) totals.late += 1;
      totals.noCheckout += day.missingCheckoutRecords.length;
    });
    return totals;
  }, { present: 0, absent: 0, noCheckout: 0, late: 0 });
  const expectedAttendance = report.attendance.length * (report.attendance[0]?.days.length || 0);
  const attendanceRate = expectedAttendance ? Math.round(((attendanceTotals.present + Math.min(attendanceTotals.noCheckout, expectedAttendance)) / expectedAttendance) * 100) : 0;
  const coverage = Number(report.boardSummary?.coveragePercent || 0);
  const cardGap = 8;
  const cardWidth = (contentWidth - cardGap * 3) / 4;
  const cardY = document.y;
  card(42, cardY, cardWidth, 'MO board coverage', `${coverage}%`, `${report.boardSummary?.registeredBoards || 0}/${report.boardSummary?.expectedBoards || 0} cutting MOs logged`, coverage >= 90 ? '#16a34a' : '#dc2626');
  card(42 + cardWidth + cardGap, cardY, cardWidth, 'WOs before board log', String(report.workOrdersBeforeBoardLogs.violations.length), `${report.workOrdersBeforeBoardLogs.startedAndFinishedBeforeLogCount} finished | ${report.workOrdersBeforeBoardLogs.startedBeforeLogCount} started`, report.workOrdersBeforeBoardLogs.violations.length === 0 ? '#16a34a' : '#dc2626');
  card(42 + (cardWidth + cardGap) * 2, cardY, cardWidth, 'PO receipts gap (M-S)', String(report.poVsFinanceDocs.primaryWeek.minMissingReceipts), `${report.poVsFinanceDocs.primaryWeek.docsEligibleInvoices}/${report.poVsFinanceDocs.primaryWeek.posConfirmed} docs (${report.poVsFinanceDocs.primaryMonday.slice(5)}..${report.poVsFinanceDocs.primarySaturday.slice(5)})`, report.poVsFinanceDocs.primaryWeek.minMissingReceipts === 0 ? '#16a34a' : '#d97706');
  card(42 + (cardWidth + cardGap) * 3, cardY, cardWidth, 'Attendance rate', `${attendanceRate}%`, `${attendanceTotals.absent} absence(s)`, attendanceRate >= 90 ? '#16a34a' : '#d97706');
  document.y = cardY + 78;

  // ── 1. Management Summary ──
  section('Management summary');
  const missingCheckoutNames = [...new Set(report.attendance.flatMap((person) => person.days.flatMap((day) => day.missingCheckoutRecords.length ? [person.name] : [])))];
  const missingCheckoutSummary = attendanceTotals.noCheckout
    ? `Did not check out: ${attendanceTotals.noCheckout} employee record(s)${missingCheckoutNames.length ? ` - ${missingCheckoutNames.join(', ')}` : ''}.`
    : 'Missing checkouts: 0';
  const overtimeSummary = summarizeProductionTeamOvertimes(report.attendance);
  const overtimePoint = buildWeeklyOvertimeSummaryPoint(report.attendance);

  const poPrimary = report.poVsFinanceDocs.primaryWeek;
  const poSummaryPoint = buildWeeklyPoSummaryPoint(poPrimary);

  const preLogAudit = report.workOrdersBeforeBoardLogs;
  const preLogPoint = preLogAudit.violations.length > 0
    ? `${preLogAudit.violations.length} of ${preLogAudit.totalChecked} cutting work order(s) were started or finished before board logs were recorded (${preLogAudit.startedBeforeLogCount} started before log; ${preLogAudit.startedAndFinishedBeforeLogCount} started & finished before log).`
    : `All ${preLogAudit.totalChecked} cutting work order(s) started/finished in the period had board logs recorded beforehand.`;

  const salesCheckInPoint = report.salesTeamAttendance.length
    ? `Sharon & Candy check-in/out: ${report.salesTeamAttendance.map((s) => `${s.name} (${s.daysWithCheckIn}/${s.expectedWorkdays}d checked in, ${s.missingCheckoutCount} open, ${s.multiDaySessionCount} multi-day unclosed)`).join('; ')}.`
    : 'Sharon & Candy attendance records were not available for this period.';

  const receiptsAndMoPoint = buildWeeklyReceiptsAndMoPoint({
    undoneReceipts: report.penalties?.undoneReceipts || 0,
    completed: report.moCompletion.completed,
    eligible: report.moCompletion.eligible,
    completionPercent: report.moCompletion.completionPercent,
    end: report.end,
  });

  const criticalPoints = [
    `${report.boardSummary?.missingBoards || 0} cutting MO(s) from ${report.start} to ${report.end} have no same-day board inventory log; current coverage is ${coverage}%.`,
    preLogPoint,
    poSummaryPoint,
    receiptsAndMoPoint,
    `${attendanceTotals.absent} Operations absence record(s) across ${report.attendance[0]?.days.length || 0} working day(s), ${attendanceTotals.late} late check-in(s) after 8:20 AM EAT. ${missingCheckoutSummary}`,
    salesCheckInPoint,
    overtimePoint,
  ];
  criticalPoints.forEach((point, index) => {
    ensureSpace(22);
    document.circle(48, document.y + 5, 3).fill(index === 0 || (index === 1 && preLogAudit.violations.length > 0) ? '#dc2626' : copper);
    document.font('Helvetica').fontSize(8.8).fillColor(ink).text(point, 58, document.y, { width: 490, lineGap: 2 });
    document.moveDown(0.32);
  });

  // ── 2. Director System-Usage Assessment ──
  const attendanceDataCompleteness = expectedAttendance
    ? Math.max(0, Math.round(((expectedAttendance - attendanceTotals.noCheckout) / expectedAttendance) * 100))
    : 100;
  const receiptUsageScore = Number(report.penalties?.undoneReceipts || 0) === 0 ? 100 : Number(report.penalties?.undoneReceipts || 0) <= 2 ? 60 : 20;
  const moUsageScore = report.moCompletion.completionPercent;
  const adoptionScore = Math.round((coverage + receiptUsageScore + moUsageScore + attendanceDataCompleteness) / 4);
  const adoptionLabel = adoptionScore >= 90 ? 'FULL USE' : adoptionScore >= 75 ? 'PARTIAL USE' : 'POOR USE';
  const adoptionColor = adoptionScore >= 90 ? '#16a34a' : adoptionScore >= 75 ? '#d97706' : '#dc2626';
  ensureSpace(145);
  section('Director system-usage assessment', 'This score measures whether required shop-floor actions are being recorded in the system; it does not treat genuine absence as app misuse.');
  const assessmentY = document.y;
  document.roundedRect(42, assessmentY, 108, 55, 6).fillAndStroke('#f8fafc', border);
  document.font('Helvetica-Bold').fontSize(19).fillColor(adoptionColor).text(`${adoptionScore}%`, 54, assessmentY + 9, { width: 84 });
  document.font('Helvetica-Bold').fontSize(7).fillColor(adoptionColor).text(adoptionLabel, 54, assessmentY + 34, { width: 84 });
  const usageEvidence = [
    { label: 'MO board logging', score: coverage, issue: `${report.boardSummary?.missingBoards || 0} MOs missing` },
    { label: 'Receipt validation', score: receiptUsageScore, issue: `${report.penalties?.undoneReceipts || 0} pending (needs board intake logs)` },
    { label: 'MO completion rate', score: moUsageScore, issue: `${report.moCompletion.completed}/${report.moCompletion.eligible} completed; ${report.moCompletion.open} open` },
    { label: 'Checkout data integrity', score: attendanceDataCompleteness, issue: `${attendanceTotals.noCheckout} blank checkout; ${attendanceTotals.absent} regular absence(s)` },
  ];
  usageEvidence.forEach((item, index) => {
    const x = 165 + (index % 2) * 194;
    const y = assessmentY + Math.floor(index / 2) * 27;
    document.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(item.label, x, y + 2, { width: 116, lineBreak: false });
    document.font('Helvetica-Bold').fontSize(8).fillColor(item.score >= 90 ? '#16a34a' : item.score >= 75 ? '#d97706' : '#dc2626').text(`${item.score}%`, x + 118, y + 2, { width: 32, align: 'right' });
    document.font('Helvetica').fontSize(6.5).fillColor(muted).text(item.issue, x, y + 13, { width: 150, lineBreak: false });
  });
  document.y = assessmentY + 64;
  const usageActions = usageEvidence.filter((item) => item.score < 90).map((item) => item.label);
  const receiptActionHint = receiptUsageScore < 90
    ? ' Note: board intake logs automatically validate pending purchased-board receipts, so operators (especially assistants/helpers) must prioritize board intake logging.'
    : '';
  document.font('Helvetica-Bold').fontSize(7.5).fillColor(usageActions.length ? '#dc2626' : '#16a34a').text(
    usageActions.length
      ? `DIRECTOR ACTION: Require completion of ${usageActions.join(', ')} and review exceptions with the responsible operators.${receiptActionHint}`
      : `DIRECTOR NOTE: Checkout data integrity is complete. ${attendanceTotals.absent} regular-shift absence(s) and separate overnight/overtime records are reported independently.`,
    42,
    document.y,
    { width: contentWidth, lineGap: 2 },
  );
  document.moveDown(0.5);

  // ── 3. Purchase Orders vs Finance Documents (Monday to Saturday) ──
  ensureSpace(240);
  section(
    'Purchase orders vs Finance documents (Monday – Saturday)',
    'Compares confirmed Purchase Orders created (minimum expected receipts/invoices) against eligible PDF/image receipts uploaded or emailed into the Odoo Documents Finance folder (excluding Delivery Notes and excluded vendors).',
  );
  calloutBox(
    `NOTE — DIFFERENT DAY RANGE: This Purchase Order & Finance Documents comparison runs Monday to Saturday (primary week: Mon ${report.poVsFinanceDocs.primaryMonday} to Sat ${report.poVsFinanceDocs.primarySaturday}, EAT), which is a different day range from the main Wednesday Shop Floor Report period (${report.start} to ${report.end}).`,
    { bg: '#eff6ff', stroke: '#bfdbfe', textColor: '#1e3a8a', bold: true },
  );

  if (report.poVsFinanceDocs.fetchError) {
    document.font('Helvetica').fontSize(8.2).fillColor('#b45309').text(
      `Notice: Live PO vs Finance document counts could not be refreshed (${report.poVsFinanceDocs.fetchError}).`,
      48,
      document.y + 4,
      { width: contentWidth - 12 },
    );
    document.moveDown(0.5);
  } else {
    const poCols = [
      { label: 'WEEK (MON – SAT)', x: 48, width: 138 },
      { label: 'CONFIRMED POs', x: 190, width: 68, align: 'center' as const },
      { label: 'DRAFT/CXL', x: 262, width: 54, align: 'center' as const },
      { label: 'FINANCE DOCS', x: 320, width: 70, align: 'center' as const },
      { label: 'ELIGIBLE DOCS', x: 394, width: 70, align: 'center' as const },
      { label: 'GAP (MISSING)', x: 468, width: 80, align: 'center' as const },
    ];
    ensureSpace(26 + report.poVsFinanceDocs.weeks.length * 26 + 26);
    tableHeader(poCols);
    report.poVsFinanceDocs.weeks.forEach((week, index) => {
      ensureSpace(28);
      if (document.y < 55) tableHeader(poCols);
      const y = document.y;
      const bg = week.isPrimary ? '#fefce8' : (index % 2 ? '#f8fafc' : '#ffffff');
      document.rect(42, y, contentWidth, 25).fill(bg);
      const gapLabel = week.netGap < 0
        ? `${Math.abs(week.netGap)} missing`
        : week.netGap > 0
          ? `+${week.netGap} surplus`
          : '0 (matched)';
      const gapColor = week.netGap < 0 ? '#dc2626' : '#16a34a';
      document.font(week.isPrimary ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.1).fillColor(ink)
        .text(`${week.monday} – ${week.saturday}${week.isPrimary ? ' *' : ''}`, 48, y + 8, { width: 138, lineBreak: false });
      document.font('Helvetica-Bold').fontSize(7.4).fillColor(ink)
        .text(String(week.posConfirmed), 190, y + 8, { width: 68, align: 'center' });
      document.font('Helvetica').fontSize(7.2).fillColor(muted)
        .text(String(week.posDraftOrCancel), 262, y + 8, { width: 54, align: 'center' });
      document.font('Helvetica').fontSize(7.2).fillColor(ink)
        .text(String(week.docsTotal), 320, y + 8, { width: 70, align: 'center' })
        .text(String(week.docsEligibleInvoices), 394, y + 8, { width: 70, align: 'center' });
      document.font('Helvetica-Bold').fontSize(7.2).fillColor(gapColor)
        .text(gapLabel, 468, y + 8, { width: 80, align: 'center' });
      document.y = y + 25;
    });

    // Totals row
    ensureSpace(28);
    const ty = document.y;
    const poTot = report.poVsFinanceDocs.totals;
    document.rect(42, ty, contentWidth, 25).fill('#f1f5f9');
    const totalGapLabel = poTot.netGap < 0
      ? `${Math.abs(poTot.netGap)} missing`
      : poTot.netGap > 0
        ? `+${poTot.netGap} surplus`
        : '0 (matched)';
    document.font('Helvetica-Bold').fontSize(7.3).fillColor(navy)
      .text(`${report.poVsFinanceDocs.weeks.length}-Week Total`, 48, ty + 8, { width: 138, lineBreak: false })
      .text(String(poTot.posConfirmed), 190, ty + 8, { width: 68, align: 'center' })
      .text(String(poTot.posDraftOrCancel), 262, ty + 8, { width: 54, align: 'center' })
      .text(String(poTot.docsTotal), 320, ty + 8, { width: 70, align: 'center' })
      .text(String(poTot.docsEligibleInvoices), 394, ty + 8, { width: 70, align: 'center' });
    document.fillColor(poTot.netGap < 0 ? '#dc2626' : '#16a34a')
      .text(totalGapLabel, 468, ty + 8, { width: 80, align: 'center' });
    document.y = ty + 29;

    const unfiledNote = report.poVsFinanceDocs.unfiledNoFolderDocsInRange > 0
      ? ` Unfiled alert: ${report.poVsFinanceDocs.unfiledNoFolderDocsPrimaryWeek} document(s) in the primary Mon–Sat week (${report.poVsFinanceDocs.unfiledNoFolderDocsInRange} across the ${report.poVsFinanceDocs.weeks.length}-week window) were uploaded with no folder assigned and should be checked/moved to Finance.`
      : '';
    document.font('Helvetica').fontSize(6.9).fillColor(muted).text(
      `* Highlighted row = latest completed Monday–Saturday week (${report.poVsFinanceDocs.primaryMonday} to ${report.poVsFinanceDocs.primarySaturday}). Confirmed POs represent the minimum number of supplier invoices/receipts expected in Odoo Documents (Finance).${unfiledNote}`,
      42,
      document.y,
      { width: contentWidth, lineGap: 1.5 },
    );
    document.moveDown(0.35);
  }

  // ── 4. Board Logging by Operator + Encouragement Note ──
  const boardLogTotals = report.boardLoggingByOperator.reduce((totals, operator) => {
    totals.records += operator.records;
    totals.boards += operator.boards;
    totals.synced += operator.synced;
    totals.failed += operator.failed;
    totals.reverted += (operator.reverted || 0);
    return totals;
  }, { records: 0, boards: 0, synced: 0, failed: 0, reverted: 0 });

  section(
    'Board logging by operator',
    `Board intake records created from ${report.start} to ${report.end} across all Operations operators. Total: ${boardLogTotals.records} record(s), ${boardLogTotals.boards} board(s).`,
  );
  const boardLogCols = [
    { label: 'OPERATOR', x: 48, width: 146 },
    { label: 'RECORDS', x: 198, width: 42, align: 'center' as const },
    { label: 'BOARDS', x: 244, width: 42, align: 'center' as const },
    { label: 'SHARE', x: 290, width: 42, align: 'center' as const },
    { label: 'SYNCED', x: 336, width: 42, align: 'center' as const },
    { label: 'FAILED', x: 382, width: 42, align: 'center' as const },
    { label: 'REVERTED', x: 428, width: 46, align: 'center' as const },
    { label: 'LAST LOG', x: 478, width: 66 },
  ];
  tableHeader(boardLogCols);
  if (!report.boardLoggingByOperator.length) {
    document.font('Helvetica').fontSize(9).fillColor(muted).text('No Operations operators were found for board intake reporting.', 48, document.y + 8);
    document.y += 28;
  }
  report.boardLoggingByOperator.forEach((operator, index) => {
    ensureSpace(32);
    if (document.y < 55) tableHeader(boardLogCols);
    const y = document.y;
    document.rect(42, y, contentWidth, 28).fill(operator.records === 0 ? '#fff7f7' : (index % 2 ? '#f8fafc' : '#ffffff'));
    const boardShare = boardLogTotals.boards ? Math.round((operator.boards / boardLogTotals.boards) * 100) : 0;
    document.font('Helvetica-Bold').fontSize(7.3).fillColor(ink).text(operator.name, 48, y + 6, { width: 146, height: 10, ellipsis: true });
    if (operator.email) document.font('Helvetica').fontSize(5.8).fillColor(muted).text(operator.email, 48, y + 17, { width: 146, height: 8, ellipsis: true });
    document.font(operator.records === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor(operator.records === 0 ? '#dc2626' : ink)
      .text(String(operator.records), 198, y + 9, { width: 42, align: 'center' });
    document.font('Helvetica').fontSize(7.5).fillColor(ink)
      .text(String(operator.boards), 244, y + 9, { width: 42, align: 'center' })
      .text(`${boardShare}%`, 290, y + 9, { width: 42, align: 'center' })
      .text(String(operator.synced), 336, y + 9, { width: 42, align: 'center' });
    document.fillColor(operator.failed > 0 ? '#dc2626' : ink).text(String(operator.failed), 382, y + 9, { width: 42, align: 'center' });
    document.fillColor((operator.reverted || 0) > 0 ? '#dc2626' : ink).text(String(operator.reverted || 0), 428, y + 9, { width: 46, align: 'center' });
    document.fontSize(5.9).fillColor(muted).text(operator.lastLoggedAt ? nairobiAppDateTime(operator.lastLoggedAt) : 'No logs', 478, y + 8, { width: 66, height: 16 });
    document.y = y + 28;
  });
  document.moveDown(0.3);
  document.font('Helvetica').fontSize(7).fillColor(muted).text(
    `Totals: ${boardLogTotals.records} records | ${boardLogTotals.boards} boards | ${boardLogTotals.synced} synced | ${boardLogTotals.failed} failed | ${boardLogTotals.reverted} reverted`,
    42,
    document.y,
    { width: contentWidth },
  );
  document.moveDown(0.25);

  // Encouragement callout box for operators with low board logs
  calloutBox(report.boardLoggingEncouragementNote, {
    bg: '#f0fdf4',
    stroke: '#86efac',
    textColor: '#14532d',
    bold: true,
  });

  // ── 4B. System Usage & Knowledge per Operator (Pie Graph) ──
  const systemUsageSummary: OperatorSystemUsageSummary = report.operatorSystemUsage || computeOperatorSystemUsageSummary({
    operators: report.attendance.map((a, idx) => ({ id: idx + 1, name: a.name })),
    workcenterSessionsByOperatorId: new Map(),
    boardLoggingByOperator: report.boardLoggingByOperator,
    attendance: report.attendance,
  });

  const pieRowCount = Math.max(4, systemUsageSummary.operators.length);
  const pieCardHeight = Math.max(156, 26 + pieRowCount * 24 + 14);
  ensureSpace(pieCardHeight + 90);
  section(
    'System usage & knowledge per operator',
    `Visual share of total system interactions (Shop Floor work-order timers, Board Intake logs, Attendance check-in/out, and portal activity) from ${report.start} to ${report.end}, paired with each operator's system proficiency level.`,
  );

  const pieCardY = document.y;
  document.roundedRect(42, pieCardY, contentWidth, pieCardHeight, 8).fillAndStroke('#f8fafc', border);

  const pieSlices: PdfPieSlice[] = systemUsageSummary.operators.map((op, idx) => {
    const badgePalette = op.knowledgeLevel === 'Advanced'
      ? { color: '#065f46', bg: '#d1fae5' }
      : op.knowledgeLevel === 'Proficient'
        ? { color: '#1d4ed8', bg: '#dbeafe' }
        : op.knowledgeLevel === 'Developing'
          ? { color: '#92400e', bg: '#fef3c7' }
          : { color: '#991b1b', bg: '#fee2e2' };
    return {
      label: op.name,
      value: op.totalUsageActions,
      color: PIE_CHART_PALETTE[idx % PIE_CHART_PALETTE.length],
      sublabel: `SF Timers: ${op.shopFloorSessions} · Boards: ${op.boardLogRecords} · Att: ${op.attendanceActions}${op.appActivityActions > 0 ? ` · App: ${op.appActivityActions}` : ''} (${op.totalUsageActions} total)`,
      badgeText: `${op.knowledgeScore}% ${op.knowledgeLevel}`,
      badgeColor: badgePalette.color,
      badgeBg: badgePalette.bg,
    };
  });

  const pieCenterY = pieCardY + pieCardHeight / 2;
  drawPdfPieChart(document, {
    cx: 122,
    cy: pieCenterY,
    radius: 58,
    innerRadius: 28,
    slices: pieSlices,
    centerTopText: String(systemUsageSummary.totalTeamActions),
    centerBottomText: 'SYSTEM ACTIONS',
    emptyLabel: 'No usage',
    legend: {
      x: 202,
      y: pieCardY + 12,
      width: contentWidth - 172,
      rowHeight: 24,
      title: 'OPERATOR SHARE & SYSTEM KNOWLEDGE',
    },
  });

  document.y = pieCardY + pieCardHeight + 8;
  calloutBox(systemUsageSummary.insightNote, {
    bg: '#eff6ff',
    stroke: '#93c5fd',
    textColor: '#1e3a8a',
    bold: true,
  });

  // ── 5. Work Orders Started / Finished Before Board Logs (replaces Overdue MO Analysis) ──
  section(
    'Work orders started or finished before board logs',
    `Replaces the previous Overdue MO list. Audits cutting work orders started or completed between ${report.start} and ${report.end} that were started—or both started and finished—before a matching board intake log (or PO board receipt) was recorded.`,
  );
  if (preLogAudit.fetchError) {
    document.font('Helvetica').fontSize(8.2).fillColor('#b45309').text(
      `Notice: Work order vs board log audit could not be completed (${preLogAudit.fetchError}).`,
      48,
      document.y + 4,
      { width: contentWidth - 12 },
    );
    document.moveDown(0.5);
  } else {
    document.font('Helvetica-Bold').fontSize(7.8).fillColor(muted).text(
      `CHECKED CUTTING WOs: ${preLogAudit.totalChecked}   |   COMPLIANT: ${preLogAudit.compliantCount}   |   STARTED BEFORE LOG: ${preLogAudit.startedBeforeLogCount}   |   STARTED & FINISHED BEFORE LOG: ${preLogAudit.startedAndFinishedBeforeLogCount}`,
      42,
      document.y,
      { width: contentWidth },
    );
    document.moveDown(0.25);
    if (preLogAudit.byOperator.length > 0) {
      document.font('Helvetica-Bold').fontSize(7.6).fillColor(ink).text(
        `BY OPERATOR   ${preLogAudit.byOperator.map((o) => `${o.operatorName}: ${o.total} (${o.startedAndFinished} finished, ${o.startedOnly} started)`).join('   |   ')}`,
        42,
        document.y,
        { width: contentWidth, lineGap: 1.5 },
      );
      document.moveDown(0.45);
    } else {
      document.moveDown(0.25);
    }

    const preLogCols = [
      { label: 'MO / CLIENT', x: 48, width: 114 },
      { label: 'BOARD / WORK ORDER', x: 164, width: 116 },
      { label: 'OPERATOR', x: 282, width: 82 },
      { label: 'STARTED / FINISHED', x: 366, width: 90 },
      { label: 'BOARD LOG STATUS', x: 458, width: 92 },
    ];
    tableHeader(preLogCols);
    if (!preLogAudit.violations.length) {
      document.font('Helvetica-Bold').fontSize(8.5).fillColor('#16a34a').text(
        'Compliant: No cutting work orders were started or finished before board logs were recorded in this period.',
        48,
        document.y + 8,
        { width: contentWidth - 12 },
      );
      document.y += 28;
    } else {
      const MAX_VIOLATION_ROWS = 25;
      const displayed = preLogAudit.violations.slice(0, MAX_VIOLATION_ROWS);
      displayed.forEach((item, index) => {
        ensureSpace(34);
        if (document.y < 55) tableHeader(preLogCols);
        const y = document.y;
        const isFinishedViolation = item.violationType === 'started_and_finished_before_log' || item.violationType === 'started_and_finished_no_log';
        document.rect(42, y, contentWidth, 32).fill(index % 2 ? '#fff7f7' : '#ffffff');

        document.font('Helvetica-Bold').fontSize(6.9).fillColor(ink).text(item.moName, 48, y + 5, { width: 114, height: 10, ellipsis: true });
        document.font('Helvetica').fontSize(6.1).fillColor(muted).text(`${item.origin !== '-' ? `${item.origin} · ` : ''}${item.clientName}`, 48, y + 16, { width: 114, height: 12, ellipsis: true });

        document.font('Helvetica').fontSize(6.6).fillColor(ink).text(item.missingBoardNames.join(', ') || item.productName, 164, y + 6, { width: 116, height: 22, ellipsis: true });
        document.font('Helvetica').fontSize(6.6).fillColor(ink).text(item.operatorName, 282, y + 8, { width: 82, height: 18, ellipsis: true });

        const timingText = item.finishedAt
          ? `S: ${nairobiDateTime(item.startedAt)}\nF: ${nairobiDateTime(item.finishedAt)}`
          : `S: ${nairobiDateTime(item.startedAt)}\nIn progress`;
        document.font('Helvetica').fontSize(6.1).fillColor(ink).text(timingText, 366, y + 5, { width: 90, height: 24, lineGap: 1 });

        const boardStatusText = item.firstBoardLogAtDisplay
          ? `${item.violationLabel}\nLogged: ${item.firstBoardLogAtDisplay}`
          : item.violationLabel;
        document.font('Helvetica-Bold').fontSize(6.1).fillColor(isFinishedViolation ? '#dc2626' : '#b45309')
          .text(boardStatusText, 458, y + 5, { width: 92, height: 24, lineGap: 1 });

        document.y = y + 32;
      });
      if (preLogAudit.violations.length > MAX_VIOLATION_ROWS) {
        document.moveDown(0.25);
        document.font('Helvetica').fontSize(7.2).fillColor(muted).text(
          `Showing ${MAX_VIOLATION_ROWS} most recent violations out of ${preLogAudit.violations.length} total (${preLogAudit.violations.length - MAX_VIOLATION_ROWS} additional work order(s) omitted for brevity).`,
          42,
          document.y,
          { width: contentWidth },
        );
      }
    }
  }

  // ── 6. Missing Checkout Details (Operations) ──
  const checkoutRows = report.attendance.flatMap((person) =>
    person.days.flatMap((day) => day.missingCheckoutRecords.length ? [{ person, day, record: day.missingCheckoutRecords[0] }] : []),
  );
  if (checkoutRows.length) {
    section('Missing checkout details (Operations)', 'Missing checkout means the Odoo attendance row has check_in but its check_out value is blank. A different check-in and checkout date is not a failure.');
    const checkoutCols = [
      { label: 'EMPLOYEE', x: 48, width: 145 },
      { label: 'CHECK-IN DATE / TIME', x: 198, width: 104 },
      { label: 'EXPECTED SHIFT / DATE', x: 306, width: 92 },
      { label: 'CHECK-OUT', x: 402, width: 78 },
      { label: 'STATUS / REASON', x: 484, width: 64 },
    ];
    tableHeader(checkoutCols);
    checkoutRows.forEach(({ person, day, record }, index) => {
      ensureSpace(32);
      if (document.y < 55) tableHeader(checkoutCols);
      const y = document.y;
      document.rect(42, y, contentWidth, 30).fill(index % 2 ? '#fff7f7' : '#ffffff');
      document.font('Helvetica-Bold').fontSize(6.9).fillColor(ink).text(person.name, 48, y + 9, { width: 145, lineBreak: false });
      document.font('Helvetica').fontSize(6.5).text(nairobiDateTime(record.check_in), 198, y + 8, { width: 104, height: 18 });
      document.font('Helvetica').fontSize(6.5).text(day.date, 306, y + 8, { width: 92, height: 18 });
      document.font('Helvetica').fontSize(6.5).fillColor('#991b1b').text('Not recorded', 402, y + 8, { width: 78, height: 18 });
      document.font('Helvetica-Bold').fontSize(6.2).fillColor('#991b1b').text('Missing\ncheck-out', 484, y + 5, { width: 64, height: 22 });
      document.y = y + 30;
    });
  }

  // ── 7. Overnight & Overtime Records (Operations) ──
  const allOvertimeEntries = report.attendance.flatMap((person) =>
    person.overtimeRecords.map((session) => ({ name: person.name, session })),
  );
  section(
    'Overnight and overtime records (Operations)',
    `Production team covered ${overtimeSummary.teamOvertimeCount} overtime(s) during this period. Off-hours overtime is recorded when an operator logs in after daytime operators have checked out for the day, on a Sunday, or on an overnight shift.`,
  );
  if (allOvertimeEntries.length) {
    const overtimeCols = [
      { label: 'EMPLOYEE', x: 48, width: 140 },
      { label: 'DATES', x: 192, width: 100 },
      { label: 'CHECK-IN', x: 296, width: 76 },
      { label: 'CHECK-OUT', x: 376, width: 76 },
      { label: 'HOURS / SHIFT TYPE', x: 456, width: 92 },
    ];
    tableHeader(overtimeCols);
    allOvertimeEntries.forEach(({ name, session }, index) => {
      const isExceeded = session.workedHours > 8;
      const rowHeight = isExceeded ? 32 : 28;
      ensureSpace(rowHeight + 2);
      if (document.y < 55) tableHeader(overtimeCols);
      const y = document.y;
      document.rect(42, y, contentWidth, rowHeight).fill(index % 2 ? '#f8fafc' : '#ffffff');
      document.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(name, 48, y + (isExceeded ? 7 : 9), { width: 140, lineBreak: false });
      document.font('Helvetica').fontSize(7.2).text(session.dateRange, 192, y + (isExceeded ? 7 : 9), { width: 100, lineBreak: false });
      document.font('Helvetica').fontSize(6.8).text(nairobiDateTime(session.checkIn), 296, y + (isExceeded ? 7 : 9), { width: 76, lineBreak: false });
      document.text(session.checkOut ? nairobiDateTime(session.checkOut) : 'Open', 376, y + (isExceeded ? 7 : 9), { width: 76, lineBreak: false });
      document.font('Helvetica-Bold').fontSize(6.8).fillColor(session.checkOut ? '#16a34a' : '#b45309').text(`${Number(session.workedHours || 0).toFixed(1)}h ${session.shiftType}`, 456, y + (isExceeded ? 5 : 9), { width: 92, lineBreak: false });
      if (isExceeded) {
        document.font('Helvetica').fontSize(5.6).fillColor('#b45309').text('* Exceeds 8h (split required)', 456, y + 17, { width: 92, lineBreak: false });
      }
      document.y = y + rowHeight;
    });
  } else {
    document.font('Helvetica').fontSize(8.5).fillColor(muted).text('No off-hours overtime, night shifts, or Sunday records were logged during this reporting period.', 48, document.y + 8);
    document.y += 24;
  }

  calloutBox(
    'REMINDER: When working night or weekend overtime, check out before the morning shift arrives, then check in to start the new workday.',
    { bg: '#fffbeb', stroke: '#fde68a', textColor: '#92400e', bold: true },
  );

  // ── 8. Attendance System Usage (Operations) ──
  section('Attendance system usage (Operations)', 'Attendance rate measures scheduled-shift coverage. A completed overnight overtime row covers the following workday and is shown separately; it does not create an absence or no-check-in exception. Checkout data integrity measures whether recorded Odoo rows have a checkout.');
  const usageCols = [
    { label: 'EMPLOYEE', x: 48, width: 146 },
    { label: 'CHECK-IN', x: 198, width: 60, align: 'center' as const },
    { label: 'CHECK-OUT', x: 262, width: 66, align: 'center' as const },
    { label: 'COMPLETE', x: 332, width: 66, align: 'center' as const },
    { label: 'OVERTIME', x: 402, width: 74, align: 'center' as const },
    { label: 'SYSTEM USAGE', x: 480, width: 66, align: 'center' as const },
  ];
  tableHeader(usageCols);
  report.attendance.forEach((person, index) => {
    ensureSpace(32);
    if (document.y < 55) tableHeader(usageCols);
    const expectedDays = person.days.length;
    const checkIns = person.days.filter((day) => ['Present', 'Overtime covered', 'No checkout'].includes(day.status)).length;
    const checkOuts = person.days.filter((day) => ['Present', 'Overtime covered'].includes(day.status)).length;
    const completeShifts = checkOuts;
    const checkInRate = expectedDays ? Math.round((checkIns / expectedDays) * 100) : 0;
    const checkOutRate = expectedDays ? Math.round((checkOuts / expectedDays) * 100) : 0;
    const systemRate = expectedDays ? Math.round((completeShifts / expectedDays) * 100) : 0;
    const y = document.y;
    document.rect(42, y, contentWidth, 28).fill(index % 2 ? '#f8fafc' : '#ffffff');
    document.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(person.name, 48, y + 9, { width: 146, lineBreak: false });
    document.font('Helvetica').fontSize(7.5).fillColor(checkInRate >= 90 ? '#16a34a' : checkInRate >= 75 ? '#d97706' : '#dc2626').text(`${checkInRate}%`, 198, y + 9, { width: 60, align: 'center' });
    document.fillColor(checkOutRate >= 90 ? '#16a34a' : checkOutRate >= 75 ? '#d97706' : '#dc2626').text(`${checkOutRate}%`, 262, y + 9, { width: 66, align: 'center' });
    document.fillColor(ink).text(`${completeShifts}/${expectedDays}`, 332, y + 9, { width: 66, align: 'center' });
    const operatorOvertimeCount = overtimeSummary.byOperator.find((item) => item.name === person.name)?.count || 0;
    document.font('Helvetica-Bold').fontSize(7.2).fillColor(operatorOvertimeCount ? '#b45309' : muted).text(operatorOvertimeCount ? `${operatorOvertimeCount} OT` : '-', 402, y + 9, { width: 74, align: 'center' });
    document.font('Helvetica-Bold').fontSize(7.5).fillColor(systemRate >= 90 ? '#16a34a' : systemRate >= 75 ? '#d97706' : '#dc2626').text(`${systemRate}%`, 480, y + 9, { width: 66, align: 'center' });
    document.y = y + 28;
  });
  document.moveDown(0.25);
  document.font('Helvetica').fontSize(7).fillColor(muted).text(
    'Attendance rate = scheduled workdays covered by a regular check-in or a completed overnight overtime row ÷ scheduled working days. Checkout data integrity = scheduled attendance denominator less blank checkouts.',
    42,
    document.y,
    { width: contentWidth },
  );

  // ── 9. Check-in & Check-out — Sharon & Candy ──
  section(
    'Check-in & Check-out — Sharon & Candy',
    `Odoo HR attendance check-in and check-out records for Sharon and Candy covering ${report.start} to ${report.end} (Nairobi EAT). Reported separately from Operations attendance scores.`,
  );
  if (!report.salesTeamAttendance.length) {
    document.font('Helvetica').fontSize(8.5).fillColor(muted).text(
      'No active employee profiles matched Sharon or Candy in Odoo.',
      48,
      document.y + 6,
    );
    document.y += 24;
  } else {
    // Summary table for Sharon & Candy
    const scSummaryCols = [
      { label: 'STAFF MEMBER', x: 48, width: 150 },
      { label: 'CHECK-IN DAYS', x: 202, width: 74, align: 'center' as const },
      { label: 'SAME-DAY OUT', x: 280, width: 74, align: 'center' as const },
      { label: 'LATE (>8:20)', x: 358, width: 62, align: 'center' as const },
      { label: 'OPEN (NO OUT)', x: 424, width: 60, align: 'center' as const },
      { label: 'MULTI-DAY', x: 488, width: 58, align: 'center' as const },
    ];
    ensureSpace(26 + report.salesTeamAttendance.length * 26);
    tableHeader(scSummaryCols);
    report.salesTeamAttendance.forEach((person, index) => {
      ensureSpace(28);
      if (document.y < 55) tableHeader(scSummaryCols);
      const y = document.y;
      document.rect(42, y, contentWidth, 25).fill(index % 2 ? '#f8fafc' : '#ffffff');
      document.font('Helvetica-Bold').fontSize(7.4).fillColor(ink).text(`${person.name}`, 48, y + 8, { width: 150, lineBreak: false });
      document.font('Helvetica').fontSize(7.4).fillColor(ink)
        .text(`${person.daysWithCheckIn}/${person.expectedWorkdays}`, 202, y + 8, { width: 74, align: 'center' })
        .text(`${person.daysWithSameDayCheckOut}/${person.expectedWorkdays}`, 280, y + 8, { width: 74, align: 'center' });
      document.fillColor(person.lateCount > 0 ? '#d97706' : '#16a34a')
        .text(String(person.lateCount), 358, y + 8, { width: 62, align: 'center' });
      document.font('Helvetica-Bold').fillColor(person.missingCheckoutCount > 0 ? '#dc2626' : '#16a34a')
        .text(String(person.missingCheckoutCount), 424, y + 8, { width: 60, align: 'center' });
      document.font('Helvetica-Bold').fillColor(person.multiDaySessionCount > 0 ? '#b45309' : '#16a34a')
        .text(String(person.multiDaySessionCount), 488, y + 8, { width: 58, align: 'center' });
      document.y = y + 25;
    });

    document.moveDown(0.45);
    // Detailed check-in / check-out log for Sharon & Candy
    const scDetailRows = report.salesTeamAttendance.flatMap((person) =>
      person.sessions.length > 0
        ? person.sessions.map((session) => ({ name: person.name, session }))
        : [{ name: person.name, session: null as NamedStaffAttendanceSession | null }],
    );
    const scDetailCols = [
      { label: 'STAFF MEMBER', x: 48, width: 126 },
      { label: 'CHECK-IN (EAT)', x: 178, width: 96 },
      { label: 'CHECK-OUT (EAT)', x: 278, width: 96 },
      { label: 'HOURS', x: 378, width: 52, align: 'center' as const },
      { label: 'STATUS', x: 434, width: 112 },
    ];
    ensureSpace(48);
    tableHeader(scDetailCols);
    scDetailRows.forEach(({ name, session }, index) => {
      ensureSpace(28);
      if (document.y < 55) tableHeader(scDetailCols);
      const y = document.y;
      const isAlert = !session || session.status === 'No check-out' || session.status === 'Multi-day (unclosed)';
      document.rect(42, y, contentWidth, 25).fill(isAlert ? '#fff7f7' : (index % 2 ? '#f8fafc' : '#ffffff'));
      document.font('Helvetica-Bold').fontSize(7.2).fillColor(ink).text(name, 48, y + 8, { width: 126, lineBreak: false });
      if (!session) {
        document.font('Helvetica').fontSize(7).fillColor('#dc2626')
          .text('No check-in / check-out recorded in period', 178, y + 8, { width: 368, lineBreak: false });
      } else {
        document.font('Helvetica').fontSize(7).fillColor(ink)
          .text(nairobiDateTime(session.checkIn), 178, y + 8, { width: 96, lineBreak: false });
        document.fillColor(session.checkOut ? ink : '#dc2626')
          .text(session.checkOut ? nairobiDateTime(session.checkOut) : 'Not checked out', 278, y + 8, { width: 96, lineBreak: false });
        document.fillColor(session.multiDayUnclosed ? '#b45309' : ink)
          .text(session.checkOut ? `${session.workedHours.toFixed(1)}h` : '-', 378, y + 8, { width: 52, align: 'center' });
        const statusColor = session.status === 'Complete'
          ? '#16a34a'
          : session.status === 'Late check-in'
            ? '#d97706'
            : '#dc2626';
        document.font('Helvetica-Bold').fontSize(7).fillColor(statusColor)
          .text(session.status, 434, y + 8, { width: 112, lineBreak: false });
      }
      document.y = y + 25;
    });
    document.moveDown(0.25);
    document.font('Helvetica').fontSize(7).fillColor(muted).text(
      'Multi-day (unclosed) = check-in and check-out spanned different calendar days or exceeded 16 hours, indicating a missed same-day check-out.',
      42,
      document.y,
      { width: contentWidth },
    );
  }

  // ── Page Footers ──
  const footerUrl = String(env.APP_BASE_URL || 'https://app.urbanvibeinteriordesign.co.ke').replace(/\/+$/, '');
  const footerRange = document.bufferedPageRange();
  for (let pageIndex = footerRange.start; pageIndex < footerRange.start + footerRange.count; pageIndex += 1) {
    document.switchToPage(pageIndex);
    // Keep the footer inside PDFKit's bottom margin; placing it lower causes
    // PDFKit to create a new footer-only page for each buffered page.
    const footerY = document.page.height - 52;
    document.moveTo(42, footerY - 6).lineTo(pageWidth - 42, footerY - 6).strokeColor(border).lineWidth(0.6).stroke();
    document.font('Helvetica').fontSize(7).fillColor(muted)
      .text(`Report source: ${footerUrl}`, 42, footerY, { width: contentWidth - 55, lineBreak: false })
      .text(`Page ${pageIndex - footerRange.start + 1} of ${footerRange.count}`, pageWidth - 95, footerY, { width: 53, align: 'right', lineBreak: false });
  }
  document.end();
  return done;
}

export async function sendWeeklyShopFloorReport(additionalRecipients: string[] = [], includeDefaultRecipients = true) {
  const [settings, users, reportResult] = await Promise.all([
    getSettings(),
    getApprovedAuthUsers(),
    getOrBuildWeeklyShopFloorReportPdf(undefined, { forceRefresh: true }),
  ]);
  const pdf = reportResult.pdf;
  const filename = reportResult.filename;
  const defaultRecipients = includeDefaultRecipients ? [
    env.AUTH_LOCAL_ADMIN_EMAIL.trim().toLowerCase(),
    ...users.filter((user) => user.active && RECIPIENT_NAMES.some((name) => user.email.toLowerCase().includes(name))).map((user) => user.email.toLowerCase()),
  ] : [];
  const recipients = [...new Set([
    ...defaultRecipients,
    ...additionalRecipients.map((email) => email.trim().toLowerCase()),
  ].filter(Boolean))];
  if (!recipients.length) throw new Error('No active approved users matched dbadmin, Charles, or Raphael.');
  const mailResult = await sendMailWithConfig(settings.mail, {
    to: recipients.join(', '),
    subject: 'Wednesday Shop Floor Accountability Report',
    text: 'Attached is the Urban Vibe weekly Shop Floor accountability report covering board logging, Monday–Saturday PO vs Finance document receipts, work orders started before board logs, Operations attendance, Sharon & Candy check-in/check-out records, overtime, and system usage.',
    html: '<p>Attached is the Urban Vibe weekly Shop Floor accountability report covering board logging, Monday–Saturday PO vs Finance document receipts, work orders started before board logs, Operations attendance, Sharon &amp; Candy check-in/check-out records, overtime, and system usage.</p>',
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  } as any);
  const smtpInfo = mailResult.info as { accepted?: string[]; rejected?: string[]; pending?: string[]; response?: string; messageId?: string };
  await logEvent('info', 'Wednesday Shop Floor report sent', {
    recipients,
    smtpAccount: mailResult.fromEmail,
    accepted: smtpInfo.accepted || [],
    rejected: smtpInfo.rejected || [],
    pending: smtpInfo.pending || [],
    response: smtpInfo.response || null,
    messageId: smtpInfo.messageId || null,
  });
  return recipients;
}

let warmupTimeout: NodeJS.Timeout | null = null;

export function startWeeklyShopFloorReportWarmup() {
  if (warmupTimeout) return;
  // Background pre-warm the default report PDF snapshot ONLY if not already fresh in DB cache,
  // and run at background priority so it never stalls interactive requests or scheduler runs.
  warmupTimeout = setTimeout(() => {
    if (isSchedulerRunActive()) return;
    void runWithOdooPriority('background', async () => {
      await getOrBuildWeeklyShopFloorReportPdf();
    }).catch((err) => {
      console.warn('[weekly-report] Initial warmup failed:', err?.message || err);
    });
  }, 60 * 1000);
  warmupTimeout.unref?.();
}

export async function purgeWeeklyReportCaches(): Promise<void> {
  try {
    await deleteShopFloorSharedCachePrefix('shop-floor:weekly-report-pdf:');
  } catch (err) {
    console.warn('[weekly-report] Failed to purge old weekly report caches:', err);
  }
}

/**
 * @deprecated Automated email delivery is managed centrally by emailAutomationService using settings.mail.automations.
 * This function is preserved for backward compatibility and delegates to background warmup.
 */
export function startWeeklyShopFloorReportInterval() {
  startWeeklyShopFloorReportWarmup();
}

export interface CachedWeeklyPdfData {
  pdfBase64: string;
  filename: string;
  generatedAt: string;
  reportStart: string;
  reportEnd: string;
}

export function getWeeklyReportCacheKey(start: string, end: string): string {
  return `shop-floor:weekly-report-pdf:v4:${start}:${end}`;
}

export async function getOrBuildWeeklyShopFloorReportPdf(
  scope?: { fromDate?: string; toDate?: string },
  options?: { forceRefresh?: boolean },
): Promise<{ pdf: Buffer; filename: string; fromCache: boolean }> {
  const settings = await getSettings();
  const reportingBaseline = settings.mail.shopFloorReportingStartDate;

  let reportStart: string;
  let reportEnd: string;
  if (scope?.fromDate && scope?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(String(scope.fromDate)) && /^\d{4}-\d{2}-\d{2}$/.test(String(scope.toDate))) {
    reportStart = clampShopFloorReportingDate(String(scope.fromDate), reportingBaseline);
    reportEnd = clampShopFloorReportingDate(String(scope.toDate), reportingBaseline);
  } else {
    const window = defaultReportWindow();
    reportStart = clampShopFloorReportingDate(window.start, reportingBaseline);
    reportEnd = clampShopFloorReportingDate(window.end, reportingBaseline);
  }

  const cacheKey = getWeeklyReportCacheKey(reportStart, reportEnd);
  const defaultFilename = `shop-floor-weekly-${reportStart}-to-${reportEnd}.pdf`;

  if (!options?.forceRefresh) {
    try {
      const cached = await getShopFloorSharedCache<CachedWeeklyPdfData>(cacheKey);
      if (cached?.data?.pdfBase64) {
        const buffer = Buffer.from(cached.data.pdfBase64, 'base64');
        const cacheAgeMs = Date.now() - new Date(cached.syncedAt).getTime();
        // If older than 60 minutes, trigger non-blocking background revalidation
        if (cacheAgeMs > 60 * 60 * 1000) {
          void generateAndCacheWeeklyReportPdf({ fromDate: reportStart, toDate: reportEnd }).catch((e) => {
            console.warn('[weekly-report] Background revalidation failed:', e);
          });
        }
        return { pdf: buffer, filename: cached.data.filename || defaultFilename, fromCache: true };
      }
    } catch (err) {
      console.warn('[weekly-report] Error reading cached PDF:', err);
    }
  }

  // Generate fresh PDF
  const pdf = await renderWeeklyShopFloorReportPdf(undefined, { fromDate: reportStart, toDate: reportEnd });
  try {
    await saveShopFloorSharedCache(cacheKey, {
      pdfBase64: pdf.toString('base64'),
      filename: defaultFilename,
      generatedAt: new Date().toISOString(),
      reportStart,
      reportEnd,
    });
  } catch (err) {
    console.warn('[weekly-report] Failed to save generated PDF to cache:', err);
  }

  return { pdf, filename: defaultFilename, fromCache: false };
}

export async function generateAndCacheWeeklyReportPdf(scope?: { fromDate?: string; toDate?: string }): Promise<void> {
  await getOrBuildWeeklyShopFloorReportPdf(scope, { forceRefresh: true });
}
