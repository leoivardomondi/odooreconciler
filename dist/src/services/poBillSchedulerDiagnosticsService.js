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
    if (/vendor|supplier/.test(lower)) {
        return { category: 'Vendor mismatch', reason: summary };
    }
    if (/total|amount/.test(lower)) {
        return { category: 'Amount mismatch', reason: summary };
    }
    return { category: 'Needs review', reason: summary };
}
function retryHours(pdf, stable, transient) {
    if (transient)
        return TRANSIENT_RETRY_HOURS;
    if (stable)
        return STABLE_SKIP_RETRY_HOURS;
    const steps = [12, 24, 48, 96, 168];
    return steps[Math.min(attemptCount(pdf), steps.length - 1)];
}
function describePoBillQueueDocument(pdf, now = Date.now()) {
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
    if (!stable && !transient && attempts >= MAX_RETRY_ATTEMPTS) {
        return { attachment: pdf, state: 'exhausted', label: 'Retry limit reached', reason: details.reason, reasonCategory: details.category, retryAt: null, attemptCount: attempts };
    }
    const attemptedAt = pdf.poBillProcessedAt ? Date.parse(pdf.poBillProcessedAt) : 0;
    const retryAtMs = attemptedAt + retryHours(pdf, stable, transient) * 60 * 60 * 1000;
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
async function buildPoBillSchedulerDiagnostics(documents) {
    const [settings, recentRuns] = await Promise.all([(0, repositories_1.getSettings)(), (0, repositories_1.getRecentSchedulerRuns)(5000)]);
    const runs = poBillRuns(recentRuns);
    const detailedReasons = outcomeReasons(runs);
    const queue = documents.map((document) => {
        const detailedReason = detailedReasons.get(Number(document.id));
        return describePoBillQueueDocument(detailedReason ? { ...document, poBillSummary: detailedReason } : document);
    });
    const attention = queue.filter((item) => item.state !== 'processed');
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
    };
}
