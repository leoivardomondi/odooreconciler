import { Response, Router } from 'express';
import { getSettings } from '../models/repositories';
import { AppSettings, HistoryEntry, SalesOrderListItem, StockProcessingRunResult } from '../models/types';
import {
  extractAttachmentForOrder,
  extractLatestJobSummaryForOrder,
  getRecentOrderHistory,
} from '../services/extractionService';
import {
  ensureMissingJobSummaryReminder,
  JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY,
} from '../services/jobSummaryReminderService';
import { OdooClient } from '../services/odooClient';
import {
  previewSaleOrderStockProcessing,
  processSaleOrderStock,
  reverseSaleOrderStockAdditions,
} from '../services/stockProcessingService';
import {
  hasOdooConfiguration,
  isJobSummaryAttachment,
  isPdfAttachment,
  resolveFieldMappings,
  sanitizeBaseUrl,
} from '../utils/helpers';

const router = Router();

async function buildClient() {
  const settings = await getSettings();

  if (!hasOdooConfiguration(settings)) {
    throw new Error('Odoo is not configured yet. Complete setup first.');
  }

  return {
    settings,
    client: new OdooClient({
      baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
      database: settings.odoo.database,
      username: settings.odoo.username,
      apiKey: settings.odoo.apiKey,
    }),
  };
}

async function buildSalesOrderListItems(
  client: OdooClient,
  settings: AppSettings,
  orderSummaries: Awaited<ReturnType<OdooClient['searchSalesOrders']>>,
): Promise<SalesOrderListItem[]> {
  const availableFields = await client.getSaleOrderFields();
  const mappings = resolveFieldMappings(settings.fieldMappings, availableFields);

  return Promise.all(
    orderSummaries.map(async (order) => {
      const [attachments, history, handoff] = await Promise.all([
        client.getAttachments(order.id).catch(() => []),
        Promise.resolve(getRecentOrderHistory(order.id)),
        client.getSaleOrderStockHandoff(order.id, mappings).catch(() => null),
      ]);
      const hasJobSummary = attachments.some((attachment) =>
        isJobSummaryAttachment(attachment, settings.parser.filenameKeyword),
      );
      const extracted = history.some((entry: HistoryEntry) =>
        ['parsed', 'parsed_empty', 'sent_to_odoo', 'signature_unchanged_skipped'].includes(entry.status),
      );
      const sentToOdoo = history.some((entry: HistoryEntry) => entry.status === 'sent_to_odoo');
      const processedStock =
        Boolean(handoff?.stockProcessed) ||
        Boolean(handoff?.stockSignature?.trim()) ||
        history.some((entry: HistoryEntry) => {
          const summary = entry.summary?.toLowerCase() || '';
          return summary.includes('stock processing') || summary.includes('stock reconciliation');
        });
      const addedStock =
        Boolean(handoff?.stockProcessed) &&
        Boolean(handoff?.stockSignature?.trim()) &&
        handoff?.signature?.trim() === handoff?.stockSignature?.trim();

      return {
        ...order,
        appStatus: {
          hasJobSummary,
          extracted,
          sentToOdoo,
          processedStock,
          addedStock,
        },
      };
    }),
  );
}

function buildOrderQuerySuffix(query: string, page = 1): string {
  const params = [];
  if (query) {
    params.push(`q=${encodeURIComponent(query)}`);
  }
  if (page > 1) {
    params.push(`page=${page}`);
  }
  return params.length ? `?${params.join('&')}` : '';
}

function formatMoney(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 'KES 0';
  }

  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 2,
  }).format(amount);
}

function describeJobSummaryReminderOutcome(outcome: Record<string, unknown>) {
  const status = String(outcome.status || '');

  if (status === 'created') {
    return {
      type: 'success',
      message: `Created Odoo To Do activity "${JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY}" for this Sales Order.`,
    };
  }

  if (status === 'already_exists') {
    return {
      type: 'info',
      message: `An open "${JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY}" activity already exists for this Sales Order.`,
    };
  }

  if (status === 'closed_after_upload') {
    return {
      type: 'success',
      message: `Job Summary PDF is already detected; closed the open "${JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY}" activity.`,
    };
  }

  if (status === 'has_job_summary') {
    return {
      type: 'info',
      message: 'Job Summary PDF is already detected, so no upload reminder is needed.',
    };
  }

  if (status === 'below_threshold') {
    return {
      type: 'warning',
      message: `No activity created. Edge banding service lines total ${formatMoney(outcome.edgeBandingTotal)}, which must be above ${formatMoney(outcome.threshold)}.`,
    };
  }

  if (status === 'missing_assignee') {
    return {
      type: 'danger',
      message: 'No activity created. The Sales Order has no creator or salesperson to assign the reminder to.',
    };
  }

  return {
    type: 'info',
    message: `Reminder check completed with status: ${status || 'unknown'}.`,
  };
}

