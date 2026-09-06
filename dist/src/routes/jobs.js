"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_crypto_1 = require("node:crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const repositories_1 = require("../models/repositories");
const extractionService_1 = require("../services/extractionService");
const jobSummaryReminderService_1 = require("../services/jobSummaryReminderService");
const logService_1 = require("../services/logService");
const mpesaReviewNotificationService_1 = require("../services/mpesaReviewNotificationService");
const invoiceExtractionJobService_1 = require("../services/invoiceExtractionJobService");
const mpesaExtractionJobService_1 = require("../services/mpesaExtractionJobService");
const shopFloorTaskReminderService_1 = require("../services/shopFloorTaskReminderService");
const odooClient_1 = require("../services/odooClient");
const schedulerService_1 = require("../services/schedulerService");
const schedulerFailureAnalysisService_1 = require("../services/schedulerFailureAnalysisService");
const env_1 = require("../utils/env");
const helpers_1 = require("../utils/helpers");
const paths_1 = require("../utils/paths");
const router = (0, express_1.Router)();
const webhookLogPath = path_1.default.join(paths_1.storageDirectoryPath, 'webhook.log');
router.post('/jobs/retry-dead-letter/:type/:jobId', async (req, res) => {
    if (req.authUser?.role !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Admin access is required.' });
    }
    const type = String(req.params.type || '').toLowerCase();
    const jobId = String(req.params.jobId || '').trim();
    if (!jobId || !['mpesa', 'invoice'].includes(type)) {
        return res.status(400).json({ ok: false, error: 'A valid job type and job ID are required.' });
    }
    try {
        if (type === 'mpesa') {
            await (0, repositories_1.retryMpesaExtractionJob)(jobId);
            (0, mpesaExtractionJobService_1.wakeMpesaExtractionJobWorker)();
        }
        else {
            await (0, repositories_1.retryInvoiceExtractionJob)(jobId);
            (0, invoiceExtractionJobService_1.wakeInvoiceExtractionJobWorker)();
        }
        return res.json({ ok: true, status: 'queued', jobId });
    }
    catch (error) {
        return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Could not retry job.' });
    }
});
async function isAuthorizedCronRequest(token) {
    const settings = await (0, repositories_1.getSettings)();
    const expectedToken = settings.scheduler.cronToken || env_1.env.SCHEDULER_CRON_TOKEN;
    return Boolean(expectedToken && token && token === expectedToken);
}
async function isAuthorizedPoBillCronRequest(token) {
    const settings = await (0, repositories_1.getSettings)();
    const expectedToken = settings.poBillScheduler.cronToken || settings.scheduler.cronToken || env_1.env.SCHEDULER_CRON_TOKEN;
    return Boolean(expectedToken && token && token === expectedToken);
}
function writeWebhookTrace(event, context = {}) {
    try {
        fs_1.default.mkdirSync(paths_1.storageDirectoryPath, { recursive: true });
        fs_1.default.appendFileSync(webhookLogPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            event,
            context: (0, helpers_1.sanitizeForLog)(context),
        }) + '\n', 'utf8');
    }
    catch (error) {
        console.warn('[webhook] Could not write webhook trace:', error instanceof Error ? error.message : error);
    }
}
function getWebhookToken(req) {
    const rawQueryToken = req.query.token;
    const queryToken = Array.isArray(rawQueryToken)
        ? String(rawQueryToken[0] || '').trim()
        : typeof rawQueryToken === 'string'
            ? rawQueryToken.trim()
            : '';
    if (queryToken) {
        return queryToken;
    }
    const authorization = String(req.get('authorization') || '').trim();
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
        return bearerMatch[1].trim();
    }
    return String(req.get('x-odoo-webhook-token') ||
        req.get('x-webhook-token') ||
        '').trim();
}
function timingSafeTokenMatches(providedToken, expectedToken) {
    if (!providedToken || !expectedToken) {
        return false;
    }
    const provided = Buffer.from(providedToken);
    const expected = Buffer.from(expectedToken);
    return provided.length === expected.length && (0, node_crypto_1.timingSafeEqual)(provided, expected);
}
function parsePositiveInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
}
function getStringField(raw, key) {
    const value = raw[key];
    return typeof value === 'string' ? value.trim() : '';
}
function isPdfMimeType(mimetype) {
    return mimetype.trim().toLowerCase() === 'application/pdf';
}
function filenameMatchesJobSummaryKeyword(filename, keyword) {
    const normalizedFilename = filename.trim().toLowerCase();
    const normalizedKeyword = keyword.trim().toLowerCase();
    return !normalizedKeyword || normalizedFilename.includes(normalizedKeyword);
}
function validateAttachmentUploadedPayload(body) {
    const errors = [];
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return {
            payload: null,
            errors: ['Request body must be a JSON object.'],
        };
    }
    const raw = body;
    const hasNativeAttachmentId = raw.id !== undefined;
    const attachmentId = parsePositiveInteger(raw.attachment_id) ||
        parsePositiveInteger(raw.id) ||
        parsePositiveInteger(raw._id);
    const orderId = parsePositiveInteger(raw.order_id) || parsePositiveInteger(raw.res_id);
    const filename = getStringField(raw, 'filename') || getStringField(raw, 'name');
    const resModel = getStringField(raw, 'res_model');
    const mimetype = getStringField(raw, 'mimetype');
    const sourceModel = getStringField(raw, '_model');
    const payloadFormat = hasNativeAttachmentId
        ? 'odoo_native'
        : 'custom';
    if (!attachmentId) {
        errors.push('attachment_id, id, or _id must be a positive integer.');
    }
    if (filename && filename.length > 512) {
        errors.push('filename or name must be 512 characters or fewer.');
    }
    if (raw.res_model !== undefined && raw.res_model !== null && typeof raw.res_model !== 'string') {
        errors.push('res_model must be a string when provided.');
    }
    else if (resModel.length > 128) {
        errors.push('res_model must be 128 characters or fewer.');
    }
    if (raw.mimetype !== undefined && raw.mimetype !== null && typeof raw.mimetype !== 'string') {
        errors.push('mimetype must be a string when provided.');
    }
    else if (mimetype.length > 128) {
        errors.push('mimetype must be 128 characters or fewer.');
    }
    if (raw._model !== undefined && raw._model !== null && typeof raw._model !== 'string') {
        errors.push('_model must be a string when provided.');
    }
    else if (sourceModel.length > 128) {
        errors.push('_model must be 128 characters or fewer.');
    }
    if (errors.length > 0 || !attachmentId) {
        return { payload: null, errors };
    }
    return {
        payload: {
            attachmentId,
            orderId: orderId || 0,
            filename: filename || '',
            resModel,
            mimetype,
            sourceModel,
            payloadFormat,
        },
        errors: [],
    };
}
router.post('/jobs/run-scheduler', async (_req, res) => {
    // Keep the browser request short. The Sales Order scheduler performs Odoo RPC calls,
    // PDF attachment downloads, and AI/OCR parsing, which can exceed production web proxy / Passenger timeouts (30s).
    void (0, schedulerService_1.runSchedulerCycle)('manual').catch(async (error) => {
        await (0, logService_1.logEvent)('error', 'Manual Sales Order scheduler background run failed', {
            error: error instanceof Error ? error.message : 'Unknown failure in manual Sales Order scheduler.',
        });
    });
    res.redirect(`/dashboard?message=${encodeURIComponent('Sales Order scheduler run initiated in background.')}`);
});
router.post('/jobs/run-po-bill-scheduler', async (_req, res) => {
    // Keep the browser request short. The PO cycle can perform OCR and several
    // Odoo calls, so waiting for it here leaves the frontend behind a loading
    // overlay (and can exceed the production proxy/Passenger timeout).
    void (0, schedulerService_1.runPoBillSchedulerCycle)('manual').catch(async (error) => {
        await (0, logService_1.logEvent)('error', 'Manual PO bill scheduler background run failed', {
            error: error instanceof Error ? error.message : 'Unknown failure in manual PO bill scheduler.',
        });
    });
    res.redirect(`/dashboard?message=${encodeURIComponent('PO bill scheduler run initiated in background.')}`);
});
router.get('/jobs/send-shop-floor-task-reminders', async (req, res) => {
    if (!(await isAuthorizedCronRequest(getWebhookToken(req)))) {
        return res.status(403).json({ ok: false, message: 'Invalid scheduler token.' });
    }
    try {
        const result = await (0, shopFloorTaskReminderService_1.sendHourlyShopFloorTaskReminders)();
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Could not send reminders.' });
    }
});
router.post('/jobs/attachment-uploaded', async (req, res) => {
    const configuredToken = env_1.env.ODOO_WEBHOOK_TOKEN.trim();
    const providedToken = getWebhookToken(req);
    const requestContext = {
        ipAddress: req.ip || req.socket.remoteAddress || '',
        userAgent: req.get('user-agent') || '',
        contentType: req.get('content-type') || '',
        contentLength: req.get('content-length') || '',
    };
    writeWebhookTrace('received', {
        ...requestContext,
        hasConfiguredToken: Boolean(configuredToken),
        hasProvidedToken: Boolean(providedToken),
        queryKeys: Object.keys(req.query || {}),
        body: req.body,
    });
    if (!configuredToken) {
        writeWebhookTrace('rejected_not_configured', requestContext);
        await (0, logService_1.logEvent)('error', 'Odoo attachment webhook rejected because token is not configured', {
            ...requestContext,
        });
        return res.status(503).json({
            ok: false,
            status: 'not_configured',
            error: 'ODOO_WEBHOOK_TOKEN is not configured.',
        });
    }
    if (!timingSafeTokenMatches(providedToken, configuredToken)) {
        writeWebhookTrace('rejected_invalid_token', {
            ...requestContext,
            hasProvidedToken: Boolean(providedToken),
        });
        await (0, logService_1.logEvent)('warn', 'Odoo attachment webhook rejected invalid token', {
            ...requestContext,
        });
        return res.status(401).json({
            ok: false,
            status: 'unauthorized',
            error: 'Invalid webhook token.',
        });
    }
    const validation = validateAttachmentUploadedPayload(req.body);
    if (!validation.payload) {
        writeWebhookTrace('rejected_validation_error', {
            ...requestContext,
            errors: validation.errors,
            body: req.body,
        });
        await (0, logService_1.logEvent)('warn', 'Odoo attachment webhook validation failed', {
            ...requestContext,
            errors: validation.errors,
            payload: req.body,
        });
        return res.status(400).json({
            ok: false,
            status: 'validation_error',
            errors: validation.errors,
        });
    }
    const payload = validation.payload;
    writeWebhookTrace('payload_validated', {
        ...requestContext,
        payload,
    });
    if (payload.sourceModel && payload.sourceModel !== 'ir.attachment') {
        writeWebhookTrace('ignored_source_model', {
            ...requestContext,
            payload,
            reason: '_model is not ir.attachment.',
        });
        await (0, logService_1.logEvent)('info', 'Odoo attachment webhook ignored non-attachment source model', {
            ...requestContext,
            payloadFormat: payload.payloadFormat,
            attachmentId: payload.attachmentId,
            orderId: payload.orderId,
            filename: payload.filename,
            sourceModel: payload.sourceModel,
            resModel: payload.resModel,
        });
        return res.json({
            ok: true,
            status: 'ignored',
            reason: '_model is not ir.attachment.',
            attachmentId: payload.attachmentId,
            orderId: payload.orderId,
        });
    }
    if (payload.resModel && !['sale.order', 'mail.message'].includes(payload.resModel)) {
        writeWebhookTrace('ignored_linked_model', {
            ...requestContext,
            payload,
            reason: 'res_model is not sale.order or mail.message.',
        });
        await (0, logService_1.logEvent)('info', 'Odoo attachment webhook ignored unsupported linked model', {
            ...requestContext,
            payloadFormat: payload.payloadFormat,
            attachmentId: payload.attachmentId,
            orderId: payload.orderId,
            filename: payload.filename,
            resModel: payload.resModel,
        });
        return res.json({
            ok: true,
            status: 'ignored',
            reason: 'res_model is not sale.order or mail.message.',
            attachmentId: payload.attachmentId,
            orderId: payload.orderId,
        });
    }
    if (payload.mimetype && !isPdfMimeType(payload.mimetype)) {
        writeWebhookTrace('ignored_non_pdf', {
            ...requestContext,
            payload,
            reason: 'mimetype is not application/pdf.',
        });
        await (0, logService_1.logEvent)('info', 'Odoo attachment webhook ignored non-PDF payload', {
            ...requestContext,
            payloadFormat: payload.payloadFormat,
            attachmentId: payload.attachmentId,
            orderId: payload.orderId,
            filename: payload.filename,
            resModel: payload.resModel,
            mimetype: payload.mimetype,
        });
        return res.json({
            ok: true,
            status: 'ignored',
            reason: 'mimetype is not application/pdf.',
            attachmentId: payload.attachmentId,
            orderId: payload.orderId,
            filename: payload.filename,
        });
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        if (!payload.orderId || !payload.filename) {
            try {
                const attachmentRecord = await client.getAttachmentRecord(payload.attachmentId);
                if (attachmentRecord) {
                    payload.orderId = attachmentRecord.res_id || payload.orderId;
                    payload.filename = attachmentRecord.name || payload.filename;
                    payload.resModel = attachmentRecord.res_model || payload.resModel;
                    payload.mimetype = attachmentRecord.mimetype || payload.mimetype;
                }
            }
            catch (err) {
                console.warn('[webhook] Could not auto-enrich attachment details from Odoo:', err);
            }
        }
        if (payload.filename && !filenameMatchesJobSummaryKeyword(payload.filename, settings.parser.filenameKeyword)) {
            writeWebhookTrace('ignored_filename_keyword', {
                ...requestContext,
                payload,
                filenameKeyword: settings.parser.filenameKeyword,
            });
            await (0, logService_1.logEvent)('info', 'Odoo attachment webhook ignored filename that does not match Job Summary rules', {
                ...requestContext,
                payloadFormat: payload.payloadFormat,
                attachmentId: payload.attachmentId,
                orderId: payload.orderId,
                filename: payload.filename,
                resModel: payload.resModel,
                mimetype: payload.mimetype || null,
                filenameKeyword: settings.parser.filenameKeyword,
            });
            return res.json({
                ok: true,
                status: 'ignored',
                reason: 'filename does not match the configured Job Summary PDF rules.',
                attachmentId: payload.attachmentId,
                orderId: payload.orderId,
                filename: payload.filename,
            });
        }
        let targetOrderId = payload.orderId;
        if (payload.resModel === 'mail.message') {
            const messageTarget = await client.getMailMessageTarget(payload.orderId);
            if (!messageTarget) {
                writeWebhookTrace('failed_mail_message_unresolved', {
                    ...requestContext,
                    payload,
                });
                await (0, logService_1.logEvent)('warn', 'Odoo attachment webhook could not resolve chatter message target', {
                    ...requestContext,
                    payloadFormat: payload.payloadFormat,
                    attachmentId: payload.attachmentId,
                    messageId: payload.orderId,
                    filename: payload.filename,
                });
                return res.status(422).json({
                    ok: false,
                    status: 'validation_error',
                    errors: ['The mail.message record could not be resolved to a Sales Order.'],
                });
            }
            if (messageTarget.model !== 'sale.order') {
                writeWebhookTrace('ignored_mail_message_target', {
                    ...requestContext,
                    payload,
                    messageTarget,
                });
                await (0, logService_1.logEvent)('info', 'Odoo attachment webhook ignored chatter message for non-Sales Order record', {
                    ...requestContext,
                    payloadFormat: payload.payloadFormat,
                    attachmentId: payload.attachmentId,
                    messageId: payload.orderId,
                    filename: payload.filename,
                    messageModel: messageTarget.model,
                    messageResId: messageTarget.res_id,
                    recordName: messageTarget.record_name || null,
                });
                return res.json({
                    ok: true,
                    status: 'ignored',
                    reason: 'mail.message target is not sale.order.',
                    attachmentId: payload.attachmentId,
                    orderId: messageTarget.res_id,
                    filename: payload.filename,
                });
            }
            targetOrderId = messageTarget.res_id;
            writeWebhookTrace('resolved_mail_message_to_sale_order', {
                ...requestContext,
                payload,
                messageTarget,
                targetOrderId,
            });
            await (0, logService_1.logEvent)('info', 'Odoo attachment webhook resolved chatter attachment to Sales Order', {
                ...requestContext,
                payloadFormat: payload.payloadFormat,
                attachmentId: payload.attachmentId,
                messageId: payload.orderId,
                orderId: targetOrderId,
                filename: payload.filename,
                recordName: messageTarget.record_name || null,
            });
        }
        const attachments = await client.getAttachments(targetOrderId);
        const attachment = attachments.find((item) => item.id === payload.attachmentId);
        if (!attachment) {
            writeWebhookTrace('failed_attachment_not_on_order', {
                ...requestContext,
                payload,
                targetOrderId,
                visibleAttachmentIds: attachments.map((item) => item.id),
            });
            await (0, logService_1.logEvent)('warn', 'Odoo attachment webhook referenced an attachment outside the Sales Order', {
                ...requestContext,
                payloadFormat: payload.payloadFormat,
                attachmentId: payload.attachmentId,
                orderId: targetOrderId,
                payloadResId: payload.orderId,
                filename: payload.filename,
            });
            return res.status(422).json({
                ok: false,
                status: 'validation_error',
                errors: ['The attachment was not found on the provided Sales Order.'],
            });
        }
        if (!(0, helpers_1.isJobSummaryAttachment)(attachment, settings.parser.filenameKeyword)) {
            writeWebhookTrace('ignored_attachment_not_matching', {
                ...requestContext,
                payload,
                targetOrderId,
                attachment,
                filenameKeyword: settings.parser.filenameKeyword,
            });
            await (0, logService_1.logEvent)('info', 'Odoo attachment webhook ignored non-matching attachment', {
                ...requestContext,
                payloadFormat: payload.payloadFormat,
                attachmentId: payload.attachmentId,
                orderId: targetOrderId,
                payloadResId: payload.orderId,
                providedFilename: payload.filename,
                actualFilename: attachment.name,
                providedMimetype: payload.mimetype || null,
                mimetype: attachment.mimetype || null,
                filenameKeyword: settings.parser.filenameKeyword,
            });
            return res.json({
                ok: true,
                status: 'ignored',
                reason: 'Attachment is not a matching Job Summary PDF.',
                attachmentId: payload.attachmentId,
                orderId: targetOrderId,
                filename: attachment.name,
            });
        }
        if (payload.filename !== attachment.name) {
            await (0, logService_1.logEvent)('warn', 'Odoo attachment webhook filename differed from Odoo attachment record', {
                ...requestContext,
                payloadFormat: payload.payloadFormat,
                attachmentId: payload.attachmentId,
                orderId: targetOrderId,
                payloadResId: payload.orderId,
                providedFilename: payload.filename,
                actualFilename: attachment.name,
                providedMimetype: payload.mimetype || null,
                actualMimetype: attachment.mimetype || null,
            });
        }
        await (0, logService_1.logEvent)('info', 'Odoo attachment webhook accepted Job Summary attachment', {
            ...requestContext,
            payloadFormat: payload.payloadFormat,
            attachmentId: payload.attachmentId,
            orderId: targetOrderId,
            payloadResId: payload.orderId,
            filename: attachment.name,
            providedMimetype: payload.mimetype || null,
            actualMimetype: attachment.mimetype || null,
        });
        const history = await (0, extractionService_1.extractAttachmentForOrder)(targetOrderId, payload.attachmentId);
        const sendResult = await (0, extractionService_1.sendExtractedResultToOdoo)(history.id, false);
        let reminderCloseResult = null;
        try {
            reminderCloseResult = await (0, jobSummaryReminderService_1.closeOpenJobSummaryReminderActivities)(client, targetOrderId, `Job Summary PDF ${attachment.name} was uploaded.`);
        }
        catch (reminderError) {
            const reminderMessage = reminderError instanceof Error ? reminderError.message : 'Unknown reminder close error.';
            reminderCloseResult = {
                status: 'failed',
                reason: reminderMessage,
            };
            await (0, logService_1.logEvent)('warn', 'Odoo attachment webhook could not close missing Job Summary activity', {
                ...requestContext,
                payloadFormat: payload.payloadFormat,
                attachmentId: payload.attachmentId,
                orderId: targetOrderId,
                filename: attachment.name,
                error: reminderMessage,
            });
        }
        writeWebhookTrace('processed', {
            ...requestContext,
            payload,
            targetOrderId,
            attachment,
            historyId: history.id,
            sendSkipped: sendResult.skipped,
            resultStatus: sendResult.history.status,
            summary: sendResult.history.summary,
            reminderCloseResult,
        });
        await (0, logService_1.logEvent)('info', 'Odoo attachment webhook processed Job Summary attachment', {
            ...requestContext,
            payloadFormat: payload.payloadFormat,
            attachmentId: payload.attachmentId,
            orderId: targetOrderId,
            payloadResId: payload.orderId,
            filename: attachment.name,
            historyId: history.id,
            sendSkipped: sendResult.skipped,
            historyStatus: sendResult.history.status,
            summary: sendResult.history.summary,
            reminderCloseResult,
        }, history.id);
        return res.json({
            ok: true,
            status: 'processed',
            attachmentId: payload.attachmentId,
            orderId: targetOrderId,
            filename: attachment.name,
            historyId: history.id,
            sendSkipped: sendResult.skipped,
            resultStatus: sendResult.history.status,
            summary: sendResult.history.summary,
            reminderCloseResult,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Attachment webhook failed.';
        writeWebhookTrace('failed_internal_error', {
            ...requestContext,
            payload,
            error: message,
        });
        await (0, logService_1.logEvent)('error', 'Odoo attachment webhook failed', {
            ...requestContext,
            payloadFormat: payload.payloadFormat,
            attachmentId: payload.attachmentId,
            orderId: payload.orderId,
            filename: payload.filename,
            error: message,
        });
        return res.status(500).json({
            ok: false,
            status: 'error',
            error: message,
        });
    }
});
router.get('/jobs/attachment-uploaded/test', async (req, res) => {
    const configuredToken = env_1.env.ODOO_WEBHOOK_TOKEN.trim();
    const providedToken = getWebhookToken(req);
    const authorized = timingSafeTokenMatches(providedToken, configuredToken);
    writeWebhookTrace('test_endpoint_hit', {
        ipAddress: req.ip || req.socket.remoteAddress || '',
        userAgent: req.get('user-agent') || '',
        hasConfiguredToken: Boolean(configuredToken),
        hasProvidedToken: Boolean(providedToken),
        authorized,
    });
    if (!configuredToken) {
        return res.status(503).json({
            ok: false,
            status: 'not_configured',
            error: 'ODOO_WEBHOOK_TOKEN is not configured.',
        });
    }
    if (!authorized) {
        return res.status(401).json({
            ok: false,
            status: 'unauthorized',
            error: 'Invalid webhook token.',
        });
    }
    return res.json({
        ok: true,
        status: 'ready',
        message: 'Webhook endpoint is reachable and the token is valid.',
    });
});
router.get('/jobs/run-scheduler', async (req, res) => {
    const token = String(req.query.token || '');
    if (!(await isAuthorizedCronRequest(token))) {
        return res.status(403).json({ ok: false, error: 'Invalid scheduler token.' });
    }
    let mpesaNotification = null;
    try {
        try {
            mpesaNotification = await (0, mpesaReviewNotificationService_1.sendDailyMpesaReviewNotification)();
        }
        catch (notificationError) {
            mpesaNotification = {
                sent: false,
                reason: notificationError instanceof Error ? notificationError.message : 'notification_failed',
                statementCount: 0,
            };
        }
        const syncMode = req.query.sync === '1' || req.query.sync === 'true';
        if (syncMode) {
            const result = await (0, schedulerService_1.runSchedulerCycle)('cron');
            return res.json({
                ok: true,
                runId: result.run.id,
                status: result.run.status,
                summary: result.run.summary,
                scannedCount: result.scannedCount,
                processedCount: result.processedCount,
                skippedCount: result.skippedCount,
                failedCount: result.failedCount,
                throttled: Boolean(result.throttled),
                throttleMinutes: result.throttleMinutes || null,
                mpesaNotification,
            });
        }
        void (0, schedulerService_1.runSchedulerCycle)('cron').catch(async (error) => {
            await (0, logService_1.logEvent)('error', 'Cron Sales Order scheduler background run failed', {
                error: error instanceof Error ? error.message : 'Unknown failure in background Sales Order scheduler.',
            });
        });
        return res.json({
            ok: true,
            status: 'initiated',
            message: 'Sales Order scheduler run initiated in background.',
            mpesaNotification,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Scheduler failed.';
        res.status(500).json({ ok: false, error: message, mpesaNotification });
    }
});
router.get('/jobs/run-po-bill-scheduler', async (req, res) => {
    const token = String(req.query.token || '');
    if (!(await isAuthorizedPoBillCronRequest(token))) {
        return res.status(403).json({ ok: false, error: 'Invalid scheduler token.' });
    }
    let mpesaNotification = null;
    try {
        try {
            mpesaNotification = await (0, mpesaReviewNotificationService_1.sendDailyMpesaReviewNotification)();
        }
        catch (notificationError) {
            mpesaNotification = {
                sent: false,
                reason: notificationError instanceof Error ? notificationError.message : 'notification_failed',
                statementCount: 0,
            };
        }
        const syncMode = req.query.sync === '1' || req.query.sync === 'true';
        if (syncMode) {
            const result = await (0, schedulerService_1.runPoBillSchedulerCycle)('cron');
            return res.json({
                ok: true,
                runId: result.run.id,
                status: result.run.status,
                summary: result.run.summary,
                scannedCount: result.scannedCount,
                processedCount: result.processedCount,
                skippedCount: result.skippedCount,
                failedCount: result.failedCount,
                throttled: Boolean(result.throttled),
                throttleMinutes: result.throttleMinutes || null,
                mpesaNotification,
            });
        }
        void (0, schedulerService_1.runPoBillSchedulerCycle)('cron').catch(async (error) => {
            await (0, logService_1.logEvent)('error', 'Cron PO bill scheduler background run failed', {
                error: error instanceof Error ? error.message : 'Unknown failure in background PO bill scheduler.',
            });
        });
        return res.json({
            ok: true,
            status: 'initiated',
            message: 'PO bill scheduler run initiated in background.',
            mpesaNotification,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'PO bill scheduler failed.';
        res.status(500).json({ ok: false, error: message, mpesaNotification });
    }
});
router.get('/jobs/send-mpesa-review-notification', async (req, res) => {
    const token = String(req.query.token || '');
    if (!(await isAuthorizedCronRequest(token))) {
        return res.status(403).json({ ok: false, error: 'Invalid scheduler token.' });
    }
    try {
        const mpesaNotification = await (0, mpesaReviewNotificationService_1.sendDailyMpesaReviewNotification)();
        res.json({ ok: true, mpesaNotification });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'M-Pesa notification failed.';
        res.status(500).json({ ok: false, error: message });
    }
});
router.get('/jobs/scheduler-failures/export.csv', async (req, res) => {
    try {
        const range = req.query.range || 'weekly';
        const fromDate = req.query.fromDate;
        const toDate = req.query.toDate;
        const report = await (0, schedulerFailureAnalysisService_1.getSchedulerFailureReport)({ range, fromDate, toDate });
        const csv = (0, schedulerFailureAnalysisService_1.generateSchedulerFailureCsv)(report);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="scheduler-failures-${fromDate || range}-${new Date().toISOString().slice(0, 10)}.csv"`);
        return res.send(csv);
    }
    catch (error) {
        return res.status(500).send('Could not generate CSV failure report.');
    }
});
router.get('/jobs/scheduler-failures/report.pdf', async (req, res) => {
    try {
        const range = req.query.range || 'weekly';
        const fromDate = req.query.fromDate;
        const toDate = req.query.toDate;
        const report = await (0, schedulerFailureAnalysisService_1.getSchedulerFailureReport)({ range, fromDate, toDate });
        const pdfBuffer = await (0, schedulerFailureAnalysisService_1.renderSchedulerFailurePdf)(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="scheduler-failures-${fromDate || range}-${new Date().toISOString().slice(0, 10)}.pdf"`);
        return res.send(pdfBuffer);
    }
    catch (error) {
        return res.status(500).send('Could not generate PDF failure report.');
    }
});
router.get('/jobs/scheduler-failures/json', async (req, res) => {
    try {
        const range = req.query.range || 'weekly';
        const fromDate = req.query.fromDate;
        const toDate = req.query.toDate;
        const report = await (0, schedulerFailureAnalysisService_1.getSchedulerFailureReport)({ range, fromDate, toDate });
        return res.json({ ok: true, report });
    }
    catch (error) {
        return res.status(500).json({ ok: false, message: 'Could not fetch failure report.' });
    }
});
exports.default = router;
