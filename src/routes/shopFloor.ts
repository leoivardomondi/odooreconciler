import { Request, Response, Router } from 'express';
import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import {
  countBoardIntakeQueueEntries,
  createBoardIntakeQueueEntry,
  getApprovedAuthUsers,
  getBoardIntakeQueueEntry,
  getRecentBoardIntakeQueueEntries,
  getSettings,
  getShopFloorFeatureFlags,
  saveShopFloorFeatureFlags,
  upsertApprovedAuthUser,
  getShopFloorDashboardSnapshot,
  saveShopFloorDashboardSnapshot,
  getShopFloorSharedCache,
  saveShopFloorSharedCache,
  deleteShopFloorSharedCache,
  deleteShopFloorSharedCachePrefix,
  deleteShopFloorDashboardSnapshot,
  getPendingShopFloorProcesses,
  markPendingShopFloorProcessesLoaded,
  saveSettings,
  getShopFloorIncidents,
  createShopFloorIncident,
  resolveShopFloorIncident,
  getShopFloorAssignedItems,
  assignShopFloorItem,
  enqueueShopFloorValidationJob,
  getActiveShopFloorValidationJobs,
  getRecentShopFloorValidationJobs,
  getShopFloorValidationJobById,
  claimBoardIntakeRevert,
  finishBoardIntakeRevert,
  releaseBoardIntakeRevert,
  unmarkPendingShopFloorProcessesLoaded,
} from '../models/repositories';
import { ShopFloorFeatureFlags, ShopFloorFeatureKey } from '../models/types';
import { wakeShopFloorValidationJobWorker } from '../services/shopFloorValidationJobService';
import { OdooClient } from '../services/odooClient';
import { buildPayrollAdvanceRecords } from '../services/payrollBridgeService';
import { getRecentMpesaStatementBatches, getMpesaTransactionsByBatchId } from '../models/repositories';
import { sendMailWithConfig } from '../services/mailTransport';
import { logEvent } from '../services/logService';
import { isValidMachineComponent, MACHINE_BREAKDOWN_CATALOG } from '../services/machineBreakdownCatalog';
import { env } from '../utils/env';
import {
  sendWeeklyShopFloorReport,
  getOrBuildWeeklyShopFloorReportPdf,
  generateAndCacheWeeklyReportPdf,
} from '../services/weeklyShopFloorReportService';
import { getConfirmedMoQueueSchedule, getMoOverdueState } from '../services/moOverdueService';
import { isBoardProductName } from '../services/boardProductClassifier';
import {
  generateMoStockShortageReport,
  renderMoStockShortageReportHtml,
  sendDailyMoStockShortageReport,
  updateMoStockShortageAutomationSettings,
} from '../services/moStockShortageReportService';
import { getStockMirrorForPage, recordOptimisticStockAddition, refreshStockMirror, recordExactStockQuantity } from '../services/stockMirrorService';
import { getCustomersForPage, searchCustomers } from '../services/customerMirrorService';
import { revertBoardIntakeEntry, syncBoardIntakeEntry } from '../services/boardIntakeSyncService';
import { syncShopFloorOperatorAccess } from '../services/shopFloorOperatorAccessSyncService';
import { syncPendingProcessesFromOdoo } from '../services/shopFloorPendingSyncService';
import { extractSoNameFromOrigin } from '../services/poJobSummaryAuditService';
import { isAllowedAttendanceIp, normalizeIpAddress } from '../utils/siteAttendanceAccess';
import { normalizeBoardLogRecipients } from '../utils/helpers';
import { isAccountDeactivated } from '../utils/accountStatus';

const router = Router();

// Department names to search for operators (case-insensitive match)
const OPERATOR_DEPARTMENT_NAMES = ['Operations', 'Production', 'Shop Floor', 'Manufacturing', 'Factory'];
const MANUFACTURING_AREAS = ['Table Saw Area', 'Edge Banding Area', 'Panel Rack Area'];
const SHOP_FLOOR_FEATURE_KEYS: ShopFloorFeatureKey[] = [
  'start-finish', 'add-stock', 'receipts', 'deliveries', 'attendance', 'maintenance', 'payroll', 'table-saw', 'edge-banding', 'panel-rack',
];
const purchaseApprovalEmailCooldown = new Map<string, number>();
const PURCHASE_APPROVAL_EMAIL_COOLDOWN_MS = 30 * 60 * 1000;
export const manuallyPausedMoIds = new Set<number>();

async function sendPurchaseApprovalRequest(input: {
  settings: Awaited<ReturnType<typeof getSettings>>;
  operatorName: string;
  operatorEmail: string;
  procurement: Awaited<ReturnType<OdooClient['getManufacturingOrderBoardProcurement']>>;
}) {
  const pendingOrders = input.procurement.purchaseOrders.filter((po) => ['draft', 'sent', 'to approve'].includes(po.state));
  if (!pendingOrders.length) return { sent: false, throttled: false };
  const cooldownKey = pendingOrders.map((po) => po.id).sort((a, b) => a - b).join(',');
  const lastSentAt = purchaseApprovalEmailCooldown.get(cooldownKey) || 0;
  if (Date.now() - lastSentAt < PURCHASE_APPROVAL_EMAIL_COOLDOWN_MS) {
    return { sent: false, throttled: true };
  }

  const users = await getApprovedAuthUsers();
  const resolvedRecipients = users
    .filter((user) => user.active && ['dbadmin', 'charles'].some((name) => user.email.toLowerCase().includes(name)))
    .map((user) => user.email.trim().toLowerCase());
  const recipients = [...new Set([
    ...resolvedRecipients,
    env.AUTH_LOCAL_ADMIN_EMAIL.toLowerCase().includes('dbadmin') ? env.AUTH_LOCAL_ADMIN_EMAIL.trim().toLowerCase() : '',
    'dbadmin@urbanvibeinteriordesign.co.ke',
    'charles@urbanvibeinteriordesign.co.ke',
  ].filter(Boolean))];
  const poRows = pendingOrders.map((po) =>
    `<li><strong>${escapeHtml(po.name)}</strong> — ${escapeHtml(po.state)}${po.supplier ? ` — ${escapeHtml(po.supplier)}` : ''}</li>`,
  ).join('');
  const boardRows = input.procurement.unavailableBoards.map((board) =>
    `<li>${escapeHtml(board.name)} — required ${board.required}, available ${board.available}</li>`,
  ).join('');
  const appUrl = env.APP_BASE_URL.replace(/\/+$/, '');
  await sendMailWithConfig(input.settings.mail, {
    to: recipients.join(', '),
    subject: `Purchase approval required for ${input.procurement.moName}`,
    text: [
      `${input.operatorName} attempted to start ${input.procurement.moName}, but its required boards are waiting on an unapproved purchase order.`,
      `Sales order: ${input.procurement.origin || 'Not available'}`,
      `Purchase orders: ${pendingOrders.map((po) => `${po.name} (${po.state})`).join(', ')}`,
      `Open Purchase Orders: ${appUrl}/purchase-orders`,
    ].join('\n'),
    html: `<p><strong>${escapeHtml(input.operatorName)}</strong> (${escapeHtml(input.operatorEmail)}) attempted to start <strong>${escapeHtml(input.procurement.moName)}</strong>, but required boards are waiting on purchase approval.</p>
      <p>Sales order: <strong>${escapeHtml(input.procurement.origin || 'Not available')}</strong></p>
      <h3>Purchase orders requiring approval</h3><ul>${poRows}</ul>
      <h3>Required boards</h3><ul>${boardRows}</ul>
      <p><a href="${escapeHtml(`${appUrl}/purchase-orders`)}">Open Purchase Orders</a></p>`,
  });
  purchaseApprovalEmailCooldown.set(cooldownKey, Date.now());
  await logEvent('info', 'Purchase approval email sent from Shop Floor start attempt', {
    moId: input.procurement.moId,
    moName: input.procurement.moName,
    purchaseOrders: pendingOrders.map((po) => ({ id: po.id, name: po.name, state: po.state })),
    recipients,
    operatorEmail: input.operatorEmail,
  });
  return { sent: true, throttled: false };
}

function canManageShopFloor(req: Request): boolean {
  return Boolean(req.authUser && (req.authUser.role === 'admin' || req.authUser.apps?.includes('shop-floor-admin')));
}

function canUseSiteAttendance(req: Request) {
  if (canManageShopFloor(req)) return true;
  const clientIp = req.ip || req.socket.remoteAddress || '';
  const normalized = normalizeIpAddress(clientIp);
  if (['127.0.0.1', '::1', 'localhost'].includes(normalized)) return true;
  const xForwardedFor = (req.headers['x-forwarded-for'] as string) || '';
  const allIps = [clientIp, ...xForwardedFor.split(',')].map((s) => s.trim()).filter(Boolean);
  for (const ip of allIps) {
    if (isAllowedAttendanceIp(ip, env.ATTENDANCE_ALLOWED_IPS)) return true;
  }
  return false;
}

function getViewedUserEmail(req: Request): string {
  return String(req.viewingAsUser?.email || req.authUser?.email || '').trim();
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character));
}

function normalizeManufacturingArea(areaName: string | null | undefined): string | null {
  const normalized = String(areaName || '').trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized === 'area-table-saw' ||
    normalized.includes('table saw') ||
    normalized.includes('table-saw') ||
    normalized.includes('saw') ||
    normalized.includes('cutting') ||
    normalized.includes('cut')
  ) {
    return 'Table Saw Area';
  }
  if (
    normalized === 'area-edge-banding' ||
    normalized.includes('edge banding') ||
    normalized.includes('edge-banding') ||
    normalized.includes('edgeband') ||
    normalized.includes('edging')
  ) {
    return 'Edge Banding Area';
  }
  if (
    normalized === 'area-panel-rack' ||
    normalized.includes('panel rack') ||
    normalized.includes('panel-rack') ||
    normalized.includes('panel area') ||
    normalized.includes('panel') ||
    normalized.includes('rack') ||
    normalized.includes('optimis')
  ) {
    return 'Panel Rack Area';
  }
  return MANUFACTURING_AREAS.find((area) => area.toLowerCase() === normalized) || null;
}

function detectArea(productName: string): string {
  const n = productName.toLowerCase();
  if (n.includes('edge banding') || n.includes('edgeband') || n.includes('edging')) return 'Edge Banding Area';
  if (
    n.startsWith('cutting') ||
    n.includes('cut ') ||
    n.includes('cutting ') ||
    n.includes('table saw') ||
    n.includes('saw') ||
    isBoardProductName(productName)
  ) {
    return 'Table Saw Area';
  }
  if (n.includes('optimised') || n.includes('optimized') || n.includes('panel') || n.includes('rack')) {
    return 'Panel Rack Area';
  }
  return 'Table Saw Area';
}

function isBoardComponentName(productName: string | null | undefined): boolean {
  return isBoardProductName(productName);
}

export function isBitcherOnyangoUser(user?: { email?: string | null; displayName?: string | null } | null): boolean {
  if (!user) return false;
  const name = String(user.displayName || '').toLowerCase().trim();
  const email = String(user.email || '').toLowerCase().trim();
  return name.includes('bitcher') || email.includes('bitcher');
}

export function isTintInteriorVendor(partner: any): boolean {
  if (!partner) return false;
  let name = '';
  if (Array.isArray(partner) && partner.length > 1) {
    name = String(partner[1] || '');
  } else if (typeof partner === 'object' && partner !== null) {
    name = String(partner.name || partner.display_name || '');
  } else if (typeof partner === 'string') {
    name = partner;
  }
  const clean = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean.includes('tintinterior') || (clean.includes('tint') && clean.includes('interior'));
}

export function isBitcherOnyangoRestrictedFromReceipt(
  user?: { email?: string | null; displayName?: string | null } | null,
  receipt?: { partner_id?: any } | null,
): boolean {
  if (!user || !receipt) return false;
  return isBitcherOnyangoUser(user) && isTintInteriorVendor(receipt.partner_id);
}

interface StockAlert {
  moName: string;
  product: string;
  component: string;
  qtyNeeded: number;
  totalNeeded?: number;
  qtyReserved?: number;
  client: string | null;
  moId: number;
  confirmedAt: string | null;
  overdueDays: number;
  partnerId?: number | null;
  productId?: number | null;
  isSyncing?: boolean;
  syncingQty?: number;
  isMoClosed?: boolean;
}

function toEAT(utcStr: string | null): string | null {
  if (!utcStr) return null;
  try {
    const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T');
    const parsedDate = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
    if (isNaN(parsedDate.getTime())) return utcStr;

    const timezone = env.APP_TIMEZONE || 'Africa/Nairobi';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    }).formatToParts(parsedDate);
    
    const value = (type: string) => parts.find((part) => part.type === type)?.value || '00';
    return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
  } catch {
    return utcStr;
  }
}

function getOverdueDaysFromDateOrder(dateOrder: string | null): number {
  if (!dateOrder) return 0;
  const timezone = env.APP_TIMEZONE || 'Africa/Nairobi';
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayParts = formatter.formatToParts(new Date());
  const today = `${todayParts.find((part) => part.type === 'year')?.value || '0000'}-${todayParts.find((part) => part.type === 'month')?.value || '01'}-${todayParts.find((part) => part.type === 'day')?.value || '01'}`;
  const confirmed = toEAT(dateOrder)?.slice(0, 10) || dateOrder.slice(0, 10);

  const confirmedDate = new Date(`${confirmed}T00:00:00Z`);
  const todayDate = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(confirmedDate.getTime()) || Number.isNaN(todayDate.getTime())) {
    return 0;
  }

  return Math.max(0, Math.floor((todayDate.getTime() - confirmedDate.getTime()) / (1000 * 60 * 60 * 24)));
}

interface OperatorSummary {
  id: number;
  name: string;
  jobTitle: string | null;
  department: string | null;
  workEmail: string | null;
  mobilePhone: string | null;
  userId: number | null;
  userName: string | null;
  checkedIn: boolean;
  checkedOut: boolean;
  checkInTime: string | null;
  assignedItems: Array<{ id: string; itemName: string; assignedDate: string; quantity: number }>;
}

interface OperatorDashboardData {
  employee: {
    id: number;
    name: string;
    jobTitle: string | null;
    department: string | null;
    workEmail: string | null;
    mobilePhone: string | null;
    manager: string | null;
  } | null;
  attendance: {
    checkedIn: boolean;
    checkedOut: boolean;
    todayRecord: {
      check_in: string;
      check_out: string | null;
    } | null;
    recentRecords: Array<{ check_in: string; check_out: string | null }>;
    isLate: boolean;
  } | null;
  workOrders: Array<{
    id: number;
    name: string;
    product: string;
    qty: number;
    produced: number;
    state: string;
    plannedStart: string | null;
    dateStarted: string | null;
    dateFinished: string | null;
    dateDeadline: string | null;
    createdAt: string | null;
    estimatedFinishAt: string | null;
    isOverdue: boolean;
    progress: number;
    origin: string | null;
    client: string | null;
    assignedTo: string | null;
    area: string;
    hasStockIssue: boolean;
    stockStatus: 'ready' | 'incoming' | 'no_stock';
  }>;
  payslips: Array<{
    id: number;
    name: string;
    dateFrom: string;
    dateTo: string;
    state: string;
    structure: string;
  }>;
  salaryAdvances: Array<{
    employeeName: string;
    amount: number;
    date: string;
    reference: string;
  }>;
  stockAlerts: StockAlert[];
  lateCount: number;
  incidents: Array<{ id: string; machineName: string; description: string | null; reportedBy: string | null; reportedAt: string; status: string; }>;
  assignedItems: Array<{ id: string; itemName: string; assignedDate: string; quantity: number; notes: string | null; }>;
  failedCheckouts: Array<{ date: string; hours: number; nextDayCheckIn: string | null }>;
  performanceRate: { percentage: number; color: string; totalOrders: number; } | null;
  areaPerformanceRates: Array<{
    area: string;
    percentage: number;
    color: string;
    totalOrders: number;
    completedOrders: number;
    onTimeOrders: number;
    overdueQuickClose: number;
    avgDaysToComplete: number;
  }>;
  manufacturingTimingSummary: {
    monthLabel: string;
    totalOrders: number;
    startedWithin1Day: number;
    finishedWithin3Days: number;
    sameDayStartFinish: number;
    withSalesOrders: number;
  } | null;
  manufacturingTimelineData: {
    monthLabel: string;
    workCenters: Array<{ id: number; name: string }>;
    records: Array<{
      moName: string;
      workCenter: string;
      product: string;
      area: string;
      origin: string | null;
      startedAt: string;
      finishedAt: string;
    }>;
  } | null;
  boardRegistrationSummary: {
    monthLabel: string;
    registeredBoards: number;
    expectedBoards: number;
    missingBoards: number;
    registeredMoves: number;
    expectedMoves: number;
    missingMoves?: number;
    missingBoardSheets?: number;
    expectedBoardSheets?: number;
    registeredBoardSheets?: number;
    coveragePercent: number;
    details: string;
  } | null;
  teamPenalties: { unmarkedDeliveries: number; undoneReceipts: number } | null;
  isLimitedDashboard: boolean;
  machines: Array<{ id: number; name: string }>;
  error: string | null;
  reservedBoardsCount: number;
}

interface CacheEntry<T> {
  value: T;
  freshUntil: number;
  expiresAt: number;
}

