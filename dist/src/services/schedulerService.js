"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSchedulerStatus = getSchedulerStatus;
exports.runPoBillSchedulerCycle = runPoBillSchedulerCycle;
exports.runSchedulerCycle = runSchedulerCycle;
exports.startSchedulerInterval = startSchedulerInterval;
exports.stopSchedulerInterval = stopSchedulerInterval;
const repositories_1 = require("../models/repositories");
const helpers_1 = require("../utils/helpers");
const env_1 = require("../utils/env");
const extractionService_1 = require("./extractionService");
const jobSummaryReminderService_1 = require("./jobSummaryReminderService");
const logService_1 = require("./logService");
const odooClient_1 = require("./odooClient");
const poBillAutomationService_1 = require("./poBillAutomationService");
const stockProcessingService_1 = require("./stockProcessingService");
const tempCleanup_1 = require("../utils/tempCleanup");
const campaignReportService_1 = require("./campaignReportService");
let schedulerRunning = false;
let schedulerIntervalHandle = null;
let poBillSchedulerIntervalHandle = null;
const SCHEDULER_LOOKBACK_HOURS = 24;
const SO_SCHEDULER_CONCURRENCY = 1;
const SO_SCHEDULER_ORDER_DELAY_MS = Math.max(0, Number(env_1.env.SO_SCHEDULER_ORDER_DELAY_MS || 1000) || 1000);
const SO_SCHEDULER_LOOKAHEAD_MIN = 50;
const SO_SCHEDULER_LOOKAHEAD_MAX = 1000;
const SO_SCHEDULER_ROUTINE_DEPRIORITIZE_RUNS = 20;
const SO_SCHEDULER_ADAPTIVE_LOOKBACK_STEP_HOURS = 24;
const SO_SCHEDULER_ADAPTIVE_LOOKBACK_MAX_HOURS = 24 * 90;
const PO_BILL_SCHEDULER_BATCH_SIZE = 1;
const PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD = 1000;
const PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD_MAX = 1000;
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
function schedulerNameForJobType(jobType) {
    return jobType === PO_BILL_SCHEDULER_JOB_TYPE ? 'PO Bill Scheduler' : 'Sales Order Scheduler';
}
function jobTypeMatches(run, jobType) {
    return run.context.jobType === jobType;
}
function getRecentRunForJobType(recentRuns, jobType) {
    return recentRuns.find((run) => jobTypeMatches(run, jobType)) || null;
}
function getConfiguredSchedulerCooldownMinutes(jobType, settings) {
    if (jobType === SALES_ORDER_SCHEDULER_JOB_TYPE) {
        return Math.max(1, Number(settings.scheduler.intervalMinutes || 10) || 10);
    }
    return Math.max(1, Number(settings.poBillScheduler.intervalMinutes || 15) || 15);
}
function getRecentRunAgeMinutes(run) {
    if (!run) {
        return Number.POSITIVE_INFINITY;
    }
    const startedAt = Date.parse(run.startedAt);
    if (!Number.isFinite(startedAt)) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
}
function buildThrottleSummary(jobType, cooldownMinutes, recentRun) {
    const schedulerName = schedulerNameForJobType(jobType);
    const ageMinutes = getRecentRunAgeMinutes(recentRun);
    return `${schedulerName} skipped to avoid bulk Odoo calls. Last run started ${ageMinutes} minute(s) ago; cooldown is ${cooldownMinutes} minute(s).`;
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function getSalesOrderLookaheadLimit(batchSize, routineOnlyRunStreak = 0) {
    const safeBatchSize = Math.max(1, Number(batchSize) || 1);
    const baseLimit = Math.max(SO_SCHEDULER_LOOKAHEAD_MIN, safeBatchSize * 10);
    const adaptiveLimit = baseLimit + Math.max(0, routineOnlyRunStreak) * baseLimit;
    return Math.min(SO_SCHEDULER_LOOKAHEAD_MAX, adaptiveLimit);
}
function getAdaptiveSalesOrderLookbackHours(routineOnlyRunStreak) {
    const adaptiveHours = SCHEDULER_LOOKBACK_HOURS +
        Math.max(0, routineOnlyRunStreak) * SO_SCHEDULER_ADAPTIVE_LOOKBACK_STEP_HOURS;
    return Math.min(SO_SCHEDULER_ADAPTIVE_LOOKBACK_MAX_HOURS, adaptiveHours);
}
function isRoutineSalesOrderOutcome(outcome) {
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
function getRecentlyRoutineSalesOrderIds(recentRuns) {
    const ids = new Set();
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
function getRoutineOnlySalesOrderRunStreak(recentRuns) {
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
function chooseSalesOrderBatch(candidates, batchSize, recentlyRoutineOrderIds) {
    const preferred = candidates.filter((order) => !recentlyRoutineOrderIds.has(order.id));
    const fallback = candidates.filter((order) => recentlyRoutineOrderIds.has(order.id));
    return [...preferred, ...fallback].slice(0, Math.max(1, Number(batchSize) || 1));
}
function getPoBillAttemptCount(pdf) {
    return Math.max(0, Number(pdf.poBillAttemptCount || 0) || 0);
}
function getRecentlyFailedPoBillAttachmentIds(run) {
    const ids = new Set();
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
function getRecentlyAttemptedPoBillAttachmentIds(run) {
    const ids = new Set();
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
function getPoBillRetryClass(pdf, policy) {
    const status = String(pdf.poBillStatus || '');
    const summary = String(pdf.poBillSummary || '').toLowerCase();
    if (['processed', 'processed_with_warnings'].includes(status)) {
        return 'processed';
    }
    if (!status) {
        return 'fresh';
    }
    if (/\b(job summary|maxcut|max cut|not a vendor bill|not a supplier invoice|already invoiced|invoiced in odoo)\b/i.test(summary)) {
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
function getPoBillRetryCooldownHours(retryClass, attemptCount, policy) {
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
            return Math.max(0, Number(policy.stableSkipRetryDays ?? 0)) * 24;
        case 'exhausted':
        case 'processed':
        default:
            return Number.POSITIVE_INFINITY;
    }
}
function getPoBillAttemptedAt(pdf) {
    return pdf.poBillProcessedAt ? Date.parse(pdf.poBillProcessedAt) || 0 : 0;
}
function isPoBillPdfDueForRetry(pdf, nowMs, policy) {
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
function getPoBillRetryPriority(pdf, policy) {
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
function getPoBillLearningStreak(recentRuns) {
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
function getPoBillDocumentLookahead(recentRuns) {
    const learningStreak = getPoBillLearningStreak(recentRuns);
    return Math.min(PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD_MAX, PO_BILL_SCHEDULER_DOCUMENT_LOOKAHEAD + learningStreak * PO_BILL_ADAPTIVE_LOOKAHEAD_STEP);
}
async function getFreshSchedulerRuntimeState() {
    const staleLock = await (0, repositories_1.clearStaleSchedulerRunLock)();
    if (staleLock?.lockRunId) {
        await (0, logService_1.logEvent)('warn', 'Cleared inactive scheduler runtime lock', {
            lockRunId: staleLock.lockRunId,
            lockAcquiredAt: staleLock.lockAcquiredAt,
        });
    }
    return (0, repositories_1.getSchedulerRuntimeState)();
}
async function touchActiveSchedulerRunLock(runId) {
    try {
        await (0, repositories_1.touchSchedulerRunLock)(runId);
    }
    catch (error) {
        await (0, logService_1.logEvent)('warn', 'Could not refresh scheduler runtime lock heartbeat', {
            schedulerRunId: runId,
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
    }
}
async function isSchedulerStopRequested(runId) {
    try {
        const runtimeState = await (0, repositories_1.getSchedulerRuntimeState)();
        return runtimeState.lockRunId === runId && Boolean(runtimeState.stopRequestedAt);
    }
    catch (error) {
        await (0, logService_1.logEvent)('warn', 'Could not read scheduler stop request', {
            schedulerRunId: runId,
            error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
        return false;
    }
}
async function describeActiveSchedulerLock(runtimeState) {
    if (!runtimeState.lockRunId) {
        return null;
    }
    try {
        const activeRun = await (0, repositories_1.getSchedulerRunById)(runtimeState.lockRunId);
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
    }
    catch (error) {
        return {
            activeLockRunId: runtimeState.lockRunId,
            activeLockAcquiredAt: runtimeState.lockAcquiredAt,
            activeLockRunLookupError: error instanceof Error ? error.message : String(error),
        };
    }
}
async function getConfiguredSchedulerClient() {
    const settings = await (0, repositories_1.getSettings)();
    return {
        settings,
        client: new odooClient_1.OdooClient(settings.odoo),
    };
}
async function getSchedulerStatus() {
    const settings = await (0, repositories_1.getSettings)();
    const recentRuns = await (0, repositories_1.getRecentSchedulerRuns)(5);
    const runtimeState = await getFreshSchedulerRuntimeState();
    const mode = settings.scheduler.useInProcessInterval && env_1.env.SCHEDULER_USE_INTERVAL === 'true'
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
function parseSchedulerDate(value) {
    if (!value) {
        return 0;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function computeEffectiveConfirmedFromDate(configuredFromDate, checkpointAt, lookbackHours = SCHEDULER_LOOKBACK_HOURS) {
    const configuredMs = parseSchedulerDate(configuredFromDate);
    const checkpointMs = parseSchedulerDate(checkpointAt);
    if (!checkpointMs) {
        return configuredFromDate;
    }
    const lookbackMs = checkpointMs - lookbackHours * 60 * 60 * 1000;
    const effectiveMs = configuredMs > 0 ? Math.max(configuredMs, lookbackMs) : lookbackMs;
    return (0, helpers_1.formatOdooDateTime)(new Date(effectiveMs));
}
function isMinuteWithinWindow(localMinute, startMinute, endMinute) {
    if (startMinute < endMinute) {
        return localMinute >= startMinute && localMinute < endMinute;
    }
    return localMinute >= startMinute || localMinute < endMinute;
}
function getLocalSchedulerTime() {
    const timeZone = env_1.env.APP_TIMEZONE || 'Africa/Nairobi';
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
    const value = (type) => parts.find((part) => part.type === type)?.value || '00';
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
function getSchedulerWindowStatus(window) {
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
        allowed: localTime.localMinute >= JOB_SUMMARY_REMINDER_RUN_MINUTE &&
            localTime.localMinute < windowEndMinute,
        allowedWindow: '16:40-16:50',
    };
}
async function runPoBillSchedulerCycle(trigger = 'manual') {
    const { client, settings } = await getConfiguredSchedulerClient();
    const runtimeState = await getFreshSchedulerRuntimeState();
    const recentRunsForCooldown = await (0, repositories_1.getRecentSchedulerRuns)(20);
    const recentRun = getRecentRunForJobType(recentRunsForCooldown, PO_BILL_SCHEDULER_JOB_TYPE);
    const cooldownMinutes = getConfiguredSchedulerCooldownMinutes(PO_BILL_SCHEDULER_JOB_TYPE, settings);
    const fromDate = settings.poBillScheduler.fromDate || campaignReportService_1.CAMPAIGN_START_DATE;
    const toDate = (0, helpers_1.formatOdooDateTime)(new Date());
    const batchSize = Math.max(1, Number(settings.poBillScheduler.batchSize || campaignReportService_1.CAMPAIGN_BATCH_SIZE));
    if (!settings.poBillScheduler.enabled) {
        const run = await (0, repositories_1.insertSchedulerRun)({
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
            const run = await (0, repositories_1.insertSchedulerRun)({
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
        const run = await (0, repositories_1.insertSchedulerRun)({
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
        const run = await (0, repositories_1.insertSchedulerRun)({
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
    let run;
    try {
        run = await (0, repositories_1.insertSchedulerRun)({
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
                timezone: env_1.env.APP_TIMEZONE,
            },
        });
    }
    catch (error) {
        schedulerRunning = false;
        throw error;
    }
    const lockAcquired = await (0, repositories_1.acquireSchedulerRunLock)(run.id);
    if (!lockAcquired) {
        const currentRuntimeState = await (0, repositories_1.getSchedulerRuntimeState)();
        const activeLock = await describeActiveSchedulerLock(currentRuntimeState);
        const activeSchedulerName = activeLock?.activeLockRun?.schedulerName || 'another scheduler run';
        const skippedRun = await (0, repositories_1.updateSchedulerRun)(run.id, {
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
    let stopRequested = false;
    const documentOutcomes = [];
    try {
        await touchActiveSchedulerRunLock(run.id);
        // compute adaptive lookahead based on recent PO bill runs
        const recentPoBillRuns = await (0, repositories_1.getRecentSchedulerRuns)(PO_BILL_ADAPTIVE_LOOKAHEAD_RUNS);
        const documentLookahead = getPoBillDocumentLookahead(recentPoBillRuns);
        // persist the computed document lookahead into the active run for diagnostics
        try {
            await (0, repositories_1.updateSchedulerRun)(run.id, {
                context: {
                    ...(run.context || {}),
                    documentLookahead,
                },
            });
        }
        catch (err) {
            // non-fatal: continue processing even if updating diagnostics fails
        }
        const recentPdfs = await (0, poBillAutomationService_1.getRecentDocumentPdfs)(client, Math.max(documentLookahead, batchSize * 20));
        const nowMs = Date.now();
        const queueCandidates = [];
        const deferredQueueCandidates = [];
        let exhaustedCount = 0;
        let cooldownBlockedCount = 0;
        let consecutiveRetryBlockedCount = 0;
        const recentlyFailedAttachmentIds = getRecentlyFailedPoBillAttachmentIds(recentRun);
        const recentlyAttemptedAttachmentIds = getRecentlyAttemptedPoBillAttachmentIds(recentRun);
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
            if (recentlyAttemptedAttachmentIds.has(Number(pdf.id))) {
                if (recentlyFailedAttachmentIds.has(Number(pdf.id))) {
                    consecutiveRetryBlockedCount += 1;
                }
                deferredQueueCandidates.push(pdf);
                continue;
            }
            queueCandidates.push(pdf);
        }
        // Rotate through the campaign. If the only eligible documents are the
        // ones from the previous run, retry them rather than leaving the queue
        // empty; otherwise prefer documents that have not just been attempted.
        if (queueCandidates.length === 0) {
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
            // fallback to attachment id ordering for stability
            return Number(left.id || 0) - Number(right.id || 0);
        })
            .slice(0, batchSize);
        for (const pdf of queue) {
            if (await isSchedulerStopRequested(run.id)) {
                stopRequested = true;
                break;
            }
            scannedCount += 1;
            await touchActiveSchedulerRunLock(run.id);
            try {
                const result = await (0, poBillAutomationService_1.runPoBillAutomation)(client, {
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
                await (0, poBillAutomationService_1.markPoBillDocumentSkipped)({
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
            }
            catch (error) {
                failedCount += 1;
                const message = error instanceof Error ? error.message : 'Unknown PO bill scheduler error.';
                await (0, poBillAutomationService_1.markPoBillDocumentSkipped)({
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
                await (0, logService_1.logEvent)('error', 'PO bill scheduler failed while processing a Finance document', {
                    schedulerRunId: run.id,
                    attachmentId: pdf.id,
                    attachmentName: pdf.name,
                    documentId: pdf.documentId || null,
                    error: message,
                });
            }
            await touchActiveSchedulerRunLock(run.id);
        }
        if (!stopRequested && failedCount === 0) {
            await (0, repositories_1.markSchedulerRunSucceeded)(run.id, runtimeState.lastCheckpointAt);
        }
        else if (!stopRequested) {
            await (0, repositories_1.markSchedulerRunFailed)(run.id, `PO bill scheduler completed with ${failedCount} failed document(s).`);
        }
        const finalRun = await (0, repositories_1.updateSchedulerRun)(run.id, {
            status: stopRequested ? 'completed' : failedCount > 0 ? 'completed_with_errors' : 'completed',
            scannedCount,
            processedCount,
            skippedCount,
            failedCount,
            summary: `${stopRequested ? 'PO bill scheduler stopped by operator. ' : ''}PO bill scheduler scanned ${scannedCount} Finance document(s), processed ${processedCount}, skipped ${skippedCount}, failed ${failedCount}${exhaustedCount > 0 ? `, ${exhaustedCount} exhausted (permanently skipped after ${settings.poBillScheduler.maxRetryAttempts} attempts)` : ''}${cooldownBlockedCount > 0 ? `, ${cooldownBlockedCount} in cooldown` : ''}${consecutiveRetryBlockedCount > 0 ? `, ${consecutiveRetryBlockedCount} held back after the previous run` : ''}.`,
            context: {
                jobType: PO_BILL_SCHEDULER_JOB_TYPE,
                schedulerName: 'PO Bill Scheduler',
                fromDate,
                toDate,
                batchSize,
                candidateFinancePdfCount: recentPdfs.length,
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
            const campaignMetrics = await (0, campaignReportService_1.computeMayCampaignMetrics)(client, settings.odoo.baseUrl);
            if (campaignMetrics.unprocessedRemaining === 0) {
                await (0, campaignReportService_1.notifyDbAdminCampaignReport)(client);
            }
        }
        catch (reportErr) {
            await (0, logService_1.logEvent)('error', 'Non-fatal error generating May campaign completion report', {
                error: reportErr instanceof Error ? reportErr.message : 'Unknown error',
            });
        }
        return { run: finalRun, scannedCount, processedCount, skippedCount, failedCount };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'PO bill scheduler failed.';
        await (0, repositories_1.markSchedulerRunFailed)(run.id, message);
        const failedRun = await (0, repositories_1.updateSchedulerRun)(run.id, {
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
    }
    finally {
        schedulerRunning = false;
        await (0, repositories_1.releaseSchedulerRunLock)(run.id);
        await (0, tempCleanup_1.cleanupStaleTempFiles)().catch(() => undefined);
    }
}
async function runSchedulerCycle(trigger = 'manual') {
    const { client, settings } = await getConfiguredSchedulerClient();
    const runtimeState = await getFreshSchedulerRuntimeState();
    const recentRunsForCooldown = await (0, repositories_1.getRecentSchedulerRuns)(20);
    const recentRun = getRecentRunForJobType(recentRunsForCooldown, SALES_ORDER_SCHEDULER_JOB_TYPE);
    const cooldownMinutes = getConfiguredSchedulerCooldownMinutes(SALES_ORDER_SCHEDULER_JOB_TYPE, settings);
    const recentSalesOrderRunsForPlanning = await (0, repositories_1.getRecentSchedulerRuns)(SO_SCHEDULER_ROUTINE_DEPRIORITIZE_RUNS);
    const routineOnlyRunStreak = getRoutineOnlySalesOrderRunStreak(recentSalesOrderRunsForPlanning);
    const adaptiveLookbackHours = getAdaptiveSalesOrderLookbackHours(routineOnlyRunStreak);
    const plannedCandidateLimit = getSalesOrderLookaheadLimit(settings.scheduler.batchSize, routineOnlyRunStreak);
    const effectiveConfirmedFromDate = computeEffectiveConfirmedFromDate(settings.scheduler.confirmedFromDate, runtimeState.lastCheckpointAt, adaptiveLookbackHours);
    if (!settings.scheduler.enabled) {
        const run = await (0, repositories_1.insertSchedulerRun)({
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
            const run = await (0, repositories_1.insertSchedulerRun)({
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
        const run = await (0, repositories_1.insertSchedulerRun)({
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
        const run = await (0, repositories_1.insertSchedulerRun)({
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
    let run;
    try {
        run = await (0, repositories_1.insertSchedulerRun)({
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
                timezone: env_1.env.APP_TIMEZONE,
            },
        });
    }
    catch (error) {
        schedulerRunning = false;
        throw error;
    }
    const lockAcquired = await (0, repositories_1.acquireSchedulerRunLock)(run.id);
    if (!lockAcquired) {
        const currentRuntimeState = await (0, repositories_1.getSchedulerRuntimeState)();
        const activeLock = await describeActiveSchedulerLock(currentRuntimeState);
        const activeSchedulerName = activeLock?.activeLockRun?.schedulerName || 'another scheduler run';
        const skippedRun = await (0, repositories_1.updateSchedulerRun)(run.id, {
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
    const orderOutcomes = [];
    let latestProcessedOrderDate = runtimeState.lastCheckpointAt;
    try {
        await touchActiveSchedulerRunLock(run.id);
        const batchSize = Math.max(1, Number(settings.scheduler.batchSize) || 1);
        const candidateLimit = plannedCandidateLimit;
        const candidateOrders = await client.getConfirmedSalesOrdersSince(effectiveConfirmedFromDate, candidateLimit);
        const recentlyRoutineOrderIds = getRecentlyRoutineSalesOrderIds(recentSalesOrderRunsForPlanning);
        const orders = chooseSalesOrderBatch(candidateOrders, batchSize, recentlyRoutineOrderIds);
        scannedCount = orders.length;
        for (const order of candidateOrders) {
            if (order.date_order && parseSchedulerDate(order.date_order) > parseSchedulerDate(latestProcessedOrderDate)) {
                latestProcessedOrderDate = order.date_order;
            }
        }
        const processOrder = async (order) => {
            try {
                await touchActiveSchedulerRunLock(run.id);
                const attachments = await client.getAttachments(order.id);
                const latestJobSummary = attachments
                    .filter((attachment) => (0, helpers_1.isJobSummaryAttachment)(attachment, settings.parser.filenameKeyword))
                    .sort(helpers_1.sortAttachmentsNewestFirst)[0];
                if (!latestJobSummary) {
                    let reminderOutcome = null;
                    const reminderWindow = getJobSummaryReminderWindowStatus();
                    if (trigger !== 'manual' && !reminderWindow.allowed) {
                        reminderOutcome = {
                            status: 'outside_daily_window',
                            reason: `Job Summary upload reminders run at 16:40 ${reminderWindow.timeZone}.`,
                            currentLocalTime: reminderWindow.label,
                            allowedWindow: reminderWindow.allowedWindow,
                            timezone: reminderWindow.timeZone,
                        };
                    }
                    else {
                        try {
                            reminderOutcome = await (0, jobSummaryReminderService_1.ensureMissingJobSummaryReminder)(client, order, settings.parser.filenameKeyword);
                        }
                        catch (reminderError) {
                            const reminderMessage = reminderError instanceof Error ? reminderError.message : 'Unknown reminder creation error.';
                            reminderOutcome = {
                                status: 'failed',
                                reason: reminderMessage,
                            };
                            await (0, logService_1.logEvent)('error', 'Scheduler could not create missing Job Summary activity', {
                                schedulerRunId: run.id,
                                orderId: order.id,
                                orderName: order.name,
                                error: reminderMessage,
                            });
                        }
                    }
                    await (0, logService_1.logEvent)('info', 'Scheduler skipped Sales Order without a matching Job Summary PDF', {
                        schedulerRunId: run.id,
                        orderId: order.id,
                        orderName: order.name,
                        reminderOutcome,
                    });
                    return {
                        result: 'skipped',
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
                let reminderCloseResult = null;
                try {
                    reminderCloseResult = await (0, jobSummaryReminderService_1.closeOpenJobSummaryReminderActivities)(client, order.id, `Job Summary PDF ${latestJobSummary.name} was detected.`);
                }
                catch (reminderError) {
                    const reminderMessage = reminderError instanceof Error ? reminderError.message : 'Unknown reminder close error.';
                    reminderCloseResult = {
                        status: 'failed',
                        reason: reminderMessage,
                    };
                    await (0, logService_1.logEvent)('warn', 'Scheduler could not close missing Job Summary activity', {
                        schedulerRunId: run.id,
                        orderId: order.id,
                        orderName: order.name,
                        attachmentId: latestJobSummary.id,
                        attachmentName: latestJobSummary.name,
                        error: reminderMessage,
                    });
                }
                await touchActiveSchedulerRunLock(run.id);
                const history = await (0, extractionService_1.extractAttachmentForOrder)(order.id, latestJobSummary.id);
                await touchActiveSchedulerRunLock(run.id);
                const sendResult = await (0, extractionService_1.sendExtractedResultToOdoo)(history.id, false);
                await touchActiveSchedulerRunLock(run.id);
                const stockResult = await (0, stockProcessingService_1.processSaleOrderStock)(order.id);
                await touchActiveSchedulerRunLock(run.id);
                if (stockResult.summary.failedCount > 0) {
                    return {
                        result: 'failed',
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
                        result: 'skipped',
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
                    result: 'processed',
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
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown scheduler error.';
                await (0, logService_1.logEvent)('error', 'Scheduler failed while processing a Sales Order', {
                    schedulerRunId: run.id,
                    orderId: order.id,
                    orderName: order.name,
                    error: message,
                });
                return {
                    result: 'failed',
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
                }
                else if (result.result === 'skipped') {
                    skippedCount += 1;
                }
                else {
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
            await (0, repositories_1.markSchedulerRunSucceeded)(run.id, latestProcessedOrderDate);
        }
        else {
            await (0, repositories_1.markSchedulerRunFailed)(run.id, `Scheduler completed with ${failedCount} failed Sales Order(s); checkpoint not advanced.`);
        }
        const finalRun = await (0, repositories_1.updateSchedulerRun)(run.id, {
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Scheduler failed.';
        await (0, repositories_1.markSchedulerRunFailed)(run.id, message);
        const failedRun = await (0, repositories_1.updateSchedulerRun)(run.id, {
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
    }
    finally {
        schedulerRunning = false;
        await (0, repositories_1.releaseSchedulerRunLock)(run.id);
    }
}
async function startSchedulerInterval() {
    const settings = await (0, repositories_1.getSettings)();
    if (!schedulerIntervalHandle &&
        env_1.env.SCHEDULER_USE_INTERVAL === 'true' &&
        settings.scheduler.enabled &&
        settings.scheduler.useInProcessInterval) {
        const intervalMs = Math.max(1, settings.scheduler.intervalMinutes) * 60 * 1000;
        schedulerIntervalHandle = setInterval(() => {
            void runSchedulerCycle('interval').catch(async (error) => {
                await (0, logService_1.logEvent)('error', 'In-process scheduler interval run failed', {
                    error: error instanceof Error ? error.message : 'Unknown interval scheduler failure.',
                });
            });
        }, intervalMs);
    }
    if (!poBillSchedulerIntervalHandle &&
        env_1.env.SCHEDULER_USE_INTERVAL === 'true' &&
        settings.poBillScheduler.enabled &&
        settings.poBillScheduler.useInProcessInterval) {
        const intervalMs = Math.max(1, settings.poBillScheduler.intervalMinutes) * 60 * 1000;
        poBillSchedulerIntervalHandle = setInterval(() => {
            void runPoBillSchedulerCycle('interval').catch(async (error) => {
                await (0, logService_1.logEvent)('error', 'In-process PO bill scheduler interval run failed', {
                    error: error instanceof Error ? error.message : 'Unknown PO bill interval scheduler failure.',
                });
            });
        }, intervalMs);
    }
}
function stopSchedulerInterval() {
    if (schedulerIntervalHandle) {
        clearInterval(schedulerIntervalHandle);
        schedulerIntervalHandle = null;
    }
    if (poBillSchedulerIntervalHandle) {
        clearInterval(poBillSchedulerIntervalHandle);
        poBillSchedulerIntervalHandle = null;
    }
}
