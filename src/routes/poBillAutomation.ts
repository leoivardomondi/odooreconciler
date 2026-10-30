import path from 'path';
import { Response, Router } from 'express';
import {
  completePoBillManualJob,
  createPoBillManualJob,
  getPoBillManualJobById,
  getSchedulerRuntimeState,
  getSettings,
  requestSchedulerStop,
  resetPoBillExhaustedDocuments,
} from '../models/repositories';
import { PoBillAutomationResult } from '../models/types';
import { OdooClient } from '../services/odooClient';
import {
  getRecentDocumentPdfsPage,
  getRecentDocumentPdfs,
  isSupportedPoBillMimetype,
  RecentDocumentPdfsPage,
  retryFailedPoBillPayment,
} from '../services/poBillAutomationService';
import { buildPoBillSchedulerDiagnostics } from '../services/poBillSchedulerDiagnosticsService';
import { getSchedulerStatus, runPoBillSchedulerCycle } from '../services/schedulerService';
import { logEvent } from '../services/logService';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';
import { wakePoBillManualJobWorker } from '../services/poBillManualJobService';

const router = Router();
const RECENT_PDFS_PAGE_SIZE = 25;
type ManualPoCheckJobView = {
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: PoBillAutomationResult | null;
  error?: string | null;
  startedAt: number;
  finishedAt?: number;
};