class MemoryCache {
  private cache = new Map<string, CacheEntry<any>>();
  private inFlight = new Map<string, Promise<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number, freshTtlMs?: number): void {
    const now = Date.now();
    this.cache.set(key, {
      value,
      freshUntil: now + (typeof freshTtlMs === 'number' ? freshTtlMs : ttlMs),
      expiresAt: now + ttlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
    void deleteShopFloorSharedCache(key).catch(() => {});
  }

  keys(): IterableIterator<string> {
    return this.cache.keys();
  }

  getEntry<T>(key: string): CacheEntry<T> | null {
    return this.cache.get(key) || null;
  }

  clearPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
    if (prefix === 'shop-floor-dashboard:') {
      const sharedMo = this.cache.get('shop-floor:shared-work-orders:v1');
      if (sharedMo) {
        sharedMo.freshUntil = 0; // Trigger background revalidation while continuing to serve current snapshot
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  /**
   * Stale-While-Revalidate:
   * Returns cached value immediately if present.
   * If stale (or missing), runs fetcher in background or awaits it.
   */
  async getOrFetchSWR<T>(
    key: string,
    freshTtlMs: number,
    maxTtlMs: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key);

    if (entry && now <= entry.expiresAt) {
      // If stale, trigger background revalidation (deduplicated)
      if (now > entry.freshUntil && !this.inFlight.has(key)) {
        const bgPromise = fetcher()
          .then((fresh) => {
            this.set(key, fresh, maxTtlMs, freshTtlMs);
            return fresh;
          })
          .catch((err) => {
            console.warn(`[shopFloorCache] Background refresh failed for ${key}:`, err?.message || err);
            return entry.value;
          })
          .finally(() => {
            this.inFlight.delete(key);
          });
        this.inFlight.set(key, bgPromise);
      }
      return entry.value;
    }

    // Not cached or fully expired. Check if another request is already fetching this key.
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key) as Promise<T>;
    }

    const promise = fetcher()
      .then((fresh) => {
        this.set(key, fresh, maxTtlMs, freshTtlMs);
        return fresh;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }

  isStale(key: string): boolean {
    const entry = this.cache.get(key);
    return !entry || Date.now() > entry.freshUntil;
  }

  isInFlight(key: string): boolean {
    return this.inFlight.has(key);
  }

  /**
   * Multi-tier Stale-While-Revalidate:
   * 1. Check in-memory RAM cache (instant < 1ms)
   * 2. Check MySQL persistent shared cache (instant < 10ms)
   * 3. SWR background revalidation updates both RAM and MySQL
   * 4. Cold miss fetches fresh and persists to both RAM and MySQL
   */
  async getOrFetchTieredSWR<T>(
    key: string,
    freshTtlMs: number,
    maxTtlMs: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const entry = this.cache.get(key);

    if (entry && now <= entry.expiresAt) {
      if (now > entry.freshUntil && !this.inFlight.has(key)) {
        const bgPromise = fetcher()
          .then(async (fresh) => {
            this.set(key, fresh, maxTtlMs, freshTtlMs);
            try {
              await saveShopFloorSharedCache(key, fresh);
            } catch (err) {
              console.warn(`[shopFloorCache] MySQL save failed for ${key}:`, err);
            }
            return fresh;
          })
          .catch((err) => {
            console.warn(`[shopFloorCache] Background refresh failed for ${key}:`, err?.message || err);
            return entry.value;
          })
          .finally(() => {
            this.inFlight.delete(key);
          });
        this.inFlight.set(key, bgPromise);
      }
      return entry.value;
    }

    // Check MySQL persistent shared cache if not in RAM
    try {
      const dbEntry = await getShopFloorSharedCache<T>(key);
      if (dbEntry && dbEntry.data) {
        this.set(key, dbEntry.data, maxTtlMs, freshTtlMs);
        const ageMs = Math.max(0, now - new Date(dbEntry.syncedAt).getTime());
        if (ageMs > freshTtlMs && !this.inFlight.has(key)) {
          const bgPromise = fetcher()
            .then(async (fresh) => {
              this.set(key, fresh, maxTtlMs, freshTtlMs);
              try {
                await saveShopFloorSharedCache(key, fresh);
              } catch (err) {
                console.warn(`[shopFloorCache] MySQL save failed for ${key}:`, err);
              }
              return fresh;
            })
            .catch((err) => {
              console.warn(`[shopFloorCache] Background refresh failed for ${key}:`, err?.message || err);
              return dbEntry.data;
            })
            .finally(() => {
              this.inFlight.delete(key);
            });
          this.inFlight.set(key, bgPromise);
        }
        return dbEntry.data;
      }
    } catch (err) {
      console.warn(`[shopFloorCache] MySQL read failed for ${key}:`, err);
    }

    if (this.inFlight.has(key)) {
      return this.inFlight.get(key) as Promise<T>;
    }

    const promise = fetcher()
      .then(async (fresh) => {
        this.set(key, fresh, maxTtlMs, freshTtlMs);
        try {
          await saveShopFloorSharedCache(key, fresh);
        } catch (err) {
          console.warn(`[shopFloorCache] MySQL save failed for ${key}:`, err);
        }
        return fresh;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, promise);
    return promise;
  }
}

export const shopFloorCache = new MemoryCache();

export async function optimisticallyUpdateSharedWorkOrderState(
  moId: number,
  newState: 'progress' | 'done' | 'paused' | 'confirmed',
  operatorName?: string,
  operatorEmail?: string,
): Promise<void> {
  if (!Number.isFinite(moId) || moId <= 0) return;

  if (newState === 'paused') {
    manuallyPausedMoIds.add(moId);
  } else {
    manuallyPausedMoIds.delete(moId);
  }

  const mutateOrder = (wo: any) => {
    if (wo && wo.id === moId) {
      wo.state = newState;
      if (operatorName && (!wo.assignedTo || wo.assignedTo === 'Unassigned')) {
        wo.assignedTo = operatorName;
      }
      if (newState === 'progress' && !wo.dateStarted) {
        wo.dateStarted = new Date().toISOString();
      }
      if (newState === 'done') {
        wo.produced = wo.qty || 1;
        wo.progress = 100;
        wo.dateFinished = new Date().toISOString();
      }
      return true;
    }
    return false;
  };

  const sortOrders = (orders: any[]) => {
    orders.sort((a, b) => {
      if (a.state === 'progress' && b.state !== 'progress') return -1;
      if (a.state !== 'progress' && b.state === 'progress') return 1;
      if (a.state === 'paused' && b.state !== 'paused') return -1;
      if (a.state !== 'paused' && b.state === 'paused') return 1;
      if (a.stockStatus === 'ready' && b.stockStatus !== 'ready') return -1;
      if (a.stockStatus !== 'ready' && b.stockStatus === 'ready') return 1;
      return 0;
    });
  };

  // 1. Mutate in RAM shared work orders
  const ramSharedMo = shopFloorCache.get<{
    workOrders: any[];
    rawStockAlerts: StockAlert[];
    areaPerformanceRates: any[];
    reservedBoardsCount: number;
  }>('shop-floor:shared-work-orders:v1');
  if (ramSharedMo?.workOrders) {
    let touched = false;
    for (const wo of ramSharedMo.workOrders) {
      if (mutateOrder(wo)) touched = true;
    }
    if (touched) {
      sortOrders(ramSharedMo.workOrders);
    }
  }

  // 2. Mutate in all active RAM operator dashboard snapshots
  for (const key of shopFloorCache.keys()) {
    if (key.startsWith('shop-floor-dashboard:')) {
      const dash = shopFloorCache.get<OperatorDashboardData>(key);
      if (dash?.workOrders) {
        let touched = false;
        for (const wo of dash.workOrders) {
          if (mutateOrder(wo)) touched = true;
        }
        if (touched) {
          sortOrders(dash.workOrders);
        }
      }
    }
  }

  // 3. Mutate persistent shared cache in MySQL
  try {
    const dbSharedEntry = await getShopFloorSharedCache<{
      workOrders: any[];
      rawStockAlerts: StockAlert[];
      areaPerformanceRates: any[];
      reservedBoardsCount: number;
    }>('shop-floor:shared-work-orders:v1');
    if (dbSharedEntry?.data?.workOrders) {
      let touched = false;
      for (const wo of dbSharedEntry.data.workOrders) {
        if (mutateOrder(wo)) touched = true;
      }
      if (touched) {
        sortOrders(dbSharedEntry.data.workOrders);
        await saveShopFloorSharedCache('shop-floor:shared-work-orders:v1', dbSharedEntry.data);
      }
    }
  } catch (err) {
    console.warn('[optimisticallyUpdateSharedWorkOrderState] MySQL shared cache update failed:', err);
  }

  // 4. Mutate persistent operator dashboard snapshot in MySQL
  if (operatorEmail) {
    try {
      const normEmail = operatorEmail.trim().toLowerCase();
      const userSnap = await getShopFloorDashboardSnapshot<OperatorDashboardData>(normEmail);
      if (userSnap?.data?.workOrders) {
        let touched = false;
        for (const wo of userSnap.data.workOrders) {
          if (mutateOrder(wo)) touched = true;
        }
        if (touched) {
          sortOrders(userSnap.data.workOrders);
          await saveShopFloorDashboardSnapshot(normEmail, userSnap.data);
        }
      }
    } catch (err) {
      console.warn('[optimisticallyUpdateSharedWorkOrderState] MySQL user snapshot update failed:', err);
    }
  }
}

type OptimisticBoardIntake = { id: string; partnerId: number; productId: number; productName: string; customerName: string; quantity: number; expiresAt: number };
const optimisticBoardIntakes: OptimisticBoardIntake[] = [];
function activeOptimisticBoardIntakes() {
  const now = Date.now();
  for (let index = optimisticBoardIntakes.length - 1; index >= 0; index -= 1) if (optimisticBoardIntakes[index].expiresAt <= now) optimisticBoardIntakes.splice(index, 1);
  return optimisticBoardIntakes;
}
function applyOptimisticBoardIntakes<T extends { productId: number; qtyMissing: number; qtyReserved: number }>(partnerId: number, requirements: T[]) {
  const remainingByProduct = new Map<number, number>();
  activeOptimisticBoardIntakes().filter((entry) => entry.partnerId === partnerId).forEach((entry) => remainingByProduct.set(entry.productId, (remainingByProduct.get(entry.productId) || 0) + entry.quantity));
  return requirements.map((requirement) => {
    const remaining = remainingByProduct.get(requirement.productId) || 0;
    const applied = Math.min(remaining, requirement.qtyMissing);
    remainingByProduct.set(requirement.productId, remaining - applied);
    return { ...requirement, qtyReserved: requirement.qtyReserved + applied, qtyMissing: requirement.qtyMissing - applied };
  }).filter((requirement) => requirement.qtyMissing > 0);
}
function applyOptimisticStockAlerts(alerts: StockAlert[]) {
  const pending = activeOptimisticBoardIntakes().map((entry) => ({ ...entry, remaining: entry.quantity }));
  return alerts.map((alert) => {
    let qtyNeeded = alert.qtyNeeded;
    for (const entry of pending) {
      const sameClient = String(alert.client || '').trim().toLowerCase() === entry.customerName.trim().toLowerCase();
      const alertProduct = String(alert.component || '').toLowerCase();
      const intakeProduct = entry.productName.toLowerCase();
      if (!sameClient || (!alertProduct.includes(intakeProduct) && !intakeProduct.includes(alertProduct)) || entry.remaining <= 0) continue;
      const applied = Math.min(entry.remaining, qtyNeeded); qtyNeeded -= applied; entry.remaining -= applied;
    }
    return { ...alert, qtyNeeded };
  }).filter((alert) => alert.qtyNeeded > 0);
}

export function reconcileBoardRegistrationWithStockAlerts(
  summary: OperatorDashboardData['boardRegistrationSummary'],
  stockAlerts: StockAlert[],
): OperatorDashboardData['boardRegistrationSummary'] {
  if (!summary) return null;
  const undoneAlerts = (stockAlerts || []).filter((a) => !a.isSyncing);
  const undoneCount = undoneAlerts.length;
  const undoneBoards = undoneAlerts.reduce((sum, a) => sum + (a.qtyNeeded || 0), 0);

  if (undoneCount === 0 && undoneBoards === 0) {
    return summary;
  }

  // Stock alerts indicate active undone board intake jobs
  const missingMoves = Math.max(summary.missingMoves ?? summary.missingBoards, undoneCount);
  const missingBoards = missingMoves;
  const missingBoardSheets = Math.max(summary.missingBoardSheets || 0, undoneBoards);

  const baseExpectedMoves = Math.max(summary.expectedMoves || summary.expectedBoards || 0, 0);
  const expectedMoves = Math.max(baseExpectedMoves, missingMoves);
  const expectedBoards = expectedMoves;
  const registeredMoves = Math.max(0, expectedMoves - missingMoves);
  const registeredBoards = registeredMoves;

  const baseExpectedSheets = Math.max(summary.expectedBoardSheets || 0, summary.registeredBoardSheets || 0);
  const expectedBoardSheets = Math.max(baseExpectedSheets, missingBoardSheets);
  const registeredBoardSheets = Math.max(0, expectedBoardSheets - missingBoardSheets);

  const coveragePercent = expectedMoves > 0
    ? Math.min(99, Math.max(0, Math.round((registeredBoards / expectedMoves) * 100)))
    : 0;

  const baseDetails = summary.details ? summary.details.split(' | Active pending gate stock alerts')[0] : '';
  const details = baseDetails
    ? `${baseDetails} | Active pending gate stock alerts: ${undoneCount} ${undoneCount === 1 ? 'item' : 'items'} (${undoneBoards} boards)`
    : `Active pending gate stock alerts: ${undoneCount} ${undoneCount === 1 ? 'item' : 'items'} (${undoneBoards} boards)`;

  return {
    ...summary,
    expectedBoards,
    registeredBoards,
    missingBoards,
    expectedMoves,
    registeredMoves,
    missingMoves,
    missingBoardSheets,
    expectedBoardSheets,
    registeredBoardSheets,
    coveragePercent,
    details,
  };
}

async function withMaxPageWait<T>(promise: Promise<T>, maxWaitMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), maxWaitMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

function emptyOperatorDashboardShell(userEmail: string): OperatorDashboardData {
  const sharedMo = shopFloorCache.get<{
    workOrders: any[];
    rawStockAlerts: StockAlert[];
    areaPerformanceRates: any[];
    reservedBoardsCount: number;
  }>('shop-floor:shared-work-orders:v1');

  return {
    employee: {
      id: 0,
      name: userEmail.split('@')[0] || 'Operator',
      jobTitle: 'Operator',
      department: null,
      workEmail: userEmail,
      mobilePhone: null,
      manager: null,
    },
    attendance: null,
    workOrders: sharedMo?.workOrders || [],
    payslips: [],
    salaryAdvances: [],
    stockAlerts: sharedMo?.rawStockAlerts ? applyOptimisticStockAlerts(sharedMo.rawStockAlerts) : [],
    lateCount: 0,
    incidents: [],
    assignedItems: [],
    failedCheckouts: [],
    performanceRate: null,
    areaPerformanceRates: sharedMo?.areaPerformanceRates || [],
    manufacturingTimingSummary: null,
    manufacturingTimelineData: null,
    boardRegistrationSummary: null,
    teamPenalties: null,
    isLimitedDashboard: false,
    machines: [],
    error: null,
    reservedBoardsCount: sharedMo?.reservedBoardsCount || 0,
  };
}

/**
 * Instantly constructs the Operator Dashboard directly from local MySQL tables & shared cache (<10ms).
 * Operators immediately see all 55 active work orders, all pending stock alerts, and machine incidents
 * upon login without waiting on Odoo XML-RPC.
 */
export async function buildInstantMysqlOperatorDashboard(userEmail: string): Promise<OperatorDashboardData> {
  const normalizedEmail = (userEmail || '').trim().toLowerCase();

  const [sharedMoEntry, pendingProcesses, sharedIncidentsEntry, userSnapshot, receiptsEntry, deliveriesEntry, operatorsListEntry] = await Promise.all([
    getShopFloorSharedCache<{
      workOrders: any[];
      rawStockAlerts: StockAlert[];
      areaPerformanceRates: any[];
      reservedBoardsCount: number;
    }>('shop-floor:shared-work-orders:v1').catch(() => null),
    getPendingShopFloorProcesses({ status: 'pending' }).catch(() => []),
    getShopFloorSharedCache<any[]>('shop-floor:shared-incidents:v1').catch(() => null),
    getShopFloorDashboardSnapshot<OperatorDashboardData>(normalizedEmail).catch(() => null),
    getShopFloorSharedCache<any[]>('shop-floor:receipts:1').catch(() => null),
    getShopFloorSharedCache<any[]>('shop-floor:deliveries:1').catch(() => null),
    getShopFloorSharedCache<any[]>('shop-floor:operators-list:v2').catch(() => null),
  ]);

  const sharedMo = sharedMoEntry?.data;
  const workOrders = (sharedMo?.workOrders || []).map((wo: any) => {
    if (manuallyPausedMoIds.has(wo.id) && wo.state !== 'done') {
      return { ...wo, state: 'paused' };
    }
    return wo;
  });

  // Build stock alerts from MySQL shop_floor_pending_processes and merge with any shared MO rawStockAlerts
  const pendingAlerts: StockAlert[] = pendingProcesses.map((p) => ({
    moName: p.mo_name,
    product: p.product_name,
    component: p.product_name,
    qtyNeeded: p.qty_missing,
    totalNeeded: p.qty_needed,
    qtyReserved: p.qty_reserved,
    client: p.partner_name,
    moId: p.mo_id,
    confirmedAt: null,
    overdueDays: 0,
    partnerId: p.partner_id || null,
    productId: p.product_id || null,
    isSyncing: false,
    isMoClosed: Boolean(p.is_mo_closed),
  }));

  const stockAlerts = pendingAlerts.filter((alert) => alert.qtyNeeded > 0);

  const incidents = (sharedIncidentsEntry?.data || []).map((r: any) => {
    let machineName = r.name || 'Unknown Machine';
    if (machineName.startsWith('Breakdown: ')) {
      machineName = machineName.replace('Breakdown: ', '');
    }
    const isResolved = r.stage_id ? (r.stage_id[1] === 'Repaired' || r.stage_id[1] === 'Scrap') : false;
    return {
      id: String(r.id),
      machineName,
      description: r.description || null,
      reportedBy: r.employee_id ? r.employee_id[1] : null,
      reportedAt: r.request_date || '',
      status: isResolved ? 'resolved' : 'open',
      resolvedAt: r.close_date || null,
    };
  });

  const cachedOp = Array.isArray(operatorsListEntry?.data)
    ? operatorsListEntry.data.find((o: any) => o.email && String(o.email).trim().toLowerCase() === normalizedEmail)
    : null;

  const employee = (userSnapshot?.data?.employee && userSnapshot.data.employee.id > 0)
    ? userSnapshot.data.employee
    : {
        id: cachedOp?.id || 0,
        name: cachedOp?.name || normalizedEmail.split('@')[0] || 'Operator',
        jobTitle: cachedOp?.jobTitle || 'Operator',
        department: cachedOp?.department || null,
        workEmail: normalizedEmail,
        mobilePhone: cachedOp?.phone || null,
        manager: cachedOp?.manager || null,
      };

  const attendance = userSnapshot?.data?.attendance || null;
  const areaPerformanceRates = sharedMo?.areaPerformanceRates || [];
  const reservedBoardsCount = sharedMo?.reservedBoardsCount || 0;

  const openReceipts = Array.isArray(receiptsEntry?.data)
    ? receiptsEntry.data.filter((r: any) => r.state !== 'done' && r.state !== 'cancel').length
    : 0;
  const openDeliveries = Array.isArray(deliveriesEntry?.data)
    ? deliveriesEntry.data.filter((d: any) => d.state !== 'done' && d.state !== 'cancel').length
    : 0;
  const teamPenalties = userSnapshot?.data?.teamPenalties || {
    undoneReceipts: openReceipts,
    unmarkedDeliveries: openDeliveries,
  };

  return {
    employee,
    attendance,
    workOrders,
    payslips: userSnapshot?.data?.payslips || [],
    salaryAdvances: userSnapshot?.data?.salaryAdvances || [],
    stockAlerts,
    lateCount: userSnapshot?.data?.lateCount || 0,
    incidents,
    assignedItems: userSnapshot?.data?.assignedItems || [],
    failedCheckouts: userSnapshot?.data?.failedCheckouts || [],
    performanceRate: userSnapshot?.data?.performanceRate || null,
    areaPerformanceRates,
    manufacturingTimingSummary: userSnapshot?.data?.manufacturingTimingSummary || null,
    manufacturingTimelineData: userSnapshot?.data?.manufacturingTimelineData || null,
    boardRegistrationSummary: reconcileBoardRegistrationWithStockAlerts(
      userSnapshot?.data?.boardRegistrationSummary || null,
      stockAlerts,
    ),
    teamPenalties,
    isLimitedDashboard: false,
    machines: userSnapshot?.data?.machines || [],
    error: null,
    reservedBoardsCount,
  };
}

const dailyManufacturingAnalytics = new Map<string, { reportDay: string; value: Promise<unknown> }>();

function manufacturingReportDay() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.APP_TIMEZONE || 'Africa/Nairobi',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const today = `${value('year')}-${value('month')}-${value('day')}`;
  if (Number(value('hour')) >= 18) return today;
  const previous = new Date(`${today}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

function isStockExemptEdgeBandingService(productName: string | null | undefined): boolean {
  const normalized = String(productName || '').trim().toLowerCase();
  return normalized.includes('edge banding service') || normalized.includes('edging banding service');
}

function getDailyManufacturingAnalytics<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const reportDay = manufacturingReportDay();
  const cached = dailyManufacturingAnalytics.get(key);
  if (cached?.reportDay === reportDay) return cached.value as Promise<T>;
  const value = loader().catch((error) => {
    dailyManufacturingAnalytics.delete(key);
    throw error;
  });
  dailyManufacturingAnalytics.set(key, { reportDay, value });
  return value;
}

async function fetchSalaryAdvances(employeeName: string): Promise<Array<{ employeeName: string; amount: number; date: string; reference: string; }>> {
  const salaryAdvances: Array<{ employeeName: string; amount: number; date: string; reference: string; }> = [];
  try {
    const batches = await getRecentMpesaStatementBatches(20);
    const batchesTransactions = await Promise.all(
      batches.map(async (batch) => {
        try {
          return await getMpesaTransactionsByBatchId(batch.id);
        } catch {
          return [];
        }
      })
    );

    for (const txs of batchesTransactions) {
      const advances = buildPayrollAdvanceRecords(txs).filter((a) =>
        a.employee_name?.toLowerCase().includes(employeeName.toLowerCase()) ||
        employeeName.toLowerCase().includes(a.employee_name?.toLowerCase() || '')
      );
      for (const adv of advances) {
        salaryAdvances.push({
          employeeName: adv.employee_name || '',
          amount: typeof adv.amount === 'number' ? adv.amount : 0,
          date: adv.transaction_date || '',
          reference: adv.mpesa_receipt || '',
        });

      }
    }
  } catch {
    // Skip
  }
  return salaryAdvances;
}

export interface SharedWorkOrdersData {
  workOrders: any[];
  rawStockAlerts: StockAlert[];
  areaPerformanceRates: any[];
  reservedBoardsCount: number;
}

/**
 * Fetches all active manufacturing work orders, stock allocations, and area performances directly from Odoo.
 */
export async function fetchLiveSharedWorkOrders(client: OdooClient): Promise<SharedWorkOrdersData> {
  const [allOrdersRaw, performanceOrders] = await Promise.all([
    client.getAllActiveWorkOrders(100),
    client.getManufacturingPerformanceOrders(),
  ]);
  const allOrders = allOrdersRaw.filter((o) => o.name.startsWith('WH/MO/'));
  const originsToFetch = [...new Set(
    [...allOrders, ...performanceOrders].flatMap((o) => [
      o.origin,
      extractSoNameFromOrigin(o.origin),
      o.name,
    ]).filter(Boolean),
  )] as string[];
  const moIds = allOrders.map((o) => o.id);

  const [clientMap, saleOrderDateMap, allComponents, poStateMap, workOrderStateMap] = await Promise.all([
    client.getBulkSaleOrderClients(originsToFetch).catch(() => new Map<string, string>()),
    client.getBulkSaleOrderConfirmationDates(originsToFetch).catch(() => new Map<string, string>()),
    client.getBulkManufacturingOrderComponents(moIds).catch(() => []),
    client.getBulkRelatedPurchaseOrderStates(originsToFetch).catch(() => new Map<string, string>()),
    client.getBulkWorkOrderStates(moIds).catch(() => new Map<number, string>()),
  ]);

  const componentsByMoId = new Map<number, any[]>();
  for (const comp of allComponents) {
    if (comp.raw_material_production_id) {
      const moId = comp.raw_material_production_id[0];
      if (!componentsByMoId.has(moId)) {
        componentsByMoId.set(moId, []);
      }
      componentsByMoId.get(moId)!.push(comp);
    }
  }

  const moIdsWithStockIssues = new Set<number>();
  const localStockAlerts: StockAlert[] = [];
  const moStockStatus = new Map<number, 'ready' | 'incoming' | 'no_stock'>();
  let reservedBoardsCount = 0;

  for (const o of allOrders) {
    const manufacturedProductName = Array.isArray(o.product_id) ? o.product_id[1] : String(o.product_id || '');
    if (isStockExemptEdgeBandingService(manufacturedProductName)) {
      moStockStatus.set(o.id, 'ready');
      continue;
    }

    const components = componentsByMoId.get(o.id) || [];
    for (const comp of components) {
      const componentName = Array.isArray(comp.product_id) ? comp.product_id[1] : '';
      if (isBoardComponentName(componentName)) {
        reservedBoardsCount += (comp.quantity || 0);
      }
    }

    if (o.state === 'done' || o.state === 'cancel') {
      moStockStatus.set(o.id, 'ready');
      continue;
    }
    const unavailable = components.filter((c) => {
      if (c.state === 'done' || c.state === 'cancel' || c.state === 'draft' || c.state === 'assigned') {
        return false;
      }
      if (['confirmed', 'waiting', 'partially_available'].includes(c.state)) {
        return true;
      }
      return !c.forecast_availability || c.forecast_availability === 'unavailable';
    });
    if (unavailable.length > 0) {
      const soOrigin = o.origin ? extractSoNameFromOrigin(o.origin) : null;
      const poState =
        (o.origin && poStateMap.get(o.origin)) ||
        (soOrigin && poStateMap.get(soOrigin)) ||
        poStateMap.get(o.name) ||
        null;
      const hasActivePo = Boolean(poState && poState !== 'cancel');
      if (!hasActivePo) {
        moStockStatus.set(o.id, 'no_stock');
        moIdsWithStockIssues.add(o.id);
        const confirmedAt = o.origin ? saleOrderDateMap.get(o.origin) || null : null;
        const overdueDays = getOverdueDaysFromDateOrder(confirmedAt);
        for (const comp of unavailable) {
          const componentName = Array.isArray(comp.product_id) ? comp.product_id[1] : '';
          if (!isBoardComponentName(componentName)) {
            continue;
          }
          const soOrigin = o.origin ? extractSoNameFromOrigin(o.origin) : null;
          const resolvedClient = (o.origin && clientMap.get(o.origin)) || (soOrigin && clientMap.get(soOrigin)) || clientMap.get(o.name) || null;
          localStockAlerts.push({
            moName: o.name,
            product: Array.isArray(o.product_id) ? o.product_id[1] : '',
            component: componentName,
            qtyNeeded: comp.product_uom_qty - (comp.quantity || 0),
            client: resolvedClient,
            moId: o.id,
            confirmedAt,
            overdueDays,
          });
        }
      } else {
        moStockStatus.set(o.id, 'incoming');
      }
    } else {
      moStockStatus.set(o.id, 'ready');
    }
  }

  const confirmedQueueSchedule = getConfirmedMoQueueSchedule(allOrders);
  const mappedWorkOrders = allOrders.map((o) => {
    const baseTiming = getMoOverdueState({ createDate: o.create_date, plannedStart: o.date_start, clientDeadline: o.date_deadline, quantity: o.product_qty, productName: Array.isArray(o.product_id) ? o.product_id[1] : String(o.product_id || '') });
    const queueTiming = confirmedQueueSchedule.get(o.id);
    const rawWoState = workOrderStateMap.get(o.id);
    const isManuallyPaused = manuallyPausedMoIds.has(o.id);
    const effectiveState = isManuallyPaused || rawWoState === 'pending'
      ? 'paused'
      : rawWoState === 'progress' || o.state === 'progress'
        ? 'progress'
        : o.state || 'draft';
    return {
      ...baseTiming,
      ...queueTiming,
      isOverdue: !baseTiming.createdToday && (baseTiming.overdueReason !== null || Boolean(queueTiming && new Date() > new Date(queueTiming.estimatedFinishAt))),
      id: o.id,
      name: o.name,
      product: Array.isArray(o.product_id) ? o.product_id[1] : String(o.product_id),
      qty: o.product_qty || 0,
      produced: o.qty_produced || 0,
      state: effectiveState,
      plannedStart: o.date_start || null,
      dateStarted: o.date_start || null,
      dateFinished: o.date_finished || null,
      dateDeadline: o.date_deadline || null,
      createdAt: o.create_date || null,
      progress: o.product_qty > 0 ? Math.round(((o.qty_produced || 0) / o.product_qty) * 100) : 0,
      origin: o.origin || null,
      client: (o.origin && clientMap.get(o.origin)) || (o.origin && clientMap.get(extractSoNameFromOrigin(o.origin) || '')) || clientMap.get(o.name) || null,
      assignedTo: Array.isArray(o.user_id) ? o.user_id[1] : null,
      area: detectArea(Array.isArray(o.product_id) ? o.product_id[1] : ''),
      hasStockIssue: moIdsWithStockIssues.has(o.id),
      stockStatus: moStockStatus.get(o.id) || 'ready',
    };
  }).sort((a, b) => {
    if (a.state === 'progress' && b.state !== 'progress') return -1;
    if (a.state !== 'progress' && b.state === 'progress') return 1;
    if (a.state === 'paused' && b.state !== 'paused') return -1;
    if (a.state !== 'paused' && b.state === 'paused') return 1;
    if (a.stockStatus === 'ready' && b.stockStatus !== 'ready') return -1;
    if (a.stockStatus !== 'ready' && b.stockStatus === 'ready') return 1;
    return 0;
  });

  const completedAreaStats = new Map<string, {
    totalOrders: number;
    completedOrders: number;
    onTimeOrders: number;
    overdueQuickClose: number;
    days: number[];
  }>();

  for (const o of performanceOrders) {
    const area = detectArea(Array.isArray(o.product_id) ? o.product_id[1] : '');
    if (!completedAreaStats.has(area)) {
      completedAreaStats.set(area, { totalOrders: 0, completedOrders: 0, onTimeOrders: 0, overdueQuickClose: 0, days: [] });
    }
    const stats = completedAreaStats.get(area)!;
    stats.totalOrders += 1;

    if (o.state !== 'done' || !o.origin || !o.date_finished) {
      continue;
    }

    const confirmedAt = saleOrderDateMap.get(o.origin) || null;
    if (!confirmedAt) {
      continue;
    }

    const soConfirmed = new Date(confirmedAt.includes('T') ? confirmedAt : confirmedAt.replace(' ', 'T') + 'Z');
    const startedAt = o.date_start ? new Date(o.date_start.includes('T') ? o.date_start : o.date_start.replace(' ', 'T') + 'Z') : null;
    const finishedAt = new Date(o.date_finished.includes('T') ? o.date_finished : o.date_finished.replace(' ', 'T') + 'Z');
    const minPerfDate = new Date('2026-08-05T00:00:00Z');
    if (soConfirmed.getTime() < minPerfDate.getTime()) {
      continue;
    }

    stats.completedOrders += 1;
    const daysToComplete = (finishedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60 * 24);
    const hoursToStart = startedAt ? (startedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60) : null;
    const minutesFromStartToFinish = startedAt ? (finishedAt.getTime() - startedAt.getTime()) / (1000 * 60) : null;
    const overdueQuickClose = hoursToStart !== null
      && minutesFromStartToFinish !== null
      && hoursToStart > 24
      && minutesFromStartToFinish >= 0
      && minutesFromStartToFinish <= 30;

    if (daysToComplete >= 0) {
      stats.days.push(daysToComplete);
    }
    if (daysToComplete >= 0 && daysToComplete <= 3 && !overdueQuickClose) {
      stats.onTimeOrders += 1;
    }
    if (overdueQuickClose) {
      stats.overdueQuickClose += 1;
    }
  }

  const areaPerformanceRates = Array.from(completedAreaStats.entries())
    .map(([area, stats]) => {
      const percentage = stats.completedOrders > 0
        ? Math.round((stats.onTimeOrders / stats.completedOrders) * 100)
        : 0;
      const avgDaysToComplete = stats.days.length > 0
        ? Math.round((stats.days.reduce((sum, value) => sum + value, 0) / stats.days.length) * 10) / 10
        : 0;
      const color = percentage >= 75 ? 'green' : percentage >= 50 ? 'orange' : 'red';
      return {
        area,
        percentage,
        color,
        totalOrders: stats.totalOrders,
        completedOrders: stats.completedOrders,
        onTimeOrders: stats.onTimeOrders,
        overdueQuickClose: stats.overdueQuickClose,
        avgDaysToComplete,
      };
    })
    .sort((a, b) => {
      const order = MANUFACTURING_AREAS;
      const aIndex = order.indexOf(a.area);
      const bIndex = order.indexOf(b.area);
      if (aIndex === -1 && bIndex === -1) return a.area.localeCompare(b.area);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

  return {
    workOrders: mappedWorkOrders,
    rawStockAlerts: localStockAlerts,
    areaPerformanceRates,
    reservedBoardsCount,
  };
}

/**
 * Re-fetches live work orders from Odoo and synchronizes both RAM and MySQL shared cache,
 * ensuring all operator screens receive immediate updates without waiting on cron intervals.
 */
export async function refreshSharedWorkOrders(client?: OdooClient): Promise<SharedWorkOrdersData> {
  let odooClient = client;
  if (!odooClient) {
    const settings = await getSettings();
    odooClient = new OdooClient(settings.odoo);
  }

  const fresh = await fetchLiveSharedWorkOrders(odooClient);
  shopFloorCache.set('shop-floor:shared-work-orders:v1', fresh, 30 * 60 * 1000, 3 * 60 * 1000);
  try {
    await saveShopFloorSharedCache('shop-floor:shared-work-orders:v1', fresh);
  } catch (err) {
    console.warn('[shopFloorCache] Failed to save shared work orders to MySQL:', err);
  }
  shopFloorCache.clearPrefix('shop-floor-dashboard:');
  try {
    await deleteShopFloorDashboardSnapshot();
  } catch (err) {
    console.warn('[shopFloorCache] Failed to delete dashboard snapshots from MySQL:', err);
  }

  return fresh;
}

/**
 * Fast Operator Profile Hydration (<500ms):
 * Fetches employee details, recent attendance, and payslips concurrently from Odoo.
 * Avoids the heavy 40s manufacturing timeline calculation so the operator sees attendance and payslips immediately.
 */
export async function fetchFastOperatorProfile(client: OdooClient, userEmail: string): Promise<{
  employee: {
    id: number;
    name: string;
    jobTitle: string | null;
    department: string | null;
    workEmail: string | null;
    mobilePhone: string | null;
    manager: string | null;
  };
  attendance: any;
  payslips: any[];
}> {
  const normalizedEmail = (userEmail || '').trim().toLowerCase();
  let employee = await client.findEmployeeForShopFloorEmail(userEmail).catch(() => null);
  if (!employee) {
    employee = await client.findEmployeeByUserEmail(userEmail).catch(() => null);
  }
  if (!employee) {
    employee = await client.findEmployeeByWorkEmail(userEmail).catch(() => null);
  }

  if (!employee) {
    return {
      employee: {
        id: 0,
        name: userEmail ? userEmail.split('@')[0] : 'Operator',
        jobTitle: 'Operator',
        department: null,
        workEmail: userEmail,
        mobilePhone: null,
        manager: null,
      },
      attendance: null,
      payslips: [],
    };
  }

  const [rawAttendance, rawPayslips] = await Promise.all([
    client.getTodayAttendance(employee.id).catch(() => null),
    client.getEmployeePayslips(employee.id, 6).catch(() => []),
  ]);

  let attendance = null;
  if (rawAttendance) {
    attendance = {
      checkedIn: rawAttendance.checkedIn,
      checkedOut: rawAttendance.checkedOut,
      todayRecord: rawAttendance.todayRecord ? {
        check_in: toEAT(rawAttendance.todayRecord.check_in) || rawAttendance.todayRecord.check_in,
        check_out: toEAT(rawAttendance.todayRecord.check_out) || rawAttendance.todayRecord.check_out,
      } : null,
      recentRecords: (rawAttendance.recentRecords || []).map((r: any) => ({
        check_in: toEAT(r.check_in) || r.check_in,
        check_out: toEAT(r.check_out) || r.check_out,
      })),
      isLate: false,
    };
    if (rawAttendance.todayRecord?.check_in) {
      const checkInTime = toEAT(rawAttendance.todayRecord.check_in);
      if (checkInTime) {
        const timePart = checkInTime.split(' ')[1] || checkInTime;
        const [hh, mm] = timePart.split(':').map(Number);
        if (hh > 8 || (hh === 8 && mm > 30)) {
          attendance.isLate = true;
        }
      }
    }
  }

  const payslips = (rawPayslips || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    dateFrom: p.date_from,
    dateTo: p.date_to,
    state: p.state || 'draft',
    structure: Array.isArray(p.struct_id) ? p.struct_id[1] : '',
  }));

  const employeeData = {
    id: employee.id,
    name: employee.name,
    jobTitle: employee.job_title || null,
    department: Array.isArray(employee.department_id) ? employee.department_id[1] : null,
    workEmail: employee.work_email || null,
    mobilePhone: employee.mobile_phone || null,
    manager: Array.isArray(employee.parent_id) ? employee.parent_id[1] : null,
  };

  return {
    employee: employeeData,
    attendance,
    payslips,
  };
}

export async function buildOperatorDashboard(
  client: OdooClient,
  userEmail: string,
  req: Request,
  stockScope?: { warehouseId?: string; pickingTypeId?: string; locationId?: string },
): Promise<OperatorDashboardData> {
  const result: OperatorDashboardData = {
    employee: null,
    attendance: null,
    workOrders: [],
    payslips: [],
    salaryAdvances: [],
    stockAlerts: [],
    lateCount: 0,
    incidents: [],
    assignedItems: [],
    failedCheckouts: [],
    performanceRate: null,
    areaPerformanceRates: [],
    manufacturingTimingSummary: null,
    manufacturingTimelineData: null,
    boardRegistrationSummary: null,
    teamPenalties: null,
    isLimitedDashboard: false,
    machines: [],
    error: null,
    reservedBoardsCount: 0,
  };

  try {
    // 1. Find employee — operators may not have res.users, search by work email directly
    let employee = await client.findEmployeeForShopFloorEmail(userEmail).catch(() => null);
    if (!employee) {
      employee = await client.findEmployeeByUserEmail(userEmail).catch(() => null);
    }
    if (!employee) {
      employee = await client.findEmployeeByWorkEmail(userEmail).catch(() => null);
    }
    if (!employee) {
      result.employee = {
        id: 0,
        name: userEmail ? userEmail.split('@')[0] : 'Shop Floor User',
        jobTitle: 'Operator',
        department: null,
        workEmail: userEmail || null,
        mobilePhone: null,
        manager: null,
      };
      result.isLimitedDashboard = false;
    } else {
      result.employee = {
        id: employee.id,
        name: employee.name,
        jobTitle: employee.job_title || null,
        department: Array.isArray(employee.department_id) ? employee.department_id[1] : null,
        workEmail: employee.work_email || null,
        mobilePhone: employee.mobile_phone || null,
        manager: Array.isArray(employee.parent_id) ? employee.parent_id[1] : null,
      };
    }
    const limitedDashboardEmail = 'janetamollo01@gmail.com';
    const dashboardEmail = String(userEmail || employee?.work_email || '').trim().toLowerCase();
    result.isLimitedDashboard = dashboardEmail === limitedDashboardEmail;
    const assignedItemEmails = Array.from(
      new Set([
        userEmail,
        employee?.work_email || '',
      ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)),
    );

    // Run remaining independent sections concurrently!
    const [
      attendanceRes,
      lateCountRes,
      workOrdersRes,
      incidentsRes,
      assignedItemsRes,
      payslipsRes,
      advancesRes,
      failedCheckoutsRes,
      performanceRateRes,
      manufacturingTimingRes,
      manufacturingTimelineRes,
      boardRegistrationRes,
      teamPenaltiesRes,
      machinesRes,
    ] = await Promise.allSettled([
      // 1. Attendance
      employee ? client.getTodayAttendance(employee.id) : Promise.resolve(null),
      // 2. Late count this month
      employee ? client.getLateCountThisMonth(employee.id) : Promise.resolve(0),
      // 3. Work orders and stock alerts (Shared factory data: cached in RAM + MySQL!)
      (async () => {
        const sharedMoData = await shopFloorCache.getOrFetchTieredSWR(
          'shop-floor:shared-work-orders:v1',
          3 * 60 * 1000,   // 3 minutes fresh
          30 * 60 * 1000,  // 30 minutes max stale
          () => fetchLiveSharedWorkOrders(client),
        );

        return {
          workOrders: sharedMoData.workOrders,
          stockAlerts: applyOptimisticStockAlerts(sharedMoData.rawStockAlerts),
          areaPerformanceRates: sharedMoData.areaPerformanceRates,
          reservedBoardsCount: sharedMoData.reservedBoardsCount,
        };
      })(),
      // 4. Incidents (now from Odoo!)
      shopFloorCache.getOrFetchTieredSWR('shop-floor:shared-incidents:v1', 3 * 60 * 1000, 30 * 60 * 1000, () => client.getMaintenanceRequests(20)),
      // 5. Assigned items (now from Odoo!)
      employee ? client.getEmployeeAssignedEquipment(employee.id) : Promise.resolve([]),
      // 6. Payslips
      employee ? client.getEmployeePayslips(employee.id, 6) : Promise.resolve([]),
      // 7. Salary Advances
      employee ? fetchSalaryAdvances(employee.name) : Promise.resolve([]),
      // 8. Failed Checkouts
      employee ? client.getFailedCheckouts(employee.id) : Promise.resolve([]),
      // 9. Work Center Performance
      // Version the cache key whenever the performance baseline changes so a
      // running process cannot serve a pre-baseline result.
      employee ? getDailyManufacturingAnalytics('performance-rate-2026-08-05-v2', () => client.getWorkCenterPerformance(employee!.id, employee!.name)) : Promise.resolve(null),
      // 10. Manufacturing timing summary
      employee ? getDailyManufacturingAnalytics('timing-summary-v2', () => client.getManufacturingTimingSummary(employee!.id, employee!.name)) : Promise.resolve(null),
      // 11. Manufacturing timeline data for charting
      employee ? getDailyManufacturingAnalytics('timeline-data-v2', () => client.getManufacturingTimelineData(employee!.id, employee!.name)) : Promise.resolve(null),
      // 12. Board registration summary from physical inventory
      shopFloorCache.getOrFetchTieredSWR(`shop-floor:shared-board-reg:${JSON.stringify(stockScope || {})}`, 3 * 60 * 1000, 30 * 60 * 1000, () => client.getBoardRegistrationSummary(stockScope)),
      // 13. Team Penalties
      shopFloorCache.getOrFetchTieredSWR(`shop-floor:shared-team-penalties:${JSON.stringify(stockScope || {})}`, 3 * 60 * 1000, 30 * 60 * 1000, () => client.getTeamPenalties(stockScope)),
      // 14. Equipment list for breakdown reporting (now from Odoo!)
      shopFloorCache.getOrFetchTieredSWR('shop-floor:shared-machines:v1', 10 * 60 * 1000, 60 * 60 * 1000, () => client.getMaintenanceEquipment()),
    ]);

    // Handle Attendance Result
    if (attendanceRes.status === 'fulfilled' && attendanceRes.value) {
      const rawAttendance = attendanceRes.value;
      result.attendance = {
        checkedIn: rawAttendance.checkedIn,
        checkedOut: rawAttendance.checkedOut,
        todayRecord: rawAttendance.todayRecord ? {
          check_in: toEAT(rawAttendance.todayRecord.check_in) || rawAttendance.todayRecord.check_in,
          check_out: toEAT(rawAttendance.todayRecord.check_out) || rawAttendance.todayRecord.check_out,
        } : null,
        recentRecords: rawAttendance.recentRecords.map((r: any) => ({
          check_in: toEAT(r.check_in) || r.check_in,
          check_out: toEAT(r.check_out) || r.check_out,
        })),
        isLate: false,
      };

      if (rawAttendance.todayRecord?.check_in) {
        const checkInTime = toEAT(rawAttendance.todayRecord.check_in);
        if (checkInTime) {
          const timePart = checkInTime.split(' ')[1] || checkInTime;
          const [hh, mm] = timePart.split(':').map(Number);
          if (hh > 8 || (hh === 8 && mm > 30)) {
            result.attendance.isLate = true;
          }
        }
      }
    }

    // Handle Late Count Result
    if (lateCountRes.status === 'fulfilled') {
      result.lateCount = lateCountRes.value;
    }

    // Handle Work Orders & Stock Alerts
    if (workOrdersRes.status === 'fulfilled' && workOrdersRes.value) {
      result.workOrders = workOrdersRes.value.workOrders;
      result.stockAlerts = workOrdersRes.value.stockAlerts;
      result.areaPerformanceRates = workOrdersRes.value.areaPerformanceRates || [];
      result.reservedBoardsCount = workOrdersRes.value.reservedBoardsCount || 0;
    }

    // Handle Incidents (mapped from Odoo maintenance requests)
    if (incidentsRes.status === 'fulfilled' && incidentsRes.value) {
      result.incidents = incidentsRes.value.map((r: any) => {
        let machineName = r.name || 'Unknown Machine';
        if (machineName.startsWith('Breakdown: ')) {
          machineName = machineName.replace('Breakdown: ', '');
        }
        const isResolved = r.stage_id ? (r.stage_id[1] === 'Repaired' || r.stage_id[1] === 'Scrap') : false;
        return {
          id: String(r.id),
          machineName,
          description: r.description || null,
          reportedBy: r.employee_id ? r.employee_id[1] : null,
          reportedAt: r.request_date || '',
          status: isResolved ? 'resolved' : 'open',
          resolvedAt: r.close_date || null,
        };
      });
    }

    // Handle Assigned Items (mapped from Odoo assigned maintenance equipments)
    if (assignedItemsRes.status === 'fulfilled' && assignedItemsRes.value) {
      result.assignedItems = assignedItemsRes.value.map((e: any) => ({
        id: String(e.id),
        itemName: e.name || '',
        assignedDate: e.assign_date || '',
        quantity: 1,
        notes: e.serial_no ? `Serial: ${e.serial_no}` : null,
      }));
    }

    // Handle Equipment/Machines List (from Odoo maintenance.equipment)
    if (machinesRes.status === 'fulfilled' && machinesRes.value) {
      result.machines = machinesRes.value;
    }

    // Handle Payslips
    if (payslipsRes.status === 'fulfilled' && payslipsRes.value) {
      result.payslips = payslipsRes.value.map((p) => ({
        id: p.id,
        name: p.name,
        dateFrom: p.date_from,
        dateTo: p.date_to,
        state: p.state || 'draft',
        structure: Array.isArray(p.struct_id) ? p.struct_id[1] : '',
      }));
    }

    // Handle Salary Advances
    if (advancesRes.status === 'fulfilled' && advancesRes.value) {
      result.salaryAdvances = advancesRes.value;
    }

    // Handle Failed Checkouts
    if (failedCheckoutsRes.status === 'fulfilled') {
      result.failedCheckouts = failedCheckoutsRes.value;
    }

    // Handle Performance Rate
    if (performanceRateRes.status === 'fulfilled') {
      result.performanceRate = performanceRateRes.value;
    }

    // Handle Manufacturing Timing Summary
    if (manufacturingTimingRes.status === 'fulfilled') {
      result.manufacturingTimingSummary = manufacturingTimingRes.value;
    }

    // Handle Manufacturing Timeline Data
    if (manufacturingTimelineRes.status === 'fulfilled' && manufacturingTimelineRes.value) {
      const timelineRecords = manufacturingTimelineRes.value.records.map((record: any) => ({
        ...record,
        area: normalizeManufacturingArea(record.area) || normalizeManufacturingArea(record.workCenter) || detectArea(record.product || ''),
      }));
      result.manufacturingTimelineData = {
        monthLabel: manufacturingTimelineRes.value.monthLabel,
        workCenters: manufacturingTimelineRes.value.workCenters,
        records: timelineRecords,
      };

      const origins = [...new Set(timelineRecords.map((record) => record.origin).filter(Boolean))] as string[];
      const saleOrderDateMap = await client.getBulkSaleOrderConfirmationDates(origins).catch(() => new Map<string, string>());
      const statsByArea = new Map<string, {
        completedOrders: number;
        onTimeOrders: number;
        overdueQuickClose: number;
        days: number[];
      }>();

      for (const record of timelineRecords) {
        const area = normalizeManufacturingArea(record.area) || normalizeManufacturingArea(record.workCenter) || detectArea(record.product || '');
        if (!statsByArea.has(area)) {
          statsByArea.set(area, { completedOrders: 0, onTimeOrders: 0, overdueQuickClose: 0, days: [] });
        }

        const stats = statsByArea.get(area)!;
        const confirmedAt = record.origin ? saleOrderDateMap.get(record.origin) || null : null;
        record.confirmedAt = confirmedAt ? (confirmedAt.includes('T') ? confirmedAt : confirmedAt.replace(' ', 'T') + 'Z') : null;
        if (!confirmedAt) {
          continue;
        }

        const soConfirmed = new Date(confirmedAt.includes('T') ? confirmedAt : confirmedAt.replace(' ', 'T') + 'Z');
        const startedAt = new Date(record.startedAt);
        const finishedAt = new Date(record.finishedAt);
        if (Number.isNaN(soConfirmed.getTime()) || Number.isNaN(finishedAt.getTime())) {
          continue;
        }

        const minPerfDate = new Date('2026-08-05T00:00:00Z');
        if (soConfirmed.getTime() < minPerfDate.getTime()) {
          continue;
        }

        stats.completedOrders += 1;
        const daysToComplete = (finishedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60 * 24);
        const hoursToStart = (startedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60);
        const minutesFromStartToFinish = (finishedAt.getTime() - startedAt.getTime()) / (1000 * 60);
        const overdueQuickClose = hoursToStart > 24
          && minutesFromStartToFinish >= 0
          && minutesFromStartToFinish <= 30;

        if (daysToComplete >= 0) {
          stats.days.push(daysToComplete);
        }
        if (daysToComplete >= 0 && daysToComplete <= 3 && !overdueQuickClose) {
          stats.onTimeOrders += 1;
        }
        if (overdueQuickClose) {
          stats.overdueQuickClose += 1;
        }
      }

      const areaOrder = MANUFACTURING_AREAS;
      result.areaPerformanceRates = Array.from(statsByArea.entries())
        .map(([area, stats]) => {
          const percentage = stats.completedOrders > 0
            ? Math.round((stats.onTimeOrders / stats.completedOrders) * 100)
            : 0;
          const avgDaysToComplete = stats.days.length > 0
            ? Math.round((stats.days.reduce((sum, value) => sum + value, 0) / stats.days.length) * 10) / 10
            : 0;
          const color = percentage >= 75 ? 'green' : percentage >= 50 ? 'orange' : 'red';

          return {
            area,
            percentage,
            color,
            totalOrders: stats.completedOrders,
            completedOrders: stats.completedOrders,
            onTimeOrders: stats.onTimeOrders,
            overdueQuickClose: stats.overdueQuickClose,
            avgDaysToComplete,
          };
        })
        .sort((a, b) => {
          const aIndex = areaOrder.indexOf(a.area);
          const bIndex = areaOrder.indexOf(b.area);
          if (aIndex === -1 && bIndex === -1) return a.area.localeCompare(b.area);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
    }

    // Handle board registration summary
    if (boardRegistrationRes.status === 'fulfilled') {
      result.boardRegistrationSummary = reconcileBoardRegistrationWithStockAlerts(
        boardRegistrationRes.value,
        result.stockAlerts,
      );
    }

    // Handle Team Penalties
    if (teamPenaltiesRes && teamPenaltiesRes.status === 'fulfilled') {
      result.teamPenalties = teamPenaltiesRes.value;
    }

  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Failed to load shop floor data.';
  }

  return result;
}

router.get('/shop-floor', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.redirect('/login');
    return;
  }

  const viewedEmail = getViewedUserEmail(req);
  const normalizedEmail = viewedEmail.trim().toLowerCase();
  const cacheKey = `shop-floor-dashboard:v3:${normalizedEmail}`;
  const featureFlagsPromise = getShopFloorFeatureFlags();
    const isExplicitRefresh = req.query.refresh === 'true';
    if (isExplicitRefresh) {
      dailyManufacturingAnalytics.clear();
      const sharedMoEntry = shopFloorCache.getEntry('shop-floor:shared-work-orders:v1');
      if (sharedMoEntry) {
        sharedMoEntry.freshUntil = 0;
      }
    }

  try {
    const settings = await getSettings();

    // Multi-tier cache for operator dashboard:
    // Tier 1: In-memory RAM cache
    let data: OperatorDashboardData | null = shopFloorCache.get<OperatorDashboardData>(cacheKey);

    // Tier 2: MySQL persistent snapshot if RAM misses (e.g. cold restart or Login As)
    if (!data) {
      try {
        const snapshot = await getShopFloorDashboardSnapshot<OperatorDashboardData>(normalizedEmail);
        if (snapshot && snapshot.data && ((snapshot.data.workOrders && snapshot.data.workOrders.length > 0) || (snapshot.data.stockAlerts && snapshot.data.stockAlerts.length > 0))) {
          data = snapshot.data;
          // Set with 10s fresh TTL so SWR background revalidation triggers quickly to sync with live Odoo state
          shopFloorCache.set(cacheKey, data, 60 * 60 * 1000, 10 * 1000);
        }
      } catch (dbErr) {
        console.warn('[shopFloor] Failed to read snapshot from MySQL for', normalizedEmail, dbErr);
      }
    }

    // Tier 3: Instant MySQL assembly (<10ms)
    // When operators login, all pending tasks, work orders, and stock alerts are served IMMEDIATELY from MySQL DB!
    if (!data || !data.workOrders || data.workOrders.length === 0) {
      try {
        const instantData = await buildInstantMysqlOperatorDashboard(viewedEmail);
        if (instantData.workOrders.length > 0 || instantData.stockAlerts.length > 0) {
          data = instantData;
          shopFloorCache.set(cacheKey, data, 60 * 60 * 1000, 10 * 1000);
        }
      } catch (mysqlErr) {
        console.warn('[shopFloor] Failed to build instant MySQL dashboard for', normalizedEmail, mysqlErr);
      }
    }

    // Fast Profile Hydration (<900ms) if attendance, payslips, or real employee are missing from MySQL snapshot
    const hasRecentAttendance = Boolean(data?.attendance?.recentRecords && data.attendance.recentRecords.length > 0);
    const hasPayslips = Boolean(data?.payslips && data.payslips.length > 0);
    const hasRealEmployee = Boolean(data?.employee && data.employee.id > 0);

    if (data && (!hasRecentAttendance || !hasPayslips || !hasRealEmployee)) {
      try {
        const client = new OdooClient(settings.odoo);
        const fastProfile = await withMaxPageWait(
          fetchFastOperatorProfile(client, viewedEmail),
          900,
          null,
        );
        if (fastProfile && fastProfile.employee.id > 0) {
          data.employee = fastProfile.employee;
          if (fastProfile.attendance) {
            data.attendance = fastProfile.attendance;
          }
          if (fastProfile.payslips && fastProfile.payslips.length > 0) {
            data.payslips = fastProfile.payslips;
          }
          shopFloorCache.set(cacheKey, data, 60 * 60 * 1000, 3 * 60 * 1000);
          void saveShopFloorDashboardSnapshot(normalizedEmail, data).catch(() => null);
        }
      } catch (profileErr) {
        console.warn('[shopFloor] Fast profile hydration warning for', normalizedEmail, profileErr);
      }
    }

    // Revalidate full analytics in background if explicit refresh, stale, or attendance missing
    const needsBackgroundRefresh = isExplicitRefresh || shopFloorCache.isStale(cacheKey) || !hasRecentAttendance;
    if (data && ((data.workOrders && data.workOrders.length > 0) || (data.stockAlerts && data.stockAlerts.length > 0))) {
      if (needsBackgroundRefresh && !shopFloorCache.isInFlight(cacheKey)) {
        void (async () => {
          try {
            const client = new OdooClient(settings.odoo);
            const fresh = await buildOperatorDashboard(client, viewedEmail, req, settings.stock);
            shopFloorCache.set(cacheKey, fresh, 60 * 60 * 1000, 3 * 60 * 1000);
            await saveShopFloorDashboardSnapshot(normalizedEmail, fresh);
          } catch (bgErr) {
            console.warn('[shopFloor] Background dashboard refresh failed for', normalizedEmail, bgErr);
          }
        })();
      }
    } else {
      // Tier 4: Cold fallback if MySQL has no data yet (first deploy before any sync)
      // Never block page render for more than 1200ms; return instant shell if Odoo takes longer
      const fetchPromise = shopFloorCache.getOrFetchSWR(
        cacheKey,
        3 * 60 * 1000,   // 3 minutes fresh
        60 * 60 * 1000,  // 60 minutes max stale
        async () => {
          const client = new OdooClient(settings.odoo);
          const fresh = await buildOperatorDashboard(client, viewedEmail, req, settings.stock);
          void saveShopFloorDashboardSnapshot(normalizedEmail, fresh).catch((saveErr) => {
            console.warn('[shopFloor] Failed to save snapshot to MySQL:', saveErr);
          });
          return fresh;
        },
      );
      data = await withMaxPageWait(fetchPromise, 1200, emptyOperatorDashboardShell(viewedEmail));
    }

    // Ensure real-time app badge counts (receipts, deliveries, pending stock) are always populated
    if (data) {
      if (!data.teamPenalties || (data.teamPenalties.undoneReceipts === 0 && data.teamPenalties.unmarkedDeliveries === 0)) {
        try {
          const [receiptsEntry, deliveriesEntry] = await Promise.all([
            getShopFloorSharedCache<any[]>('shop-floor:receipts:1').catch(() => null),
            getShopFloorSharedCache<any[]>('shop-floor:deliveries:1').catch(() => null),
          ]);
          const openReceipts = Array.isArray(receiptsEntry?.data)
            ? receiptsEntry.data.filter((r: any) => r.state !== 'done' && r.state !== 'cancel').length
            : 0;
          const openDeliveries = Array.isArray(deliveriesEntry?.data)
            ? deliveriesEntry.data.filter((d: any) => d.state !== 'done' && d.state !== 'cancel').length
            : 0;
          data.teamPenalties = {
            undoneReceipts: openReceipts,
            unmarkedDeliveries: openDeliveries,
          };
        } catch (_e) {}
      }

      if (!data.workOrders || data.workOrders.length === 0) {
        try {
          const sharedMo = await getShopFloorSharedCache<any>('shop-floor:shared-work-orders:v1').catch(() => null);
          if (sharedMo?.data?.workOrders?.length) {
            data.workOrders = sharedMo.data.workOrders;
          }
        } catch (_e) {}
      }

      try {
        const pendingProcesses = await getPendingShopFloorProcesses({ status: 'pending' }).catch(() => []);
        data.stockAlerts = pendingProcesses
          .filter((p) => Number(p.qty_missing || 0) > 0)
          .map((p) => ({
            moName: p.mo_name,
            product: p.product_name,
            component: p.product_name,
            qtyNeeded: p.qty_missing,
            totalNeeded: p.qty_needed,
            qtyReserved: p.qty_reserved,
            client: p.partner_name,
            moId: p.mo_id,
            confirmedAt: null,
            overdueDays: 0,
            partnerId: p.partner_id || null,
            productId: p.product_id || null,
            isSyncing: false,
            isMoClosed: Boolean(p.is_mo_closed),
          }));
      } catch (_e) {}

      if (data.boardRegistrationSummary) {
        data.boardRegistrationSummary = reconcileBoardRegistrationWithStockAlerts(
          data.boardRegistrationSummary,
          data.stockAlerts || [],
        );
      }
    }

    const featureFlags = await featureFlagsPromise;
    res.render('shop-floor', {
      pageTitle: 'Shop Floor',
      appName: env.APP_NAME,
      data,
      breakdownCatalog: MACHINE_BREAKDOWN_CATALOG,
      authUser: req.authUser,
      featureFlags,
      canManageFeatures: canManageShopFloor(req),
      csrfToken: req.csrfToken || null,
      attendanceSiteAllowed: canUseSiteAttendance(req),
      message: typeof req.query.message === 'string' ? req.query.message : null,
      error: typeof req.query.error === 'string' ? req.query.error : null,
    });
  } catch (err) {
    res.status(500).render('error', {
      pageTitle: 'Shop Floor Error',
      errorMessage: err instanceof Error ? err.message : 'Could not load shop floor.',
      details: [],
      csrfToken: req.csrfToken || null,
    });
  }
});

async function resolveShopFloorEmployeeRecord(email: string, client: OdooClient): Promise<{ id: number; name: string } | null> {
  const norm = (email || '').trim().toLowerCase();
  if (!norm) return null;
  const cacheKey = `shop-floor-dashboard:v3:${norm}`;
  const cached = shopFloorCache.get<OperatorDashboardData>(cacheKey);
  if (cached?.employee?.id && cached.employee.id > 0) {
    return { id: cached.employee.id, name: cached.employee.name };
  }
  try {
    const snapshot = await getShopFloorDashboardSnapshot<OperatorDashboardData>(norm);
    if (snapshot?.data?.employee?.id && snapshot.data.employee.id > 0) {
      return { id: snapshot.data.employee.id, name: snapshot.data.employee.name };
    }
  } catch (_e) {}

  const found = await client.findEmployeeForShopFloorEmail(email).catch(() => null);
  if (found && found.id > 0) return { id: found.id, name: found.name };

  const byUser = await client.findEmployeeByUserEmail(email).catch(() => null);
  if (byUser && byUser.id > 0) return { id: byUser.id, name: byUser.name };

  const byWork = await client.findEmployeeByWorkEmail(email).catch(() => null);
  if (byWork && byWork.id > 0) return { id: byWork.id, name: byWork.name };

  return null;
}

async function resolveAttendanceEmployee(req: Request, client: OdooClient) {
  const viewedEmail = getViewedUserEmail(req);
  return resolveShopFloorEmployeeRecord(viewedEmail || req.authUser!.email, client);
}

router.post('/shop-floor/attendance/check-in', async (req: Request, res: Response) => {
  const wantsJson = req.xhr || req.headers.accept?.includes('application/json') || req.is('json');
  if (!req.authUser) {
    if (wantsJson) { res.status(401).json({ ok: false, error: 'Please sign in first.' }); return; }
    res.redirect('/login');
    return;
  }
  if (!canUseSiteAttendance(req)) {
    const msg = 'Attendance check-in is available only while connected to the site network.';
    if (wantsJson) { res.status(403).json({ ok: false, error: msg }); return; }
    res.redirect('/shop-floor?error=' + encodeURIComponent(msg));
    return;
  }
  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const employee = await resolveAttendanceEmployee(req, client);
    if (!employee) {
      const msg = 'No Odoo employee record is linked to this account.';
      if (wantsJson) { res.status(404).json({ ok: false, error: msg }); return; }
      res.redirect('/shop-floor?error=' + encodeURIComponent(msg));
      return;
    }
    const result = await client.checkInAttendance(employee.id);
    const checkInTime = result.record?.check_in || new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Instant SWR cache update so any reload or navigation immediately shows Checked In
    const viewedEmail = getViewedUserEmail(req).toLowerCase();
    const cacheKey = `shop-floor-dashboard:v3:${viewedEmail}`;
    const cached = shopFloorCache.get<OperatorDashboardData>(cacheKey);
    if (cached) {
      if (!cached.attendance) {
        cached.attendance = { checkedIn: true, checkedOut: false, todayRecord: { check_in: checkInTime, check_out: null }, recentRecords: [], isLate: false };
      } else {
        cached.attendance.checkedIn = true;
        cached.attendance.checkedOut = false;
        cached.attendance.todayRecord = { check_in: checkInTime, check_out: null };
      }
      shopFloorCache.set(cacheKey, cached, 30 * 60 * 1000);
      saveShopFloorDashboardSnapshot(viewedEmail, cached).catch(() => {});
    }

    if (!wantsJson) {
      res.redirect('/shop-floor?message=' + encodeURIComponent('Checked in successfully.'));
      return;
    }
    res.json({ ok: true, action: result.created ? 'checked_in' : 'already_checked_in', checkIn: checkInTime });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Could not check in to Odoo.';
    if (!wantsJson) {
      res.redirect('/shop-floor?error=' + encodeURIComponent(errMsg));
      return;
    }
    res.status(500).json({ ok: false, error: errMsg });
  }
});

router.post('/shop-floor/attendance/check-out', async (req: Request, res: Response) => {
  const wantsJson = req.xhr || req.headers.accept?.includes('application/json') || req.is('json');
  if (!req.authUser) {
    if (wantsJson) { res.status(401).json({ ok: false, error: 'Please sign in first.' }); return; }
    res.redirect('/login');
    return;
  }
  if (!canUseSiteAttendance(req)) {
    const msg = 'Attendance check-out is available only while connected to the site network.';
    if (wantsJson) { res.status(403).json({ ok: false, error: msg }); return; }
    res.redirect('/shop-floor?error=' + encodeURIComponent(msg));
    return;
  }
  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const employee = await resolveAttendanceEmployee(req, client);
    if (!employee) {
      const msg = 'No Odoo employee record is linked to this account.';
      if (wantsJson) { res.status(404).json({ ok: false, error: msg }); return; }
      res.redirect('/shop-floor?error=' + encodeURIComponent(msg));
      return;
    }
    const result = await client.checkOutAttendance(employee.id);
    if (!result.updated) {
      const msg = 'No open Odoo attendance record was found.';
      if (wantsJson) { res.status(409).json({ ok: false, error: msg }); return; }
      res.redirect('/shop-floor?error=' + encodeURIComponent(msg));
      return;
    }
    const checkOutTime = result.record?.check_out || new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Instant SWR cache update so any reload or navigation immediately shows Checked Out
    const viewedEmail = getViewedUserEmail(req).toLowerCase();
    const cacheKey = `shop-floor-dashboard:v3:${viewedEmail}`;
    const cached = shopFloorCache.get<OperatorDashboardData>(cacheKey);
    if (cached) {
      if (cached.attendance) {
        cached.attendance.checkedIn = false;
        cached.attendance.checkedOut = true;
        if (cached.attendance.todayRecord) {
          cached.attendance.todayRecord.check_out = checkOutTime;
        }
      }
      shopFloorCache.set(cacheKey, cached, 30 * 60 * 1000);
      saveShopFloorDashboardSnapshot(viewedEmail, cached).catch(() => {});
    }

    if (!wantsJson) {
      res.redirect('/shop-floor?message=' + encodeURIComponent('Checked out successfully.'));
      return;
    }
    res.json({ ok: true, action: 'checked_out', checkIn: result.record?.check_in || null, checkOut: checkOutTime });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Could not check out from Odoo.';
    if (!wantsJson) {
      res.redirect('/shop-floor?error=' + encodeURIComponent(errMsg));
      return;
    }
    res.status(500).json({ ok: false, error: errMsg });
  }
});

router.get('/shop-floor/stock-alerts/notifications', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ ok: false, alerts: [] });
    return;
  }

  try {
    const viewedEmail = getViewedUserEmail(req);
    const cacheKey = `shop-floor-dashboard:v3:${viewedEmail.toLowerCase()}`;
    const data = await shopFloorCache.get<OperatorDashboardData>(cacheKey);

    const alerts = !data || data.isLimitedDashboard
      ? []
      : data.stockAlerts.map((alert) => ({
          id: `${alert.moId}:${alert.component}`,
          moName: alert.moName,
          product: alert.product,
          component: alert.component,
          qtyNeeded: alert.qtyNeeded,
          client: alert.client,
          confirmedAt: alert.confirmedAt,
          overdueDays: alert.overdueDays,
          message: `${alert.component}: count first, then key in ${alert.qtyNeeded} incoming board(s).`,
        }));

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      count: alerts.length,
      alerts,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      alerts: [],
      error: err instanceof Error ? err.message : 'Could not load stock alerts.',
    });
  }
});

router.get('/shop-floor/payslip/:id/download', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const payslipId = parseInt(req.params.id, 10);

    if (isNaN(payslipId)) {
      res.status(400).send('Invalid payslip ID');
      return;
    }

    const [pdf, displayName] = await Promise.all([
      client.getPayslipPdf(payslipId),
      client.getPayslipName(payslipId),
    ]);

    if (!pdf) {
      res.status(404).send('Payslip PDF not found or not yet generated.');
      return;
    }

    const safeFilename = displayName.replace(/[<>:"/\\|?*]/g, '').trim() + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
    res.setHeader('Content-Length', pdf.data.length);
    res.send(pdf.data);
  } catch (err) {
    res.status(500).send(err instanceof Error ? err.message : 'Failed to download payslip.');
  }
});

/**
 * GET /shop-floor/api/attendance-status (and /shop-floor/api/operator-profile)
 * Fast JSON endpoint returning current operator profile, attendance records, and payslips.
 */
const handleOperatorProfileSync = async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  try {
    const settings = await getSettings();
    const viewedEmail = getViewedUserEmail(req);
    const normalizedEmail = viewedEmail.trim().toLowerCase();
    const cacheKey = `shop-floor-dashboard:v3:${normalizedEmail}`;

    // Check local snapshot first
    const snapshot = await getShopFloorDashboardSnapshot<OperatorDashboardData>(normalizedEmail).catch(() => null);
    const hasAttendance = Boolean(snapshot?.data?.attendance?.recentRecords && snapshot.data.attendance.recentRecords.length > 0);
    const hasPayslips = Boolean(snapshot?.data?.payslips && snapshot.data.payslips.length > 0);
    const hasEmployee = Boolean(snapshot?.data?.employee && snapshot.data.employee.id > 0);

    if (hasAttendance && hasPayslips && hasEmployee) {
      return res.json({
        success: true,
        attendance: snapshot!.data!.attendance,
        employee: snapshot!.data!.employee,
        payslips: snapshot!.data!.payslips,
      });
    }

    // Otherwise fetch fresh fast profile concurrently from Odoo (<500ms)
    const client = new OdooClient(settings.odoo);
    const profile = await fetchFastOperatorProfile(client, viewedEmail);

    let baseData = snapshot?.data;
    if (!baseData) {
      baseData = await buildInstantMysqlOperatorDashboard(viewedEmail).catch(() => emptyOperatorDashboardShell(viewedEmail));
    }
    if (profile.employee.id > 0) {
      baseData.employee = profile.employee;
    }
    if (profile.attendance) {
      baseData.attendance = profile.attendance;
    }
    if (profile.payslips && profile.payslips.length > 0) {
      baseData.payslips = profile.payslips;
    }

    // Persist immediately to MySQL snapshot and RAM cache
    await saveShopFloorDashboardSnapshot(normalizedEmail, baseData).catch(() => null);
    shopFloorCache.set(cacheKey, baseData, 60 * 60 * 1000, 3 * 60 * 1000);

    return res.json({
      success: true,
      attendance: baseData.attendance,
      employee: baseData.employee,
      payslips: baseData.payslips || [],
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to fetch attendance status' });
  }
};

router.get('/shop-floor/api/attendance-status', handleOperatorProfileSync);
router.get('/shop-floor/api/operator-profile', handleOperatorProfileSync);

/**
 * GET /shop-floor/api/app-badge-counts — Fast (<5ms) JSON endpoint returning real-time notification counts from MySQL.
 */
router.get('/shop-floor/api/app-badge-counts', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  try {
    const ramSharedMo = shopFloorCache.get<{ workOrders: any[] }>('shop-floor:shared-work-orders:v1');
    const [sharedMoEntry, pendingProcesses, sharedIncidentsEntry, receiptsEntry, deliveriesEntry] = await Promise.all([
      ramSharedMo?.workOrders?.length
        ? Promise.resolve({ data: ramSharedMo })
        : getShopFloorSharedCache<{ workOrders: any[] }>('shop-floor:shared-work-orders:v1').catch(() => null),
      getPendingShopFloorProcesses({ status: 'pending' }).catch(() => []),
      getShopFloorSharedCache<any[]>('shop-floor:shared-incidents:v1').catch(() => null),
      getShopFloorSharedCache<any[]>('shop-floor:receipts:1').catch(() => null),
      getShopFloorSharedCache<any[]>('shop-floor:deliveries:1').catch(() => null),
    ]);

    const workOrders = ramSharedMo?.workOrders || sharedMoEntry?.data?.workOrders || [];
    let openWorkOrders = workOrders.filter((o: any) => o.state !== 'done').length;

    // Fallback: if openWorkOrders is 0, check user's snapshot to prevent transient count drops
    let userSnapshotPromise: Promise<any> | null = null;
    const getUserSnapshot = () => {
      if (!userSnapshotPromise && req.authUser?.email) {
        userSnapshotPromise = getShopFloorDashboardSnapshot<OperatorDashboardData>(req.authUser.email).catch(() => null);
      }
      return userSnapshotPromise;
    };

    if (openWorkOrders === 0 && req.authUser?.email) {
      const snap = await getUserSnapshot();
      if (snap?.data?.workOrders?.length) {
        openWorkOrders = snap.data.workOrders.filter((o: any) => o.state !== 'done').length;
      }
    }

    // Calculate pending add-stock count with fallbacks to avoid transient count drops
    const pendingStockAlertsCount = pendingProcesses.filter((p: any) => Number(p.qty_missing || 0) > 0).length;
    let addStockCount = pendingStockAlertsCount;
    if (addStockCount === 0) {
      const rawAlerts = (ramSharedMo as any)?.rawStockAlerts || (sharedMoEntry?.data as any)?.rawStockAlerts;
      if (rawAlerts && Array.isArray(rawAlerts) && rawAlerts.length > 0) {
        addStockCount = rawAlerts.length;
      }
    }
    if (addStockCount === 0 && req.authUser?.email) {
      const snap = await getUserSnapshot();
      if (snap?.data?.stockAlerts && Array.isArray(snap.data.stockAlerts) && snap.data.stockAlerts.length > 0) {
        addStockCount = snap.data.stockAlerts.length;
      }
    }
    const openIncidents = (sharedIncidentsEntry?.data || []).filter((i: any) => {
      const isResolved = i.stage_id ? (i.stage_id[1] === 'Repaired' || i.stage_id[1] === 'Scrap') : false;
      return !isResolved && (i.status === 'open' || !i.status);
    }).length;

    const openReceipts = Array.isArray(receiptsEntry?.data)
      ? receiptsEntry.data.filter((r: any) => r.state !== 'done' && r.state !== 'cancel').length
      : 0;
    const openDeliveries = Array.isArray(deliveriesEntry?.data)
      ? deliveriesEntry.data.filter((d: any) => d.state !== 'done' && d.state !== 'cancel').length
      : 0;

    const areaAttention = (area: string) => workOrders.filter((o: any) => {
      if (o.area !== area || o.state === 'done') return false;
      return Boolean(o.isOverdue) || o.hasStockIssue || o.stockStatus === 'no_stock';
    }).length;

    // Trigger background revalidation if shared work orders cache is stale
    if (shopFloorCache.isStale('shop-floor:shared-work-orders:v1') && !shopFloorCache.isInFlight('shop-floor:shared-work-orders:v1')) {
      void refreshSharedWorkOrders().catch(() => null);
    }

    const workOrderStates = workOrders.map((o: any) => ({
      id: o.id,
      name: o.name,
      state: o.state,
      progress: o.progress,
      produced: o.produced,
      qty: o.qty,
      stockStatus: o.stockStatus,
    }));

    const viewedEmail = getViewedUserEmail(req).trim().toLowerCase();
    const userSnap = viewedEmail ? shopFloorCache.get<OperatorDashboardData>(`shop-floor-dashboard:v3:${viewedEmail}`) : null;
    const attendanceInfo = userSnap?.attendance ? {
      checkedIn: Boolean(userSnap.attendance.checkedIn),
      checkedOut: Boolean(userSnap.attendance.checkedOut),
      isLate: Boolean(userSnap.attendance.isLate),
    } : null;

    res.json({
      success: true,
      counts: {
        'start-finish': openWorkOrders,
        'add-stock': addStockCount,
        receipts: openReceipts,
        deliveries: openDeliveries,
        maintenance: openIncidents,
        'table-saw': areaAttention('Table Saw Area'),
        'edge-banding': areaAttention('Edge Banding Area'),
        'panel-rack': areaAttention('Panel Rack Area'),
      },
      workOrders: workOrderStates,
      attendance: attendanceInfo,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function cleanOdooDepartment(emp: any): string {
  if (Array.isArray(emp.department_id) && emp.department_id[1]) {
    const raw = String(emp.department_id[1]).trim();
    if (raw.includes('/')) {
      const leaf = raw.split('/').pop()?.trim();
      if (leaf) return leaf;
    }
    return raw;
  }
  if (typeof emp.department_id === 'string' && emp.department_id.trim()) {
    const raw = emp.department_id.trim();
    if (raw.includes('/')) {
      const leaf = raw.split('/').pop()?.trim();
      if (leaf) return leaf;
    }
    return raw;
  }

  const title = String(emp.job_title || '').trim().toLowerCase();
  const name = String(emp.name || '').trim().toLowerCase();

  if (title.includes('director') || title.includes('managing') || title.includes('executive') || name.includes('charles') || name.includes('raphael')) {
    return 'Management';
  }
  if (title.includes('information') || title.includes('system') || title.includes('tech') || title.includes('it') || name.includes('leoivard') || name.includes('dbadmin')) {
    return 'Information Technology';
  }
  if (title.includes('sales') || title.includes('optimizer') || name.includes('sharon') || name.includes('candy')) {
    return 'Sales';
  }
  return 'Operations';
}

function cleanOdooJobTitle(emp: any): string {
  if (emp.job_title && typeof emp.job_title === 'string' && emp.job_title.trim()) {
    return emp.job_title.trim();
  }
  const name = String(emp.name || '').trim().toLowerCase();
  if (name.includes('charles')) return 'Managing Director';
  if (name.includes('raphael')) return 'Director';
  if (name.includes('leoivard')) return 'Information Systems';
  if (name.includes('janet')) return 'Operations Assistant';
  if (name.includes('joel')) return 'Junior Operator';
  if (name.includes('thomas')) return 'Assistant Jr Operator';
  if (name.includes('okoth') || name.includes('michael')) return 'Helper';
  if (name.includes('akulo') || name.includes('bitcher')) return 'Senior Operator';
  return 'Operator';
}

/**
 * GET /shop-floor/operators — Admin view: list all operators from Odoo with true names and accurate departments.
 */
router.get('/shop-floor/operators', async (req: Request, res: Response) => {
  const isAdmin = req.authUser?.role === 'admin';
  const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');

  if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
    res.status(403).redirect('/dashboard');
    return;
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

  try {
    const settings = await getSettings();
    const operatorCacheKey = 'shop-floor:operators-list:v2';

    // Purge obsolete v1 cache key to ensure any old fallback with truncated email names is cleared
    void deleteShopFloorSharedCache('shop-floor:operators-list:v1').catch(() => {});

    // 1. Read persistent MySQL shared cache immediately (<5ms)
    let persistentCache = await getShopFloorSharedCache<{
      allOperators: OperatorSummary[];
      departments: string[];
    }>(operatorCacheKey).catch(() => null);

    // Sanitize cached data in-memory: filter out entries with email-derived names or inactive/corrupt tags without nuking the cache
    if (persistentCache?.data?.allOperators && Array.isArray(persistentCache.data.allOperators)) {
      persistentCache.data.allOperators = persistentCache.data.allOperators.filter((op) => {
        if (!op || !op.name || typeof op.name !== 'string') return false;
        const n = op.name.trim();
        const emailPrefix = String(op.workEmail || '').split('@')[0].trim().toLowerCase();
        if (n.toLowerCase() === emailPrefix) return false;
        if (op.workEmail && op.workEmail.toLowerCase().includes('onyangoakulo22')) return false;
        return true;
      });
      persistentCache.data.departments = [...new Set(persistentCache.data.allOperators.map((op) => op.department).filter((d): d is string => Boolean(d)))];
    }

    const operatorsPromise = shopFloorCache.getOrFetchTieredSWR(
      operatorCacheKey,
      req.query.refresh === 'true' ? 0 : 15 * 60 * 1000,   // Non-blocking serve with background revalidation on refresh (15m fresh TTL)
      2 * 60 * 60 * 1000,  // 2 hours max stale
      async () => {
        const client = new OdooClient(settings.odoo);
        const targetCompanyId = await client.getTargetCompanyIdValue();

        // 1. Fetch active approved accounts from the database
        const allApprovedUsers = await getApprovedAuthUsers().catch(() => []);
        // Strictly only active accounts that have shop-floor access or are admin (exclude deactivated accounts and obsolete emails)
        const activeAccounts = (allApprovedUsers || []).filter((u) => {
          if (!u || !u.email) return false;
          if (isAccountDeactivated(u.active)) return false;
          if (u.email.toLowerCase().includes('onyangoakulo22')) return false;
          const apps = Array.isArray(u.apps) ? u.apps : [];
          return apps.includes('shop-floor') || u.role === 'admin';
        });

        // 2. Fetch active Odoo employees and active users in target company
        const [workcenters, allOdooEmployees, allOdooUsers] = await Promise.all([
          client.searchReadRecords<{ id: number; employee_ids: number[] }>('mrp.workcenter', {
            domain: [['company_id', '=', targetCompanyId]],
            fields: ['id', 'employee_ids'],
          }).catch(() => []),
          client.searchReadRecords<any>('hr.employee', {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['active', '=', true],
            ],
            fields: ['id', 'name', 'job_title', 'department_id', 'work_email', 'mobile_phone', 'user_id', 'active'],
          }).catch(() => []),
          client.searchReadRecords<any>('res.users', {
            domain: [
              ['company_id', '=', targetCompanyId],
              ['active', '=', true],
            ],
            fields: ['id', 'name', 'login', 'email', 'active'],
          }).catch(() => []),
        ]);

        const workcenterOperatorIds = new Set<number>(workcenters.flatMap((w) => w.employee_ids || []));

        // 3. Match active accounts strictly to active Odoo employees
        const operators: OperatorSummary[] = [];
        const seenEmpIds = new Set<number>();

        for (const account of activeAccounts) {
          const userEmail = String(account.email || '').trim().toLowerCase();
          if (!userEmail) continue;

          // Find matching active Odoo employee by work_email, user login, user email, or director name
          const linkedEmp = allOdooEmployees.find((e) => {
            if (e.active === false) return false;
            const empEmail = String(e.work_email || '').trim().toLowerCase();
            if (empEmail && empEmail === userEmail) return true;

            if (Array.isArray(e.user_id) && e.user_id[0]) {
              const u = allOdooUsers.find((user: any) => user.id === e.user_id[0]);
              if (u) {
                const uLogin = String(u.login || '').trim().toLowerCase();
                const uEmail = String(u.email || '').trim().toLowerCase();
                if (uLogin === userEmail || uEmail === userEmail) return true;
              }
            }

            const localPart = userEmail.split('@')[0].replace(/[._-]/g, ' ').trim().toLowerCase();
            const eName = String(e.name || '').trim().toLowerCase();
            if (localPart.length >= 3 && eName.includes(localPart)) {
              return true;
            }
            return false;
          });

          // STRICT REQUIREMENT: Only accounts linked to an active Odoo employee in company 1!
          if (!linkedEmp) continue;
          if (seenEmpIds.has(linkedEmp.id)) continue;
          seenEmpIds.add(linkedEmp.id);

          // Full name strictly from Odoo employee record! NEVER derived from email address.
          const odooFullName = String(linkedEmp.name || '').trim();
          if (!odooFullName || odooFullName.toLowerCase() === userEmail.split('@')[0].toLowerCase()) {
            continue;
          }

          operators.push({
            id: linkedEmp.id,
            name: odooFullName,
            jobTitle: cleanOdooJobTitle(linkedEmp),
            department: cleanOdooDepartment(linkedEmp),
            workEmail: account.email || linkedEmp.work_email,
            mobilePhone: linkedEmp.mobile_phone || null,
            userId: Array.isArray(linkedEmp.user_id) ? linkedEmp.user_id[0] : null,
            userName: Array.isArray(linkedEmp.user_id) ? linkedEmp.user_id[1] : odooFullName,
            checkedIn: false,
            checkedOut: false,
            checkInTime: null,
            assignedItems: [],
          });
        }

        // Also include any active workcenter operators or operations / management employees from Odoo
        for (const emp of allOdooEmployees) {
          if (emp.active === false) continue;
          if (seenEmpIds.has(emp.id)) continue;
          const isWc = workcenterOperatorIds.has(emp.id);
          const dept = cleanOdooDepartment(emp);
          if (!isWc && dept !== 'Operations' && dept !== 'Management') continue;

          seenEmpIds.add(emp.id);
          const odooFullName = String(emp.name || '').trim();
          const email = String(emp.work_email || '').trim().toLowerCase();

          operators.push({
            id: emp.id,
            name: odooFullName,
            jobTitle: cleanOdooJobTitle(emp),
            department: dept,
            workEmail: email && email !== 'false' ? email : null,
            mobilePhone: emp.mobile_phone || null,
            userId: Array.isArray(emp.user_id) ? emp.user_id[0] : null,
            userName: Array.isArray(emp.user_id) ? emp.user_id[1] : odooFullName,
            checkedIn: false,
            checkedOut: false,
            checkInTime: null,
            assignedItems: [],
          });
        }

        // Sort: Management & workcenter operators first, then alphabetically by Odoo full name
        operators.sort((a, b) => {
          const aPriority = a.department === 'Management' ? 0 : workcenterOperatorIds.has(a.id) ? 1 : 2;
          const bPriority = b.department === 'Management' ? 0 : workcenterOperatorIds.has(b.id) ? 1 : 2;
          if (aPriority !== bPriority) return aPriority - bPriority;
          return a.name.localeCompare(b.name);
        });

        // Get today's attendance and assigned equipment concurrently in parallel!
        if (operators.length > 0) {
          const operatorIds = operators.map((op) => op.id);
          const [attendanceRecords, allEquipments] = await Promise.all([
            client.getBulkAttendance(operatorIds).catch((err) => {
              console.warn('[shopFloor] Failed to fetch bulk attendance:', err);
              return [];
            }),
            client.getBulkAssignedEquipment().catch((err) => {
              console.warn('[shopFloor] Failed to fetch bulk assigned equipment:', err);
              return [];
            }),
          ]);

          for (const rec of attendanceRecords) {
            const empId = Array.isArray(rec.employee_id) ? rec.employee_id[0] : rec.employee_id;
            const op = operators.find((o) => o.id === empId);
            if (op) {
              op.checkedIn = Boolean(rec.check_in && !rec.check_out);
              op.checkedOut = Boolean(rec.check_out);
              op.checkInTime = toEAT(rec.check_in) || rec.check_in;
            }
          }

          const equipByEmployeeId = new Map<number, Array<(typeof allEquipments)[number]>>();
          for (const eq of allEquipments) {
            if (eq.employee_id) {
              const empId = eq.employee_id[0];
              if (!equipByEmployeeId.has(empId)) {
                equipByEmployeeId.set(empId, []);
              }
              equipByEmployeeId.get(empId)!.push(eq);
            }
          }

          for (const op of operators) {
            const items = equipByEmployeeId.get(op.id) || [];
            op.assignedItems = items.map((i) => ({
              id: String(i.id),
              itemName: i.name || '',
              assignedDate: i.assign_date || '',
              quantity: 1,
            }));
          }
        }

        const departmentsList = [...new Set(operators.map((op) => op.department).filter(Boolean))];
        const freshData = { allOperators: operators, departments: departmentsList };
        if (operators.length > 0) {
          await saveShopFloorSharedCache(operatorCacheKey, freshData).catch(() => {});
        }
        return freshData;
      },
    );

    // Extract cached data safely regardless of whether MySQL stored an object or an array
    let cachedOperators: OperatorSummary[] = [];
    let cachedDepartments: string[] = [];

    if (persistentCache?.data) {
      if (Array.isArray(persistentCache.data.allOperators)) {
        cachedOperators = persistentCache.data.allOperators;
        cachedDepartments = Array.isArray(persistentCache.data.departments) ? persistentCache.data.departments : [];
      } else if (Array.isArray(persistentCache.data)) {
        cachedOperators = persistentCache.data;
      }
    }

    const hasCachedData = cachedOperators.length > 0;
    const fallbackData = {
      allOperators: cachedOperators,
      departments: cachedDepartments.length > 0
        ? cachedDepartments
        : [...new Set(cachedOperators.map((o) => o.department).filter((d): d is string => Boolean(d)))],
    };

    // Zero-wait SWR: If MySQL persistent cache is available, serve immediately (<10ms).
    // If cold miss (first time boot), wait up to 4500ms so Odoo has time to respond without showing an empty page.
    let resolvedData = hasCachedData
      ? fallbackData
      : await withMaxPageWait(operatorsPromise, 4500, fallbackData);

    let allOperators = Array.isArray(resolvedData?.allOperators) ? resolvedData.allOperators : [];
    let departments = Array.isArray(resolvedData?.departments) ? resolvedData.departments : [];

    // Always ensure background revalidation doesn't create unhandled rejections
    void operatorsPromise.catch((err) => {
      console.warn('[shopFloor/operators] Background operators revalidation failed:', err?.message || err);
    });

    // Guaranteed post-filter: Exclude any entry that is inactive or has an email-derived username as its name
    if (allOperators && allOperators.length > 0) {
      allOperators = allOperators.filter((op) => {
        if (!op || !op.id || !op.name) return false;
        const n = op.name.trim();
        const prefix = String(op.workEmail || '').split('@')[0].trim().toLowerCase();
        if (n.toLowerCase() === prefix) return false;
        if (op.workEmail && op.workEmail.toLowerCase().includes('onyangoakulo22')) return false;
        return true;
      });
      departments = [...new Set(allOperators.map((op) => op.department).filter((d): d is string => Boolean(d)))];
    }

    // Non-blocking background warmup of weekly PDF snapshot so download is instant (<50ms)
    void getOrBuildWeeklyShopFloorReportPdf().catch(() => {});

    const csrfToken = req.csrfToken || '';

    res.render('shop-floor-operators', {
      pageTitle: 'Shop Floor Operators',
      appName: env.APP_NAME,
      operators: allOperators,
      departments,
      total: allOperators.length,
      checkedInCount: allOperators.filter((o: OperatorSummary) => o && o.checkedIn).length,
      authUser: req.authUser,
      csrfToken,
      message: typeof req.query.message === 'string' ? req.query.message : null,
      error: typeof req.query.error === 'string' ? req.query.error : null,
    });
  } catch (err) {
    console.error('[shopFloor/operators] Error loading operators:', err);
    res.status(500).render('error', {
      pageTitle: 'Error',
      appName: env.APP_NAME,
      errorMessage: err instanceof Error ? err.message : 'Could not load operators.',
      details: [],
      csrfToken: req.csrfToken || '',
    });
  }
});

/**
 * Build welcome email HTML for an operator.
 */
function buildOperatorWelcomeEmail(op: { name: string; workEmail: string }, appUrl: string): { subject: string; html: string } {
  const firstName = op.name.split(' ')[0];
  const loginUrl = `${appUrl}/login`;

  const subject = `${firstName}, set up your Urban Vibe Shop Floor account`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background: #f4f4f8; padding: 2rem; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 2rem 2rem 1.5rem; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 1.5rem; font-weight: 700;">Urban Vibe Interior Design</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 0.5rem 0 0; font-size: 0.95rem;">Shop Floor Portal</p>
    </div>
    
    <!-- Body -->
    <div style="padding: 2rem;">
      <h2 style="color: #1e3a5f; margin: 0 0 1rem; font-size: 1.2rem;">Welcome, ${firstName}! 👋</h2>
      
      <p style="color: #374151; line-height: 1.6; margin: 0 0 1.5rem;">
        Your Shop Floor account has been set up. You can now:
      </p>
      
      <ul style="color: #374151; line-height: 1.8; margin: 0 0 1.5rem; padding-left: 1.2rem;">
        <li>📋 View your work orders and progress</li>
        <li>🕐 Check your attendance status</li>
        <li>💰 Download your payslips</li>
        <li>💸 See any salary advances</li>
      </ul>
      
      <p style="color: #374151; line-height: 1.6; margin: 0 0 1.5rem;">
        <strong>Your login email:</strong> ${op.workEmail}<br>
        Use this email to sign in — you'll receive a one-time code.
      </p>
      
      <!-- Button -->
      <div style="text-align: center; margin: 2rem 0;">
        <a href="${loginUrl}" style="display: inline-block; padding: 0.85rem 2.5rem; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 1rem;">
          Go to Shop Floor Portal →
        </a>
      </div>
      
      <p style="color: #6b7280; font-size: 0.85rem; line-height: 1.5; margin: 0;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${loginUrl}" style="color: #2563eb; word-break: break-all;">${loginUrl}</a>
      </p>
    </div>
    
    <!-- Footer -->
    <div style="background: #f9fafb; padding: 1.2rem 2rem; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #9ca3af; font-size: 0.78rem; margin: 0;">
        Urban Vibe Interior Design LTD · Shop Floor Portal<br>
        This is an automated message. Please do not reply directly.
      </p>
    </div>
  </div>
</body>
</html>`.trim();

  return { subject, html };
}

/**
 * POST /shop-floor/operators/send-invite
/**
 * POST /shop-floor/operators/send-invite
 * Sends welcome emails to selected operators with login instructions.
 */
router.post('/shop-floor/operators/send-invite', async (req: Request, res: Response) => {
  const isAdmin = req.authUser?.role === 'admin';
  const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
  if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
    res.status(403).json({ ok: false, error: 'Access denied.' });
    return;
  }

  const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids : (req.body.ids ? [String(req.body.ids)] : []);

  if (ids.length === 0) {
    res.redirect('/shop-floor/operators?error=' + encodeURIComponent('Select at least one operator.'));
    return;
  }

  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);

    // Fetch operator details
    const operatorIds = ids.map(Number).filter((n) => !isNaN(n));
    const allOperators: Array<{ id: number; name: string; workEmail: string | null }> = [];

    const targetCompanyId = await client.getTargetCompanyIdValue();
    const emps = await client.searchReadRecords<any>('hr.employee', {
      domain: [
        ['id', 'in', operatorIds],
        ['company_id', '=', targetCompanyId],
        ['active', '=', true],
      ],
      fields: ['id', 'name', 'work_email'],
    }).catch(() => []);

    for (const emp of emps) {
      if (emp.work_email) {
        allOperators.push({ id: emp.id, name: emp.name, workEmail: emp.work_email });
      }
    }

    const appUrl = env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
    let sent = 0;
    const errors: string[] = [];

    for (const op of allOperators) {
      if (!op.workEmail) {
        errors.push(`${op.name}: no work email`);
        continue;
      }

      try {
        const { subject, html } = buildOperatorWelcomeEmail({ name: op.name, workEmail: op.workEmail }, appUrl);
        await sendMailWithConfig(settings.mail, {
          to: op.workEmail,
          subject,
          html,
        });
        sent++;
      } catch (err) {
        errors.push(`${op.name}: ${err instanceof Error ? err.message : 'send failed'}`);
      }
    }

    const msg = `Sent ${sent} welcome email(s)${errors.length ? '. Errors: ' + errors.join('; ') : ''}`;
    res.redirect(`/shop-floor/operators?message=${encodeURIComponent(msg)}`);
  } catch (err) {
    res.redirect(`/shop-floor/operators?error=${encodeURIComponent(err instanceof Error ? err.message : 'Failed to send invites.')}`);
  }
});

