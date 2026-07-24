import { SalesOrderSummary, SaleOrderLine } from '../models/types';
import { isJobSummaryAttachment } from '../utils/helpers';
import { OdooClient } from './odooClient';
import { closeActivities, createTodoActivity, findOpenActivities } from './odooActivityService';

export const JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY = 'UPLOAD JOB SUMMARY';

const EDGE_BANDING_REMINDER_THRESHOLD = 1000;
const EDGE_BANDING_LINE_PREFIX =
  /^\s*(?:\[[^\]]+\]\s*)?(?:edge\s+banding\s+services?|edge\s+band\s+services?)\b/i;

function relationId(value: [number, string] | false | null | undefined) {
  return Array.isArray(value) ? Number(value[0]) : null;
}

function relationLabel(value: [number, string] | false | null | undefined) {
  return Array.isArray(value) ? value[1] : '';
}

function lineDisplayName(line: SaleOrderLine) {
  return relationLabel(line.product_id) || line.name || '';
}

function isEdgeBandingServiceLine(line: SaleOrderLine) {
  const candidates = [lineDisplayName(line), line.name || ''];
  return candidates.some((candidate) => EDGE_BANDING_LINE_PREFIX.test(candidate));
}

function getLineAmount(line: SaleOrderLine) {
  const priceTotal = Number(line.price_total);
  if (Number.isFinite(priceTotal) && priceTotal > 0) {
    return priceTotal;
  }

  const priceSubtotal = Number(line.price_subtotal);
  return Number.isFinite(priceSubtotal) ? priceSubtotal : 0;
}

function formatAmount(value: number) {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(value);
}

function reminderAssigneeId(order: SalesOrderSummary) {
  return relationId(order.create_uid) || relationId(order.user_id);
}

export async function closeOpenJobSummaryReminderActivities(
  client: OdooClient,
  orderId: number,
  feedback = 'Job Summary PDF was uploaded.',
) {
  const openActivities = await findOpenActivities(client, {
    modelName: 'sale.order',
    recordId: orderId,
    summary: JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
  });

  if (openActivities.length === 0) {
    return { closedCount: 0, activityIds: [] as number[] };
  }

  const activityIds = openActivities.map((activity) => activity.id);
  const result = await closeActivities(client, activityIds, feedback);
  return { ...result, activityIds };
}

export async function ensureMissingJobSummaryReminder(
  client: OdooClient,
  order: SalesOrderSummary,
  filenameKeyword: string,
) {
  const attachments = await client.getAttachments(order.id);
  const hasJobSummary = attachments.some((attachment) => isJobSummaryAttachment(attachment, filenameKeyword));
  if (hasJobSummary) {
    const closeResult = await closeOpenJobSummaryReminderActivities(
      client,
      order.id,
      'Job Summary PDF was detected.',
    );
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

  const existingActivities = await findOpenActivities(client, {
    modelName: 'sale.order',
    recordId: order.id,
    summary: JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
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

  const activityId = await createTodoActivity(client, {
    modelName: 'sale.order',
    recordId: order.id,
    userId,
    summary: JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
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
