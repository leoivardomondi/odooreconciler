import { AttachmentInfo, SalesOrderSummary, SaleOrderLine } from '../models/types';
import { isJobSummaryAttachment } from '../utils/helpers';
import { OdooClient } from './odooClient';
import {
  closeActivities,
  createTodoActivity,
  findOpenActivities,
  stripSummaryTimestamp,
  type MailActivitySummary,
} from './odooActivityService';

export const JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY = 'UPLOAD JOB SUMMARY';

export const MISSING_JOB_SUMMARY_ACTIVITY_PATTERNS = [
  'upload job summary',
  'await job summary',
  'job summary required',
  'job summary missing',
] as const;

const EDGE_BANDING_REMINDER_THRESHOLD = 1000;
const EDGE_BANDING_LINE_PREFIX =
  /^\s*(?:\[[^\]]+\]\s*)?(?:edge\s+banding\s+services?|edge\s+band\s+services?)\b/i;

// Per-Sales-Order in-flight lock and short-term cache to prevent duplicate
// activities or notes within the same scheduler run or concurrent webhook calls.
const inFlightMissingJsLocks = new Map<number, Promise<unknown>>();
const recentMissingJsSoNoteCache = new Map<number, number>();
const recentMissingJsActivityCache = new Map<number, { activityId: number; at: number }>();
const IN_MEMORY_DEDUPE_TTL_MS = 10 * 60 * 1000;

export function resetMissingJobSummaryDedupeCaches() {
  inFlightMissingJsLocks.clear();
  recentMissingJsSoNoteCache.clear();
  recentMissingJsActivityCache.clear();
}

export async function withSaleOrderMissingJsLock<T>(
  saleOrderId: number,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = inFlightMissingJsLocks.get(saleOrderId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => current);
  inFlightMissingJsLocks.set(saleOrderId, chained);

  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (inFlightMissingJsLocks.get(saleOrderId) === chained) {
      inFlightMissingJsLocks.delete(saleOrderId);
    }
  }
}

export function isMissingJobSummaryActivitySummary(summary: string | null | undefined): boolean {
  const clean = stripSummaryTimestamp(String(summary || ''));
  if (!clean) return false;
  return MISSING_JOB_SUMMARY_ACTIVITY_PATTERNS.some((pattern) => clean.includes(pattern));
}

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
  return relationId(order.user_id) || relationId(order.create_uid);
}

/**
 * Checks whether ANY open missing-Job-Summary activity already exists for this Sales Order
 * (either directly on `sale.order` or on any linked `purchase.order`).
 * Enforces the rule: at most ONE missing Job Summary activity per Sales Order.
 */
