import {
  acquireSchedulerRunLock,
  clearStaleSchedulerRunLock,
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
import { OdooClient } from './odooClient';
import {
  getRecentDocumentPdfs,
  markPoBillDocumentSkipped,
  runPoBillAutomation,
} from './poBillAutomationService';
import { processSaleOrderStock } from './stockProcessingService';

let schedulerRunning = false;
let schedulerIntervalHandle: NodeJS.Timeout | null = null;
let poBillSchedulerIntervalHandle: NodeJS.Timeout | null = null;
const SCHEDULER_LOOKBACK_HOURS = 24;
const SO_SCHEDULER_CONCURRENCY = 1;
const SO_SCHEDULER_ORDER_DELAY_MS = Math.max(
  0,
  Number(env.SO_SCHEDULER_ORDER_DELAY_MS || 1000) || 1000,
);
const SO_SCHEDULER_LOOKAHEAD_MIN = 50;
const SO_SCHEDULER_LOOKAHEAD_MAX = 1000;
const SO_SCHEDULER_ROUTINE_DEPRIORITIZE_RUNS = 20;
const SO_SCHEDULER_ADAPTIVE_LOOKBACK_STEP_HOURS = 24;
const SO_SCHEDULER_ADAPTIVE_LOOKBACK_MAX_HOURS = 24 * 90;
const PO_BILL_SCHEDULER_BATCH_SIZE = 1;
const PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD = 250;
const PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD_MAX = 500;
const PO_BILL_RETRY_COOLDOWN_HOURS = 12;
const PO_BILL_TRANSIENT_RETRY_COOLDOWN_HOURS = 2;
const PO_BILL_STABLE_SKIP_RETRY_COOLDOWN_HOURS = 24 * 14;
const PO_BILL_ADAPTIVE_LOOKAHEAD_STEP = 250;
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

  const startedAt = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAt)) {
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

function getPoBillRetryClass(pdf: AttachmentInfo, policy: PoBillSchedulerConfig): PoBillRetryClass {
  const status = String(pdf.poBillStatus || '');
  const summary = String(pdf.poBillSummary || '').toLowerCase();

  if (['processed', 'processed_with_warnings'].includes(status)) {
    return 'processed';
  }
  if (!status) {
    return 'fresh';
  }
  if (/\b(job summary|maxcut|max cut|not a vendor bill|not a supplier invoice)\b/i.test(summary)) {
    return 'stable_skip';
  }
  if (/\b(timeout|network|rate limit|api key|ai extraction|ocr|upload failed|could not download|failed to parse|unknown po bill scheduler error)\b/i.test(summary)) {
    return 'transient';
  }

  // For changeable skips (e.g. "No safe PO bill match"), check if exhausted
  const attemptCount = getPoBillAttemptCount(pdf);
  if (attemptCount >= Math.max(1, Number(policy.maxRetryAttempts || MAX_PO_BILL_RETRY_ATTEMPTS))) {
    return 'exhausted';
  }

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
      // 7-day (168h) retry interval per attempt
      const escalationSteps = policy.retryBackoffHours?.length
        ? policy.retryBackoffHours
        : [168, 168, 168, 168, 168, 168, 168, 168, 168, 168];
      const index = Math.min(attemptCount, escalationSteps.length - 1);
      return escalationSteps[index];
    }
    case 'stable_skip':
      return Math.max(1, Number(policy.stableSkipRetryDays || 14)) * 24;
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
  if (retryClass === 'processed' || retryClass === 'exhausted') {
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
  const recentRuns = await getRecentSchedulerRuns(5);
  const runtimeState = await getFreshSchedulerRuntimeState();
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

  const parsed = Date.parse(value);
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
): Promise<SchedulerRunResult> {
  const { client, settings } = await getConfiguredSchedulerClient();
  const runtimeState = await getFreshSchedulerRuntimeState();
  const recentRunsForCooldown = await getRecentSchedulerRuns(20);
  const recentRun = getRecentRunForJobType(recentRunsForCooldown, PO_BILL_SCHEDULER_JOB_TYPE);
  const cooldownMinutes = getConfiguredSchedulerCooldownMinutes(PO_BILL_SCHEDULER_JOB_TYPE, settings);
  const fromDate = settings.poBillScheduler.fromDate || '2026-01-01 00:00:00';
  const toDate = formatOdooDateTime(new Date());
  const batchSize = PO_BILL_SCHEDULER_BATCH_SIZE;

  if (!settings.poBillScheduler.enabled) {
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

    return { run, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  if (trigger !== 'manual' && recentRun) {
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

    return { run, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  schedulerRunning = true;

  let run: Awaited<ReturnType<typeof insertSchedulerRun>>;
  try {
    run = await insertSchedulerRun({
      status: 'started',
      trigger,
      summary: 'PO bill scheduler run started.',
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
  } catch (error) {
    schedulerRunning = false;
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

    schedulerRunning = false;
    return { run: skippedRun, scannedCount: 0, processedCount: 0, skippedCount: 0, failedCount: 0 };
  }

  let scannedCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const documentOutcomes: Array<Record<string, unknown>> = [];

  try {
    await touchActiveSchedulerRunLock(run.id);
    // compute adaptive lookahead based on recent PO bill runs
    const recentPoBillRuns = await getRecentSchedulerRuns(PO_BILL_ADAPTIVE_LOOKAHEAD_RUNS);
    const documentLookahead = getPoBillDocumentLookahead(recentPoBillRuns);
    // persist the computed document lookahead into the active run for diagnostics
    try {
      await updateSchedulerRun(run.id, {
        context: {
          ...(run.context || {}),
          documentLookahead,
        },
      });
    } catch (err) {
      // non-fatal: continue processing even if updating diagnostics fails
    }
    const recentPdfs = await getRecentDocumentPdfs(
      client,
      Math.max(documentLookahead, batchSize * 20),
    );

    const nowMs = Date.now();
    const queueCandidates: AttachmentInfo[] = [];
    let exhaustedCount = 0;
    let cooldownBlockedCount = 0;
    for (const pdf of recentPdfs) {
      const status = String(pdf.poBillStatus || '');
      if (['processed', 'processed_with_warnings'].includes(status)) {
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

      queueCandidates.push(pdf);
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

        // fallback to attachment id ordering for stability
        return Number(left.id || 0) - Number(right.id || 0);
      })
      .slice(0, batchSize);

    for (const pdf of queue) {
      scannedCount += 1;
      await touchActiveSchedulerRunLock(run.id);

      try {
        const result = await runPoBillAutomation(client, {
          attachmentId: pdf.id,
          mode: 'auto',
          aiConfig: settings.ai,
          matchFromDate: fromDate,
          matchToDate: toDate,
          onlyUnbilledPurchaseOrders: true,
          sourceAttachment: pdf,
        });

        const processed = result.actionsTaken.some((action) => /marked .* as processed/i.test(action));
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
            status: 'processed',
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
    }

    if (failedCount === 0) {
      await markSchedulerRunSucceeded(run.id, runtimeState.lastCheckpointAt);
    } else {
      await markSchedulerRunFailed(
        run.id,
        `PO bill scheduler completed with ${failedCount} failed document(s).`,
      );
    }

    const finalRun = await updateSchedulerRun(run.id, {
      status: failedCount > 0 ? 'completed_with_errors' : 'completed',
      scannedCount,
      processedCount,
      skippedCount,
      failedCount,
      summary: `PO bill scheduler scanned ${scannedCount} Finance document(s), processed ${processedCount}, skipped ${skippedCount}, failed ${failedCount}${exhaustedCount > 0 ? `, ${exhaustedCount} exhausted (permanently skipped after ${settings.poBillScheduler.maxRetryAttempts} attempts)` : ''}${cooldownBlockedCount > 0 ? `, ${cooldownBlockedCount} in cooldown` : ''}.`,
      context: {
        jobType: PO_BILL_SCHEDULER_JOB_TYPE,
        schedulerName: 'PO Bill Scheduler',
        fromDate,
        toDate,
        batchSize,
        candidateFinancePdfCount: recentPdfs.length,
        exhaustedCount,
        cooldownBlockedCount,
        documentLookahead,
        trigger,
        documentOutcomes,
      },
      finished: true,
    });

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
      summary: 'PO bill scheduler run failed.',
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
    schedulerRunning = false;
    await releaseSchedulerRunLock(run.id);
  }
}

export async function runSchedulerCycle(
  trigger: 'interval' | 'manual' | 'cron' = 'manual',
): Promise<SchedulerRunResult> {
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

  if (!settings.scheduler.enabled) {
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

    return {
      run,
      scannedCount: 0,
      processedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    };
  }

  schedulerRunning = true;

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
  } catch (error) {
    schedulerRunning = false;
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

    schedulerRunning = false;
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

  try {
    await touchActiveSchedulerRunLock(run.id);
    const batchSize = Math.max(1, Number(settings.scheduler.batchSize) || 1);
    const candidateLimit = plannedCandidateLimit;
    const candidateOrders = await client.getConfirmedSalesOrdersSince(
      effectiveConfirmedFromDate,
      candidateLimit,
    );
    const recentlyRoutineOrderIds = getRecentlyRoutineSalesOrderIds(recentSalesOrderRunsForPlanning);
    const orders = chooseSalesOrderBatch(candidateOrders, batchSize, recentlyRoutineOrderIds);

    scannedCount = orders.length;
    for (const order of candidateOrders) {
      if (order.date_order && parseSchedulerDate(order.date_order) > parseSchedulerDate(latestProcessedOrderDate)) {
        latestProcessedOrderDate = order.date_order;
      }
    }

    const processOrder = async (order: (typeof orders)[number]) => {
      try {
        await touchActiveSchedulerRunLock(run.id);
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
          } else {
            try {
              reminderOutcome = await ensureMissingJobSummaryReminder(
                client,
                order,
                settings.parser.filenameKeyword,
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
        const history = await extractAttachmentForOrder(order.id, latestJobSummary.id);
        await touchActiveSchedulerRunLock(run.id);
        const sendResult = await sendExtractedResultToOdoo(history.id, false);
        await touchActiveSchedulerRunLock(run.id);
        const stockResult = await processSaleOrderStock(order.id);
        await touchActiveSchedulerRunLock(run.id);

        if (stockResult.summary.failedCount > 0) {
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
      const results = await Promise.all(chunk.map((order) => processOrder(order)));
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
      summary: 'Scheduler run failed.',
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
    schedulerRunning = false;
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
