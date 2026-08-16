import { timingSafeEqual } from 'node:crypto';
import fs from 'fs';
import path from 'path';
import { Request, Router } from 'express';
import { getSettings, retryInvoiceExtractionJob, retryMpesaExtractionJob } from '../models/repositories';
import {
  extractAttachmentForOrder,
  sendExtractedResultToOdoo,
} from '../services/extractionService';
import { closeOpenJobSummaryReminderActivities } from '../services/jobSummaryReminderService';
import { logEvent } from '../services/logService';
import { sendDailyMpesaReviewNotification } from '../services/mpesaReviewNotificationService';
import { wakeInvoiceExtractionJobWorker } from '../services/invoiceExtractionJobService';
import { wakeMpesaExtractionJobWorker } from '../services/mpesaExtractionJobService';
import { sendHourlyShopFloorTaskReminders } from '../services/shopFloorTaskReminderService';
import { OdooClient } from '../services/odooClient';
import { runPoBillSchedulerCycle, runSchedulerCycle } from '../services/schedulerService';
import {
  generateSchedulerFailureCsv,
  getSchedulerFailureReport,
  renderSchedulerFailurePdf,
} from '../services/schedulerFailureAnalysisService';
import { env } from '../utils/env';
import { hasOdooConfiguration, isJobSummaryAttachment, sanitizeForLog } from '../utils/helpers';
import { storageDirectoryPath } from '../utils/paths';

const router = Router();
const webhookLogPath = path.join(storageDirectoryPath, 'webhook.log');

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
      await retryMpesaExtractionJob(jobId);
      wakeMpesaExtractionJobWorker();
    } else {
      await retryInvoiceExtractionJob(jobId);
      wakeInvoiceExtractionJobWorker();
    }
    return res.json({ ok: true, status: 'queued', jobId });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Could not retry job.' });
  }
});

interface AttachmentUploadedPayload {
  attachmentId: number;
  orderId: number;
  filename: string;
  resModel: string;
  mimetype: string;
  sourceModel: string;
  payloadFormat: 'odoo_native' | 'custom';
}

async function isAuthorizedCronRequest(token: string) {
  const settings = await getSettings();
  const expectedToken = settings.scheduler.cronToken || env.SCHEDULER_CRON_TOKEN;

  return Boolean(expectedToken && token && token === expectedToken);
}

async function isAuthorizedPoBillCronRequest(token: string) {
  const settings = await getSettings();
  const expectedToken =
    settings.poBillScheduler.cronToken || settings.scheduler.cronToken || env.SCHEDULER_CRON_TOKEN;

  return Boolean(expectedToken && token && token === expectedToken);
}

function writeWebhookTrace(event: string, context: Record<string, unknown> = {}) {
  try {
    fs.mkdirSync(storageDirectoryPath, { recursive: true });
    fs.appendFileSync(
      webhookLogPath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        context: sanitizeForLog(context),
      }) + '\n',
      'utf8',
    );
  } catch (error) {
    console.warn(
      '[webhook] Could not write webhook trace:',
      error instanceof Error ? error.message : error,
    );
  }
}

function getWebhookToken(req: Request): string {
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

  return String(
    req.get('x-odoo-webhook-token') ||
      req.get('x-webhook-token') ||
      '',
  ).trim();
}