export async function findAnyOpenMissingJobSummaryActivity(
  client: OdooClient,
  input: {
    saleOrderId: number;
    saleOrderName?: string | null;
    purchaseOrderId?: number | null;
  },
): Promise<{
  exists: boolean;
  activityId: number | null;
  sourceModel: 'sale.order' | 'purchase.order' | null;
  summary: string | null;
}> {
  const now = Date.now();
  const cached = recentMissingJsActivityCache.get(input.saleOrderId);
  if (cached && now - cached.at < IN_MEMORY_DEDUPE_TTL_MS) {
    return {
      exists: true,
      activityId: cached.activityId,
      sourceModel: 'sale.order',
      summary: JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
    };
  }

  // 1. Check all open activities on the Sales Order itself
  const soActivities = await findOpenActivities(client, {
    modelName: 'sale.order',
    recordId: input.saleOrderId,
  }).catch(() => [] as MailActivitySummary[]);
  const matchingSoActivity = soActivities.find((act) => isMissingJobSummaryActivitySummary(act.summary));
  if (matchingSoActivity) {
    recentMissingJsActivityCache.set(input.saleOrderId, { activityId: matchingSoActivity.id, at: Date.now() });
    return {
      exists: true,
      activityId: matchingSoActivity.id,
      sourceModel: 'sale.order',
      summary: String(matchingSoActivity.summary || ''),
    };
  }

  // 2. Check open activities on the specific PO (if provided) and any sibling POs linked to the same SO
  const poIdsToCheck = new Set<number>();
  if (input.purchaseOrderId && input.purchaseOrderId > 0) {
    poIdsToCheck.add(input.purchaseOrderId);
  }
  const cleanSoName = String(input.saleOrderName || '').trim();
  if (cleanSoName) {
    const linkedPos = await client
      .searchReadRecords<{ id: number }>('purchase.order', {
        domain: [
          ['origin', 'ilike', cleanSoName],
          ['state', '!=', 'cancel'],
        ],
        fields: ['id'],
        limit: 20,
      })
      .catch(() => []);
    for (const po of linkedPos) {
      if (po?.id) poIdsToCheck.add(po.id);
    }
  }

  if (poIdsToCheck.size > 0) {
    const poActivities = await client
      .searchReadRecords<MailActivitySummary>('mail.activity', {
        domain: [
          ['res_model', '=', 'purchase.order'],
          ['res_id', 'in', Array.from(poIdsToCheck)],
        ],
        fields: ['id', 'summary', 'note', 'user_id', 'date_deadline', 'create_date'],
        limit: 50,
        order: 'id desc',
      })
      .catch(() => [] as MailActivitySummary[]);
    const matchingPoActivity = poActivities.find((act) => isMissingJobSummaryActivitySummary(act.summary));
    if (matchingPoActivity) {
      recentMissingJsActivityCache.set(input.saleOrderId, { activityId: matchingPoActivity.id, at: Date.now() });
      return {
        exists: true,
        activityId: matchingPoActivity.id,
        sourceModel: 'purchase.order',
        summary: String(matchingPoActivity.summary || ''),
      };
    }
  }

  return { exists: false, activityId: null, sourceModel: null, summary: null };
}

export function recordMissingJobSummaryActivityCreated(saleOrderId: number, activityId: number) {
  recentMissingJsActivityCache.set(saleOrderId, { activityId, at: Date.now() });
}

/**
 * Checks whether ANY missing-Job-Summary chatter note already exists on the Sales Order
 * (including older mirrored PO notes or prior "Job Summary Required" notes).
 */
