import {
  acquireSchedulerRunLock,
  clearStaleSchedulerRunLock,
  getExtractedResultByHistoryId,
  getRecentDashboardSchedulerRuns,
  getSchedulerRuntimeState,
  getSchedulerRunById,
  getRecentSchedulerRuns,
  getSettings,
  insertSchedulerRun,
  markSchedulerRunFailed,
  markSchedulerRunSucceeded,
  releaseSchedulerRunLock,
  touchSchedulerRunLock,
  updateSchedulerRun,
} from '../models/repositories';
import { AttachmentInfo, PoBillSchedulerConfig, SalesOrderSummary, SchedulerRunEntry, SchedulerRunResult } from '../models/types';
import { formatOdooDateTime, isJobSummaryAttachment, sortAttachmentsNewestFirst } from '../utils/helpers';
import { env } from '../utils/env';
import { extractAttachmentForOrder, sendExtractedResultToOdoo } from './extractionService';
import {
  closeOpenJobSummaryReminderActivities,
  ensureMissingJobSummaryReminder,
} from './jobSummaryReminderService';
import { logEvent } from './logService';
import { OdooClient, getOdooQueueStats, isOdooTrafficPaused, setSchedulerRunActive } from './odooClient';
import {
  findExcludedPoBillVendor,
  getRecentDocumentPdfs,
  markPoBillDocumentSkipped,
  runPoBillAutomation,
} from './poBillAutomationService';
import { processSaleOrderStock } from './stockProcessingService';
import { auditLinkedPurchaseOrdersForSaleOrder } from './poJobSummaryAuditService';
import { syncAllPendingStandaloneEtrPos } from './crossCompanySyncService';
import { cleanupStaleTempFiles } from '../utils/tempCleanup';
import {
  CAMPAIGN_BATCH_SIZE,
  CAMPAIGN_START_DATE,
  computeMayCampaignMetrics,
  isAlreadyInvoicedSummary,
  isNonInvoiceSummary,
  notifyDbAdminCampaignReport,
} from './campaignReportService';

let schedulerRunning = false;
function setSchedulerRunningState(active: boolean) {
  schedulerRunning = active;
  setSchedulerRunActive(active);
}
const SCHEDULER_HEARTBEAT_MAX_MS = 20 * 60 * 1000;
const SO_PER_ORDER_TIMEOUT_MS = 240_000;
const SO_PO_AUDIT_TIMEOUT_MS = 45_000;
const PO_BILL_FETCH_TIMEOUT_MS = 75_000;
let schedulerIntervalHandle: NodeJS.Timeout | null = null;
let poBillSchedulerIntervalHandle: NodeJS.Timeout | null = null;
let poBillContinuousChainHandle: NodeJS.Timeout | null = null;
const poBillContinuousPassAttemptedIds = new Set<number>();
const SCHEDULER_LOOKBACK_HOURS = 24;
const SO_SCHEDULER_CONCURRENCY = 1;
const SO_SCHEDULER_ORDER_DELAY_MS = Math.max(
  0,
  Number(env.SO_SCHEDULER_ORDER_DELAY_MS || 1000) || 1000,
);
const SO_SCHEDULER_LOOKAHEAD_MIN = 50;
const SO_SCHEDULER_LOOKAHEAD_MAX = 250;
const SO_SCHEDULER_ROUTINE_DEPRIORITIZE_RUNS = 20;
const SO_SCHEDULER_ADAPTIVE_LOOKBACK_STEP_HOURS = 24;
const SO_SCHEDULER_ADAPTIVE_LOOKBACK_MAX_HOURS = 24 * 90;
const PO_BILL_SCHEDULER_BATCH_SIZE = 1;
const PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD = 150;
const PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD_MAX = 250;
const PO_BILL_RETRY_COOLDOWN_HOURS = 12;
const PO_BILL_TRANSIENT_RETRY_COOLDOWN_HOURS = 2;
const PO_BILL_STABLE_SKIP_RETRY_COOLDOWN_HOURS = 24 * 14;
const PO_BILL_ADAPTIVE_LOOKAHEAD_STEP = 0;
const PO_BILL_ADAPTIVE_LOOKAHEAD_RUNS = 7;
const MAX_PO_BILL_RETRY_ATTEMPTS = 5;
const SALES_ORDER_SCHEDULER_JOB_TYPE = 'sales_order_processing';
const PO_BILL_SCHEDULER_JOB_TYPE = 'po_bill_matching';
const SALES_ORDER_ALLOWED_WINDOW = {
  startMinute: 0,
  endMinute: 24 * 60,
  label: '00:00-24:00 (24/7 All Hours)',
};
const PO_BILL_ALLOWED_WINDOW = {
  startMinute: 0,
  endMinute: 24 * 60,
  label: '00:00-24:00 (24/7 All Hours)',
};
const JOB_SUMMARY_REMINDER_RUN_MINUTE = 16 * 60 + 40;
const JOB_SUMMARY_REMINDER_RUN_WINDOW_MINUTES = 10;
const ROUTINE_SALES_ORDER_CATEGORIES = new Set(['already_reconciled', 'missing_job_summary']);

type PoBillRetryClass = 'fresh' | 'transient' | 'changeable' | 'stable_skip' | 'processed' | 'exhausted';
type SchedulerJobType = 'sales_order_processing' | 'po_bill_matching';

function schedulerNameForJobType(jobType: unknown) {
  return jobType === PO_BILL_SCHEDULER_JOB_TYPE ? 'PO Bill Scheduler' : 'Sales Order Scheduler';
}

function jobTypeMatches(run: SchedulerRunEntry, jobType: SchedulerJobType) {
  return run.context.jobType === jobType;
}

function getRecentRunForJobType(recentRuns: SchedulerRunEntry[], jobType: SchedulerJobType) {
  return recentRuns.find((run) => jobTypeMatches(run, jobType)) || null;
}

function getConfiguredSchedulerCooldownMinutes(
  jobType: SchedulerJobType,
  settings: Awaited<ReturnType<typeof getSettings>>,
) {
  if (jobType === SALES_ORDER_SCHEDULER_JOB_TYPE) {
    return Math.max(1, Number(settings.scheduler.intervalMinutes || 10) || 10);
  }

  return Math.max(
    1,
    Number(settings.poBillScheduler.intervalMinutes || 15) || 15,
  );
}