function timingSafeTokenMatches(providedToken: string, expectedToken: string): boolean {
  if (!providedToken || !expectedToken) {
    return false;
  }

  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function getStringField(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isPdfMimeType(mimetype: string): boolean {
  return mimetype.trim().toLowerCase() === 'application/pdf';
}

function filenameMatchesJobSummaryKeyword(filename: string, keyword: string): boolean {
  const normalizedFilename = filename.trim().toLowerCase();
  const normalizedKeyword = keyword.trim().toLowerCase();

  return !normalizedKeyword || normalizedFilename.includes(normalizedKeyword);
}

function validateAttachmentUploadedPayload(body: unknown): {
  payload: AttachmentUploadedPayload | null;
  errors: string[];
} {
  const errors: string[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      payload: null,
      errors: ['Request body must be a JSON object.'],
    };
  }

  const raw = body as Record<string, unknown>;
  const hasNativeAttachmentId = raw.id !== undefined;
  const attachmentId =
    parsePositiveInteger(raw.attachment_id) ||
    parsePositiveInteger(raw.id) ||
    parsePositiveInteger(raw._id);
  const orderId = parsePositiveInteger(raw.order_id) || parsePositiveInteger(raw.res_id);
  const filename = getStringField(raw, 'filename') || getStringField(raw, 'name');
  const resModel = getStringField(raw, 'res_model');
  const mimetype = getStringField(raw, 'mimetype');
  const sourceModel = getStringField(raw, '_model');
  const payloadFormat: AttachmentUploadedPayload['payloadFormat'] = hasNativeAttachmentId
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
  } else if (resModel.length > 128) {
    errors.push('res_model must be 128 characters or fewer.');
  }

  if (raw.mimetype !== undefined && raw.mimetype !== null && typeof raw.mimetype !== 'string') {
    errors.push('mimetype must be a string when provided.');
  } else if (mimetype.length > 128) {
    errors.push('mimetype must be 128 characters or fewer.');
  }

  if (raw._model !== undefined && raw._model !== null && typeof raw._model !== 'string') {
    errors.push('_model must be a string when provided.');
  } else if (sourceModel.length > 128) {
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
  try {
    const result = await runSchedulerCycle('manual');
    res.redirect(`/dashboard?message=${encodeURIComponent(result.run.summary || 'Sales Order scheduler completed.')}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sales Order scheduler failed.';
    res.redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }
});

router.post('/jobs/run-po-bill-scheduler', async (_req, res) => {
  // Keep the browser request short. The PO cycle can perform OCR and several
  // Odoo calls, so waiting for it here leaves the frontend behind a loading
  // overlay (and can exceed the production proxy/Passenger timeout).
  void runPoBillSchedulerCycle('manual').catch(async (error) => {
    await logEvent('error', 'Manual PO bill scheduler background run failed', {
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
    const result = await sendHourlyShopFloorTaskReminders();
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error instanceof Error ? error.message : 'Could not send reminders.' });
  }
});

router.post('/jobs/attachment-uploaded', async (req, res) => {
  const configuredToken = env.ODOO_WEBHOOK_TOKEN.trim();
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
    await logEvent('error', 'Odoo attachment webhook rejected because token is not configured', {
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
    await logEvent('warn', 'Odoo attachment webhook rejected invalid token', {
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
    await logEvent('warn', 'Odoo attachment webhook validation failed', {
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
    await logEvent('info', 'Odoo attachment webhook ignored non-attachment source model', {
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
    await logEvent('info', 'Odoo attachment webhook ignored unsupported linked model', {
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
    await logEvent('info', 'Odoo attachment webhook ignored non-PDF payload', {
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
    const settings = await getSettings();

    const client = new OdooClient(settings.odoo);

    if (!payload.orderId || !payload.filename) {
      try {
        const attachmentRecord = await client.getAttachmentRecord(payload.attachmentId);

        if (attachmentRecord) {
          payload.orderId = attachmentRecord.res_id || payload.orderId;
          payload.filename = attachmentRecord.name || payload.filename;
          payload.resModel = attachmentRecord.res_model || payload.resModel;
          payload.mimetype = attachmentRecord.mimetype || payload.mimetype;
        }
      } catch (err) {
        console.warn('[webhook] Could not auto-enrich attachment details from Odoo:', err);
      }
    }

    if (payload.filename && !filenameMatchesJobSummaryKeyword(payload.filename, settings.parser.filenameKeyword)) {
      writeWebhookTrace('ignored_filename_keyword', {
        ...requestContext,
        payload,
        filenameKeyword: settings.parser.filenameKeyword,
      });
      await logEvent('info', 'Odoo attachment webhook ignored filename that does not match Job Summary rules', {
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
        await logEvent('warn', 'Odoo attachment webhook could not resolve chatter message target', {
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
        await logEvent('info', 'Odoo attachment webhook ignored chatter message for non-Sales Order record', {
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
      await logEvent('info', 'Odoo attachment webhook resolved chatter attachment to Sales Order', {
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
      await logEvent('warn', 'Odoo attachment webhook referenced an attachment outside the Sales Order', {
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

    if (!isJobSummaryAttachment(attachment, settings.parser.filenameKeyword)) {
      writeWebhookTrace('ignored_attachment_not_matching', {
        ...requestContext,
        payload,
        targetOrderId,
        attachment,
        filenameKeyword: settings.parser.filenameKeyword,
      });
      await logEvent('info', 'Odoo attachment webhook ignored non-matching attachment', {
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
      await logEvent('warn', 'Odoo attachment webhook filename differed from Odoo attachment record', {
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

    await logEvent('info', 'Odoo attachment webhook accepted Job Summary attachment', {
      ...requestContext,
      payloadFormat: payload.payloadFormat,
      attachmentId: payload.attachmentId,
      orderId: targetOrderId,
      payloadResId: payload.orderId,
      filename: attachment.name,
      providedMimetype: payload.mimetype || null,
      actualMimetype: attachment.mimetype || null,
    });

    const history = await extractAttachmentForOrder(targetOrderId, payload.attachmentId);
    const sendResult = await sendExtractedResultToOdoo(history.id, false);
    let reminderCloseResult: Record<string, unknown> | null = null;
    try {
      reminderCloseResult = await closeOpenJobSummaryReminderActivities(
        client,
        targetOrderId,
        `Job Summary PDF ${attachment.name} was uploaded.`,
      );
    } catch (reminderError) {
      const reminderMessage =
        reminderError instanceof Error ? reminderError.message : 'Unknown reminder close error.';
      reminderCloseResult = {
        status: 'failed',
        reason: reminderMessage,
      };
      await logEvent('warn', 'Odoo attachment webhook could not close missing Job Summary activity', {
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

    await logEvent(
      'info',
      'Odoo attachment webhook processed Job Summary attachment',
      {
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
      },
      history.id,
    );

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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment webhook failed.';
    writeWebhookTrace('failed_internal_error', {
      ...requestContext,
      payload,
      error: message,
    });

    await logEvent('error', 'Odoo attachment webhook failed', {
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
  const configuredToken = env.ODOO_WEBHOOK_TOKEN.trim();
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

  let mpesaNotification: Awaited<ReturnType<typeof sendDailyMpesaReviewNotification>> | null = null;

  try {
    try {
      mpesaNotification = await sendDailyMpesaReviewNotification();
    } catch (notificationError) {
      mpesaNotification = {
        sent: false,
        reason: notificationError instanceof Error ? notificationError.message : 'notification_failed',
        statementCount: 0,
      };
    }

    const syncMode = req.query.sync === '1' || req.query.sync === 'true';
    if (syncMode) {
      const result = await runSchedulerCycle('cron');
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

    void runSchedulerCycle('cron').catch(async (error) => {
      await logEvent('error', 'Cron Sales Order scheduler background run failed', {
        error: error instanceof Error ? error.message : 'Unknown failure in background Sales Order scheduler.',
      });
    });

    return res.json({
      ok: true,
      status: 'initiated',
      message: 'Sales Order scheduler run initiated in background.',
      mpesaNotification,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scheduler failed.';
    res.status(500).json({ ok: false, error: message, mpesaNotification });
  }
});

router.get('/jobs/run-po-bill-scheduler', async (req, res) => {
  const token = String(req.query.token || '');

  if (!(await isAuthorizedPoBillCronRequest(token))) {
    return res.status(403).json({ ok: false, error: 'Invalid scheduler token.' });
  }

  let mpesaNotification: Awaited<ReturnType<typeof sendDailyMpesaReviewNotification>> | null = null;

  try {
    try {
      mpesaNotification = await sendDailyMpesaReviewNotification();
    } catch (notificationError) {
      mpesaNotification = {
        sent: false,
        reason: notificationError instanceof Error ? notificationError.message : 'notification_failed',
        statementCount: 0,
      };
    }

    const syncMode = req.query.sync === '1' || req.query.sync === 'true';
    if (syncMode) {
      const result = await runPoBillSchedulerCycle('cron');
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

    void runPoBillSchedulerCycle('cron').catch(async (error) => {
      await logEvent('error', 'Cron PO bill scheduler background run failed', {
        error: error instanceof Error ? error.message : 'Unknown failure in background PO bill scheduler.',
      });
    });

    return res.json({
      ok: true,
      status: 'initiated',
      message: 'PO bill scheduler run initiated in background.',
      mpesaNotification,
    });
  } catch (error) {
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
    const mpesaNotification = await sendDailyMpesaReviewNotification();
    res.json({ ok: true, mpesaNotification });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'M-Pesa notification failed.';
    res.status(500).json({ ok: false, error: message });
  }
});

router.get('/jobs/scheduler-failures/export.csv', async (req, res) => {
  try {
    const range = (req.query.range as 'daily' | 'weekly' | 'all') || 'weekly';
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const report = await getSchedulerFailureReport({ range, fromDate, toDate });
    const csv = generateSchedulerFailureCsv(report);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="scheduler-failures-${fromDate || range}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  } catch (error) {
    return res.status(500).send('Could not generate CSV failure report.');
  }
});

router.get('/jobs/scheduler-failures/report.pdf', async (req, res) => {
  try {
    const range = (req.query.range as 'daily' | 'weekly' | 'all') || 'weekly';
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const report = await getSchedulerFailureReport({ range, fromDate, toDate });
    const pdfBuffer = await renderSchedulerFailurePdf(report);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="scheduler-failures-${fromDate || range}-${new Date().toISOString().slice(0, 10)}.pdf"`);
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).send('Could not generate PDF failure report.');
  }
});

router.get('/jobs/scheduler-failures/json', async (req, res) => {
  try {
    const range = (req.query.range as 'daily' | 'weekly' | 'all') || 'weekly';
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;
    const report = await getSchedulerFailureReport({ range, fromDate, toDate });
    return res.json({ ok: true, report });
  } catch (error) {
    return res.status(500).json({ ok: false, message: 'Could not fetch failure report.' });
  }
});

export default router;
