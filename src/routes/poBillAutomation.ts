import { randomUUID } from 'node:crypto';
import path from 'path';
import { Response, Router } from 'express';
import { getSchedulerRuntimeState, getSettings, requestSchedulerStop } from '../models/repositories';
import { PoBillAutomationResult } from '../models/types';
import { OdooClient } from '../services/odooClient';
import {
  getRecentDocumentPdfsPage,
  getRecentDocumentPdfs,
  isSupportedPoBillMimetype,
  RecentDocumentPdfsPage,
  runPoBillAutomation,
} from '../services/poBillAutomationService';
import { buildPoBillSchedulerDiagnostics } from '../services/poBillSchedulerDiagnosticsService';
import { getSchedulerStatus, runPoBillSchedulerCycle } from '../services/schedulerService';
import { logEvent } from '../services/logService';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';

const router = Router();
const RECENT_PDFS_PAGE_SIZE = 25;
type ManualPoCheckJob = {
  status: 'running' | 'completed' | 'failed';
  result?: PoBillAutomationResult;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};
const manualPoCheckJobs = new Map<string, ManualPoCheckJob>();

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
    manualJob?: { id: string; status: ManualPoCheckJob['status']; startedAt: number; finishedAt?: number } | null;
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
  const manualJob = manualJobId ? manualPoCheckJobs.get(manualJobId) || null : null;

  try {
    await renderPage(res, {
      status: manualJob?.status === 'failed'
        ? { type: 'danger', message: manualJob.error || 'PO bill check failed.' }
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
      manualJob: manualJob ? { id: manualJobId, status: manualJob.status, startedAt: manualJob.startedAt, finishedAt: manualJob.finishedAt } : null,
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

  const jobId = randomUUID();
  const startedAt = Date.now();
  manualPoCheckJobs.set(jobId, { status: 'running', startedAt });
  setTimeout(() => manualPoCheckJobs.delete(jobId), 30 * 60 * 1000);

  void (async () => {
    try {
      const { client, settings } = await buildClient();
      const result = await runPoBillAutomation(client, {
        attachmentId,
        purchaseOrderSearch,
        mode,
        aiConfig: settings.ai,
      });

      manualPoCheckJobs.set(jobId, { status: 'completed', result, startedAt, finishedAt: Date.now() });

      await logEvent('info', 'Manual PO bill check completed in background', {
        attachmentId,
        purchaseOrderSearch: purchaseOrderSearch || null,
        mode,
        canAutoProceed: result.canAutoProceed,
        actionsTaken: result.actionsTaken,
        actionsPending: result.actionsPending,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown PO bill automation failure.';
      manualPoCheckJobs.set(jobId, { status: 'failed', error: message, startedAt, finishedAt: Date.now() });
      await logEvent('error', 'Manual PO bill check failed in background', {
        attachmentId,
        purchaseOrderSearch: purchaseOrderSearch || null,
        mode,
        error: message,
      });
    }
  })();

  await renderPage(res, {
    status: {
      type: 'info',
      message: `PO bill check for attachment ${attachmentId} is running.`,
    },
    form,
    result: null,
    manualJob: { id: jobId, status: 'running', startedAt },
    loadRecentPdfs,
  });
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

export default router;
