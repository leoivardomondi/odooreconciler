"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const repositories_1 = require("../models/repositories");
const extractionService_1 = require("../services/extractionService");
const jobSummaryReminderService_1 = require("../services/jobSummaryReminderService");
const odooClient_1 = require("../services/odooClient");
const stockProcessingService_1 = require("../services/stockProcessingService");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
async function buildClient() {
    const settings = await (0, repositories_1.getSettings)();
    if (!(0, helpers_1.hasOdooConfiguration)(settings)) {
        throw new Error('Odoo is not configured yet. Complete setup first.');
    }
    return {
        settings,
        client: new odooClient_1.OdooClient({
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(settings.odoo.baseUrl),
            database: settings.odoo.database,
            username: settings.odoo.username,
            apiKey: settings.odoo.apiKey,
        }),
    };
}
async function buildSalesOrderListItems(client, settings, orderSummaries) {
    const availableFields = await client.getSaleOrderFields();
    const mappings = (0, helpers_1.resolveFieldMappings)(settings.fieldMappings, availableFields);
    const attachmentsByOrder = await client.getAttachmentsForSaleOrders(orderSummaries.map((order) => order.id)).catch(async () => {
        const fallback = new Map();
        await Promise.all(orderSummaries.map(async (order) => fallback.set(order.id, await client.getAttachments(order.id).catch(() => []))));
        return fallback;
    });
    const handoffsByOrder = await client.getSaleOrderStockHandoffs(orderSummaries.map((order) => order.id), mappings).catch(async () => {
        const fallback = new Map();
        await Promise.all(orderSummaries.map(async (order) => {
            const handoff = await client.getSaleOrderStockHandoff(order.id, mappings).catch(() => null);
            if (handoff)
                fallback.set(order.id, handoff);
        }));
        return fallback;
    });
    return Promise.all(orderSummaries.map(async (order) => {
        const [attachments, history] = await Promise.all([
            Promise.resolve(attachmentsByOrder.get(order.id) || []),
            Promise.resolve((0, extractionService_1.getRecentOrderHistory)(order.id)),
        ]);
        const handoff = handoffsByOrder.get(order.id) || null;
        const hasJobSummary = attachments.some((attachment) => (0, helpers_1.isJobSummaryAttachment)(attachment, settings.parser.filenameKeyword));
        const extracted = history.some((entry) => ['parsed', 'parsed_empty', 'sent_to_odoo', 'signature_unchanged_skipped'].includes(entry.status));
        const sentToOdoo = history.some((entry) => entry.status === 'sent_to_odoo');
        const processedStock = Boolean(handoff?.stockProcessed) ||
            Boolean(handoff?.stockSignature?.trim()) ||
            history.some((entry) => {
                const summary = entry.summary?.toLowerCase() || '';
                return summary.includes('stock processing') || summary.includes('stock reconciliation');
            });
        const addedStock = Boolean(handoff?.stockProcessed) &&
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
    }));
}
function buildOrderQuerySuffix(query, page = 1) {
    const params = [];
    if (query) {
        params.push(`q=${encodeURIComponent(query)}`);
    }
    if (page > 1) {
        params.push(`page=${page}`);
    }
    return params.length ? `?${params.join('&')}` : '';
}
function formatMoney(value) {
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
function describeJobSummaryReminderOutcome(outcome) {
    const status = String(outcome.status || '');
    if (status === 'created') {
        return {
            type: 'success',
            message: `Created Odoo To Do activity "${jobSummaryReminderService_1.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY}" for this Sales Order.`,
        };
    }
    if (status === 'already_exists') {
        return {
            type: 'info',
            message: `An open "${jobSummaryReminderService_1.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY}" activity already exists for this Sales Order.`,
        };
    }
    if (status === 'closed_after_upload') {
        return {
            type: 'success',
            message: `Job Summary PDF is already detected; closed the open "${jobSummaryReminderService_1.JOB_SUMMARY_REMINDER_ACTIVITY_SUMMARY}" activity.`,
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
async function renderSalesOrderDetailsPage(res, options) {
    const { client, settings } = await buildClient();
    const order = await client.getSaleOrder(options.orderId);
    const orderedResults = await client.searchSalesOrders(options.query, 200);
    const currentIndex = orderedResults.findIndex((entry) => entry.id === options.orderId);
    const previousOrder = currentIndex > 0 ? orderedResults[currentIndex - 1] : null;
    const nextOrder = currentIndex >= 0 && currentIndex < orderedResults.length - 1
        ? orderedResults[currentIndex + 1]
        : null;
    const attachments = await client.getAttachments(options.orderId);
    const decoratedAttachments = attachments.map((attachment) => ({
        ...attachment,
        isPdf: (0, helpers_1.isPdfAttachment)(attachment),
        isJobSummary: (0, helpers_1.isJobSummaryAttachment)(attachment, settings.parser.filenameKeyword),
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
        history: await (0, extractionService_1.getRecentOrderHistory)(options.orderId),
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
    }
    catch (error) {
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
    }
    catch (caughtError) {
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
        const stockResult = await (0, stockProcessingService_1.previewSaleOrderStockProcessing)(orderId);
        await renderSalesOrderDetailsPage(res, {
            orderId,
            query,
            page,
            status: { type: 'info', message: stockResult.statusMessage },
            stockResult,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not preview stock reconciliation.';
        try {
            await renderSalesOrderDetailsPage(res, {
                orderId,
                query,
                page,
                status: { type: 'danger', message },
                stockResult: null,
            });
        }
        catch {
            res.redirect(`/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${buildOrderQuerySuffix(query, page) ? '&' : '?'}error=${encodeURIComponent(message)}`);
        }
    }
});
router.post('/sales-orders/:orderId/stock/process', async (req, res) => {
    const orderId = Number(req.params.orderId);
    const query = String(req.body.q || '').trim();
    const page = Math.max(1, Number(req.body.page || 1) || 1);
    try {
        const stockResult = await (0, stockProcessingService_1.processSaleOrderStock)(orderId);
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not run stock reconciliation.';
        try {
            await renderSalesOrderDetailsPage(res, {
                orderId,
                query,
                page,
                status: { type: 'danger', message },
                stockResult: null,
            });
        }
        catch {
            res.redirect(`/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${buildOrderQuerySuffix(query, page) ? '&' : '?'}error=${encodeURIComponent(message)}`);
        }
    }
});
router.post('/sales-orders/:orderId/stock/reverse', async (req, res) => {
    const orderId = Number(req.params.orderId);
    const query = String(req.body.q || '').trim();
    const page = Math.max(1, Number(req.body.page || 1) || 1);
    try {
        const reverseResult = await (0, stockProcessingService_1.reverseSaleOrderStockAdditions)(orderId);
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not reverse stock additions.';
        try {
            await renderSalesOrderDetailsPage(res, {
                orderId,
                query,
                page,
                status: { type: 'danger', message },
                stockResult: null,
            });
        }
        catch {
            res.redirect(`/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${buildOrderQuerySuffix(query, page) ? '&' : '?'}error=${encodeURIComponent(message)}`);
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
        const outcome = await (0, jobSummaryReminderService_1.ensureMissingJobSummaryReminder)(client, order, settings.parser.filenameKeyword);
        const status = describeJobSummaryReminderOutcome(outcome);
        await renderSalesOrderDetailsPage(res, {
            orderId,
            query,
            page,
            status,
            stockResult: null,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not run the Job Summary reminder check.';
        try {
            await renderSalesOrderDetailsPage(res, {
                orderId,
                query,
                page,
                status: { type: 'danger', message },
                stockResult: null,
            });
        }
        catch {
            res.redirect(`/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${buildOrderQuerySuffix(query, page) ? '&' : '?'}error=${encodeURIComponent(message)}`);
        }
    }
});
router.post('/sales-orders/:orderId/extract-latest', async (req, res) => {
    const orderId = Number(req.params.orderId);
    const query = String(req.body.q || '').trim();
    const page = Math.max(1, Number(req.body.page || 1) || 1);
    try {
        const history = await (0, extractionService_1.extractLatestJobSummaryForOrder)(orderId);
        res.redirect(`/extractions/${history.id}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not extract the latest Job Summary.';
        res.redirect(`/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${buildOrderQuerySuffix(query, page) ? '&' : '?'}error=${encodeURIComponent(message)}`);
    }
});
router.post('/sales-orders/:orderId/extract-selected', async (req, res) => {
    const orderId = Number(req.params.orderId);
    const attachmentId = Number(req.body.attachmentId);
    const query = String(req.body.q || '').trim();
    const page = Math.max(1, Number(req.body.page || 1) || 1);
    try {
        const history = await (0, extractionService_1.extractAttachmentForOrder)(orderId, attachmentId);
        res.redirect(`/extractions/${history.id}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not extract the selected PDF.';
        res.redirect(`/sales-orders/${orderId}${buildOrderQuerySuffix(query, page)}${buildOrderQuerySuffix(query, page) ? '&' : '?'}error=${encodeURIComponent(message)}`);
    }
});
exports.default = router;
