"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSchedulerSuggestion = generateSchedulerSuggestion;
exports.getSchedulerFailureReport = getSchedulerFailureReport;
exports.generateSchedulerFailureCsv = generateSchedulerFailureCsv;
exports.renderSchedulerFailurePdf = renderSchedulerFailurePdf;
const pdfkit_1 = __importDefault(require("pdfkit"));
const db_1 = require("../models/db");
function parseJsonContext(contextJson) {
    try {
        return JSON.parse(contextJson || '{}');
    }
    catch {
        return {};
    }
}
function generateSchedulerSuggestion(status, summary, errorMessage, context) {
    const text = `${summary || ''} ${errorMessage || ''} ${JSON.stringify(context || {})}`.toLowerCase();
    if (text.includes('outside allowed time window')) {
        return {
            diagnosis: 'Outside Allowed Operating Hours',
            suggestion: 'Normal business logic: Routine sales order and PO bill schedulers auto-pause outside 08:00–17:00 Nairobi time. Adjust cron schedule if night runs are required.',
        };
    }
    if (text.includes('already in progress') || text.includes('persistent scheduler lock') || text.includes('cleared inactive scheduler')) {
        return {
            diagnosis: 'Persistent Lock / Concurrent Run Lockout',
            suggestion: 'A previous run got stuck or was interrupted by a server restart. The lock auto-expires in 10 minutes, or you can click "Clear Lock" in Settings.',
        };
    }
    if (text.includes('disabled')) {
        return {
            diagnosis: 'Scheduler Job Disabled in Settings',
            suggestion: 'This background scheduler is currently toggled OFF. Go to Settings -> Background Schedulers to enable it.',
        };
    }
    if (text.includes('throttled') || text.includes('cooldown')) {
        return {
            diagnosis: 'Cooldown / Rate Limit Active',
            suggestion: 'Run skipped to prevent flooding Odoo API. Wait for the cooldown period to pass or trigger a manual run from Dashboard.',
        };
    }
    if (text.includes('leovard') || text.includes('no active user found')) {
        return {
            diagnosis: 'Recipient Email Configuration Issue',
            suggestion: 'The email automation recipient lookup failed. Ensure an active user with dbadmin or admin email is registered under Settings -> Approved Users.',
        };
    }
    if (text.includes('invalid scheduler token') || text.includes('403') || text.includes('unauthorized')) {
        return {
            diagnosis: 'Authentication / Security Token Mismatch',
            suggestion: 'The cron trigger token or user session is invalid. Verify the Cron Secret Token in Settings -> Background Schedulers.',
        };
    }
    if (text.includes('connection') || text.includes('econnrefused') || text.includes('etimedout') || text.includes('xmlrpc')) {
        return {
            diagnosis: 'Odoo Connection / Network Timeout',
            suggestion: 'The server could not reach the Odoo XML-RPC endpoint. Check internet/firewall connectivity and test credentials under Settings -> Odoo Credentials.',
        };
    }
    if (text.includes('no safe po bill match') || text.includes('no safe match')) {
        return {
            diagnosis: 'Unmatched PO Bill Invoice',
            suggestion: 'The AI invoice parser did not find a matching open Purchase Order. Review the document manually under PO Bill Reconciliation.',
        };
    }
    if (status === 'failed') {
        return {
            diagnosis: 'Execution Runtime Error',
            suggestion: 'Inspect system logs for the full stack trace. Verify Odoo database state and external API credentials.',
        };
    }
    return {
        diagnosis: 'Operational Notice',
        suggestion: 'Review run diagnostics context for details.',
    };
}
async function getSchedulerFailureReport(scope) {
    const now = new Date();
    let fromDate;
    let toDate;
    let rangeLabel;
    if (scope?.fromDate && scope?.toDate && /^\d{4}-\d{2}-\d{2}$/.test(scope.fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(scope.toDate)) {
        fromDate = scope.fromDate;
        toDate = scope.toDate;
        rangeLabel = `${fromDate} to ${toDate}`;
    }
    else if (scope?.range === 'daily') {
        fromDate = now.toISOString().slice(0, 10);
        toDate = fromDate;
        rangeLabel = `Daily (${fromDate})`;
    }
    else {
        // Default weekly (last 7 days)
        const end = new Date(now);
        const start = new Date(now);
        start.setDate(end.getDate() - 6);
        fromDate = start.toISOString().slice(0, 10);
        toDate = end.toISOString().slice(0, 10);
        rangeLabel = `Weekly (${fromDate} to ${toDate})`;
    }
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, status, trigger_source, started_at, finished_at,
        scanned_count, processed_count, skipped_count, failed_count,
        summary, error_message, context_json
      FROM scheduler_runs
      WHERE started_at >= ? AND started_at <= ?
        AND (status IN ('failed', 'completed_with_errors', 'skipped') OR failed_count > 0)
      ORDER BY started_at DESC
    `, [`${fromDate} 00:00:00`, `${toDate} 23:59:59`]);
    let failedCount = 0;
    let skippedCount = 0;
    let completedWithErrorsCount = 0;
    const items = rows.map((r) => {
        if (r.status === 'failed')
            failedCount++;
        else if (r.status === 'skipped')
            skippedCount++;
        else if (r.status === 'completed_with_errors' || r.failed_count > 0)
            completedWithErrorsCount++;
        const ctx = parseJsonContext(r.context_json);
        const schedulerName = ctx.schedulerName || (ctx.jobType === 'po_bill_scheduler' ? 'PO Bill Scheduler' : 'Sales Order Scheduler');
        const jobType = ctx.jobType || 'scheduler';
        const reason = r.summary || r.error_message || 'Job did not complete cleanly.';
        const errorMessage = r.error_message || '';
        const { diagnosis, suggestion } = generateSchedulerSuggestion(r.status, reason, errorMessage, ctx);
        return {
            id: r.id,
            schedulerName,
            jobType,
            trigger: r.trigger_source,
            startedAt: r.started_at,
            finishedAt: r.finished_at,
            status: r.status,
            scannedCount: r.scanned_count || 0,
            processedCount: r.processed_count || 0,
            skippedCount: r.skipped_count || 0,
            failedCount: r.failed_count || 0,
            reason,
            errorMessage,
            diagnosis,
            suggestion,
        };
    });
    return {
        generatedAt: new Date().toISOString(),
        rangeLabel,
        fromDate,
        toDate,
        totalRuns: items.length,
        failedCount,
        skippedCount,
        completedWithErrorsCount,
        items,
    };
}
function generateSchedulerFailureCsv(report) {
    const headers = [
        'Run ID',
        'Started At',
        'Finished At',
        'Scheduler Name',
        'Trigger',
        'Status',
        'Scanned',
        'Processed',
        'Skipped',
        'Failed',
        'Diagnosis',
        'Reason / Error',
        'Suggested Solution',
    ];
    const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
    const rows = report.items.map((i) => [
        escape(i.id),
        escape(i.startedAt),
        escape(i.finishedAt || '-'),
        escape(i.schedulerName),
        escape(i.trigger),
        escape(i.status),
        i.scannedCount,
        i.processedCount,
        i.skippedCount,
        i.failedCount,
        escape(i.diagnosis),
        escape(i.reason),
        escape(i.suggestion),
    ]);
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
async function renderSchedulerFailurePdf(report) {
    const document = new pdfkit_1.default({ size: 'A4', margin: 36, bufferPages: true });
    const chunks = [];
    document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    const done = new Promise((resolve, reject) => {
        document.on('end', () => resolve(Buffer.concat(chunks)));
        document.on('error', reject);
    });
    const navy = '#1e293b';
    const muted = '#64748b';
    const border = '#cbd5e1';
    document.font('Helvetica-Bold').fontSize(16).fillColor(navy).text('SCHEDULER FAILURES & DIAGNOSTIC ANALYSIS REPORT');
    document.font('Helvetica').fontSize(9).fillColor(muted).text(`Range: ${report.rangeLabel}  |  Generated: ${new Date(report.generatedAt).toLocaleString()}`);
    document.moveDown(0.8);
    document.rect(36, document.y, 523, 48).fillAndStroke('#f8fafc', border);
    const curY = document.y - 40;
    document.font('Helvetica-Bold').fontSize(9).fillColor(navy).text(`Total Issue Runs: ${report.totalRuns}   |   Failed: ${report.failedCount}   |   Completed with Errors: ${report.completedWithErrorsCount}   |   Skipped: ${report.skippedCount}`, 48, curY);
    document.y = curY + 28;
    document.moveDown(1);
    if (report.items.length === 0) {
        document.font('Helvetica-Oblique').fontSize(10).fillColor('#166534').text('No scheduler failures or issues recorded for this period. All background jobs completed cleanly!');
    }
    else {
        report.items.forEach((item, index) => {
            if (document.y + 90 > 770)
                document.addPage();
            const y = document.y;
            const isError = item.status === 'failed' || item.status === 'completed_with_errors' || item.failedCount > 0;
            const accent = isError ? '#ef4444' : '#f59e0b';
            document.rect(36, y, 523, 75).fillAndStroke('#ffffff', border);
            document.rect(36, y, 5, 75).fill(accent);
            document.font('Helvetica-Bold').fontSize(10).fillColor(navy).text(`${index + 1}. ${item.schedulerName} (${item.status.toUpperCase()})`, 48, y + 8);
            document.font('Helvetica').fontSize(8).fillColor(muted).text(`Started: ${item.startedAt} | Trigger: ${item.trigger} | Run ID: ${item.id}`, 48, y + 22);
            document.font('Helvetica-Bold').fontSize(8.5).fillColor('#b91c1c').text(`Diagnosis: ${item.diagnosis}`, 48, y + 36);
            document.font('Helvetica').fontSize(8).fillColor('#334155').text(`Reason: ${item.reason.slice(0, 110)}`, 48, y + 48, { width: 500, lineBreak: false });
            document.font('Helvetica-Oblique').fontSize(8).fillColor('#15803d').text(`Suggestion: ${item.suggestion.slice(0, 120)}`, 48, y + 60, { width: 500, lineBreak: false });
            document.y = y + 82;
        });
    }
    document.end();
    return done;
}