async function renderSalesOrderDetailsPage(
  res: Response,
  options: {
    orderId: number;
    query: string;
    page?: number;
    status: { type: string; message: string } | null;
    stockResult?: StockProcessingRunResult | null;
  },
) {
  const { client, settings } = await buildClient();
  const order = await client.getSaleOrder(options.orderId);
  const orderedResults = await client.searchSalesOrders(options.query, 200);
  const currentIndex = orderedResults.findIndex((entry) => entry.id === options.orderId);
  const previousOrder = currentIndex > 0 ? orderedResults[currentIndex - 1] : null;
  const nextOrder =
    currentIndex >= 0 && currentIndex < orderedResults.length - 1
      ? orderedResults[currentIndex + 1]
      : null;
  const attachments = await client.getAttachments(options.orderId);
  const decoratedAttachments = attachments.map((attachment) => ({
    ...attachment,
    isPdf: isPdfAttachment(attachment),
    isJobSummary: isJobSummaryAttachment(attachment, settings.parser.filenameKeyword),
  }));

  res.render('sales-order-details', {
    pageTitle: `Sales Order ${order.name}`,
    order,
    attachments: decoratedAttachments,
    status: options.status,
    query: options.query,
    page: options.page || 1,
    previousOrder,
    nextOrder,
    history: await getRecentOrderHistory(options.orderId),
    filenameKeyword: settings.parser.filenameKeyword,
    stockResult: options.stockResult || null,
  });
}

router.get('/sales-orders', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const shouldLoad = req.query.load === '1' || query.length > 0 || page > 1;

  if (!shouldLoad) {
    res.render('sales-orders', {
      pageTitle: 'Sales Orders',
      query,
      orders: [],
      page,
      hasPreviousPage: false,
      hasNextPage: false,
      hasLoaded: false,
      status: null,
    });
    return;
  }

  try {
    const { client, settings } = await buildClient();
    const orderSummaries = await client.searchSalesOrders(query, pageSize + 1, offset);
    const hasNextPage = orderSummaries.length > pageSize;
    const visibleOrders = orderSummaries.slice(0, pageSize);
    const orders = await buildSalesOrderListItems(client, settings, visibleOrders);

    res.render('sales-orders', {
      pageTitle: 'Sales Orders',
      query,
      orders,
      page,
      hasPreviousPage: page > 1,
      hasNextPage,
      hasLoaded: true,
      status: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load Sales Orders.';
    res.status(500).render('sales-orders', {
      pageTitle: 'Sales Orders',
      query,
      orders: [],
      page,
      hasPreviousPage: page > 1,
      hasNextPage: false,
      hasLoaded: true,
      status: { type: 'danger', message },
    });
  }
});

router.get('/sales-orders/:orderId', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const query = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const message = typeof req.query.message === 'string' ? req.query.message : '';
  const error = typeof req.query.error === 'string' ? req.query.error : '';

  try {
    await renderSalesOrderDetailsPage(res, {
      orderId,
      query,
      page,
      status: message
        ? { type: 'success', message }
        : error
          ? { type: 'danger', message: error }
          : null,
      stockResult: null,
    });
  } catch (caughtError) {
    const details = caughtError instanceof Error ? caughtError.message : 'Could not load order.';
    res.status(500).render('error', {
      pageTitle: 'Sales Order Error',
      errorMessage: details,
      details: [],
    });
  }
});