/**
 * POST /shop-floor/operators/sync-access — Sync operators to Access Control approved users.
 */
router.post('/shop-floor/operators/sync-access', async (req: Request, res: Response) => {
  const isAdmin = req.authUser?.role === 'admin';
  const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
  if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
    res.status(403).redirect('/dashboard');
    return;
  }

  try {
    const result = await syncShopFloorOperatorAccess();
    shopFloorCache.delete('shop-floor:operators-list:v1');
    shopFloorCache.delete('shop-floor:operators-list:v2');
    await Promise.allSettled([
      deleteShopFloorSharedCache('shop-floor:operators-list:v1'),
      deleteShopFloorSharedCache('shop-floor:operators-list:v2'),
    ]);
    res.redirect(`/shop-floor/operators?message=${encodeURIComponent(`Synced ${result.operators} operator(s): ${result.added} added and ${result.updated} updated with Shop Floor access.`)}`);
  } catch (err) {
    res.redirect(`/shop-floor/operators?error=${encodeURIComponent(err instanceof Error ? err.message : 'Failed to sync operators.')}`);
  }
});

/**
 * POST /shop-floor/incident — Report a machine breakdown.
 */
router.post('/shop-floor/incident', async (req: Request, res: Response) => {
  if (!req.authUser) { res.redirect('/login'); return; }
  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const viewedEmail = getViewedUserEmail(req);

    // Find the employee ID
    let employee = await client.findEmployeeByUserEmail(viewedEmail);
    if (!employee) {
      employee = await client.findEmployeeByWorkEmail(viewedEmail);
    }
    const employeeId = employee ? employee.id : null;

    const machineInput = String(req.body.machine || '');
    const component = String(req.body.component || '').trim();
    let equipmentId: number | null = null;
    let machineName = '';

    if (machineInput === '__custom__') {
      machineName = String(req.body.machineCustom || '').trim();
    } else {
      const eqId = Number(machineInput);
      if (Number.isFinite(eqId) && eqId > 0) {
        equipmentId = eqId;
        const equipment = await client.readRecords<{ name: string }>('maintenance.equipment', [eqId], ['name']);
        if (equipment && equipment.length > 0) {
          machineName = equipment[0].name;
        } else {
          machineName = `Equipment ID ${eqId}`;
        }
      } else {
        machineName = machineInput;
      }
    }

    if (!machineName) {
      throw new Error('Please specify a machine.');
    }
    if (!isValidMachineComponent(machineName, component)) {
      throw new Error('Select a valid component for the chosen machine.');
    }

    const severity = String(req.body._severity || 'medium');
    const priorityMap: Record<string, string> = {
      critical: '3',
      high: '2',
      medium: '1',
      low: '0',
    };
    const priority = priorityMap[severity] || '1';

    await client.createMaintenanceRequest({
      equipmentId,
      machineName,
      description: `Component: ${component}\n${String(req.body.description || '')}`,
      employeeId,
      priority,
    });

    // Invalidate cached operator dashboards because of the new incident
    shopFloorCache.clearPrefix('shop-floor-dashboard:');
    void Promise.allSettled([
      deleteShopFloorSharedCache('shop-floor:shared-incidents:v1'),
      deleteShopFloorDashboardSnapshot(),
    ]).catch(() => {});
    res.redirect('/shop-floor?message=' + encodeURIComponent('Incident reported.'));
  } catch (err) {
    res.redirect('/shop-floor?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed.'));
  }
});