function getRecentRunAgeMinutes(run: SchedulerRunEntry | null) {
  if (!run) {
    return Number.POSITIVE_INFINITY;
  }

  const startedAt = parseSchedulerDate(run.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
}

function buildThrottleSummary(jobType: SchedulerJobType, cooldownMinutes: number, recentRun: SchedulerRunEntry) {
  const schedulerName = schedulerNameForJobType(jobType);
  const ageMinutes = getRecentRunAgeMinutes(recentRun);
  return `${schedulerName} skipped to avoid bulk Odoo calls. Last run started ${ageMinutes} minute(s) ago; cooldown is ${cooldownMinutes} minute(s).`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSalesOrderLookaheadLimit(batchSize: number, routineOnlyRunStreak = 0) {
  const safeBatchSize = Math.max(1, Number(batchSize) || 1);
  const baseLimit = Math.max(SO_SCHEDULER_LOOKAHEAD_MIN, safeBatchSize * 10);
  const adaptiveLimit = baseLimit + Math.max(0, routineOnlyRunStreak) * baseLimit;
  return Math.min(
    SO_SCHEDULER_LOOKAHEAD_MAX,
    adaptiveLimit,
  );
}

function getAdaptiveSalesOrderLookbackHours(routineOnlyRunStreak: number) {
  const adaptiveHours =
    SCHEDULER_LOOKBACK_HOURS +
    Math.max(0, routineOnlyRunStreak) * SO_SCHEDULER_ADAPTIVE_LOOKBACK_STEP_HOURS;

  return Math.min(SO_SCHEDULER_ADAPTIVE_LOOKBACK_MAX_HOURS, adaptiveHours);
}

function isRoutineSalesOrderOutcome(outcome: unknown) {
  if (!isRecord(outcome)) {
    return false;
  }

  if (outcome.status !== 'skipped' || !ROUTINE_SALES_ORDER_CATEGORIES.has(String(outcome.category || ''))) {
    return false;
  }

  const reminderOutcome = outcome.reminderOutcome;
  if (isRecord(reminderOutcome) && reminderOutcome.status === 'failed') {
    return false;
  }

  return true;
}

function getRecentlyRoutineSalesOrderIds(recentRuns: SchedulerRunEntry[]) {
  const ids = new Set<number>();

  for (const run of recentRuns) {
    if (run.context.jobType && run.context.jobType !== SALES_ORDER_SCHEDULER_JOB_TYPE) {
      continue;
    }

    const outcomes = run.context.orderOutcomes;
    if (!Array.isArray(outcomes)) {
      continue;
    }

    for (const outcome of outcomes) {
      if (!isRoutineSalesOrderOutcome(outcome) || !isRecord(outcome)) {
        continue;
      }

      const orderId = Number(outcome.orderId);
      if (Number.isSafeInteger(orderId) && orderId > 0) {
        ids.add(orderId);
      }
    }
  }

  return ids;
}

function getRoutineOnlySalesOrderRunStreak(recentRuns: SchedulerRunEntry[]) {
  let streak = 0;

  for (const run of recentRuns) {
    if (run.context.jobType && run.context.jobType !== SALES_ORDER_SCHEDULER_JOB_TYPE) {
      continue;
    }

    const outcomes = run.context.orderOutcomes;
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      continue;
    }

    if (outcomes.every(isRoutineSalesOrderOutcome)) {
      streak += 1;
      continue;
    }

    break;
  }

  return streak;
}

function chooseSalesOrderBatch(
  candidates: SalesOrderSummary[],
  batchSize: number,
  recentlyRoutineOrderIds: Set<number>,
) {
  const preferred = candidates.filter((order) => !recentlyRoutineOrderIds.has(order.id));
  const fallback = candidates.filter((order) => recentlyRoutineOrderIds.has(order.id));
  return [...preferred, ...fallback].slice(0, Math.max(1, Number(batchSize) || 1));
}

function getPoBillAttemptCount(pdf: AttachmentInfo) {
  return Math.max(0, Number(pdf.poBillAttemptCount || 0) || 0);
}

function getRecentlyFailedPoBillAttachmentIds(run: SchedulerRunEntry | null) {
  const ids = new Set<number>();
  const outcomes = run?.context.documentOutcomes;
  if (!Array.isArray(outcomes)) {
    return ids;
  }

  for (const outcome of outcomes) {
    if (!isRecord(outcome) || !['skipped', 'failed'].includes(String(outcome.status || ''))) {
      continue;
    }

    const attachmentId = Number(outcome.attachmentId);
    if (Number.isSafeInteger(attachmentId) && attachmentId > 0) {
      ids.add(attachmentId);
    }
  }

  return ids;
}

function getRecentlyAttemptedPoBillAttachmentIds(run: SchedulerRunEntry | null) {
  const ids = new Set<number>();
  const outcomes = run?.context.documentOutcomes;
  if (!Array.isArray(outcomes)) {
    return ids;
  }

  for (const outcome of outcomes) {
    if (!isRecord(outcome)) {
      continue;
    }

    const attachmentId = Number(outcome.attachmentId);
    if (Number.isSafeInteger(attachmentId) && attachmentId > 0) {
      ids.add(attachmentId);
    }
  }

  return ids;
}

function getPoBillRetryClass(pdf: AttachmentInfo, policy: PoBillSchedulerConfig): PoBillRetryClass {
  const status = String(pdf.poBillStatus || '');
  const summary = String(pdf.poBillSummary || '').toLowerCase();

  if (['processed', 'processed_with_warnings', 'delivery_note'].includes(status)) {
    return 'processed';
  }
  if (
    findExcludedPoBillVendor({
      attachmentName: pdf.name,
      vendorName: pdf.poBillVendorName,
      summary: pdf.poBillSummary,
    })
  ) {
    return 'stable_skip';
  }
  if (!status) {
    return 'fresh';
  }
  if (isNonInvoiceSummary(summary) || isAlreadyInvoicedSummary(summary)) {
    return 'stable_skip';
  }
  if (/\b(timeout|network|rate limit|api key|ai extraction|ocr|upload failed|could not download|failed to parse|unknown po bill scheduler error)\b/i.test(summary)) {
    return 'transient';
  }

  // In continuous campaign mode, always re-attempt report-eligible Unmatched Invoices
  // across passes rather than permanently shelving them at 5 attempts.
  return 'changeable';
}

function getPoBillRetryCooldownHours(
  retryClass: PoBillRetryClass,
  attemptCount: number,
  policy: PoBillSchedulerConfig,
): number {
  switch (retryClass) {
    case 'fresh':
      return 0;
    case 'transient':
      return Math.max(1, Number(policy.transientRetryHours || PO_BILL_TRANSIENT_RETRY_COOLDOWN_HOURS));
    case 'changeable': {
      // Campaign reset: retry previously failed matches immediately so older
      // documents are not hidden behind the former seven-day backoff policy.
      return 0;
    }
    case 'stable_skip':
    case 'exhausted':
    case 'processed':
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function getPoBillAttemptedAt(pdf: AttachmentInfo) {
  return pdf.poBillProcessedAt ? Date.parse(pdf.poBillProcessedAt) || 0 : 0;
}

function isPoBillPdfDueForRetry(pdf: AttachmentInfo, nowMs: number, policy: PoBillSchedulerConfig) {
  const retryClass = getPoBillRetryClass(pdf, policy);
  if (retryClass === 'processed' || retryClass === 'exhausted' || retryClass === 'stable_skip') {
    return false;
  }

  const attemptedAt = getPoBillAttemptedAt(pdf);
  if (!attemptedAt) {
    return true;
  }

  const attemptCount = getPoBillAttemptCount(pdf);
  const cooldownMs = getPoBillRetryCooldownHours(retryClass, attemptCount, policy) * 60 * 60 * 1000;
  return nowMs - attemptedAt >= cooldownMs;
}

function getPoBillRetryPriority(pdf: AttachmentInfo, policy: PoBillSchedulerConfig) {
  const retryClass = getPoBillRetryClass(pdf, policy);
  switch (retryClass) {
    case 'fresh':
      return 0;
    case 'changeable':
      return 1;
    case 'transient':
      return 2;
    case 'stable_skip':
      return 3;
    case 'exhausted':
    case 'processed':
    default:
      return 99;
  }
}

function getPoBillLearningStreak(recentRuns: SchedulerRunEntry[]) {
  let streak = 0;

  for (const run of recentRuns) {
    if (run.context.jobType !== PO_BILL_SCHEDULER_JOB_TYPE) {
      continue;
    }
    if (!['completed', 'completed_with_errors'].includes(run.status)) {
      continue;
    }

    const processedCount = Number(run.processedCount || 0);
    const scannedCount = Number(run.scannedCount || 0);
    if (scannedCount > 0 && processedCount === 0) {
      streak += 1;
      continue;
    }

    break;
  }

  return Math.min(streak, PO_BILL_ADAPTIVE_LOOKAHEAD_RUNS);
}

function getPoBillDocumentLookahead(recentRuns: SchedulerRunEntry[]) {
  const learningStreak = getPoBillLearningStreak(recentRuns);
  return Math.min(
    PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD_MAX,
    PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD + learningStreak * PO_BILL_ADAPTIVE_LOOKAHEAD_STEP,
  );
}

async function getFreshSchedulerRuntimeState() {
  const staleLock = await clearStaleSchedulerRunLock();
  if (staleLock?.lockRunId) {
    await logEvent('warn', 'Cleared inactive scheduler runtime lock', {
      lockRunId: staleLock.lockRunId,
      lockAcquiredAt: staleLock.lockAcquiredAt,
    });
  }

  return getSchedulerRuntimeState();
}

async function touchActiveSchedulerRunLock(runId: string) {
  try {
    await touchSchedulerRunLock(runId);
  } catch (error) {
    await logEvent('warn', 'Could not refresh scheduler runtime lock heartbeat', {
      schedulerRunId: runId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  }
}

async function isSchedulerStopRequested(runId: string) {
  try {
    const runtimeState = await getSchedulerRuntimeState();
    return runtimeState.lockRunId === runId && Boolean(runtimeState.stopRequestedAt);
  } catch (error) {
    await logEvent('warn', 'Could not read scheduler stop request', {
      schedulerRunId: runId,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    return false;
  }
}

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function describeActiveSchedulerLock(runtimeState: Awaited<ReturnType<typeof getSchedulerRuntimeState>>) {
  if (!runtimeState.lockRunId) {
    return null;
  }

  try {
    const activeRun = await getSchedulerRunById(runtimeState.lockRunId);
    const jobType = activeRun.context.jobType || SALES_ORDER_SCHEDULER_JOB_TYPE;

    return {
      activeLockRunId: runtimeState.lockRunId,
      activeLockAcquiredAt: runtimeState.lockAcquiredAt,
      activeLockRun: {
        id: activeRun.id,
        schedulerName: schedulerNameForJobType(jobType),
        jobType,
        status: activeRun.status,
        trigger: activeRun.trigger,
        startedAt: activeRun.startedAt,
        finishedAt: activeRun.finishedAt,
        summary: activeRun.summary,
      },
    };
  } catch (error) {
    return {
      activeLockRunId: runtimeState.lockRunId,
      activeLockAcquiredAt: runtimeState.lockAcquiredAt,
      activeLockRunLookupError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getConfiguredSchedulerClient() {
  const settings = await getSettings();

  return {
    settings,
    client: new OdooClient(settings.odoo),
  };
}

export async function getSchedulerStatus() {
  const settings = await getSettings();
  const runtimeState = await getFreshSchedulerRuntimeState();
  const recentRuns = await getRecentDashboardSchedulerRuns(10);
  const mode =
    settings.scheduler.useInProcessInterval && env.SCHEDULER_USE_INTERVAL === 'true'
      ? 'in_process_interval'
      : 'cron_only';

  return {
    config: settings.scheduler,
    isRunning: Boolean(runtimeState.lockRunId) || schedulerRunning,
    runtimeState,
    mode,
    cronRecommended: true,
    recentRuns,
    lastRun: recentRuns[0] || null,
  };
}

function parseSchedulerDate(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed)) {
    const parsedEat = Date.parse(`${trimmed.replace(' ', 'T')}+03:00`);
    if (Number.isFinite(parsedEat)) {
      return parsedEat;
    }
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeEffectiveConfirmedFromDate(
  configuredFromDate: string,
  checkpointAt: string | null,
  lookbackHours = SCHEDULER_LOOKBACK_HOURS,
): string {
  const configuredMs = parseSchedulerDate(configuredFromDate);
  const checkpointMs = parseSchedulerDate(checkpointAt);

  if (!checkpointMs) {
    return configuredFromDate;
  }

  const lookbackMs = checkpointMs - lookbackHours * 60 * 60 * 1000;
  const effectiveMs = configuredMs > 0 ? Math.max(configuredMs, lookbackMs) : lookbackMs;
  return formatOdooDateTime(new Date(effectiveMs));
}

function isMinuteWithinWindow(localMinute: number, startMinute: number, endMinute: number) {
  if (startMinute < endMinute) {
    return localMinute >= startMinute && localMinute < endMinute;
  }

  return localMinute >= startMinute || localMinute < endMinute;
}

function getLocalSchedulerTime() {
  const timeZone = env.APP_TIMEZONE || 'Africa/Nairobi';
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  const hour = Number(value('hour'));
  const minute = Number(value('minute'));
  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;

  return {
    timeZone,
    hour: safeHour,
    minute: safeMinute,
    localMinute: safeHour * 60 + safeMinute,
    label: `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`,
  };
}

function getSchedulerWindowStatus(window: {
  startMinute: number;
  endMinute: number;
  label: string;
}) {
  const localTime = getLocalSchedulerTime();

  return {
    ...localTime,
    allowed: isMinuteWithinWindow(localTime.localMinute, window.startMinute, window.endMinute),
    allowedWindow: window.label,
  };
}

function getJobSummaryReminderWindowStatus() {
  const localTime = getLocalSchedulerTime();
  const windowEndMinute = JOB_SUMMARY_REMINDER_RUN_MINUTE + JOB_SUMMARY_REMINDER_RUN_WINDOW_MINUTES;

  return {
    ...localTime,
    allowed:
      localTime.localMinute >= JOB_SUMMARY_REMINDER_RUN_MINUTE &&
      localTime.localMinute < windowEndMinute,
    allowedWindow: '16:40-16:50',
  };
}

export async function runPoBillSchedulerCycle(
  trigger: 'interval' | 'manual' | 'cron' = 'manual',
  options: { continuousChain?: boolean; onRunCreated?: (run: SchedulerRunEntry) => void } = {},
): Promise<SchedulerRunResult> {
  if (poBillContinuousChainHandle) {
    clearTimeout(poBillContinuousChainHandle);
    poBillContinuousChainHandle = null;
  }
  const notifyCreated = (run: SchedulerRunEntry) => {
    try {
      options.onRunCreated?.(run);
    } catch {
      // ignore callback error
    }
  };
  const { client, settings } = await getConfiguredSchedulerClient();
  const runtimeState = await getFreshSchedulerRuntimeState();
  const recentRunsForCooldown = await getRecentSchedulerRuns(20);
  const recentRun = getRecentRunForJobType(recentRunsForCooldown, PO_BILL_SCHEDULER_JOB_TYPE);
  const cooldownMinutes = getConfiguredSchedulerCooldownMinutes(PO_BILL_SCHEDULER_JOB_TYPE, settings);
  const fromDate = settings.poBillScheduler.fromDate || CAMPAIGN_START_DATE;
  const toDate = formatOdooDateTime(new Date());
  const batchSize = Math.max(1, Number(settings.poBillScheduler.batchSize || CAMPAIGN_BATCH_SIZE));

  if (isOdooTrafficPaused()) {
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: 'Odoo API traffic is paused for firewall unban resolution.',
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        batchSize,
      },
    });
    notifyCreated(run);

    return { run, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  if (trigger !== 'manual' && !settings.poBillScheduler.enabled) {
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: 'PO bill scheduler is disabled.',
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        batchSize,
      },
    });
    notifyCreated(run);

    return { run, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  if (trigger !== 'manual' && !options.continuousChain && recentRun) {
    const ageMinutes = getRecentRunAgeMinutes(recentRun);
    if (ageMinutes < cooldownMinutes) {
      const run = await insertSchedulerRun({
        status: 'skipped',
        trigger,
        summary: buildThrottleSummary(PO_BILL_SCHEDULER_JOB_TYPE, cooldownMinutes, recentRun),
        context: {
          jobType: PO_BILL_SCHEDULER_JOB_TYPE,
          schedulerName: 'PO Bill Scheduler',
          fromDate,
          toDate,
          batchSize,
          recentRunId: recentRun.id,
          recentRunStartedAt: recentRun.startedAt,
          recentRunTrigger: recentRun.trigger,
          cooldownMinutes,
          cooldownRemainingMinutes: Math.max(0, cooldownMinutes - ageMinutes),
        },
      });
      notifyCreated(run);

      return {
        run,
        scannedCount: 0,
        processedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        throttled: true,
        throttleMinutes: cooldownMinutes,
      };
    }
  }

  const windowStatus = getSchedulerWindowStatus(PO_BILL_ALLOWED_WINDOW);
  if (!windowStatus.allowed) {
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: `PO bill scheduler skipped outside allowed time window (${windowStatus.allowedWindow} ${windowStatus.timeZone}).`,
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        batchSize,
        allowedWindow: windowStatus.allowedWindow,
        currentLocalTime: windowStatus.label,
        currentLocalMinute: windowStatus.localMinute,
        timezone: windowStatus.timeZone,
      },
    });
    notifyCreated(run);

    return { run, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  if (schedulerRunning || runtimeState.lockRunId) {
    const activeLock = await describeActiveSchedulerLock(runtimeState);
    const activeSchedulerName = activeLock?.activeLockRun?.schedulerName || 'another scheduler run';
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: `PO bill scheduler skipped because ${activeSchedulerName} is already in progress.`,
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        ...(activeLock || { activeLockRunId: runtimeState.lockRunId }),
      },
    });
    notifyCreated(run);

    return { run, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  setSchedulerRunningState(true);

  let run: Awaited<ReturnType<typeof insertSchedulerRun>>;
  try {
    run = await insertSchedulerRun({
      status: 'started',
      trigger,
      summary: 'PO bill scheduler run started. Loading candidate Finance documents...',
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        batchSize,
        configuredBatchSize: Number(settings.poBillScheduler.batchSize || batchSize),
        documentLookahead: PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD,
        timezone: env.APP_TIMEZONE,
      },
    });
    notifyCreated(run);
  } catch (error) {
    setSchedulerRunningState(false);
    throw error;
  }

  const lockAcquired = await acquireSchedulerRunLock(run.id);
  if (!lockAcquired) {
    const currentRuntimeState = await getSchedulerRuntimeState();
    const activeLock = await describeActiveSchedulerLock(currentRuntimeState);
    const activeSchedulerName = activeLock?.activeLockRun?.schedulerName || 'another scheduler run';
    const skippedRun = await updateSchedulerRun(run.id, {
      status: 'skipped',
      summary: `PO bill scheduler skipped because ${activeSchedulerName} still has the persistent scheduler lock.`,
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        ...(activeLock || { activeLockRunId: currentRuntimeState.lockRunId }),
      },
      finished: true,
    });

    setSchedulerRunningState(false);
    return { run: skippedRun, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  let scannedCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let stopRequested = false;
  const documentOutcomes: Array<Record<string, unknown>> = [];
  let heartbeatTimer: NodeJS.Timeout | null = null;

  try {
    const heartbeatStartedAt = Date.now();
    heartbeatTimer = setInterval(() => {
      if (Date.now() - heartbeatStartedAt < SCHEDULER_HEARTBEAT_MAX_MS) {
        touchActiveSchedulerRunLock(run.id).catch(() => undefined);
      }
    }, 25000);
    await touchActiveSchedulerRunLock(run.id);
    // compute adaptive lookahead based on recent PO bill runs
    const recentPoBillRuns = await getRecentSchedulerRuns(PO_BILL_ADAPTIVE_LOOKAHEAD_RUNS);
    const documentLookahead = getPoBillDocumentLookahead(recentPoBillRuns);
    // persist the computed document lookahead into the active run for diagnostics
    try {
      await updateSchedulerRun(run.id, {
        summary: 'Loading candidate Finance documents from Odoo...',
        context: {
          ...(run.context || {}),
          documentLookahead,
        },
      });
    } catch (err) {
      // non-fatal: continue processing even if updating diagnostics fails
    }
    const forceDocumentRefresh = !options.continuousChain;
    const recentPdfs = await withTimeout(
      (signal) => getRecentDocumentPdfs(client, 300, 0, forceDocumentRefresh, signal),
      PO_BILL_FETCH_TIMEOUT_MS,
      'Fetching recent Finance documents from Odoo',
    );
    await touchActiveSchedulerRunLock(run.id);

    const nowMs = Date.now();
    const queueCandidates: AttachmentInfo[] = [];
    const deferredQueueCandidates: AttachmentInfo[] = [];
    let exhaustedCount = 0;
    let cooldownBlockedCount = 0;
    let consecutiveRetryBlockedCount = 0;
    let excludedVendorSkippedCount = 0;
    const recentlyFailedAttachmentIds = getRecentlyFailedPoBillAttachmentIds(recentRun);
    const recentlyAttemptedAttachmentIds = getRecentlyAttemptedPoBillAttachmentIds(recentRun);
    for (const pdf of recentPdfs) {
      const status = String(pdf.poBillStatus || '');
      if (['processed', 'processed_with_warnings', 'delivery_note'].includes(status)) {
        continue;
      }

      const preQueueExcludedVendor = findExcludedPoBillVendor({
        attachmentName: pdf.name,
        vendorName: pdf.poBillVendorName,
        summary: pdf.poBillSummary,
      });
      if (preQueueExcludedVendor) {
        excludedVendorSkippedCount += 1;
        if (status !== 'skipped' || !/\bexcluded vendor\b/i.test(String(pdf.poBillSummary || ''))) {
          await markPoBillDocumentSkipped({
            attachment: pdf,
            status: 'skipped',
            summary: `Skipped before PO matching because this document is from excluded vendor ${preQueueExcludedVendor} (excluded from PO Bill runs).`,
            invoiceVendor: preQueueExcludedVendor,
          }).catch(() => undefined);
        }
        continue;
      }

      const retryClass = getPoBillRetryClass(pdf, settings.poBillScheduler);
      const dueForRetry = isPoBillPdfDueForRetry(pdf, nowMs, settings.poBillScheduler);

      if (retryClass === 'exhausted') {
        exhaustedCount += 1;
        continue;
      }

      if (!dueForRetry) {
        cooldownBlockedCount += 1;
        continue;
      }

      if (
        poBillContinuousPassAttemptedIds.has(Number(pdf.id)) ||
        (!options.continuousChain && recentlyAttemptedAttachmentIds.has(Number(pdf.id)))
      ) {
        if (recentlyFailedAttachmentIds.has(Number(pdf.id))) {
          consecutiveRetryBlockedCount += 1;
        }
        deferredQueueCandidates.push(pdf);
        continue;
      }

      queueCandidates.push(pdf);
    }

    // Rotate through the campaign pass of unmatched documents only.
    // Once every unmatched document in the current pass has been attempted,
    // start a fresh pass only if this was not an auto-chained continuation.
    if (queueCandidates.length === 0 && !options.continuousChain && deferredQueueCandidates.length > 0) {
      poBillContinuousPassAttemptedIds.clear();
      queueCandidates.push(...deferredQueueCandidates);
    }

    const queue = queueCandidates
      .sort((left, right) => {
        const leftPriority = getPoBillRetryPriority(left, settings.poBillScheduler);
        const rightPriority = getPoBillRetryPriority(right, settings.poBillScheduler);
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        const leftAttempt = left.poBillProcessedAt ? Date.parse(left.poBillProcessedAt) || 0 : 0;
        const rightAttempt = right.poBillProcessedAt ? Date.parse(right.poBillProcessedAt) || 0 : 0;
        if (leftAttempt !== rightAttempt) {
          return leftAttempt - rightAttempt;
        }

        if (leftAttempt === 0 && rightAttempt === 0) {
          return Number(right.id || 0) - Number(left.id || 0);
        }

        // fallback to attachment id ordering for stability
        return Number(left.id || 0) - Number(right.id || 0);
      })
      .slice(0, batchSize);

    await updateSchedulerRun(run.id, {
      scannedCount: queue.length,
      summary: `Processing ${queue.length} candidate Finance document(s)...`,
      context: {
        ...run.context,
        candidateFinancePdfCount: recentPdfs.length,
        eligibleCount: queueCandidates.length,
      },
    }).catch(() => undefined);

    for (const pdf of queue) {
      if (await isSchedulerStopRequested(run.id)) {
        stopRequested = true;
        break;
      }

      scannedCount += 1;
      poBillContinuousPassAttemptedIds.add(Number(pdf.id));
      await touchActiveSchedulerRunLock(run.id);
      await updateSchedulerRun(run.id, {
        scannedCount,
        processedCount,
        skippedCount,
        failedCount,
        summary: `Processing Finance document ${pdf.name} (#${pdf.id}) (${scannedCount} of ${queue.length})...`,
        context: {
          ...run.context,
          currentAttachmentId: pdf.id,
          currentAttachmentName: pdf.name,
          documentOutcomes: [...documentOutcomes],
        },
      }).catch(() => undefined);

      // Claim and increment the attempt counter in po_bill_processed_documents BEFORE
      // downloading/rendering the PDF so if cPanel/CloudLinux kills the Node worker
      // mid-document (e.g. OOM on a corrupt/oversized PDF), this attachment will not
      // stay at 0 attempts and repeatedly crash the server on every cycle.
      await markPoBillDocumentSkipped({
        attachment: pdf,
        status: 'failed',
        summary: `Processing started for ${pdf.name} (#${pdf.id}); interrupted before completion.`,
      }).catch(() => undefined);

      try {
        const result = await withTimeout(
          () =>
            runPoBillAutomation(client, {
              attachmentId: pdf.id,
              mode: 'auto',
              aiConfig: settings.ai,
              matchFromDate: fromDate,
              matchToDate: toDate,
              onlyUnbilledPurchaseOrders: true,
              sourceAttachment: pdf,
            }),
          180_000,
          `Processing Finance document ${pdf.name} (#${pdf.id})`,
        );

        const processed = result.actionsTaken.some((action) =>
          /marked .* as processed/i.test(action) || /(?:marked|recorded).*delivery note/i.test(action),
        );
        const diagnostics = {
          checks: result.checks,
          actionsTaken: result.actionsTaken,
          actionsPending: result.actionsPending,
          canAutoProceed: result.canAutoProceed,
          candidates: result.candidates.slice(0, 5).map((candidate) => ({
            id: candidate.purchaseOrder.id,
            name: candidate.purchaseOrder.name,
            vendorName: Array.isArray(candidate.purchaseOrder.partner_id)
              ? candidate.purchaseOrder.partner_id[1]
              : null,
            dateOrder: candidate.purchaseOrder.date_order,
            amountTotal: candidate.purchaseOrder.amount_total,
            score: candidate.score,
            reasons: candidate.reasons,
          })),
          parsedInvoice: {
            vendorName: result.parsedInvoice.vendorName,
            invoiceDate: result.parsedInvoice.invoiceDate,
            invoiceNumber: result.parsedInvoice.invoiceNumber,
            orderNumber: result.parsedInvoice.orderNumber,
            taxPin: result.parsedInvoice.taxPin,
            pinNote: result.parsedInvoice.pinNote,
            grandTotal: result.parsedInvoice.grandTotal,
            itemCount: result.parsedInvoice.itemCount,
            logs: result.parsedInvoice.logs,
          },
        };
        if (processed) {
          processedCount += 1;
          documentOutcomes.push({
            attachmentId: pdf.id,
            attachmentName: pdf.name,
            documentId: pdf.documentId || null,
            status: result.actionsTaken.some((action) => /(?:marked|recorded).*delivery note/i.test(action))
              ? 'delivery_note'
              : 'processed',
            purchaseOrder: result.purchaseOrder?.name || null,
            summary: result.actionsTaken.join(' '),
            diagnostics,
          });
          continue;
        }

        skippedCount += 1;
        const summary = result.actionsPending.join(' ') || 'No safe PO bill match was found.';
        await markPoBillDocumentSkipped({
          attachment: pdf,
          status: 'skipped',
          summary,
          purchaseOrder: result.purchaseOrder,
          invoiceNumber: result.parsedInvoice.invoiceNumber,
          invoiceVendor: result.parsedInvoice.vendorName,
          invoiceTotal: result.parsedInvoice.grandTotal,
        });
        documentOutcomes.push({
          attachmentId: pdf.id,
          attachmentName: pdf.name,
          documentId: pdf.documentId || null,
          status: 'skipped',
          purchaseOrder: result.purchaseOrder?.name || null,
          summary,
          diagnostics,
        });
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : 'Unknown PO bill scheduler error.';
        await markPoBillDocumentSkipped({
          attachment: pdf,
          status: 'failed',
          summary: message,
        }).catch(() => undefined);
        documentOutcomes.push({
          attachmentId: pdf.id,
          attachmentName: pdf.name,
          documentId: pdf.documentId || null,
          status: 'failed',
          summary: message,
          diagnostics: {
            error: message,
          },
        });
        await logEvent('error', 'PO bill scheduler failed while processing a Finance document', {
          schedulerRunId: run.id,
          attachmentId: pdf.id,
          attachmentName: pdf.name,
          documentId: pdf.documentId || null,
          error: message,
        });
      }
      await touchActiveSchedulerRunLock(run.id);

      await updateSchedulerRun(run.id, {
        scannedCount: queue.length,
        processedCount,
        skippedCount,
        failedCount,
        summary: `Processing ${scannedCount} of ${queue.length} Finance document(s) (${processedCount} processed, ${skippedCount} skipped, ${failedCount} failed)...`,
        context: {
          ...run.context,
          documentOutcomes: [...documentOutcomes],
        },
      }).catch(() => undefined);
    }

    if (!stopRequested && failedCount === 0) {
      await markSchedulerRunSucceeded(run.id, runtimeState.lastCheckpointAt);
    } else if (!stopRequested) {
      await markSchedulerRunFailed(
        run.id,
        `PO bill scheduler completed with ${failedCount} failed document(s).`,
      );
    }

    const remainingUnmatchedInPass = Math.max(0, queueCandidates.length - scannedCount);
    const shouldChainNextRun =
      !stopRequested &&
      settings.poBillScheduler.enabled &&
      !isOdooTrafficPaused() &&
      scannedCount > 0 &&
      remainingUnmatchedInPass > 0;

    const finalRun = await updateSchedulerRun(run.id, {
      status: stopRequested ? 'completed' : failedCount > 0 ? 'completed_with_errors' : 'completed',
      scannedCount,
      processedCount,
      skippedCount,
      failedCount,
      summary: `${stopRequested ? 'PO bill scheduler stopped by operator. ' : ''}Found ${recentPdfs.length} Finance document(s) since ${fromDate}; ${queue.length} eligible in this batch (${remainingUnmatchedInPass} unmatched remaining in current pass); scanned ${scannedCount}, processed ${processedCount}, skipped ${skippedCount}, failed ${failedCount}${excludedVendorSkippedCount > 0 ? `, ${excludedVendorSkippedCount} excluded vendor doc(s) skipped (MAIFAN/TAJI/QUICKMART/EASY COACH)` : ''}${exhaustedCount > 0 ? `, ${exhaustedCount} exhausted (permanently skipped after ${settings.poBillScheduler.maxRetryAttempts} attempts)` : ''}${cooldownBlockedCount > 0 ? `, ${cooldownBlockedCount} non-bill/cooldown skipped` : ''}${consecutiveRetryBlockedCount > 0 ? `, ${consecutiveRetryBlockedCount} held back after the previous run` : ''}${shouldChainNextRun ? '. Continuous mode: next unmatched batch scheduled in 5s.' : '.'}`,
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        batchSize,
        candidateFinancePdfCount: recentPdfs.length,
        remainingUnmatchedInPass,
        excludedVendorSkippedCount,
        continuousChained: Boolean(options.continuousChain),
        nextContinuousRunScheduled: shouldChainNextRun,
        exhaustedCount,
        cooldownBlockedCount,
        consecutiveRetryBlockedCount,
        stopRequested,
        documentLookahead,
        trigger,
        documentOutcomes,
      },
      finished: true,
    });

    try {
      await withTimeout(
        () => syncAllPendingStandaloneEtrPos(client),
        45_000,
        'Standalone ETR cross-company PO sync',
      );
    } catch (crossSyncErr) {
      await logEvent('error', 'Non-fatal error running standalone ETR cross-company sync cycle', {
        error: crossSyncErr instanceof Error ? crossSyncErr.message : 'Unknown error',
      });
    }

    if (shouldChainNextRun) {
      poBillContinuousChainHandle = setTimeout(() => {
        poBillContinuousChainHandle = null;
        void runPoBillSchedulerCycle('cron', { continuousChain: true }).catch(async (chainErr) => {
          await logEvent('error', 'Continuous PO bill scheduler chain run failed', {
            error: chainErr instanceof Error ? chainErr.message : String(chainErr),
          });
        });
      }, 5000);
    } else if (!stopRequested) {
      poBillContinuousPassAttemptedIds.clear();
      try {
        const campaignMetrics = await withTimeout(
          (signal) => computeMayCampaignMetrics(client, settings.odoo.baseUrl, signal),
          30_000,
          'Computing May campaign completion metrics',
        );
        if (campaignMetrics.unprocessedRemaining === 0 && scannedCount > 0) {
          await withTimeout(
            () => notifyDbAdminCampaignReport(client),
            30_000,
            'Sending May campaign completion report',
          );
        }
      } catch (reportErr) {
        await logEvent('error', 'Non-fatal error generating May campaign completion report', {
          error: reportErr instanceof Error ? reportErr.message : 'Unknown error',
        });
      }
    }

    return { run: finalRun, scannedCount, processedCount, skippedCount, failedCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PO bill scheduler failed.';
    await markSchedulerRunFailed(run.id, message);
    const failedRun = await updateSchedulerRun(run.id, {
      status: 'failed',
      scannedCount,
      processedCount,
      skippedCount,
      failedCount: failedCount + 1,
      summary: `PO bill scheduler run failed: ${message}`,
      errorMessage: message,
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        batchSize,
        trigger,
        documentOutcomes,
      },
      finished: true,
    });

    throw Object.assign(new Error(message), { schedulerRun: failedRun });
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    setSchedulerRunningState(false);
    await releaseSchedulerRunLock(run.id);
    await cleanupStaleTempFiles().catch(() => undefined);
  }
}

export async function runSchedulerCycle(
  trigger: 'interval' | 'manual' | 'cron' = 'manual',
  options: { onRunCreated?: (run: SchedulerRunEntry) => void } = {},
): Promise<SchedulerRunResult> {
  const notifyCreated = (run: SchedulerRunEntry) => {
    try {
      options.onRunCreated?.(run);
    } catch {
      // ignore callback error
    }
  };
  const { client, settings } = await getConfiguredSchedulerClient();
  const runtimeState = await getFreshSchedulerRuntimeState();
  const recentRunsForCooldown = await getRecentSchedulerRuns(20);
  const recentRun = getRecentRunForJobType(recentRunsForCooldown, SALES_ORDER_SCHEDULER_JOB_TYPE);
  const cooldownMinutes = getConfiguredSchedulerCooldownMinutes(SALES_ORDER_SCHEDULER_JOB_TYPE, settings);
  const recentSalesOrderRunsForPlanning = await getRecentSchedulerRuns(SO_SCHEDULER_ROUTINE_DEPRIORITIZE_RUNS);
  const routineOnlyRunStreak = getRoutineOnlySalesOrderRunStreak(recentSalesOrderRunsForPlanning);
  const adaptiveLookbackHours = getAdaptiveSalesOrderLookbackHours(routineOnlyRunStreak);
  const plannedCandidateLimit = getSalesOrderLookaheadLimit(
    settings.scheduler.batchSize,
    routineOnlyRunStreak,
  );
  const effectiveConfirmedFromDate = computeEffectiveConfirmedFromDate(
    settings.scheduler.confirmedFromDate,
    runtimeState.lastCheckpointAt,
    adaptiveLookbackHours,
  );

  if (isOdooTrafficPaused()) {
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: 'Odoo API traffic is paused for firewall unban resolution.',
      context: {
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
      },
    });
    notifyCreated(run);

    return {
      run,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  if (trigger !== 'manual' && !settings.scheduler.enabled) {
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: 'Scheduler is disabled.',
      context: {
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
      },
    });
    notifyCreated(run);

    return {
      run,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  if (trigger !== 'manual' && recentRun) {
    const ageMinutes = getRecentRunAgeMinutes(recentRun);
    if (ageMinutes < cooldownMinutes) {
      const run = await insertSchedulerRun({
        status: 'skipped',
        trigger,
        summary: buildThrottleSummary(SALES_ORDER_SCHEDULER_JOB_TYPE, cooldownMinutes, recentRun),
        context: {
          confirmedFromDate: settings.scheduler.confirmedFromDate,
          effectiveConfirmedFromDate,
          jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
          schedulerName: 'Sales Order Scheduler',
          recentRunId: recentRun.id,
          recentRunStartedAt: recentRun.startedAt,
          recentRunTrigger: recentRun.trigger,
          cooldownMinutes,
          cooldownRemainingMinutes: Math.max(0, cooldownMinutes - ageMinutes),
        },
      });
      notifyCreated(run);

      return {
        run,
        scannedCount: 0,
        processedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        throttled: true,
        throttleMinutes: cooldownMinutes,
      };
    }
  }

  const windowStatus = getSchedulerWindowStatus(SALES_ORDER_ALLOWED_WINDOW);
  if (!windowStatus.allowed) {
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: `Sales Order scheduler skipped outside allowed time window (${windowStatus.allowedWindow} ${windowStatus.timeZone}).`,
      context: {
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
        allowedWindow: windowStatus.allowedWindow,
        currentLocalTime: windowStatus.label,
        currentLocalMinute: windowStatus.localMinute,
        timezone: windowStatus.timeZone,
      },
    });
    notifyCreated(run);

    return {
      run,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  if (schedulerRunning || runtimeState.lockRunId) {
    const activeLock = await describeActiveSchedulerLock(runtimeState);
    const activeSchedulerName = activeLock?.activeLockRun?.schedulerName || 'another scheduler run';
    const run = await insertSchedulerRun({
      status: 'skipped',
      trigger,
      summary: `Sales Order scheduler skipped because ${activeSchedulerName} is already in progress.`,
      context: {
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        ...(activeLock || { activeLockRunId: runtimeState.lockRunId }),
      },
    });
    notifyCreated(run);

    return {
      run,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  setSchedulerRunningState(true);

  let run: Awaited<ReturnType<typeof insertSchedulerRun>>;
  try {
    run = await insertSchedulerRun({
      status: 'started',
      trigger,
      summary: 'Scheduler run started.',
      context: {
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
        lookbackHours: adaptiveLookbackHours,
        baseLookbackHours: SCHEDULER_LOOKBACK_HOURS,
        previousCheckpointAt: runtimeState.lastCheckpointAt,
        batchSize: settings.scheduler.batchSize,
        salesOrderConcurrency: SO_SCHEDULER_CONCURRENCY,
        orderDelayMs: SO_SCHEDULER_ORDER_DELAY_MS,
        candidateLimit: plannedCandidateLimit,
        routineOnlyRunStreak,
        routineDeprioritizeRuns: SO_SCHEDULER_ROUTINE_DEPRIORITIZE_RUNS,
        timezone: env.APP_TIMEZONE,
      },
    });
    notifyCreated(run);
  } catch (error) {
    setSchedulerRunningState(false);
    throw error;
  }

  const lockAcquired = await acquireSchedulerRunLock(run.id);
  if (!lockAcquired) {
    const currentRuntimeState = await getSchedulerRuntimeState();
    const activeLock = await describeActiveSchedulerLock(currentRuntimeState);
    const activeSchedulerName = activeLock?.activeLockRun?.schedulerName || 'another scheduler run';
    const skippedRun = await updateSchedulerRun(run.id, {
      status: 'skipped',
      summary: `Sales Order scheduler skipped because ${activeSchedulerName} still has the persistent scheduler lock.`,
      context: {
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
        ...(activeLock || { activeLockRunId: currentRuntimeState.lockRunId }),
      },
      finished: true,
    });

    setSchedulerRunningState(false);
    return {
      run: skippedRun,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  let scannedCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const orderOutcomes: Array<Record<string, unknown>> = [];
  let latestProcessedOrderDate = runtimeState.lastCheckpointAt;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  try {
    const heartbeatStartedAt = Date.now();
    heartbeatTimer = setInterval(() => {
      if (Date.now() - heartbeatStartedAt < SCHEDULER_HEARTBEAT_MAX_MS) {
        touchActiveSchedulerRunLock(run.id).catch(() => undefined);
      }
    }, 25000);
    await touchActiveSchedulerRunLock(run.id);

    const configuredBatchSize = Math.max(1, Number(settings.scheduler.batchSize) || 3);
    const batchSize = Math.min(4, configuredBatchSize);
    const candidateLimit = plannedCandidateLimit;
    let candidateOrders: SalesOrderSummary[];
    try {
      candidateOrders = await withTimeout(
        () => client.getConfirmedSalesOrdersSince(effectiveConfirmedFromDate, candidateLimit, 40000),
        45000,
        'Fetching candidate sales orders from Odoo',
      );
    } catch (initialFetchError) {
      const fallbackLimit = Math.min(50, candidateLimit);
      await logEvent('warn', 'Primary Sales Order fetch timed out or failed; retrying with compact limit', {
        schedulerRunId: run.id,
        candidateLimit,
        fallbackLimit,
        error: initialFetchError instanceof Error ? initialFetchError.message : String(initialFetchError),
      }).catch(() => undefined);
      await wait(2000);
      await touchActiveSchedulerRunLock(run.id);
      candidateOrders = await withTimeout(
        () => client.getConfirmedSalesOrdersSince(effectiveConfirmedFromDate, fallbackLimit, 55000),
        60000,
        'Retrying candidate sales orders fetch from Odoo',
      );
    }
    const recentlyRoutineOrderIds = getRecentlyRoutineSalesOrderIds(recentSalesOrderRunsForPlanning);
    const orders = chooseSalesOrderBatch(candidateOrders, batchSize, recentlyRoutineOrderIds);

    scannedCount = orders.length;
    for (const order of candidateOrders) {
      if (order.date_order && parseSchedulerDate(order.date_order) > parseSchedulerDate(latestProcessedOrderDate)) {
        latestProcessedOrderDate = order.date_order;
      }
    }

    await updateSchedulerRun(run.id, {
      scannedCount,
      summary: `Scanning ${scannedCount} candidate Sales Order(s)...`,
      context: {
        ...run.context,
        candidateOrderCount: candidateOrders.length,
        selectedOrderIds: orders.map((o) => o.id),
        selectedOrderNames: orders.map((o) => o.name),
      },
    }).catch(() => undefined);

    const orderStages = new Map<number, string>();
    const missingJobSummaryCheckedOrderIds = new Set<number>();
    const processOrder = async (order: (typeof orders)[number]) => {
      const markOrderStage = async (stage: string) => {
        orderStages.set(order.id, stage);
        await updateSchedulerRun(run.id, {
          scannedCount,
          processedCount,
          skippedCount,
          failedCount,
          summary: `Processing Sales Order ${order.name} (${stage})...`,
          context: {
            ...run.context,
            candidateOrderCount: candidateOrders.length,
            selectedOrderIds: orders.map((o) => o.id),
            selectedOrderNames: orders.map((o) => o.name),
            currentOrderId: order.id,
            currentOrderName: order.name,
            currentStage: stage,
            orderOutcomes: [...orderOutcomes],
          },
        }).catch(() => undefined);
      };

      try {
        await touchActiveSchedulerRunLock(run.id);
        await markOrderStage('attachment_lookup');
        const attachments = await client.getAttachments(order.id);
        const latestJobSummary = attachments
          .filter((attachment) =>
            isJobSummaryAttachment(attachment, settings.parser.filenameKeyword),
          )
          .sort(sortAttachmentsNewestFirst)[0];

        if (!latestJobSummary) {
          let reminderOutcome: Record<string, unknown> | null = null;
          const reminderWindow = getJobSummaryReminderWindowStatus();

          if (trigger !== 'manual' && !reminderWindow.allowed) {
            reminderOutcome = {
              status: 'outside_daily_window',
              reason: `Job Summary upload reminders run at 16:40 ${reminderWindow.timeZone}.`,
              currentLocalTime: reminderWindow.label,
              allowedWindow: reminderWindow.allowedWindow,
              timezone: reminderWindow.timeZone,
            };
          } else if (missingJobSummaryCheckedOrderIds.has(order.id)) {
            reminderOutcome = {
              status: 'already_checked_in_run',
              reason: `Skipped duplicate missing Job Summary check within the same scheduler run for ${order.name}.`,
            };
          } else {
            missingJobSummaryCheckedOrderIds.add(order.id);
            try {
              await markOrderStage('missing_job_summary_reminder');
              reminderOutcome = await ensureMissingJobSummaryReminder(
                client,
                order,
                settings.parser.filenameKeyword,
                attachments,
              );
            } catch (reminderError) {
              const reminderMessage =
                reminderError instanceof Error ? reminderError.message : 'Unknown reminder creation error.';
              reminderOutcome = {
                status: 'failed',
                reason: reminderMessage,
              };
              await logEvent('error', 'Scheduler could not create missing Job Summary activity', {
                schedulerRunId: run.id,
                orderId: order.id,
                orderName: order.name,
                error: reminderMessage,
              });
            }
          }

          await logEvent('info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', {
            schedulerRunId: run.id,
            orderId: order.id,
            orderName: order.name,
            reminderOutcome,
          });
          return {
            result: 'skipped' as const,
            outcome: {
              orderId: order.id,
              orderName: order.name,
              status: 'skipped',
              category: 'missing_job_summary',
              stage: 'attachment_lookup',
              reason: 'No matching Job Summary PDF found.',
              reminderOutcome,
            },
          };
        }

        let reminderCloseResult: Record<string, unknown> | null = null;
        try {
          reminderCloseResult = await closeOpenJobSummaryReminderActivities(
            client,
            order.id,
            `Job Summary PDF ${latestJobSummary.name} was detected.`,
            order.name,
          );
        } catch (reminderError) {
          const reminderMessage =
            reminderError instanceof Error ? reminderError.message : 'Unknown reminder close error.';
          reminderCloseResult = {
            status: 'failed',
            reason: reminderMessage,
          };
          await logEvent('warn', 'Scheduler could not close missing Job Summary activity', {
            schedulerRunId: run.id,
            orderId: order.id,
            orderName: order.name,
            attachmentId: latestJobSummary.id,
            attachmentName: latestJobSummary.name,
            error: reminderMessage,
          });
        }

        await touchActiveSchedulerRunLock(run.id);
        await markOrderStage('extract_pdf');
        const history = await extractAttachmentForOrder(order.id, latestJobSummary.id, {
          preloadedOrder: order,
          preloadedAttachments: attachments,
        });
        await touchActiveSchedulerRunLock(run.id);
        await markOrderStage('send_to_odoo');
        const sendResult = await sendExtractedResultToOdoo(history.id, false, {
          orderState: order.state,
          orderName: order.name,
        });
        await touchActiveSchedulerRunLock(run.id);
        await markOrderStage('stock_reconciliation');
        const stockResult = await processSaleOrderStock(order.id, { skipMultiSummaryRefetch: true });
        await touchActiveSchedulerRunLock(run.id);

        if (stockResult.summary.failedCount > 0) {
          const failedItemReasons = stockResult.items
            .filter((item) => item.status === 'failed')
            .map((item) => `${item.normalizedColor || item.expectedSoProduct || 'Item'}: ${item.skipReason}`)
            .filter(Boolean);
          const detailedReason = failedItemReasons.length > 0
            ? failedItemReasons.join('; ')
            : stockResult.statusMessage;

          return {
            result: 'failed' as const,
            outcome: {
              orderId: order.id,
              orderName: order.name,
              attachmentId: latestJobSummary.id,
              attachmentName: latestJobSummary.name,
              status: 'failed',
              category: 'stock_failed',
              stage: 'stock_reconciliation',
              reason: detailedReason,
              failedItemReasons,
              historyId: history.id,
              extractionSkipped: sendResult.skipped,
              stockSignature: stockResult.signature,
              stockAlreadyProcessed: stockResult.alreadyProcessed,
              stockSummary: stockResult.summary,
              reminderCloseResult,
            },
          };
        }

        // Non-blocking fallback: Audit linked confirmed Purchase Orders against the Job Summary
        // Bound with its own timeout so an already-reconciled Sales Order never fails on a slow PO audit.
        try {
          await markOrderStage('po_audit');
          const extractedRecord = await getExtractedResultByHistoryId(history.id).catch(() => null);
          await withTimeout(
            () =>
              auditLinkedPurchaseOrdersForSaleOrder(
                client,
                order.id,
                extractedRecord?.resultJson,
                order.name,
                {
                  preloadedOrder: {
                    id: order.id,
                    name: order.name,
                    user_id: Array.isArray(order.user_id) ? order.user_id : false,
                    partner_id: Array.isArray(order.partner_id) ? order.partner_id : false,
                  },
                  // send_to_odoo already ran reconcileWorkOrderQuantitiesForSaleOrder when !sendResult.skipped
                  skipWorkOrderReconciliation: !sendResult.skipped,
                },
              ),
            SO_PO_AUDIT_TIMEOUT_MS,
            `PO audit for Sales Order ${order.name}`,
          );
        } catch (poAuditErr) {
          await logEvent('warn', 'Non-blocking PO audit timed out or failed after stock reconciliation', {
            schedulerRunId: run.id,
            orderId: order.id,
            orderName: order.name,
            error: poAuditErr instanceof Error ? poAuditErr.message : String(poAuditErr),
          }).catch(() => undefined);
        }

        if (stockResult.alreadyProcessed || stockResult.lockSkipped) {
          return {
            result: 'skipped' as const,
            outcome: {
              orderId: order.id,
              orderName: order.name,
              attachmentId: latestJobSummary.id,
              attachmentName: latestJobSummary.name,
              status: 'skipped',
              category: stockResult.alreadyProcessed ? 'already_reconciled' : 'order_locked',
              stage: 'stock_reconciliation',
              reason: stockResult.statusMessage,
              historyId: history.id,
              extractionSkipped: sendResult.skipped,
              stockSignature: stockResult.signature,
              stockAlreadyProcessed: stockResult.alreadyProcessed,
              stockSummary: stockResult.summary,
              reminderCloseResult,
            },
          };
        }

        return {
          result: 'processed' as const,
          outcome: {
            orderId: order.id,
            orderName: order.name,
            attachmentId: latestJobSummary.id,
            attachmentName: latestJobSummary.name,
            status: 'processed',
            category: sendResult.skipped ? 'send_skipped_but_stock_processed' : 'processed',
            stage: sendResult.skipped ? 'stock_reconciliation' : 'completed',
            reason: stockResult.statusMessage,
            historyId: history.id,
            extractionSkipped: sendResult.skipped,
            stockSignature: stockResult.signature,
            stockAlreadyProcessed: stockResult.alreadyProcessed,
            stockSummary: stockResult.summary,
            reminderCloseResult,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown scheduler error.';
        await logEvent('error', 'Scheduler failed while processing a Sales Order', {
          schedulerRunId: run.id,
          orderId: order.id,
          orderName: order.name,
          error: message,
        });

        return {
          result: 'failed' as const,
          outcome: {
            orderId: order.id,
            orderName: order.name,
            status: 'failed',
            category: 'unexpected_error',
            stage: 'order_processing',
            reason: message,
          },
        };
      }
    };

    for (let index = 0; index < orders.length; index += SO_SCHEDULER_CONCURRENCY) {
      const chunk = orders.slice(index, index + SO_SCHEDULER_CONCURRENCY);
      await touchActiveSchedulerRunLock(run.id);
      const results = await Promise.all(
        chunk.map((order) =>
          withTimeout(
            () => processOrder(order),
            SO_PER_ORDER_TIMEOUT_MS,
            `Processing Sales Order ${order.name}`,
          ).catch(async (timeoutErr) => {
            const lastStage = orderStages.get(order.id) || 'order_processing';
            const qStats = getOdooQueueStats();
            const baseMsg =
              timeoutErr instanceof Error ? timeoutErr.message : 'Sales Order processing timed out.';
            const timeoutMsg = `${baseMsg} (last stage: ${lastStage}; Odoo queue: high=${qStats.highPending}, background=${qStats.backgroundPending}, active=${qStats.activeLabel || 'idle'} ${qStats.activeElapsedMs}ms)`;
            await logEvent('error', 'Scheduler timed out while processing a Sales Order', {
              schedulerRunId: run.id,
              orderId: order.id,
              orderName: order.name,
              lastStage,
              odooQueue: qStats,
              error: timeoutMsg,
            }).catch(() => undefined);
            return {
              result: 'failed' as const,
              outcome: {
                orderId: order.id,
                orderName: order.name,
                status: 'failed',
                category: 'order_timeout',
                stage: lastStage,
                reason: timeoutMsg,
              },
            };
          }),
        ),
      );
      for (const result of results) {
        if (result.result === 'processed') {
          processedCount += 1;
        } else if (result.result === 'skipped') {
          skippedCount += 1;
        } else {
          failedCount += 1;
        }
        orderOutcomes.push(result.outcome);
      }
      await touchActiveSchedulerRunLock(run.id);

      const doneCount = processedCount + skippedCount + failedCount;
      await updateSchedulerRun(run.id, {
        scannedCount,
        processedCount,
        skippedCount,
        failedCount,
        summary: `Processing ${doneCount} of ${scannedCount} Sales Order(s) (${processedCount} reconciled, ${skippedCount} skipped, ${failedCount} failed)...`,
        context: {
          ...run.context,
          orderOutcomes: [...orderOutcomes],
        },
      }).catch(() => undefined);

      if (SO_SCHEDULER_ORDER_DELAY_MS > 0 && index + SO_SCHEDULER_CONCURRENCY < orders.length) {
        await wait(SO_SCHEDULER_ORDER_DELAY_MS);
      }
    }

    if (failedCount === 0) {
      await markSchedulerRunSucceeded(run.id, latestProcessedOrderDate);
    } else {
      await markSchedulerRunFailed(
        run.id,
        `Scheduler completed with ${failedCount} failed Sales Order(s); checkpoint not advanced.`,
      );
    }
    const finalRun = await updateSchedulerRun(run.id, {
      status: failedCount > 0 ? 'completed_with_errors' : 'completed',
      scannedCount,
      processedCount,
      skippedCount,
      failedCount,
      summary: `Scanned ${scannedCount} Sales Order(s), reconciled ${processedCount}, skipped ${skippedCount}, failed ${failedCount}.`,
      context: {
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
        checkpointAt: latestProcessedOrderDate,
        lookbackHours: adaptiveLookbackHours,
        baseLookbackHours: SCHEDULER_LOOKBACK_HOURS,
        batchSize,
        salesOrderConcurrency: SO_SCHEDULER_CONCURRENCY,
        orderDelayMs: SO_SCHEDULER_ORDER_DELAY_MS,
        candidateOrderCount: candidateOrders.length,
        candidateLimit,
        recentlyRoutineOrderCount: recentlyRoutineOrderIds.size,
        routineOnlyRunStreak,
        routineDeprioritizeRuns: SO_SCHEDULER_ROUTINE_DEPRIORITIZE_RUNS,
        selectedOrderIds: orders.map((order) => order.id),
        trigger,
        orderOutcomes,
      },
      finished: true,
    });

    return {
      run: finalRun,
      scannedCount,
      processedCount,
      skippedCount,
      failedCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduler failed.';
    await markSchedulerRunFailed(run.id, message);
    const failedRun = await updateSchedulerRun(run.id, {
      status: 'failed',
      scannedCount,
      processedCount,
      skippedCount,
      failedCount: failedCount + 1,
      summary: `Scheduler run failed: ${message}`,
      errorMessage: message,
      context: {
        confirmedFromDate: settings.scheduler.confirmedFromDate,
        effectiveConfirmedFromDate,
        jobType: SALES_ORDER_SCHEDULER_JOB_TYPE,
        schedulerName: 'Sales Order Scheduler',
        batchSize: settings.scheduler.batchSize,
        trigger,
        orderOutcomes,
      },
      finished: true,
    });

    throw Object.assign(new Error(message), { schedulerRun: failedRun });
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    setSchedulerRunningState(false);
    await releaseSchedulerRunLock(run.id);
  }
}

export async function startSchedulerInterval() {
  const settings = await getSettings();

  if (
    !schedulerIntervalHandle &&
    env.SCHEDULER_USE_INTERVAL === 'true' &&
    settings.scheduler.enabled &&
    settings.scheduler.useInProcessInterval
  ) {
    const intervalMs = Math.max(1, settings.scheduler.intervalMinutes) * 60 * 1000;

    schedulerIntervalHandle = setInterval(() => {
      void runSchedulerCycle('interval').catch(async (error) => {
        await logEvent('error', 'In-process scheduler interval run failed', {
          error: error instanceof Error ? error.message : 'Unknown interval scheduler failure.',
        });
      });
    }, intervalMs);
  }

  if (
    !poBillSchedulerIntervalHandle &&
    env.SCHEDULER_USE_INTERVAL === 'true' &&
    settings.poBillScheduler.enabled &&
    settings.poBillScheduler.useInProcessInterval
  ) {
    const intervalMs = Math.max(1, settings.poBillScheduler.intervalMinutes) * 60 * 1000;

    poBillSchedulerIntervalHandle = setInterval(() => {
      void runPoBillSchedulerCycle('interval').catch(async (error) => {
        await logEvent('error', 'In-process PO bill scheduler interval run failed', {
          error: error instanceof Error ? error.message : 'Unknown PO bill interval scheduler failure.',
        });
      });
    }, intervalMs);
  }
}

export function stopSchedulerInterval() {
  if (schedulerIntervalHandle) {
    clearInterval(schedulerIntervalHandle);
    schedulerIntervalHandle = null;
  }
  if (poBillSchedulerIntervalHandle) {
    clearInterval(poBillSchedulerIntervalHandle);
    poBillSchedulerIntervalHandle = null;
  }
}
