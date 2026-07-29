"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY = void 0;
exports.closeOpenJobSummaryReminderActivities = closeOpenJobSummaryReminderActivities;
exports.ensureMissingJobSummaryReminder = ensureMissingJobSummaryReminder;
const helpers_1 = require("../utils/helpers");
const odooActivityService_1 = require("./odooActivityService");
exports.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY = 'UPLOAD JOB SUMMARY';
const EDGE_BANDING_REMINDER_THRESHOLD = 1000;
const EDGE_BANDING_LINE_PREFIX = /^\s*(?:\[[^\]]+\]\s*)?(?:edge\s+banding\s+services?|edge\s+band\s+services?)\b/i;
function relationId(value) {
    return Array.isArray(value) ? Number(value[0]) : null;
}
function relationLabel(value) {
    return Array.isArray(value) ? value[1] : '';
}
function lineDisplayName(line) {
    return relationLabel(line.product_id) || line.name || '';
}
function isEdgeBandingServiceLine(line) {
    const candidates = [lineDisplayName(line), line.name || ''];
    return candidates.some((candidate) => EDGE_BANDING_LINE_PREFIX.test(candidate));
}
function getLineAmount(line) {
    const priceTotal = Number(line.price_total);
    if (Number.isFinite(priceTotal) && priceTotal > 0) {
        return priceTotal;
    }
    const priceSubtotal = Number(line.price_subtotal);
    return Number.isFinite(priceSubtotal) ? priceSubtotal : 0;
}
function formatAmount(value) {
    return new Intl.NumberFormat('en-KE', {
        style: 'currency',
        currency: 'KES',
        maximumFractionDigits: 2,
    }).format(value);
}
function reminderAssigneeId(order) {
    return relationId(order.create_uid) || relationId(order.user_id);
}
async function closeOpenJobSummaryReminderActivities(client, orderId, feedback = 'Job Summary PDF was uploaded.') {
    const openActivities = await (0, odooActivityService_1.findOpenActivities)(client, {
        modelName: 'sale.order',
        recordId: orderId,
        summary: exports.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
    });
    if (openActivities.length === 0) {
        return { closedCount: 0, activityIds: [] };
    }
    const activityIds = openActivities.map((activity) => activity.id);
    const result = await (0, odooActivityService_1.closeActivities)(client, activityIds, feedback);
    return { ...result, activityIds };
}
async function ensureMissingJobSummaryReminder(client, order, filenameKeyword) {
    const attachments = await client.getAttachments(order.id);
    const hasJobSummary = attachments.some((attachment) => (0, helpers_1.isJobSummaryAttachment)(attachment, filenameKeyword));
    if (hasJobSummary) {
        const closeResult = await closeOpenJobSummaryReminderActivities(client, order.id, 'Job Summary PDF was detected.');
        return {
            status: closeResult.closedCount > 0 ? 'closed_after_upload' : 'has_job_summary',
            closeResult,
        };
    }
    const lines = await client.getSaleOrderLines(order.id);
    const edgeBandingLines = lines.filter((line) => !line.display_type && isEdgeBandingServiceLine(line));
    const edgeBandingTotal = edgeBandingLines.reduce((total, line) => total + getLineAmount(line), 0);
    if (edgeBandingTotal <= EDGE_BANDING_REMINDER_THRESHOLD) {
        return {
            status: 'below_threshold',
            edgeBandingTotal,
            threshold: EDGE_BANDING_REMINDER_THRESHOLD,
            edgeBandingLineCount: edgeBandingLines.length,
        };
    }
    const existingActivities = await (0, odooActivityService_1.findOpenActivities)(client, {
        modelName: 'sale.order',
        recordId: order.id,
        summary: exports.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
    });
    if (existingActivities.length > 0) {
        return {
            status: 'already_exists',
            activityId: existingActivities[0].id,
            edgeBandingTotal,
            edgeBandingLineCount: edgeBandingLines.length,
        };
    }
    const userId = reminderAssigneeId(order);
    if (!userId) {
        return {
            status: 'missing_assignee',
            edgeBandingTotal,
            edgeBandingLineCount: edgeBandingLines.length,
        };
    }
    const activityId = await (0, odooActivityService_1.createTodoActivity)(client, {
        modelName: 'sale.order',
        recordId: order.id,
        userId,
        summary: exports.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
        noteLines: [
            `Sales Order: ${order.name}`,
            `Edge banding service total: ${formatAmount(edgeBandingTotal)}`,
            `Matching edge banding line(s): ${edgeBandingLines.length}`,
            `No matching Job Summary PDF was found.`,
        ],
    });
    return {
        status: 'created',
        activityId,
        assignedUserId: userId,
        edgeBandingTotal,
        edgeBandingLineCount: edgeBandingLines.length,
    };
}