/**
 * POST /shop-floor/incident/:id/resolve
 */
router.post('/shop-floor/incident/:id/resolve', async (req: Request, res: Response) => {
  const isAdmin = req.authUser?.role === 'admin';
  const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
  if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) { res.redirect('/login'); return; }
  try {
    const incidentId = Number(req.params.id);
    if (Number.isFinite(incidentId) && incidentId > 0) {
      const settings = await getSettings();
      const client = new OdooClient(settings.odoo);
      await client.resolveMaintenanceRequest(incidentId);
    } else {
      await resolveShopFloorIncident(req.params.id);
    }
    // Invalidate cached operator dashboards as an incident was resolved
    shopFloorCache.clearPrefix('shop-floor-dashboard:');
    void Promise.allSettled([
      deleteShopFloorSharedCache('shop-floor:shared-incidents:v1'),
      deleteShopFloorDashboardSnapshot(),
    ]).catch(() => {});
    res.redirect('/shop-floor?message=' + encodeURIComponent('Incident resolved.'));
  } catch (err) {
    res.redirect('/shop-floor?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed.'));
  }
});

/**
 * POST /shop-floor/work-order/:id/plan-date
 * Stores the client-required completion date on the manufacturing order.
 */
router.post('/shop-floor/work-order/:id/plan-date', async (req: Request, res: Response) => {
  if (!req.authUser) { res.redirect('/login'); return; }

  const moId = Number(req.params.id);
  const planDate = String(req.body.planDate || '').trim();
  const returnTo = String(req.body.returnTo || '/shop-floor');

  if (!Number.isFinite(moId) || moId <= 0) {
    res.redirect(`${returnTo}?error=${encodeURIComponent('Invalid manufacturing order.')}`);
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
    res.redirect(`${returnTo}?error=${encodeURIComponent('Please choose a valid plan date.')}`);
    return;
  }

  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    await client.setManufacturingOrderPlanDate(moId, `${planDate} 23:59:59`);
    shopFloorCache.clearPrefix('shop-floor-dashboard:');
    res.redirect(`${returnTo}?message=${encodeURIComponent('Plan date saved.')}`);
  } catch (err) {
    res.redirect(`${returnTo}?error=${encodeURIComponent(err instanceof Error ? err.message : 'Failed to save plan date.')}`);
  }
});