function parsePositiveInteger(value: unknown, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function emptyRecentPdfsPage(page = 1): RecentDocumentPdfsPage {
  return {
    items: [],
    page,
    pageSize: RECENT_PDFS_PAGE_SIZE,
    total: 0,
    totalPages: 1,
    from: 0,
    to: 0,
    sinceDate: '2026-05-01 00:00:00',
  };
}

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

async function renderPage(
  res: Response,
  options: {
    status: { type: string; message: string } | null;
    result?: PoBillAutomationResult | null;
    form?: {
      attachmentId?: string;
      purchaseOrderSearch?: string;
      mode?: string;
      pdfPage?: string;
    };
    loadRecentPdfs?: boolean;
    manualJob?: { id: string; status: ManualPoCheckJobView['status']; startedAt: number; finishedAt?: number } | null;
  },
) {
  const requestedPdfPage = parsePositiveInteger(options.form?.pdfPage, 1);
  let recentPdfsPage = emptyRecentPdfsPage(requestedPdfPage);
  let queueDiagnostics: Awaited<ReturnType<typeof buildPoBillSchedulerDiagnostics>> | null = null;
  const schedulerStatus = await getSchedulerStatus().catch(() => null);
  const recentPdfsLoaded = Boolean(options.loadRecentPdfs);

  if (recentPdfsLoaded) {
    const { client } = await buildClient();
    const [pageResult, queueDocuments] = await Promise.all([
      getRecentDocumentPdfsPage(client, {
        page: requestedPdfPage,
        pageSize: RECENT_PDFS_PAGE_SIZE,
      }).catch(() => emptyRecentPdfsPage(requestedPdfPage)),
      getRecentDocumentPdfs(client, 250).catch(() => []),
    ]);
    recentPdfsPage = pageResult;
    queueDiagnostics = await buildPoBillSchedulerDiagnostics(queueDocuments);
  }

  res.render('po-bill-automation', {
    pageTitle: 'PO Bill Automation',
    status: options.status,
    recentPdfs: recentPdfsPage.items,
    recentPdfsPage,
    recentPdfsLoaded,
    queueDiagnostics,
    schedulerStatus,
    result: options.result || null,
    manualJob: options.manualJob || null,
    form: {
      attachmentId: options.form?.attachmentId || '',
      purchaseOrderSearch: options.form?.purchaseOrderSearch || '',
      mode: options.form?.mode || 'review',
      pdfPage: String(recentPdfsPage.page),
    },
  });
}

router.get('/po-bill-automation', async (req, res) => {
  const requestedPdfPage = parsePositiveInteger(req.query.pdfPage, 1);
  const loadRecentPdfs =
    req.query.loadPdfs === '1' || requestedPdfPage > 1 || Boolean(String(req.query.attachmentId || '').trim());
  const manualJobId = String(req.query.jobId || '').trim();
  const manualJob = manualJobId ? await getPoBillManualJobById(manualJobId).catch(() => null) : null;
  const manualJobView = manualJob
    ? {
        id: manualJob.id,
        status: manualJob.status,
        startedAt: Date.parse(manualJob.startedAt || manualJob.createdAt) || Date.now(),
        finishedAt: manualJob.completedAt ? Date.parse(manualJob.completedAt) : undefined,
      }
    : null;

  if (manualJob && manualJob.status === 'running' && manualJobView && Date.now() - manualJobView.startedAt > 300_000) {
    manualJob.status = 'failed';
    manualJob.errorMessage = 'PO bill check timed out after exceeding 5 minutes.';
    manualJobView.status = 'failed';
    void completePoBillManualJob({ id: manualJob.id, status: 'failed', errorMessage: manualJob.errorMessage }).catch(() => undefined);
  }

  try {
    await renderPage(res, {
      status: manualJob?.status === 'failed'
        ? { type: 'danger', message: manualJob.errorMessage || 'PO bill check failed.' }
        : manualJob?.status === 'completed'
          ? { type: 'success', message: 'PO bill check completed.' }
          : typeof req.query.message === 'string'
        ? { type: 'info', message: req.query.message }
        : typeof req.query.error === 'string'
          ? { type: 'danger', message: req.query.error }
          : null,
      form: {
        attachmentId: String(req.query.attachmentId || ''),
        purchaseOrderSearch: String(req.query.purchaseOrderSearch || ''),
        mode: req.query.mode === 'auto' ? 'auto' : 'review',
        pdfPage: String(requestedPdfPage),
      },
      result: manualJob?.status === 'completed' ? manualJob.result : null,
      manualJob: manualJobView,
      loadRecentPdfs,
    });
  } catch (error) {
    res.status(500).render('po-bill-automation', {
      pageTitle: 'PO Bill Automation',
      status: {
        type: 'danger',
        message: error instanceof Error ? error.message : 'Could not load PO bill automation.',
      },
      recentPdfs: [],
      recentPdfsPage: emptyRecentPdfsPage(requestedPdfPage),
      recentPdfsLoaded: false,
      queueDiagnostics: null,
      result: null,
      manualJob: null,
      form: {
        attachmentId: String(req.query.attachmentId || ''),
        purchaseOrderSearch: String(req.query.purchaseOrderSearch || ''),
        mode: req.query.mode === 'auto' ? 'auto' : 'review',
        pdfPage: String(requestedPdfPage),
      },
    });
  }
});

router.get('/po-bill-automation/attachments/:attachmentId/preview', async (req, res) => {
  const attachmentId = Number(req.params.attachmentId);

  try {
    if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
      throw new Error('Invalid attachment ID.');
    }

    const { client } = await buildClient();
    const attachment = await client.downloadAttachment(attachmentId);
    const filename = path.basename(attachment.name || `attachment-${attachment.id}`).replace(/"/g, '');

    if (!isSupportedPoBillMimetype(attachment.mimetype)) {
      throw new Error('Only supported PDF or image attachments can be previewed here.');
    }

    res.setHeader('Content-Type', String(attachment.mimetype));
    res.setHeader('Content-Length', String(attachment.content.length));
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(attachment.content);
  } catch (error) {
    res.status(404).render('error', {
      pageTitle: 'Document Preview Error',
      errorMessage: error instanceof Error ? error.message : 'Could not preview document.',
      details: [],
    });
  }
});

router.post('/po-bill-automation/run', async (req, res) => {
  const attachmentId = Number(req.body.attachmentId);
  const purchaseOrderSearch = String(req.body.purchaseOrderSearch || '').trim();
  const mode = req.body.mode === 'auto' ? 'auto' : 'review';
  const form = {
    attachmentId: String(req.body.attachmentId || ''),
    purchaseOrderSearch,
    mode,
    pdfPage: String(req.body.pdfPage || '1'),
  };
  const loadRecentPdfs = req.body.loadPdfs === '1';

  if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
    return res.redirect(`/po-bill-automation?error=${encodeURIComponent('Enter a valid Odoo attachment ID.')}`);
  }

  const job = await createPoBillManualJob({ attachmentId, purchaseOrderSearch, mode });
  wakePoBillManualJobWorker();

  await renderPage(res, {
    status: {
      type: 'info',
      message: `PO bill check for attachment ${attachmentId} is running.`,
    },
    form,
    result: null,
    manualJob: { id: job.id, status: job.status, startedAt: Date.parse(job.createdAt) || Date.now() },
    loadRecentPdfs,
  });
});