export async function hasExistingMissingJobSummaryChatterNote(
  client: OdooClient,
  saleOrderId: number,
): Promise<boolean> {
  const cachedAt = recentMissingJsSoNoteCache.get(saleOrderId);
  if (cachedAt && Date.now() - cachedAt < IN_MEMORY_DEDUPE_TTL_MS) {
    return true;
  }

  try {
    const existing = await client.searchReadRecords<{ id: number }>('mail.message', {
      domain: [
        ['model', '=', 'sale.order'],
        ['res_id', '=', saleOrderId],
        '|',
        '|',
        ['body', 'ilike', 'Job Summary Required'],
        ['body', 'ilike', 'Job Summary Missing Alert'],
        ['body', 'ilike', 'no Job Summary PDF is attached'],
      ],
      fields: ['id'],
      limit: 1,
    });
    if (Array.isArray(existing) && existing.length > 0) {
      recentMissingJsSoNoteCache.set(saleOrderId, Date.now());
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Posts at most ONE missing-Job-Summary chatter note on the Sales Order using the concise
 * "Job Summary Required" format (never mirrored from PO chatter and never duplicated across runs).
 */
export async function postSingleMissingJobSummarySaleOrderNote(
  client: OdooClient,
  input: {
    saleOrderId: number;
    poName?: string | null;
  },
): Promise<{ posted: boolean; reason: 'posted' | 'already_exists' }> {
  const alreadyExists = await hasExistingMissingJobSummaryChatterNote(client, input.saleOrderId);
  if (alreadyExists) {
    return { posted: false, reason: 'already_exists' };
  }

  const cleanPoName = String(input.poName || '').trim();
  const bodyHtml = cleanPoName
    ? `<p>⚠️ <strong>Job Summary Required for PO ${cleanPoName}:</strong></p>` +
      `<p>Purchase Order <strong>${cleanPoName}</strong> is confirmed, but no Job Summary PDF is attached to this Sales Order. Please attach the Job Summary PDF ASAP in this log note area so procurement can be verified.</p>`
    : `<p>⚠️ <strong>Job Summary Required:</strong></p>` +
      `<p>No Job Summary PDF is attached to this Sales Order. Please attach the Job Summary PDF ASAP in this log note area so production and procurement can be verified.</p>`;

  await client.postModelChatterMessage(
    'sale.order',
    input.saleOrderId,
    bodyHtml,
    undefined,
    { skipSoSync: true },
  );
  recentMissingJsSoNoteCache.set(input.saleOrderId, Date.now());
  return { posted: true, reason: 'posted' };
}

export async function closeOpenJobSummaryReminderActivities(
  client: OdooClient,
  orderId: number,
  feedback = 'Job Summary PDF was uploaded.',
  saleOrderName?: string | null,
) {
  recentMissingJsActivityCache.delete(orderId);
  const openSoActivities = await findOpenActivities(client, {
    modelName: 'sale.order',
    recordId: orderId,
  });
  const matchingSoIds = openSoActivities
    .filter((act) => isMissingJobSummaryActivitySummary(act.summary))
    .map((act) => act.id);

  let matchingPoIds: number[] = [];
  const cleanSoName = String(saleOrderName || '').trim();
  if (cleanSoName) {
    const linkedPos = await client
      .searchReadRecords<{ id: number }>('purchase.order', {
        domain: [
          ['origin', 'ilike', cleanSoName],
          ['state', '!=', 'cancel'],
        ],
        fields: ['id'],
        limit: 20,
      })
      .catch(() => []);
    if (linkedPos.length > 0) {
      const poActivities = await client
        .searchReadRecords<MailActivitySummary>('mail.activity', {
          domain: [
            ['res_model', '=', 'purchase.order'],
            ['res_id', 'in', linkedPos.map((p) => p.id)],
          ],
          fields: ['id', 'summary'],
          limit: 50,
        })
        .catch(() => [] as MailActivitySummary[]);
      matchingPoIds = poActivities
        .filter((act) => isMissingJobSummaryActivitySummary(act.summary))
        .map((act) => act.id);
    }
  }

  const allIds = [...new Set([...matchingSoIds, ...matchingPoIds])];
  if (allIds.length === 0) {
    return { closedCount: 0, activityIds: [] as number[] };
  }

  const result = await closeActivities(client, allIds, feedback);
  return { ...result, activityIds: allIds };
}

export async function ensureMissingJobSummaryReminder(
  client: OdooClient,
  order: SalesOrderSummary,
  filenameKeyword: string,
  preloadedAttachments?: AttachmentInfo[],
) {
  return withSaleOrderMissingJsLock(order.id, async () => {
    const attachments = preloadedAttachments ?? (await client.getAttachments(order.id));
    const hasJobSummary = attachments.some((attachment) => isJobSummaryAttachment(attachment, filenameKeyword));
    if (hasJobSummary) {
      const closeResult = await closeOpenJobSummaryReminderActivities(
        client,
        order.id,
        'Job Summary PDF was detected.',
        order.name,
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

    // Unified check across BOTH sale.order and any linked purchase.order:
    // never duplicate an existing missing-Job-Summary activity or note.
    const existingAny = await findAnyOpenMissingJobSummaryActivity(client, {
      saleOrderId: order.id,
      saleOrderName: order.name,
    });
    if (existingAny.exists) {
      return {
        status: 'already_exists',
        activityId: existingAny.activityId,
        sourceModel: existingAny.sourceModel,
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
        `No matching Job Summary PDF was found. Please attach the Job Summary PDF ASAP in this log note area.`,
      ],
    });
    recordMissingJobSummaryActivityCreated(order.id, activityId);

    const noteResult = await postSingleMissingJobSummarySaleOrderNote(client, {
      saleOrderId: order.id,
    }).catch(() => ({ posted: false, reason: 'already_exists' as const }));

    return {
      status: 'created',
      activityId,
      notePosted: noteResult.posted,
      assignedUserId: userId,
      edgeBandingTotal,
      edgeBandingLineCount: edgeBandingLines.length,
    };
  });
}