/**
 * POST /shop-floor/assign-item â€” Admin assigns equipment to an operator.
 */
router.post('/shop-floor/assign-item', async (req: Request, res: Response) => {
  const isAdmin = req.authUser?.role === 'admin';
  const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
  if (!req.authUser) { res.redirect('/login'); return; }
  const viewedEmail = getViewedUserEmail(req);
  const emailStr = isAdmin || isShopFloorAdmin
    ? String(req.body.email || viewedEmail || '')
    : String(viewedEmail || '');
  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    await client.assignEquipmentToEmployee(
      emailStr,
      String(req.body.itemName || ''),
      String(req.body.assignedDate || new Date().toISOString().slice(0, 10))
    );
    // Invalidate the cache for this specific operator
    if (emailStr) {
      shopFloorCache.delete(`shop-floor-dashboard:v3:${emailStr.toLowerCase()}`);
    }
    res.redirect('/shop-floor/operators?message=' + encodeURIComponent('Item assigned.'));
  } catch (err) {
    res.redirect('/shop-floor/operators?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed.'));
  }
});

/**
 * GET /shop-floor/boards — Board Intake & Auto-Reserve dashboard.
 */
router.get('/shop-floor/boards', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.redirect('/login');
    return;
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const featureFlags = await getShopFloorFeatureFlags();
  if (!featureFlags['add-stock'] && !canManageShopFloor(req)) {
    res.status(404).render('error', {
      pageTitle: 'Feature unavailable',
      errorMessage: 'Add Stock is currently disabled by an administrator.',
      details: [],
      csrfToken: req.csrfToken || null,
    });
    return;
  }

  try {
    const boardLogPage = Math.max(1, Number.parseInt(String(req.query.boardLogPage || '1'), 10) || 1);
    const boardLogPageSize = 12;
    const isRefresh = req.query.refresh === 'true';

    const nairobiNow = dayjs().tz(env.APP_TIMEZONE || 'Africa/Nairobi');
    const todayDate = nairobiNow.format('YYYY-MM-DD');
    const yesterdayDate = nairobiNow.subtract(1, 'day').format('YYYY-MM-DD');

    const rawDateQuery = typeof req.query.date === 'string' ? req.query.date.trim() : null;
    let selectedDate = todayDate;
    if (rawDateQuery === 'all') {
      selectedDate = 'all';
    } else if (rawDateQuery === 'today') {
      selectedDate = todayDate;
    } else if (rawDateQuery === 'yesterday') {
      selectedDate = yesterdayDate;
    } else if (rawDateQuery && /^\d{4}-\d{2}-\d{2}$/.test(rawDateQuery)) {
      selectedDate = rawDateQuery;
    }

    const isDateAll = selectedDate === 'all';
    const effectiveDate = isDateAll ? todayDate : selectedDate;

    const activeDayjs = dayjs.tz(effectiveDate, env.APP_TIMEZONE || 'Africa/Nairobi');
    const prevDate = activeDayjs.subtract(1, 'day').format('YYYY-MM-DD');
    const nextDate = activeDayjs.add(1, 'day').format('YYYY-MM-DD');
    const isNextDisabled = !isDateAll && effectiveDate >= todayDate;

    const isFilteringToday = !isDateAll && effectiveDate === todayDate;
    const isFilteringYesterday = !isDateAll && effectiveDate === yesterdayDate;

    const todayDisplayShort = nairobiNow.format('D MMM');
    const yesterdayDisplayShort = nairobiNow.subtract(1, 'day').format('D MMM');

    let activeDateDisplay = 'Today (' + todayDisplayShort + ')';
    if (isDateAll) {
      activeDateDisplay = 'All Logs';
    } else if (isFilteringToday) {
      activeDateDisplay = 'Today (' + todayDisplayShort + ')';
    } else if (isFilteringYesterday) {
      activeDateDisplay = 'Yesterday (' + yesterdayDisplayShort + ')';
    } else {
      activeDateDisplay = activeDayjs.format('D MMM YYYY');
    }

    const prevDateLabel = prevDate === yesterdayDate ? 'Yesterday' : dayjs.tz(prevDate, env.APP_TIMEZONE || 'Africa/Nairobi').format('D MMM');
    const prevDateShortLabel = prevDate === yesterdayDate ? 'Yesterday' : dayjs.tz(prevDate, env.APP_TIMEZONE || 'Africa/Nairobi').format('D MMM');
    const nextDateLabel = nextDate === todayDate ? 'Today' : dayjs.tz(nextDate, env.APP_TIMEZONE || 'Africa/Nairobi').format('D MMM');
    const nextDateShortLabel = nextDate === todayDate ? 'Today' : dayjs.tz(nextDate, env.APP_TIMEZONE || 'Africa/Nairobi').format('D MMM');

    if (isRefresh) {
      // Trigger fresh sync from Odoo in background without blocking initial render
      void syncPendingProcessesFromOdoo(true).catch(() => null);
    }

    const [settings, stockMirror, recentIntakeRows, pendingProcesses, customers, todayLogsCount, yesterdayLogsCount, selectedDateLogsCount] = await Promise.all([
      getSettings(),
      getStockMirrorForPage(isRefresh),
      getRecentBoardIntakeQueueEntries(boardLogPageSize + 1, (boardLogPage - 1) * boardLogPageSize, selectedDate),
      getPendingShopFloorProcesses({ status: 'pending' }),
      getCustomersForPage(200),
      countBoardIntakeQueueEntries(todayDate),
      countBoardIntakeQueueEntries(yesterdayDate),
      countBoardIntakeQueueEntries(selectedDate),
    ]);

    const hasNextBoardLogPage = recentIntakeRows.length > boardLogPageSize;
    const recentIntakes = recentIntakeRows.slice(0, boardLogPageSize);
    const products = stockMirror.products;

    const optimisticSyncs = activeOptimisticBoardIntakes();
    const activeQueueSyncs = recentIntakes.filter(
      (row: any) => row.status === 'processing' || row.status === 'pending',
    );

    // Format local stock alerts strictly from pending processes in MySQL (single source of truth)
    const localStockAlerts: StockAlert[] = pendingProcesses.map((p) => {
      const pPartner = String(p.partner_name || '').trim().toLowerCase();
      const pProduct = String(p.product_name || '').trim().toLowerCase();

      const matchingSync =
        optimisticSyncs.find(
          (s) =>
            (s.partnerId === p.partner_id ||
              s.customerName.trim().toLowerCase() === pPartner) &&
            (s.productId === p.product_id ||
              s.productName.toLowerCase().includes(pProduct) ||
              pProduct.includes(s.productName.toLowerCase())),
        ) ||
        activeQueueSyncs.find(
          (q: any) =>
            String(q.customer_name || '').trim().toLowerCase() === pPartner &&
            (String(q.product_name || '').toLowerCase().includes(pProduct) ||
              pProduct.includes(String(q.product_name || '').toLowerCase())),
        );

      // If p.qty_missing > 0, this row represents an active UNLOGGED balance requirement.
      // Any logged quantity was already applied in MySQL, leaving p.qty_missing as the remaining needed count.
      // Therefore, the unlogged balance of p.qty_missing boards is NOT syncing - it is an active unlogged card!
      // An alert item is only "isSyncing" (locked) if there is NO remaining unlogged quantity (qty_missing <= 0).
      const hasUnloggedBalance = Number(p.qty_missing || 0) > 0;
      const isSyncing = !hasUnloggedBalance && Boolean(matchingSync);

      let resolvedClient = p.partner_name && p.partner_name !== 'Unknown Customer' ? p.partner_name.trim() : '';
      if (!resolvedClient && p.partner_id) {
        const matchingCustomer = (customers || []).find((c: any) => c.id === p.partner_id || c.partner_id === p.partner_id);
        if (matchingCustomer?.name) {
          resolvedClient = matchingCustomer.name.trim();
        }
      }
      if (!resolvedClient && p.origin) {
        resolvedClient = p.origin.trim();
      }

      return {
        moName: p.mo_name,
        product: p.product_name,
        component: p.product_name,
        qtyNeeded: p.qty_missing,
        totalNeeded: p.qty_needed,
        qtyReserved: p.qty_reserved,
        client: resolvedClient || p.partner_name || 'No Client',
        moId: p.mo_id,
        confirmedAt: null,
        overdueDays: 0,
        partnerId: p.partner_id || null,
        productId: p.product_id || null,
        isSyncing,
        syncingQty: matchingSync ? Number((matchingSync as any).quantity || (matchingSync as any).qty || 0) : undefined,
        isMoClosed: Boolean(p.is_mo_closed),
      };
    });

    // If local table is empty on first boot, kick off initial sync in background
    if (!pendingProcesses.length && !isRefresh) {
      void syncPendingProcessesFromOdoo(false).catch(() => null);
    }

    res.render('shop-floor-boards', {
      pageTitle: 'Board Intake & Auto-Reserve',
      appName: env.APP_NAME,
      products,
      stockMirror,
      recentIntakes,
      boardLogPage,
      hasNextBoardLogPage,
      stockAlerts: localStockAlerts,
      boardLogEmail: normalizeBoardLogRecipients(settings.stock?.boardLogNotificationEmail),
      customers,
      selectedDate,
      todayDate,
      yesterdayDate,
      prevDate,
      nextDate,
      isNextDisabled,
      isFilteringToday,
      isFilteringYesterday,
      isDateAll,
      activeDateDisplay,
      todayDisplayShort,
      yesterdayDisplayShort,
      prevDateLabel,
      prevDateShortLabel,
      nextDateLabel,
      nextDateShortLabel,
      todayLogsCount,
      yesterdayLogsCount,
      selectedDateLogsCount,
      authUser: req.authUser,
      csrfToken: req.csrfToken || null,
      message: typeof req.query.message === 'string' ? req.query.message : null,
      error: typeof req.query.error === 'string' ? req.query.error : null,
      intakeResult: typeof req.query.intakeResult === 'string'
        ? (() => { try { return JSON.parse(req.query.intakeResult as string); } catch { return null; } })()
        : null,
    });
  } catch (err) {
    res.status(500).render('error', {
      pageTitle: 'Board Intake Error',
      errorMessage: err instanceof Error ? err.message : 'Could not load board intake page.',
      details: [],
      csrfToken: req.csrfToken || null,
    });
  }
});