router.post('/sales-orders/:orderId/stock/preview', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const query = String(req.body.q || '').trim();
  const page = Math.max(1, Number(req.body.page || 1) || 1);

  try {
    const stockResult = await previewSaleOrderStockProcessing(orderId);
    await renderSalesOrderDetailsPage(res, {
      orderId,
      query,
      page,
      status: { type: 'info', message: stockResult.statusMessage },
      stockResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not preview stock reconciliation.';
    try {
      await renderSalesOrderDetailsPage(res, {
        orderId,
        query,
        page,
        status: { type: 'danger', message },
        stockResult: null,
      });
    } catch {
      res.redirect(
        `/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${
          buildOrderQuerySuffix(query, page) ? '&' : '?'
        }error=${encodeURIComponent(message)}`,
      );
    }
  }
});

router.post('/sales-orders/:orderId/stock/process', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const query = String(req.body.q || '').trim();
  const page = Math.max(1, Number(req.body.page || 1) || 1);

  try {
    const stockResult = await processSaleOrderStock(orderId);
    await renderSalesOrderDetailsPage(res, {
      orderId,
      query,
      page,
      status: {
        type: stockResult.summary.failedCount > 0 ? 'warning' : 'success',
        message: stockResult.statusMessage,
      },
      stockResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not run stock reconciliation.';
    try {
      await renderSalesOrderDetailsPage(res, {
        orderId,
        query,
        page,
        status: { type: 'danger', message },
        stockResult: null,
      });
    } catch {
      res.redirect(
        `/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${
          buildOrderQuerySuffix(query, page) ? '&' : '?'
        }error=${encodeURIComponent(message)}`,
      );
    }
  }
});

router.post('/sales-orders/:orderId/stock/reverse', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const query = String(req.body.q || '').trim();
  const page = Math.max(1, Number(req.body.page || 1) || 1);

  try {
    const reverseResult = await reverseSaleOrderStockAdditions(orderId);
    await renderSalesOrderDetailsPage(res, {
      orderId,
      query,
      page,
      status: {
        type: reverseResult.reversedCount > 0 ? 'warning' : 'info',
        message: reverseResult.message,
      },
      stockResult: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not reverse stock additions.';
    try {
      await renderSalesOrderDetailsPage(res, {
        orderId,
        query,
        page,
        status: { type: 'danger', message },
        stockResult: null,
      });
    } catch {
      res.redirect(
        `/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${
          buildOrderQuerySuffix(query, page) ? '&' : '?'
        }error=${encodeURIComponent(message)}`,
      );
    }
  }
});

router.post('/sales-orders/:orderId/job-summary-reminder/run', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const query = String(req.body.q || '').trim();
  const page = Math.max(1, Number(req.body.page || 1) || 1);

  try {
    const { client, settings } = await buildClient();
    const order = await client.getSaleOrder(orderId);
    const outcome = await ensureMissingJobSummaryReminder(
      client,
      order,
      settings.parser.filenameKeyword,
    );
    const status = describeJobSummaryReminderOutcome(outcome as Record<string, unknown>);

    await renderSalesOrderDetailsPage(res, {
      orderId,
      query,
      page,
      status,
      stockResult: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not run the Job Summary reminder check.';
    try {
      await renderSalesOrderDetailsPage(res, {
        orderId,
        query,
        page,
        status: { type: 'danger', message },
        stockResult: null,
      });
    } catch {
      res.redirect(
        `/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${
          buildOrderQuerySuffix(query, page) ? '&' : '?'
        }error=${encodeURIComponent(message)}`,
      );
    }
  }
});

router.post('/sales-orders/:orderId/extract-latest', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const query = String(req.body.q || '').trim();
  const page = Math.max(1, Number(req.body.page || 1) || 1);

  try {
    const history = await extractLatestJobSummaryForOrder(orderId);
    res.redirect(`/extractions/${history.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not extract the latest Job Summary.';
    res.redirect(
      `/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${
        buildOrderQuerySuffix(query, page) ? '&' : '?'
      }error=${encodeURIComponent(message)}`,
    );
  }
});

router.post('/sales-orders/:orderId/extract-selected', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const attachmentId = Number(req.body.attachmentId);
  const query = String(req.body.q || '').trim();
  const page = Math.max(1, Number(req.body.page || 1) || 1);

  try {
    const history = await extractAttachmentForOrder(orderId, attachmentId);
    res.redirect(`/extractions/${history.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not extract the selected PDF.';
    res.redirect(
      `/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${
        buildOrderQuerySuffix(query, page) ? '&' : '?'
      }error=${encodeURIComponent(message)}`,
    );
  }
});

export default router;