router.get('/po-bill-automation/manual-jobs/:jobId', async (req, res) => {
  try {
    const job = await getPoBillManualJobById(req.params.jobId);
    const startedAt = Date.parse(job.startedAt || job.createdAt) || Date.now();
    if (job.status === 'running' && Date.now() - startedAt > 300_000) {
      job.status = 'failed';
      job.errorMessage = 'PO bill check timed out after exceeding 5 minutes.';
      void completePoBillManualJob({ id: job.id, status: 'failed', errorMessage: job.errorMessage }).catch(() => undefined);
    }
    res.json({ ok: true, job });
  } catch (error) {
    res.status(404).json({ ok: false, error: error instanceof Error ? error.message : 'PO bill job not found.' });
  }
});

router.post('/po-bill-automation/run-scheduler', async (req, res) => {
  const pdfPage = String(req.body.pdfPage || '1');
  const loadRecentPdfs = req.body.loadPdfs === '1';
  void runPoBillSchedulerCycle('manual').catch(async (error) => {
    await logEvent('error', 'Manual PO bill scheduler background run failed', {
      error: error instanceof Error ? error.message : 'Unknown failure in manual PO bill scheduler.',
    });
  });

  const query = new URLSearchParams({
    message: 'PO bill scheduler run initiated in background.',
    pdfPage,
  });
  if (loadRecentPdfs) query.set('loadPdfs', '1');
  res.redirect(`/po-bill-automation?${query.toString()}`);
});

router.post('/po-bill-automation/stop-scheduler', async (req, res) => {
  const pdfPage = String(req.body.pdfPage || '1');
  const loadRecentPdfs = req.body.loadPdfs === '1';

  try {
    const runtimeState = await getSchedulerRuntimeState();
    const requested = await requestSchedulerStop(runtimeState.lockRunId);
    await renderPage(res, {
      status: {
        type: requested ? 'warning' : 'info',
        message: requested
          ? 'Stop requested. The scheduler will stop after the current document finishes.'
          : 'No active PO bill scheduler run was found.',
      },
      form: { mode: 'auto', pdfPage },
      loadRecentPdfs,
    });
  } catch (error) {
    await renderPage(res, {
      status: {
        type: 'danger',
        message: error instanceof Error ? error.message : 'Could not request scheduler stop.',
      },
      form: { mode: 'auto', pdfPage },
      loadRecentPdfs,
    });
  }
});

router.post('/po-bill-automation/reset-exhausted', async (req, res) => {
  const pdfPage = String(req.body.pdfPage || '1');
  const loadRecentPdfs = req.body.loadPdfs === '1';

  try {
    const resetCount = await resetPoBillExhaustedDocuments();
    const query = new URLSearchParams({
      message: `Reset attempt count for ${resetCount} document(s). The scheduler will re-check them on its next run.`,
      pdfPage,
    });
    if (loadRecentPdfs) query.set('loadPdfs', '1');
    res.redirect(`/po-bill-automation?${query.toString()}`);
  } catch (error) {
    const query = new URLSearchParams({
      error: error instanceof Error ? error.message : 'Could not reset exhausted documents.',
      pdfPage,
    });
    if (loadRecentPdfs) query.set('loadPdfs', '1');
    res.redirect(`/po-bill-automation?${query.toString()}`);
  }
});

router.post('/po-bill-automation/retry-payment', async (req, res) => {
  const billName = typeof req.body.billName === 'string' ? req.body.billName.trim() : undefined;
  const billId = req.body.billId ? Number(req.body.billId) : undefined;
  const pinNote = req.body.pinNote === 'ETR' ? 'ETR' : 'NO PIN';
  const paymentDate =
    typeof req.body.paymentDate === 'string' ? req.body.paymentDate.trim() : undefined;
  const purchaseOrderNames = Array.isArray(req.body.purchaseOrderNames)
    ? req.body.purchaseOrderNames
    : typeof req.body.purchaseOrderNames === 'string'
      ? req.body.purchaseOrderNames
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined;

  try {
    const { client } = await buildClient();
    const result = await retryFailedPoBillPayment(client, {
      billName,
      billId,
      pinNote,
      paymentDate,
      purchaseOrderNames,
    });

    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.json(result);
    }

    const query = new URLSearchParams({
      message: result.message,
    });
    res.redirect(`/po-bill-automation?${query.toString()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retry bill payment.';
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(500).json({ success: false, message });
    }
    const query = new URLSearchParams({ error: message });
    res.redirect(`/po-bill-automation?${query.toString()}`);
  }
});

export default router;
