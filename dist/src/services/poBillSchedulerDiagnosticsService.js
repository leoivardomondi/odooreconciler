"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describePoBillQueueDocument = describePoBillQueueDocument;
exports.buildPoBillSchedulerDiagnostics = buildPoBillSchedulerDiagnostics;
const repositories_1 = require("../models/repositories");
const MAX_RETRY_ATTEMPTS = 5;
const TRANSIENT_RETRY_HOURS = 2;
const STABLE_SKIP_RETRY_HOURS = 24 * 14;
function attemptCount(pdf) {
    return Math.max(0, Number(pdf.poBillAttemptCount || 0) || 0);
}
function reasonDetails(summaryValue) {
    const summary = String(summaryValue || '').trim();
    const lower = summary.toLowerCase();
    if (!summary)
        return { category: 'Not checked', reason: 'The scheduler has not checked this document yet.' };
    if (/job summary|maxcut|max cut|not a vendor bill|not a supplier invoice/.test(lower)) {
        return { category: 'Not a vendor bill', reason: summary };
    }
    if (/timeout|network|rate limit|api key|ocr|ai extraction|could not download|failed to parse/.test(lower)) {
        return { category: 'Temporary OCR/API failure', reason: summary };
    }
    if (/no safe po bill match|no match/.test(lower)) {
        return { category: 'No safe PO match', reason: summary };
    }
    if (/gate|auto mode stopped/.test(lower)) {
        return { category: 'Automation gate failed', reason: summary };
    }
    if (/already billed|duplicate/.test(lower)) {
        return { category: 'Possible duplicate', reason: summary };
    }
    if (/chatter evidence|processed marker|verification marker/.test(lower)) {
        return { category: 'Odoo verification marker missing', reason: summary };
    }
    if (/vendor|supplier/.test(lower)) {
        return { category: 'Vendor mismatch', reason: summary };
    }
    if (/total|amount/.test(lower)) {
        return { category: 'Amount mismatch', reason: summary };
    }
    return { category: 'Needs review', reason: summary };
}
function retryHours(pdf, stable, transient, policy) {
    if (transient)
        return policy?.transientRetryHours || TRANSIENT_RETRY_HOURS;
    if (stable)
        return (policy?.stableSkipRetryDays || 14) * 24;
    const steps = policy?.retryBackoffHours?.length ? policy.retryBackoffHours : [12, 24, 48, 96, 168];
    return steps[Math.min(attemptCount(pdf), steps.length - 1)];
}
function describePoBillQueueDocument(pdf, now = Date.now(), policy) {
    const status = String(pdf.poBillStatus || '');
    const details = reasonDetails(pdf.poBillSummary);
    const attempts = attemptCount(pdf);
    if (['processed', 'processed_with_warnings'].includes(status)) {
        return { attachment: pdf, state: 'processed', label: 'Completed', reason: details.reason, reasonCategory: details.category, retryAt: null, attemptCount: attempts };
    }
    if (!status) {
        return { attachment: pdf, state: 'new', label: 'Not checked', reason: details.reason, reasonCategory: details.category, retryAt: null, attemptCount: 0 };
    }
    const stable = details.category === 'Not a vendor bill';
    const transient = details.category === 'Temporary OCR/API failure';
    if (!stable && !transient && attempts >= (policy?.maxRetryAttempts || MAX_RETRY_ATTEMPTS)) {
        return { attachment: pdf, state: 'exhausted', label: 'Retry limit reached', reason: details.reason, reasonCategory: details.category, retryAt: null, attemptCount: attempts };
    }
    const attemptedAt = pdf.poBillProcessedAt ? Date.parse(pdf.poBillProcessedAt) : 0;
    const retryAtMs = attemptedAt + retryHours(pdf, stable, transient, policy) * 60 * 60 * 1000;
    const retryAt = attemptedAt ? new Date(retryAtMs).toISOString() : null;
    if (!attemptedAt || retryAtMs <= now) {
        return {
            attachment: pdf,
            state: stable ? 'stable_skip' : 'due',
            label: stable ? 'Non-bill—periodic recheck' : 'Due for recheck',
            reason: details.reason,
            reasonCategory: details.category,
            retryAt,
            attemptCount: attempts,
        };
    }
    return { attachment: pdf, state: 'cooldown', label: 'Waiting for recheck', reason: details.reason, reasonCategory: details.category, retryAt, attemptCount: attempts };
}
function percentile(values, fraction) {
    if (!values.length)
        return 0;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))];
}
function poBillRuns(runs) {
    return runs.filter((run) => run.context.jobType === 'po_bill_matching');
}
function outcomeReasons(runs) {
    const reasons = new Map();
    for (const run of runs) {
        const outcomes = Array.isArray(run.context.documentOutcomes) ? run.context.documentOutcomes : [];
        for (const rawOutcome of outcomes) {
            if (!rawOutcome || typeof rawOutcome !== 'object')
                continue;
            const outcome = rawOutcome;
            const attachmentId = Number(outcome.attachmentId);
            if (!attachmentId || reasons.has(attachmentId))
                continue;
            const diagnostics = outcome.diagnostics && typeof outcome.diagnostics === 'object'
                ? outcome.diagnostics
                : {};
            const checks = Array.isArray(diagnostics.checks) ? diagnostics.checks : [];
            const failedChecks = checks
                .filter((rawCheck) => rawCheck && typeof rawCheck === 'object' && rawCheck.status !== 'pass')
                .map((rawCheck) => {
                const check = rawCheck;
                return `${String(check.label || 'Check')}: ${String(check.detail || '').trim()}`.trim();
            })
                .filter(Boolean);
            const summary = String(outcome.summary || '').trim();
            const detailed = failedChecks.length ? failedChecks.slice(0, 3).join(' ') : summary;
            if (detailed)
                reasons.set(attachmentId, detailed);
        }
    }
    return reasons;
}
function historicalFailureAssessment(runs) {
    const histories = new Map();
    const reasonCounts = {};
    let failureOutcomes = 0;
    for (const run of runs) {
        const outcomes = Array.isArray(run.context.documentOutcomes) ? run.context.documentOutcomes : [];
        for (const rawOutcome of outcomes) {
            if (!rawOutcome || typeof rawOutcome !== 'object')
                continue;
            const outcome = rawOutcome;
            if (String(outcome.status || '') === 'processed')
                continue;
            const attachmentId = Number(outcome.attachmentId);
            if (attachmentId && run.startedAt) {
                if (!histories.has(attachmentId))
                    histories.set(attachmentId, []);
                histories.get(attachmentId).push(new Date(run.startedAt));
            }
            const detail = String(outcome.summary || '').trim();
            const category = reasonDetails(detail).category;
            reasonCounts[category] = (reasonCounts[category] || 0) + 1;
            failureOutcomes += 1;
        }
    }
    const intervalsHours = [];
    for (const dates of histories.values()) {
        dates.sort((a, b) => a.getTime() - b.getTime());
        for (let index = 1; index < dates.length; index += 1) {
            intervalsHours.push((dates[index].getTime() - dates[index - 1].getTime()) / 3_600_000);
        }
    }
    const orderedIntervals = intervalsHours.sort((a, b) => a - b);
    const under12Hours = orderedIntervals.filter((hours) => hours < 12).length;
    return {
        failureOutcomes,
        retriedDocuments: [...histories.values()].filter((dates) => dates.length > 1).length,
        repeatIntervals: orderedIntervals.length,
        repeatsUnder12Hours: under12Hours,
        repeatsUnder12Percent: orderedIntervals.length ? Math.round((under12Hours / orderedIntervals.length) * 1000) / 10 : 0,
        medianRetryHours: Math.round(percentile(orderedIntervals, 0.5) * 10) / 10,
        minimumRetryMinutes: orderedIntervals.length ? Math.max(1, Math.round(orderedIntervals[0] * 60)) : 0,
        reasonCounts,
    };
}
async function buildPoBillSchedulerDiagnostics(documents) {
    const [settings, recentRuns] = await Promise.all([(0, repositories_1.getSettings)(), (0, repositories_1.getRecentSchedulerRuns)(5000)]);
    const runs = poBillRuns(recentRuns);
    const detailedReasons = outcomeReasons(runs);
    const queue = documents.map((document) => {
        const detailedReason = detailedReasons.get(Number(document.id));
        return describePoBillQueueDocument(detailedReason ? { ...document, poBillSummary: detailedReason } : document, Date.now(), settings.poBillScheduler);
    });
    const attention = queue.filter((item) => item.state !== 'processed');
    const historical = historicalFailureAssessment(runs);
    const completedDurations = runs
        .filter((run) => run.startedAt && run.finishedAt && run.scannedCount > 0)
        .map((run) => Math.max(0, (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))
        .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
    const p75Seconds = percentile(completedDurations, 0.75);
    const suggestedIntervalMinutes = Math.max(5, Math.min(60, Math.ceil(p75Seconds / 60) + 2));
    const reasonCounts = attention.reduce((counts, item) => {
        counts[item.reasonCategory] = (counts[item.reasonCategory] || 0) + 1;
        return counts;
    }, {});
    const recommendations = [];
    if (!settings.poBillScheduler.enabled) {
        recommendations.push('Enable the PO bill scheduler; it is currently disabled, so new Finance documents will remain unchecked.');
    }
    if (settings.poBillScheduler.intervalMinutes < suggestedIntervalMinutes) {
        recommendations.push(`Increase the interval from ${settings.poBillScheduler.intervalMinutes} to about ${suggestedIntervalMinutes} minutes. Recent document checks can take ${Math.ceil(p75Seconds)} seconds, so the current interval can overlap or be throttled.`);
    }
    else if (settings.poBillScheduler.intervalMinutes > Math.max(15, suggestedIntervalMinutes * 2) && attention.some((item) => item.state === 'new' || item.state === 'due')) {
        recommendations.push(`Reduce the interval toward ${suggestedIntervalMinutes}-${Math.max(suggestedIntervalMinutes + 5, 15)} minutes while documents are waiting.`);
    }
    else {
        recommendations.push(`The configured ${settings.poBillScheduler.intervalMinutes}-minute interval is reasonable for the observed processing duration.`);
    }
    if (!settings.poBillScheduler.useInProcessInterval) {
        recommendations.push('The in-process interval is off. Confirm that cPanel cron calls the PO bill scheduler URL; otherwise no automatic run occurs.');
    }
    if ((reasonCounts['No safe PO match'] || 0) > 0) {
        recommendations.push('Review supplier names, invoice totals, invoice dates and PO references for “No safe PO match” documents before forcing a match.');
    }
    if (historical.repeatsUnder12Percent >= 25) {
        recommendations.push(`${historical.repeatsUnder12Percent}% of historical repeat checks happened within 12 hours. Avoid repeated manual checks until the document or matching PO data changes; preserve the 12/24/48-hour retry backoff.`);
    }
    return {
        queue: attention.sort((a, b) => {
            const order = { new: 0, due: 1, cooldown: 2, exhausted: 3, stable_skip: 4, processed: 5 };
            return order[a.state] - order[b.state] || Number(b.attachment.id) - Number(a.attachment.id);
        }),
        counts: queue.reduce((counts, item) => {
            counts[item.state] += 1;
            return counts;
        }, { new: 0, due: 0, cooldown: 0, exhausted: 0, stable_skip: 0, processed: 0 }),
        reasonCounts,
        recommendations,
        configuredIntervalMinutes: settings.poBillScheduler.intervalMinutes,
        schedulerEnabled: settings.poBillScheduler.enabled,
        useInProcessInterval: settings.poBillScheduler.useInProcessInterval,
        observedRuns: completedDurations.length,
        p75DurationSeconds: Math.ceil(p75Seconds),
        suggestedIntervalMinutes,
        historical,
        retryPolicy: {
            maxRetryAttempts: settings.poBillScheduler.maxRetryAttempts,
            transientRetryHours: settings.poBillScheduler.transientRetryHours,
            retryBackoffHours: settings.poBillScheduler.retryBackoffHours,
            stableSkipRetryDays: settings.poBillScheduler.stableSkipRetryDays,
        },
    };
}