/**
 * GET /shop-floor/boards/requirements — Fetch pending board component requirements for a customer's MOs.
 * Reads directly from local MySQL (<2ms) and falls back to Odoo if cold.
 */
router.get('/shop-floor/boards/requirements', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const partnerId = Number(req.query.partner_id);
  if (!partnerId) {
    res.status(400).json({ error: 'Missing partner_id' });
    return;
  }
  if (partnerId === 350) {
    res.json([]);
    return;
  }

  try {
    // 1. Query local-first from MySQL (strictly excluding URBAN VIBE 2 and VA prefix)
    const rawLocalPending = await getPendingShopFloorProcesses({ partnerId, status: 'pending' });
    const localPending = rawLocalPending.filter(
      (p) => !String(p.mo_name || '').toUpperCase().startsWith('VA/') && String(p.partner_name || '').toUpperCase() !== 'URBAN VIBE 2'
    );
    if (localPending.length > 0) {
      const reqMap = new Map<string, {
        moId: number;
        moName: string;
        origin: string | null;
        productId: number;
        productName: string;
        qtyNeeded: number;
        qtyReserved: number;
        qtyMissing: number;
      }>();

      for (const p of localPending) {
        const key = `${p.mo_id}_${p.product_id}`;
        const existing = reqMap.get(key);
        if (existing) {
          existing.qtyNeeded += Number(p.qty_needed || 0);
          existing.qtyReserved += Number(p.qty_reserved || 0);
          existing.qtyMissing += Number(p.qty_missing || 0);
        } else {
          reqMap.set(key, {
            moId: p.mo_id,
            moName: p.mo_name,
            origin: p.origin,
            productId: p.product_id,
            productName: p.product_name,
            qtyNeeded: Number(p.qty_needed || 0),
            qtyReserved: Number(p.qty_reserved || 0),
            qtyMissing: Number(p.qty_missing || 0),
          });
        }
      }

      const requirements = Array.from(reqMap.values()).filter((r) => r.qtyMissing > 0 && !String(r.moName || '').toUpperCase().startsWith('VA/'));
      res.json(requirements);
      return;
    }

    // 2. If no local records found for this partner yet (cold cache), fallback to Odoo and trigger background sync
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const requirements = (await client.getCustomerBoardRequirements(partnerId)).filter(
      (r) => !String(r.moName || '').toUpperCase().startsWith('VA/')
    );
    void syncPendingProcessesFromOdoo(false).catch(() => null);
    res.json(applyOptimisticBoardIntakes(partnerId, requirements));
  } catch (err) {
    console.error('[shopFloorRouter] Failed to fetch board requirements:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /shop-floor/sync-mos — On-demand background sync trigger for new MO board requirements.
 */
router.get('/shop-floor/sync-mos', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  const result = await syncPendingProcessesFromOdoo(true);
  res.json(result);
});

/**
 * POST /api/webhooks/odoo/mo — Instant webhook for MO updates from Odoo.
 */
router.post('/api/webhooks/odoo/mo', async (_req: Request, res: Response) => {
  void syncPendingProcessesFromOdoo(true).catch(() => null);
  res.json({ ok: true, message: 'MO sync initiated' });
});

/**
 * Workflow:
 * 1. Add boards to stock (inventory adjustment)
 * 2. Find MOs needing this board for this client (no PO covering it)
 * 3. Call action_assign to reserve stock on those MOs
 * 4. Redirect with detailed result
 */
/**
 * GET /shop-floor/partners/search - Search partner/client records directly from MySQL mirror table (<5ms).
 */
router.get('/shop-floor/partners/search', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ ok: false, results: [] });
    return;
  }

  try {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const results = await searchCustomers(query, 50);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      query,
      results,
    });
  } catch (err) {
    console.error('[shopFloorRouter] Failed to search partner records from MySQL:', err);
    res.status(500).json({ ok: false, results: [] });
  }
});

async function handleAdvanceMo(req: Request, res: Response) {
  const wantsJson = req.get('accept')?.includes('application/json');
  if (!req.authUser) {
    if (wantsJson) {
      res.status(401).json({
        ok: false,
        code: 'session_expired',
        message: 'Your session has expired. Sign in again, then retry this job.',
        loginUrl: '/login?next=%2Fshop-floor',
      });
      return;
    }
    res.redirect('/login');
    return;
  }
  const moId = Number(req.params.id || req.body.moId || req.body.workOrderId || req.body.id);
  const action = req.body.action === 'finish' ? 'finish' : 'start';
  if (!Number.isFinite(moId) || moId <= 0) {
    if (wantsJson) { res.status(400).json({ ok: false, message: 'Invalid manufacturing order.' }); return; }
    res.redirect('/shop-floor?error=' + encodeURIComponent('Invalid manufacturing order.') + '#manufacturing-orders');
    return;
  }

  try {
    const viewedEmail = getViewedUserEmail(req);
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const employee = await resolveShopFloorEmployeeRecord(viewedEmail, client);
    if (!employee) {
      throw new Error('Your signed-in account is not linked to an Odoo employee. Ask an administrator to match your email.');
    }

    // Enforce 100% component availability for BOTH start and finish actions
    const stockCheck = await client.checkManufacturingOrderStockAvailability(moId);
    if (!stockCheck.isFullyAvailable) {
      if (stockCheck.hasMissingBoards) {
        // Run pending PO auto-approval asynchronously in the background so operator gets instant feedback
        void (async () => {
          try {
            const procurement = await client.getManufacturingOrderBoardProcurement(moId);
            const pendingPurchaseOrders = procurement.purchaseOrders.filter((po) => ['draft', 'sent', 'to approve'].includes(po.state));
            if (pendingPurchaseOrders.length) {
              await client.approvePurchaseOrdersForShopFloor(pendingPurchaseOrders);
            }
          } catch (_) {}
        })();
      }

      const missingSummary = stockCheck.missingComponents
        .slice(0, 5)
        .map((c) => `${c.productName} (Need ${c.missingQty} ${c.uom})`)
        .join(', ') + (stockCheck.missingComponents.length > 5 ? ` and ${stockCheck.missingComponents.length - 5} more` : '');
      const actionVerb = action === 'finish' ? 'finish or close' : 'start';
      const message = `Cannot ${actionVerb} ${stockCheck.moName}: Missing required components in stock (${missingSummary}). Add or receive the required stock before proceeding.`;

      let redirectTo = '/shop-floor';
      if (stockCheck.hasMissingBoards) {
        redirectTo = `/shop-floor/boards?message=${encodeURIComponent(message)}`;
      } else if (stockCheck.hasMissingHardware) {
        redirectTo = `/shop-floor/receipts?message=${encodeURIComponent(message)}`;
      }

      if (wantsJson) {
        res.status(409).json({
          ok: false,
          code: 'stock_missing',
          action,
          moId,
          moName: stockCheck.moName,
          message,
          missingComponents: stockCheck.missingComponents,
          hasMissingBoards: stockCheck.hasMissingBoards,
          hasMissingHardware: stockCheck.hasMissingHardware,
          redirectTo,
        });
        return;
      }
      res.redirect(redirectTo);
      return;
    }

    // Stock check passed - Respond instantly for immediate operator feedback
    const targetState = action === 'finish' ? 'done' : 'progress';
    await optimisticallyUpdateSharedWorkOrderState(moId, targetState, employee.name, viewedEmail);
    shopFloorCache.clearPrefix('shop-floor-dashboard:');
    const message = action === 'finish'
      ? 'Current operation finished.'
      : `Manufacturing operation started for ${employee.name}.`;

    if (wantsJson) {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        ok: true,
        state: targetState,
        message,
        employeeName: employee.name,
      });
    } else {
      res.redirect('/shop-floor?message=' + encodeURIComponent(message) + '#manufacturing-orders');
    }

    // Execute Odoo work order transition asynchronously in background
    void (async () => {
      try {
        const advanceResult = await client.advanceManufacturingOrder(moId, action, employee.id, stockCheck);
        await optimisticallyUpdateSharedWorkOrderState(moId, targetState, employee.name, viewedEmail);
        const sharedMoEntry = shopFloorCache.getEntry('shop-floor:shared-work-orders:v1');
        if (sharedMoEntry) {
          sharedMoEntry.freshUntil = 0;
        }
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        const operatorTrackingWarning = action === 'start'
          && advanceResult
          && typeof advanceResult === 'object'
          && 'operatorLinked' in advanceResult
          && !advanceResult.operatorLinked
            ? 'The job is In Progress in Odoo, but Odoo did not allow this app to update the employee tracking field.'
            : null;
        if (operatorTrackingWarning) {
          void logEvent('warn', 'Odoo work order started without employee tracking attribution', {
            moId,
            employeeId: employee.id,
            employeeName: employee.name,
            operatorEmail: viewedEmail,
          });
        }
      } catch (bgErr) {
        void logEvent('error', 'Background advanceManufacturingOrder failed in Odoo', {
          moId,
          action,
          operatorEmail: viewedEmail,
          error: bgErr instanceof Error ? bgErr.message : String(bgErr),
        });
      }
    })();
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not update the manufacturing order.';
    void logEvent('error', 'Shop Floor manufacturing-order action failed in Odoo', {
      moId,
      action,
      operatorEmail: getViewedUserEmail(req),
      error: message,
    });
    if ((err as any)?.code === 'stock_missing') {
      const stockAvailability = (err as any).stockAvailability;
      if (wantsJson) {
        res.status(409).json({
          ok: false,
          code: 'stock_missing',
          action,
          moId,
          moName: stockAvailability?.moName || 'Manufacturing Order',
          message,
          missingComponents: stockAvailability?.missingComponents || [],
          hasMissingBoards: stockAvailability?.hasMissingBoards ?? false,
          hasMissingHardware: stockAvailability?.hasMissingHardware ?? false,
        });
        return;
      }
    }
    const permissionDenied = /access denied|access error|not allowed|permission|forbidden/i.test(message);
    if (wantsJson) {
      res.status(permissionDenied ? 403 : 500).json({
        ok: false,
        code: permissionDenied ? 'permission_denied' : 'odoo_error',
        message,
      });
      return;
    }
    res.redirect('/shop-floor?error=' + encodeURIComponent(message) + '#manufacturing-orders');
  }
}

async function handlePauseMo(req: Request, res: Response) {
  const wantsJson = req.get('accept')?.includes('application/json');
  if (!req.authUser) {
    if (wantsJson) {
      res.status(401).json({ ok: false, code: 'session_expired', message: 'Your session has expired.' });
      return;
    }
    res.redirect('/login');
    return;
  }
  const moId = Number(req.params.id || req.body.moId || req.body.workOrderId || req.body.id);
  const createBackorder = String(req.body.createBackorder || 'true') === 'true';
  const qtyProduced = Number(req.body.qtyProduced || 0);

  if (!Number.isFinite(moId) || moId <= 0) {
    if (wantsJson) {
      res.status(400).json({ ok: false, message: 'Invalid manufacturing order.' });
      return;
    }
    res.redirect('/shop-floor?error=' + encodeURIComponent('Invalid manufacturing order.') + '#manufacturing-orders');
    return;
  }

  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const viewedEmail = getViewedUserEmail(req);
    const employee = await resolveShopFloorEmployeeRecord(viewedEmail, client);
    if (!employee) throw new Error('Your account is not linked to an Odoo employee.');

    await optimisticallyUpdateSharedWorkOrderState(moId, 'paused', employee.name, viewedEmail);
    shopFloorCache.clearPrefix('shop-floor-dashboard:');

    if (wantsJson) {
      res.json({
        ok: true,
        state: 'paused',
        message: 'Manufacturing order paused successfully.',
      });
    } else {
      res.redirect('/shop-floor?message=' + encodeURIComponent('Manufacturing order paused successfully.') + '#manufacturing-orders');
    }

    // Execute pause in background
    void (async () => {
      try {
        await client.pauseManufacturingOrder(moId, { createBackorder, qtyProduced }, employee.id);
        await optimisticallyUpdateSharedWorkOrderState(moId, 'paused', employee.name, viewedEmail);
        const sharedMoEntry = shopFloorCache.getEntry('shop-floor:shared-work-orders:v1');
        if (sharedMoEntry) {
          sharedMoEntry.freshUntil = 0;
        }
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        await logEvent('info', 'Manufacturing order paused', { moId, actor: employee.name, createBackorder });
      } catch (bgErr) {
        void logEvent('error', 'Background pauseManufacturingOrder failed in Odoo', {
          moId,
          error: bgErr instanceof Error ? bgErr.message : String(bgErr),
        });
      }
    })();
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not pause the manufacturing order.';
    void logEvent('error', 'Shop Floor manufacturing-order pause failed in Odoo', {
      moId,
      operatorEmail: getViewedUserEmail(req),
      error: message,
    });
    if (wantsJson) {
      res.status(500).json({ ok: false, message });
      return;
    }
    res.redirect('/shop-floor?error=' + encodeURIComponent(message) + '#manufacturing-orders');
  }
}

router.post('/shop-floor/work-order/:id/advance', handleAdvanceMo);

router.post('/shop-floor', async (req: Request, res: Response) => {
  const moId = Number(req.body.moId || req.body.workOrderId || req.body.id);
  const action = req.body.action;
  if (Number.isFinite(moId) && moId > 0) {
    req.params.id = String(moId);
    if (action === 'pause') {
      return handlePauseMo(req, res);
    }
    if (action === 'start' || action === 'finish') {
      return handleAdvanceMo(req, res);
    }
  }
  const wantsJson = req.get('accept')?.includes('application/json');
  if (wantsJson) {
    res.json({ ok: true, redirectTo: '/shop-floor' });
    return;
  }
  res.redirect('/shop-floor');
});

// Shop Floor path aliases to ensure operators never hit 404
router.get('/shopfloor', (_req: Request, res: Response) => res.redirect(301, '/shop-floor'));
router.get('/shop_floor', (_req: Request, res: Response) => res.redirect(301, '/shop-floor'));
router.get('/shop', (_req: Request, res: Response) => res.redirect(301, '/shop-floor'));
router.post('/shopfloor', (_req: Request, res: Response) => res.redirect(307, '/shop-floor'));
router.post('/shop_floor', (_req: Request, res: Response) => res.redirect(307, '/shop-floor'));

router.get('/shop-floor/work-order/:id/stock-check', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ ok: false, code: 'session_expired', message: 'Your session has expired.' });
    return;
  }
  const moId = Number(req.params.id);
  if (!Number.isFinite(moId) || moId <= 0) {
    res.status(400).json({ ok: false, message: 'Invalid manufacturing order.' });
    return;
  }
  try {
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);
    const stockCheck = await client.checkManufacturingOrderStockAvailability(moId);
    res.json({
      ok: true,
      ...stockCheck,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to check stock availability in Odoo.';
    res.status(500).json({ ok: false, message });
  }
});

router.get('/shop-floor/work-order/:id/pause', (req: Request, res: Response) => {
  res.redirect('/shop-floor#manufacturing-orders');
});

router.post('/shop-floor/work-order/:id/pause', handlePauseMo);

router.get('/shop-floor/operators/weekly-report.pdf', async (req: Request, res: Response) => {
  if (!canManageShopFloor(req)) { res.status(403).send('Administrator access required.'); return; }
  try {
    const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
    const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;
    const forceRefresh = req.query.refresh === 'true';

    const { pdf, filename, fromCache } = await getOrBuildWeeklyShopFloorReportPdf(
      { fromDate, toDate },
      { forceRefresh },
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Report-Cached', fromCache ? 'HIT' : 'MISS');
    res.send(pdf);
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : 'Could not generate report.');
  }
});

router.post('/shop-floor/operators/send-weekly-report', async (req: Request, res: Response) => {
  if (!canManageShopFloor(req)) { res.status(403).send('Administrator access required.'); return; }
  try {
    const sendMode = String(req.body.sendMode || 'all');
    const recipientEmail = String(req.body.recipientEmail || '').trim().toLowerCase();
    if (sendMode === 'entered' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      res.redirect(`/shop-floor/operators?error=${encodeURIComponent('Enter a valid recipient email address.')}`);
      return;
    }
    const recipients = sendMode === 'entered'
      ? await sendWeeklyShopFloorReport([recipientEmail], false)
      : await sendWeeklyShopFloorReport();
    res.redirect(`/shop-floor/operators?message=${encodeURIComponent(`Report sent to ${recipients.join(', ')}.`)}`);
  } catch (error) {
    res.redirect(`/shop-floor/operators?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not send report.')}`);
  }
});

router.post('/shop-floor/features', async (req: Request, res: Response) => {
  if (!canManageShopFloor(req)) {
    res.status(403).send('Only administrators can manage Shop Floor apps.');
    return;
  }
  const flags = SHOP_FLOOR_FEATURE_KEYS.reduce((result, key) => {
    result[key] = req.body[key] === 'on';
    return result;
  }, {} as ShopFloorFeatureFlags);
  await saveShopFloorFeatureFlags(flags);
  shopFloorCache.clear();
  await logEvent('info', 'Shop Floor app availability updated', { updatedBy: req.authUser?.email, flags }).catch(() => undefined);
  res.redirect('/shop-floor?message=' + encodeURIComponent('Shop Floor apps updated.'));
});

router.post('/shop-floor/board-intake', async (req: Request, res: Response) => {
  const wantsJson = Boolean(req.xhr || req.headers.accept?.includes('application/json') || req.is('json'));
  if (!req.authUser) {
    if (wantsJson) {
      res.status(401).json({ ok: false, error: 'Please sign in first.' });
      return;
    }
    res.redirect('/login');
    return;
  }

  const { product_id, quantity, partner_id } = req.body;
  if (!product_id || !quantity || !partner_id) {
    const errorMsg = 'Missing required fields: board type, quantity, and client are all required.';
    if (wantsJson) {
      res.status(400).json({ ok: false, error: errorMsg });
      return;
    }
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent(errorMsg));
    return;
  }

  const productId = Number(product_id);
  const qty = Number(quantity);
  const partnerId = Number(partner_id);

  if (qty <= 0 || !Number.isFinite(qty) || !Number.isInteger(qty) || qty % 1 !== 0) {
    const errorMsg = 'Only full boards can be logged. Offcuts do not need logging.';
    if (wantsJson) {
      res.status(400).json({ ok: false, error: errorMsg });
      return;
    }
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent(errorMsg));
    return;
  }

  try {
    const productName = String(req.body.product_name || '').trim() || `Product #${productId}`;
    const customerName = String(req.body.partner_name || '').trim() || `Client #${partnerId}`;
    const vehicleRegistration = String(req.body.vehicle_registration || '').trim().toUpperCase();
    const arrivalDate = String(req.body.arrival_date || '').trim();
    const arrivalTime = String(req.body.arrival_time || '').trim();
    const gate = String(req.body.gate || '').trim();
    const isPurchase = req.body.is_purchase === 'true' || req.body.is_purchase === '1' || req.body.is_purchase === 'on' || req.body.is_purchase === 'purchase' || req.body.source_type === 'purchase';
    const purchaseOrderReference = String(req.body.purchase_order_reference || '').trim() || null;
    const actorName = req.authUser.displayName || req.authUser.email;
    const optimisticId = randomUUID();
    await createBoardIntakeQueueEntry({
      id: optimisticId, productId, productName, partnerId, customerName,
      quantity: qty, actorName, actorEmail: req.authUser.email,
      vehicleRegistration, arrivalDate, arrivalTime, gate,
      isPurchase, purchaseOrderReference: purchaseOrderReference || undefined,
    });
    await recordOptimisticStockAddition(productId, productName, qty);
    const moId = req.body.mo_id ? Number(req.body.mo_id) : undefined;
    const moName = req.body.mo_name ? String(req.body.mo_name).trim() : undefined;

    // Mark matching pending board requirements loaded in MySQL immediately
    const updatedRequirements = await markPendingShopFloorProcessesLoaded({
      partnerId,
      productId,
      customerName,
      productName,
      loadedBy: actorName,
      quantity: qty,
      moId,
      moName,
    });
    optimisticBoardIntakes.push({ id: optimisticId, partnerId, productId, productName, customerName, quantity: qty, expiresAt: Date.now() + 10 * 60 * 1000 });
    shopFloorCache.clearPrefix('shop-floor-dashboard:');
    void Promise.allSettled([
      deleteShopFloorDashboardSnapshot(),
      deleteShopFloorSharedCachePrefix('shop-floor:shared-board-reg:'),
    ]).catch(() => {});

    const hasMoReq = updatedRequirements && updatedRequirements.length > 0;
    const totalNeeded = hasMoReq ? updatedRequirements.reduce((sum, r) => sum + Number(r.qty_needed || 0), 0) : null;
    const totalMissing = hasMoReq ? updatedRequirements.reduce((sum, r) => sum + Number(r.qty_missing || 0), 0) : null;
    const moNames = hasMoReq ? [...new Set(updatedRequirements.map((r) => r.mo_name).filter(Boolean))].join(', ') : '';
    const resolvedMoNames = moNames || (moName ? moName : '');
    const effectiveHasMoReq = hasMoReq || Boolean(moName);

    let partialSuffix = '';
    if (effectiveHasMoReq && totalNeeded != null && totalMissing != null) {
      if (totalMissing > 0) {
        partialSuffix = ` (Partial: ${qty} logged, balance ${totalMissing} of ${totalNeeded} needed for ${resolvedMoNames || 'MO'})`;
      } else {
        partialSuffix = ` (Complete: all ${totalNeeded} supplied for ${resolvedMoNames || 'MO'})`;
      }
    } else if (resolvedMoNames) {
      partialSuffix = ` (For ${resolvedMoNames})`;
    }

    const purchaseTypeBadge = isPurchase ? ' [Purchase]' : ' [Client Supply]';
    const successMessage = `Boards saved immediately: ${qty} x ${productName} for ${customerName}${purchaseTypeBadge}${partialSuffix}${vehicleRegistration ? ` (${vehicleRegistration})` : ''}. Odoo synchronization and MO reservation are continuing in the background.`;

    if (wantsJson) {
      res.json({
        ok: true,
        message: successMessage,
        item: {
          id: optimisticId,
          product_id: productId,
          product_name: productName,
          partner_id: partnerId,
          customer_name: customerName,
          quantity: qty,
          vehicle_registration: vehicleRegistration,
          arrival_date: arrivalDate,
          arrival_time: arrivalTime,
          gate,
          is_purchase: isPurchase ? 1 : 0,
          purchase_order_reference: purchaseOrderReference,
          actor_name: actorName,
          actor_email: req.authUser.email,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
        updatedRequirements: updatedRequirements || [],
        balanceRemaining: totalMissing,
        totalNeeded,
      });
    } else {
      res.redirect('/shop-floor/boards?message=' + encodeURIComponent(successMessage));
    }

    void (async () => {
      let effectiveIsPurchase = isPurchase;
      let effectivePoRef = purchaseOrderReference;

      // 1. Synchronize board inventory, validate matching PO receipt if connected, and reserve MO in Odoo
      try {
        const syncResult = await syncBoardIntakeEntry(optimisticId);
        const refreshed = await getBoardIntakeQueueEntry(optimisticId);
        if (refreshed) {
          effectiveIsPurchase = Boolean(refreshed.is_purchase);
          effectivePoRef = refreshed.purchase_order_reference || null;
        }
        await markPendingShopFloorProcessesLoaded({
          partnerId,
          productId,
          customerName,
          productName,
          loadedBy: actorName,
          quantity: qty,
          moId,
          moName,
        }).catch(() => 0);

        const optimisticIndex = optimisticBoardIntakes.findIndex((entry) => entry.id === optimisticId);
        if (optimisticIndex >= 0) optimisticBoardIntakes.splice(optimisticIndex, 1);
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        await logEvent('info', 'Board intake background MO reservation completed', {
          productId, partnerId, quantity: qty,
          matchingMoCount: syncResult.matchingMoCount || 0,
        }).catch(() => undefined);
      } catch (syncErr) {
        console.warn('[ShopFloor] Board intake sync background error:', syncErr);
      }

      // 2. Dispatch email alert with accurate purchase / PO status
      try {
        const settings = await getSettings();
        const rawRecipients = normalizeBoardLogRecipients(settings.stock?.boardLogNotificationEmail);
        const recipientList = [...new Set(rawRecipients.split(/[,\s;\n]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
        const toRecipients = recipientList.join(', ');
        const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE || 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        const safeCustomerName = escapeHtml(customerName);
        const safeProductName = escapeHtml(productName);
        const safeVehicleReg = escapeHtml(vehicleRegistration || '—');
        const safeArrivalTime = escapeHtml(arrivalTime || '—');
        const safeGate = escapeHtml(gate || '—');
        const safeActorEmail = escapeHtml(actorName);
        const subjectCustomerName = customerName.replace(/[\r\n]+/g, ' ').trim();

        const partialSubjectTag = (effectiveHasMoReq && totalMissing != null && totalMissing > 0)
          ? ` (Partial: ${qty} Logged, Balance ${totalMissing} Needed)`
          : (resolvedMoNames ? ` (${resolvedMoNames})` : '');

        let reqDetailsHtml = '';
        if (effectiveHasMoReq && totalNeeded != null) {
          reqDetailsHtml += `<br>Total Required: ${totalNeeded} sheets`;
          if (totalMissing != null) {
            if (totalMissing > 0) {
              reqDetailsHtml += `<br>Balance Remaining: <strong style="color:#b91c1c;">${totalMissing} sheet${totalMissing === 1 ? '' : 's'} needed</strong>`;
            } else {
              reqDetailsHtml += `<br>Balance Remaining: <strong style="color:#15803d;">0 sheets (Fully supplied)</strong>`;
            }
          }
        }
        if (resolvedMoNames) {
          reqDetailsHtml += `<br>Manufacturing Order: ${escapeHtml(resolvedMoNames)}`;
        }

        let calloutHtml = '';
        if (effectiveHasMoReq && totalNeeded != null && totalMissing != null) {
          if (totalMissing > 0) {
            calloutHtml = `<p style="margin-top:12px;padding:8px 12px;background:#fef2f2;border-left:4px solid #ef4444;color:#991b1b;border-radius:4px;">` +
              `⚠️ <strong>PARTIAL INTAKE:</strong> ${qty} sheet${qty === 1 ? '' : 's'} logged, balance <strong>${totalMissing} sheet${totalMissing === 1 ? '' : 's'}</strong> still required for ${escapeHtml(resolvedMoNames || 'MO')}. Stock requirement of ${totalMissing} board${totalMissing === 1 ? '' : 's'} remains active before cutting/completion can start.` +
              `</p>`;
          } else {
            calloutHtml = `<p style="margin-top:12px;padding:8px 12px;background:#f0fdf4;border-left:4px solid #22c55e;color:#166534;border-radius:4px;">` +
              `✅ <strong>COMPLETE INTAKE:</strong> All ${totalNeeded} sheets received and allocated in stock for ${escapeHtml(resolvedMoNames || 'MO')}.` +
              `</p>`;
          }
        } else if (resolvedMoNames) {
          calloutHtml = `<p style="margin-top:12px;padding:8px 12px;background:#f0fdf4;border-left:4px solid #22c55e;color:#166534;border-radius:4px;">` +
            `✅ <strong>BOARD INTAKE:</strong> ${qty} sheet${qty === 1 ? '' : 's'} logged and allocated for ${escapeHtml(resolvedMoNames)}.` +
            `</p>`;
        }

        const purchaseSubjectTag = effectiveIsPurchase ? ' [PURCHASE]' : ' [CLIENT SUPPLY]';
        const purchaseLabel = effectiveIsPurchase
          ? (effectivePoRef ? `Yes (PO: ${escapeHtml(effectivePoRef)})` : 'Yes (Company Purchase)')
          : 'No (Client Supplied)';

        const appBaseUrl = String(env.APP_BASE_URL || 'https://app.urbanvibeinteriordesign.co.ke').replace(/\/+$/, '');
        const fullListUrl = `${appBaseUrl}/shop-floor/boards?date=${encodeURIComponent(reportDate)}#recentBoardLogsSection`;
        const buttonHtml = `<div style="margin-top:20px;margin-bottom:12px;">` +
          `<a href="${fullListUrl}" style="display:inline-block;background-color:#0f172a;color:#ffffff;text-decoration:none;padding:10px 22px;font-size:14px;font-weight:600;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.08);letter-spacing:0.01em;" target="_blank">` +
          `📋 View Full Board Logs List &rarr;` +
          `</a>` +
          `</div>`;

        await sendMailWithConfig(settings.mail, {
          to: toRecipients,
          subject: `${subjectCustomerName} - Board Log${purchaseSubjectTag}${partialSubjectTag} - ${reportDate}`,
          html: `<p><strong>Board log completed</strong></p><p>Client: ${safeCustomerName}<br>Board: ${safeProductName}<br>Purchase: <strong style="${effectiveIsPurchase ? 'color:#1d4ed8;' : 'color:#475569;'}">${purchaseLabel}</strong><br>Quantity: ${qty} sheet${qty === 1 ? '' : 's'}${reqDetailsHtml}<br>Gate: ${safeGate}<br>Vehicle Reg: ${safeVehicleReg}<br>Arrival Time: ${safeArrivalTime}<br>Date: ${reportDate}<br>Logged by: ${safeActorEmail}</p>${calloutHtml}${buttonHtml}`,
        });
      } catch (mailError) {
        await logEvent('error', `Board log email failed`, {
          customerName, productName, quantity: qty, vehicleRegistration, arrivalTime, gate, actor: actorName, actorEmail: req.authUser?.email,
          error: mailError instanceof Error ? mailError.message : String(mailError),
        });
      }
    })();
    return;
  } catch (err) {
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed to process board intake.'));
  }
});

/**
 * POST /shop-floor/boards/notification-email — Update the email that receives board log intake notifications.
 */
router.post('/shop-floor/boards/notification-email', async (req: Request, res: Response) => {
  const wantsJson = Boolean(req.xhr || req.headers.accept?.includes('application/json') || req.is('json'));
  if (!req.authUser) {
    if (wantsJson) {
      res.status(401).json({ ok: false, error: 'Please sign in first.' });
      return;
    }
    res.redirect('/login');
    return;
  }

  if (!canManageShopFloor(req)) {
    const errorMsg = 'Administrator access required to update board log notification email.';
    if (wantsJson) {
      res.status(403).json({ ok: false, error: errorMsg });
      return;
    }
    res.status(403).redirect('/shop-floor/boards?error=' + encodeURIComponent(errorMsg));
    return;
  }

  const rawEmail = normalizeBoardLogRecipients(String(req.body.email || req.body.stockBoardLogNotificationEmail || ''));
  if (!rawEmail || !rawEmail.includes('@')) {
    const errorMsg = 'Please provide a valid email address.';
    if (wantsJson) {
      res.status(400).json({ ok: false, error: errorMsg });
      return;
    }
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent(errorMsg));
    return;
  }

  try {
    const settings = await getSettings();
    await saveSettings({
      baseUrl: settings.odoo.baseUrl,
      database: settings.odoo.database,
      username: settings.odoo.username,
      apiKey: settings.odoo.apiKey,
      keepExistingApiKey: true,
      stock: {
        ...settings.stock,
        boardLogNotificationEmail: rawEmail,
      },
    });
    await logEvent('info', 'Board log notification email updated', {
      updatedBy: req.authUser.email,
      boardLogNotificationEmail: rawEmail,
    });

    if (wantsJson) {
      res.json({ ok: true, email: rawEmail, message: 'Notification recipient email updated successfully.' });
      return;
    }
    res.redirect('/shop-floor/boards?message=' + encodeURIComponent('Board log notification email updated to ' + rawEmail));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to update email.';
    if (wantsJson) {
      res.status(500).json({ ok: false, error: errorMsg });
      return;
    }
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent(errorMsg));
  }
});

router.get('/shop-floor/receipts', async (req: Request, res: Response) => {
  if (!req.authUser) { res.redirect('/login'); return; }
  try {
    const settings = await getSettings();
    const warehouseId = Number(settings.stock.warehouseId || 0);
    if (!warehouseId) throw new Error('The Urban Vibe warehouse ID is not configured.');
    const receiptsPromise = shopFloorCache.getOrFetchTieredSWR(
      `shop-floor:receipts:${warehouseId}`,
      req.query.refresh === 'true' ? 0 : 3 * 60 * 1000,   // Non-blocking serve with background revalidation on refresh
      30 * 60 * 1000,  // 30 minutes max stale
      async () => new OdooClient(settings.odoo).getOpenBoardReceipts(warehouseId),
    );
    const [receipts, activeJobs] = await Promise.all([
      withMaxPageWait(receiptsPromise, 1200, []),
      getActiveShopFloorValidationJobs('receipt').catch(() => []),
    ]);
    res.render('shop-floor-receipts', {
      pageTitle: 'Board Receipts',
      appName: env.APP_NAME,
      receipts,
      activeJobs,
      authUser: req.authUser,
      csrfToken: req.csrfToken || null,
      message: req.query.message || null,
      error: req.query.error || null,
      isBitcherOnyangoRestrictedFromReceipt,
    });
  } catch (error) {
    res.status(500).render('error', { pageTitle: 'Board Receipts', errorMessage: error instanceof Error ? error.message : 'Could not load receipts.', details: [], csrfToken: req.csrfToken || null });
  }
});

router.get('/shop-floor/receipts/queue-status', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  try {
    const [activeJobs, recentJobs] = await Promise.all([
      getActiveShopFloorValidationJobs('receipt'),
      getRecentShopFloorValidationJobs('receipt', 10),
    ]);
    res.json({
      ok: true,
      activeJobs,
      recentJobs,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to query validation queue status.',
    });
  }
});

router.post('/shop-floor/board-intake/:id/retry', async (req: Request, res: Response) => {
  const isAjax = Boolean(
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.body?.ajax === 'true' ||
    req.query?.ajax === 'true'
  );
  if (!req.authUser) {
    if (isAjax) {
      res.status(401).json({ ok: false, error: 'Please sign in first.' });
      return;
    }
    res.redirect('/login');
    return;
  }
  const entryId = String(req.params.id || '');
  const entry = await getBoardIntakeQueueEntry(entryId);
  if (!entry) {
    if (isAjax) {
      res.status(404).json({ ok: false, error: 'Board log not found.' });
      return;
    }
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent('Board log not found.'));
    return;
  }

  // Clear dashboard cache immediately
  shopFloorCache.clearPrefix('shop-floor-dashboard:');

  // Trigger sync in the background (NON-BLOCKING)
  void (async () => {
    try {
      await syncBoardIntakeEntry(entryId);
      shopFloorCache.clearPrefix('shop-floor-dashboard:');
    } catch (_err) {
      // Sync errors are captured, logged, and recorded in MySQL queue by syncBoardIntakeEntry
    }
  })();

  if (isAjax) {
    res.json({
      ok: true,
      status: 'processing',
      message: 'Board log synchronization retry initiated in the background.',
    });
    return;
  }
  res.redirect('/shop-floor/boards?message=' + encodeURIComponent('Board log retry is processing in the background.'));
});

router.post('/shop-floor/board-intake/:id/revert', async (req: Request, res: Response) => {
  const isAjax = Boolean(
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.body?.ajax === 'true' ||
    req.query?.ajax === 'true'
  );
  if (!req.authUser) {
    if (isAjax) {
      res.status(401).json({ ok: false, error: 'Please sign in first.' });
      return;
    }
    res.redirect('/login');
    return;
  }
  const entryId = String(req.params.id || '');
  const entry = await getBoardIntakeQueueEntry(entryId);
  if (!entry) {
    if (isAjax) {
      res.status(404).json({ ok: false, error: 'Board log not found.' });
      return;
    }
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent('Board log not found.') + '&boardLogPage=' + encodeURIComponent(String(req.body.boardLogPage || '1')));
    return;
  }

  const isAdmin = canManageShopFloor(req);
  const userEmail = (req.authUser.email || '').trim().toLowerCase();
  const actorEmail = (entry.actor_email || '').trim().toLowerCase();
  const userName = (req.authUser.displayName || req.authUser.email || '').trim().toLowerCase();
  const actorName = (entry.actor_name || '').trim().toLowerCase();
  const isOwner = Boolean((userEmail && actorEmail && userEmail === actorEmail) || (userName && actorName && userName === actorName));

  if (!isAdmin && !isOwner) {
    if (isAjax) {
      res.status(403).json({ ok: false, error: 'You can only revert board logs that you logged.' });
      return;
    }
    res.status(403).redirect('/shop-floor/boards?error=' + encodeURIComponent('You can only revert board logs that you logged.') + '&boardLogPage=' + encodeURIComponent(String(req.body.boardLogPage || '1')));
    return;
  }

  if (entry.reverted_at || entry.status === 'reverted') {
    if (isAjax) {
      res.json({ ok: true, status: 'reverted', message: 'This board log was already reverted.' });
      return;
    }
    res.redirect('/shop-floor/boards?message=' + encodeURIComponent('This board log was already reverted.') + '&boardLogPage=' + encodeURIComponent(String(req.body.boardLogPage || '1')));
    return;
  }

  const revertedBy = req.authUser.displayName || req.authUser.email || 'Operator';

  // Mark the entry as 'reverting' immediately in MySQL (<5ms)
  const claimed = await claimBoardIntakeRevert(entryId);
  if (!claimed) {
    if (isAjax) {
      res.status(409).json({ ok: false, error: 'This board log is already being reverted.' });
      return;
    }
    res.redirect('/shop-floor/boards?error=' + encodeURIComponent('This board log is already being reverted.') + '&boardLogPage=' + encodeURIComponent(String(req.body.boardLogPage || '1')));
    return;
  }

  // Unmark pending processes immediately so it reappears instantly on /shop-floor/boards (<5ms)
  const restoredRequirements = await unmarkPendingShopFloorProcessesLoaded({
    partnerId: Number(entry.partner_id || 0),
    productId: Number(entry.product_id || 0),
    customerName: entry.customer_name,
    productName: entry.product_name,
    quantity: Number(entry.quantity || 0),
  }).catch(() => []);

  // Clear dashboard cache immediately
  shopFloorCache.clearPrefix('shop-floor-dashboard:');
  void Promise.allSettled([
    deleteShopFloorDashboardSnapshot(),
    deleteShopFloorSharedCachePrefix('shop-floor:shared-board-reg:'),
  ]).catch(() => {});

  // Launch the Odoo stock removal in the background (NON-BLOCKING)
  void (async () => {
    try {
      const settings = await getSettings();
      const odooClient = new OdooClient(settings.odoo);
      const result = await odooClient.removeBoardsFromStock({
        productId: Number(entry.product_id),
        quantity: Number(entry.quantity),
      });
      await finishBoardIntakeRevert(entryId, revertedBy, result.newQty);
      await recordExactStockQuantity(Number(entry.product_id), entry.product_name, result.newQty, -Number(entry.quantity));
      shopFloorCache.clearPrefix('shop-floor-dashboard:');
      void refreshStockMirror();
      void syncPendingProcessesFromOdoo(true).catch(() => null);

      // Post comprehensive short statement in Odoo chatter on matching MOs and linked Sales Orders
      const reportDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: env.APP_TIMEZONE || 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

      const safeCustomerName = escapeHtml(entry.customer_name);
      const safeProductName = escapeHtml(entry.product_name);
      const safeRevertedBy = escapeHtml(revertedBy);
      const safeOriginalActor = escapeHtml(entry.actor_name || entry.actor_email || 'Operator');
      const qtyNum = Number(entry.quantity);

      const revertChatterHtml = [
        `⚠️ <strong>BOARD INTAKE REVERTED (Operator Mobile App)</strong>`,
        `• <strong>Client:</strong> ${safeCustomerName}`,
        `• <strong>Board:</strong> ${safeProductName}`,
        `• <strong>Quantity Reverted:</strong> -${qtyNum} sheet${qtyNum === 1 ? '' : 's'} (Remaining Odoo Stock: ${result.newQty})`,
        `• <strong>Originally Logged By:</strong> ${safeOriginalActor}`,
        `• <strong>Reverted By:</strong> ${safeRevertedBy}`,
        `• <strong>Date:</strong> ${escapeHtml(reportDate)}`,
        `<em>Summary: Physical board intake was reverted; stock has been automatically deducted back in Odoo.</em>`,
      ].join('<br/>\n');

      const matchingMOs = await odooClient.findMOsForBoardIntake({
        productId: Number(entry.product_id),
        partnerId: Number(entry.partner_id),
      }).catch(() => []);

      if (matchingMOs.length > 0) {
        await Promise.all(matchingMOs.map((mo) =>
          odooClient.postModelChatterMessage('mrp.production', mo.moId, revertChatterHtml).catch(() => null)
        ));
        const postedSoIds = new Set<number>();
        for (const mo of matchingMOs) {
          if (mo.soId && !postedSoIds.has(mo.soId)) {
            postedSoIds.add(mo.soId);
            await odooClient.postModelChatterMessage('sale.order', mo.soId, revertChatterHtml).catch(() => null);
          }
        }
      }

      // Send immediate email notification to configured recipients
      const rawRecipients = normalizeBoardLogRecipients(settings.stock?.boardLogNotificationEmail);
      const recipientList = [...new Set(rawRecipients.split(/[,\s;\n]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
      const toRecipients = recipientList.join(', ');
      const subjectCustomerName = (entry.customer_name || 'Client').replace(/[\r\n]+/g, ' ').trim();

      const appBaseUrl = String(env.APP_BASE_URL || 'https://app.urbanvibeinteriordesign.co.ke').replace(/\/+$/, '');
      const fullListUrl = `${appBaseUrl}/shop-floor/boards?date=${encodeURIComponent(reportDate)}#recentBoardLogsSection`;
      const buttonHtml = `<div style="margin-top:20px;margin-bottom:12px;">` +
        `<a href="${fullListUrl}" style="display:inline-block;background-color:#0f172a;color:#ffffff;text-decoration:none;padding:10px 22px;font-size:14px;font-weight:600;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.08);letter-spacing:0.01em;" target="_blank">` +
        `📋 View Full Board Logs List &rarr;` +
        `</a>` +
        `</div>`;

      const isPurchase = Boolean(entry.is_purchase);
      const poRef = entry.purchase_order_reference;
      const purchaseLabel = isPurchase
        ? (poRef ? `Yes (PO: ${escapeHtml(String(poRef))})` : 'Yes (Company Purchase)')
        : 'No (Client Supplied)';
      const purchaseSubjectTag = isPurchase ? ' [PURCHASE]' : ' [CLIENT SUPPLY]';

      await sendMailWithConfig(settings.mail, {
        to: toRecipients,
        subject: `[REVERTED] ${subjectCustomerName} - Board Intake Cancelled${purchaseSubjectTag} - ${reportDate}`,
        html: `<p style="color:#b91c1c;"><strong>⚠️ Board Intake Cancelled &amp; Reverted in Odoo</strong></p>` +
              `<p>` +
              `<strong>Client:</strong> ${safeCustomerName}<br>` +
              `<strong>Board:</strong> ${safeProductName}<br>` +
              `<strong>Purchase:</strong> ${purchaseLabel}<br>` +
              `<strong>Quantity Reverted:</strong> -${qtyNum} sheets<br>` +
              `<strong>Remaining Odoo Stock:</strong> ${result.newQty}<br>` +
              `<strong>Originally Logged By:</strong> ${safeOriginalActor}<br>` +
              `<strong>Reverted By:</strong> ${safeRevertedBy}<br>` +
              `<strong>Date:</strong> ${escapeHtml(reportDate)}<br>` +
              `</p>` +
              `<p style="font-size:0.9em;color:#475569;"><em>Comprehensive note: The previous board entry was reverted. ${qtyNum} sheets of ${safeProductName} have been deducted from inventory and component reservation released.</em></p>` +
              buttonHtml,
      }).catch((mailError) => logEvent('error', `Board intake revert email to ${toRecipients} failed`, {
        customerName: entry.customer_name,
        productName: entry.product_name,
        quantity: entry.quantity,
        revertedBy,
        error: mailError instanceof Error ? mailError.message : String(mailError),
      }));

      await logEvent('warn', 'Board intake reverted in Odoo (background)', {
        boardIntakeId: entryId,
        productId: entry.product_id,
        quantity: entry.quantity,
        revertedBy,
      }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await releaseBoardIntakeRevert(entryId, message).catch(() => undefined);
      await logEvent('error', 'Board intake revert background failed', {
        boardIntakeId: entryId,
        error: message,
      }).catch(() => undefined);
    }
  })();

  // Instant response to user (<10ms!)
  if (isAjax) {
    res.json({
      ok: true,
      status: 'reverting',
      message: 'Board log revert initiated in the background.',
      restoredRequirements: restoredRequirements || [],
      item: {
        id: entryId,
        product_id: entry.product_id,
        product_name: entry.product_name,
        partner_id: entry.partner_id,
        customer_name: entry.customer_name,
        quantity: entry.quantity,
      },
    });
    return;
  }
  res.redirect('/shop-floor/boards?message=' + encodeURIComponent('Board log revert is processing in the background.') + '&boardLogPage=' + encodeURIComponent(String(req.body.boardLogPage || '1')));
});

router.get('/shop-floor/board-intake/status', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.status(401).json({ ok: false, error: 'Please sign in first.' });
    return;
  }
  try {
    const rawIds = typeof req.query.ids === 'string'
      ? req.query.ids.split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    if (rawIds.length > 0) {
      const entries = await Promise.all(
        rawIds.slice(0, 25).map((id) => getBoardIntakeQueueEntry(id))
      );
      res.json({ ok: true, entries: entries.filter(Boolean) });
      return;
    }
    const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : undefined;
    const entries = await getRecentBoardIntakeQueueEntries(12, 0, dateParam);
    res.json({ ok: true, entries });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Could not query board intake status.' });
  }
});

router.post('/shop-floor/receipts/:id/validate', async (req: Request, res: Response) => {
  if (!req.authUser) {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    res.redirect('/login');
    return;
  }
  const isAjax = Boolean(
    req.xhr ||
    req.headers.accept?.includes('application/json') ||
    req.body?.ajax === 'true' ||
    req.query?.ajax === 'true'
  );
  try {
    const pickingId = Number(req.params.id);
    if (!Number.isInteger(pickingId) || pickingId <= 0) {
      throw new Error('Invalid board receipt ID provided.');
    }

    // Strict vendor restriction: User BITCHER ONYANGO cannot receive items from vendor TINT INTERIOR
    if (isBitcherOnyangoUser(req.authUser)) {
      const settings = await getSettings();
      const client = new OdooClient(settings.odoo);
      const pickings = await client.searchReadRecords<any>('stock.picking', {
        domain: [['id', '=', pickingId]],
        fields: ['id', 'partner_id'],
        limit: 1,
      });
      if (pickings.length && isTintInteriorVendor(pickings[0].partner_id)) {
        const errorMsg = 'Access restricted: User Bitcher Onyango is not authorized to receive items from vendor Tint Interior.';
        if (isAjax) {
          res.status(403).json({ ok: false, error: errorMsg, code: 'vendor_restricted' });
          return;
        }
        res.redirect('/shop-floor/receipts?error=' + encodeURIComponent(errorMsg));
        return;
      }
    }

    const actorName = req.authUser.displayName || req.authUser.email;
    const job = await enqueueShopFloorValidationJob({
      jobType: 'receipt',
      pickingId,
      actorEmail: req.authUser.email,
      actorName,
    });
    wakeShopFloorValidationJobWorker();

    if (isAjax) {
      res.json({
        ok: true,
        jobId: job.id,
        pickingId: job.pickingId,
        status: job.status,
        message: 'Receipt queued for background validation (FIFO).',
      });
      return;
    }
    res.redirect('/shop-floor/receipts?message=' + encodeURIComponent('Receipt queued for validation in background.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receipt validation failed.';
    if (isAjax) {
      res.status(500).json({ ok: false, error: message });
      return;
    }
    res.redirect('/shop-floor/receipts?error=' + encodeURIComponent(message));
  }
});

router.get('/shop-floor/deliveries', async (req: Request, res: Response) => {
  if (!req.authUser) { res.redirect('/login'); return; }
  try {
    const settings = await getSettings();
    const warehouseId = Number(settings.stock.warehouseId || 0);
    if (!warehouseId) throw new Error('The Urban Vibe warehouse ID is not configured.');
    const deliveriesPromise = shopFloorCache.getOrFetchTieredSWR(
      `shop-floor:deliveries:${warehouseId}`,
      req.query.refresh === 'true' ? 0 : 3 * 60 * 1000,   // Non-blocking serve with background revalidation on refresh
      30 * 60 * 1000,  // 30 minutes max stale
      async () => new OdooClient(settings.odoo).getOpenDeliveries(warehouseId),
    );
    const deliveries = await withMaxPageWait(deliveriesPromise, 1200, []);
    res.render('shop-floor-deliveries', { pageTitle: 'Deliveries', appName: env.APP_NAME, deliveries, authUser: req.authUser, csrfToken: req.csrfToken || null, message: req.query.message || null, error: req.query.error || null });
  } catch (error) {
    res.status(500).render('error', { pageTitle: 'Deliveries', errorMessage: error instanceof Error ? error.message : 'Could not load deliveries.', details: [], csrfToken: req.csrfToken || null });
  }
});

router.post('/shop-floor/deliveries/:id/validate', async (req: Request, res: Response) => {
  if (!req.authUser) { res.redirect('/login'); return; }
  try {
    const settings = await getSettings();
    const pickingId = Number(req.params.id);
    if (!Number.isFinite(pickingId) || pickingId <= 0) throw new Error('Invalid delivery.');
    const warehouseId = Number(settings.stock.warehouseId || 0);
    if (!warehouseId) throw new Error('The Urban Vibe warehouse ID is not configured.');
    const actorName = req.authUser.displayName || req.authUser.email;
    await new OdooClient(settings.odoo).validateDelivery(pickingId, actorName, warehouseId);
    shopFloorCache.clearPrefix('shop-floor-dashboard:');
    shopFloorCache.clearPrefix('shop-floor:deliveries:');
    await Promise.allSettled([
      deleteShopFloorSharedCachePrefix('shop-floor:deliveries:'),
      deleteShopFloorDashboardSnapshot(),
    ]).catch(() => {});
    void refreshStockMirror();
    await logEvent('info', 'Odoo delivery validated', { pickingId, actor: actorName, actorEmail: req.authUser.email });
    res.redirect('/shop-floor/deliveries?message=' + encodeURIComponent('Delivery validated in Odoo.'));
  } catch (error) {
    res.redirect('/shop-floor/deliveries?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Delivery validation failed.'));
  }
});

router.get('/reports/mo-stock-shortage', async (req: Request, res: Response) => {
  if (!req.authUser) {
    res.redirect('/login');
    return;
  }
  try {
    const forceRefresh = req.query.refresh === 'true';
    const summary = await generateMoStockShortageReport(undefined, { forceRefresh });
    const html = renderMoStockShortageReportHtml(summary);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).render('error', {
      pageTitle: 'Error',
      errorMessage: err instanceof Error ? err.message : 'Could not generate MO stock shortage report.',
      details: [],
      csrfToken: req.csrfToken || null,
    });
  }
});

router.post('/reports/mo-stock-shortage/send', async (req: Request, res: Response) => {
  if (!canManageShopFloor(req)) {
    res.status(403).json({ ok: false, error: 'Administrator access required.' });
    return;
  }
  try {
    const recipientEmail = typeof req.body.recipientEmail === 'string' ? req.body.recipientEmail.trim() : '';
    const recipients = recipientEmail ? [recipientEmail] : [];
    await sendDailyMoStockShortageReport(recipients);
    if (req.headers.accept?.includes('application/json')) {
      res.json({ ok: true, message: 'Report sent successfully.' });
      return;
    }
    res.redirect('/reports/mo-stock-shortage?message=' + encodeURIComponent('Report sent successfully.'));
  } catch (err) {
    if (req.headers.accept?.includes('application/json')) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to send report.' });
      return;
    }
    res.redirect('/reports/mo-stock-shortage?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed to send report.'));
  }
});

router.post('/reports/mo-stock-shortage/settings', async (req: Request, res: Response) => {
  if (!canManageShopFloor(req)) {
    res.status(403).json({ ok: false, error: 'Administrator access required.' });
    return;
  }
  try {
    const rawFreq = typeof req.body.frequency === 'string' ? req.body.frequency.trim().toLowerCase() : undefined;
    const frequency = rawFreq === 'daily' || rawFreq === 'weekly' || rawFreq === 'hourly' ? rawFreq : undefined;
    const hour = req.body.hour !== undefined && req.body.hour !== '' ? parseInt(String(req.body.hour), 10) : undefined;
    const enabled = req.body.enabled === 'true' ? true : req.body.enabled === 'false' ? false : undefined;
    const recipients = typeof req.body.recipients === 'string' ? req.body.recipients : undefined;

    await updateMoStockShortageAutomationSettings({
      frequency,
      hour,
      enabled,
      recipients,
    });

    if (req.headers.accept?.includes('application/json')) {
      res.json({ ok: true, message: 'Schedule & recipients updated successfully.' });
      return;
    }
    res.redirect('/reports/mo-stock-shortage?message=' + encodeURIComponent('Schedule & recipients updated successfully.'));
  } catch (err) {
    if (req.headers.accept?.includes('application/json')) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to update settings.' });
      return;
    }
    res.redirect('/reports/mo-stock-shortage?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed to update settings.'));
  }
});

export default router;

