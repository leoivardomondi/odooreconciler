"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("../services/odooClient");
const poBillAutomationService_1 = require("../services/poBillAutomationService");
const poBillSchedulerDiagnosticsService_1 = require("../services/poBillSchedulerDiagnosticsService");
const schedulerService_1 = require("../services/schedulerService");
const logService_1 = require("../services/logService");
const helpers_1 = require("../utils/helpers");
const router = (0, express_1.Router)();
const RECENT_PDFS_PAGE_SIZE = 25;
function parsePositiveInteger(value, fallback = 1) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
function emptyRecentPdfsPage(page = 1) {
    return {
        items: [],
        page,
        pageSize: RECENT_PDFS_PAGE_SIZE,
        total: 0,
        totalPages: 1,
        from: 0,
        to: 0,
        sinceDate: '2026-01-01 00:00:00',
    };
}
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
async function renderPage(res, options) {
    const requestedPdfPage = parsePositiveInteger(options.form?.pdfPage, 1);
    let recentPdfsPage = emptyRecentPdfsPage(requestedPdfPage);
    let queueDiagnostics = null;
    const schedulerStatus = await (0, schedulerService_1.getSchedulerStatus)().catch(() => null);
    const recentPdfsLoaded = Boolean(options.loadRecentPdfs);
    if (recentPdfsLoaded) {
        const { client } = await buildClient();
        const [pageResult, queueDocuments] = await Promise.all([
            (0, poBillAutomationService_1.getRecentDocumentPdfsPage)(client, {
                page: requestedPdfPage,
                pageSize: RECENT_PDFS_PAGE_SIZE,
            }).catch(() => emptyRecentPdfsPage(requestedPdfPage)),
            (0, poBillAutomationService_1.getRecentDocumentPdfs)(client, 250).catch(() => []),
        ]);
        recentPdfsPage = pageResult;
        queueDiagnostics = await (0, poBillSchedulerDiagnosticsService_1.buildPoBillSchedulerDiagnostics)(queueDocuments);
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
    const loadRecentPdfs = req.query.loadPdfs === '1' || requestedPdfPage > 1 || Boolean(String(req.query.attachmentId || '').trim());
    try {
        await renderPage(res, {
            status: typeof req.query.message === 'string'
                ? { type: 'info', message: req.query.message }
                : typeof req.query.error === 'string'
                    ? { type: 'danger', message: req.query.error }
                    : null,
            form: {
                attachmentId: String(req.query.attachmentId || ''),
                pdfPage: String(requestedPdfPage),
            },
            loadRecentPdfs,
        });
    }
    catch (error) {
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
            form: {
                attachmentId: String(req.query.attachmentId || ''),
                purchaseOrderSearch: '',
                mode: 'review',
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
        const filename = path_1.default.basename(attachment.name || `attachment-${attachment.id}`).replace(/"/g, '');
        if (!(0, poBillAutomationService_1.isSupportedPoBillMimetype)(attachment.mimetype)) {
            throw new Error('Only supported PDF or image attachments can be previewed here.');
        }
        res.setHeader('Content-Type', String(attachment.mimetype));
        res.setHeader('Content-Length', String(attachment.content.length));
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.send(attachment.content);
    }
    catch (error) {
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
    try {
        if (!Number.isFinite(attachmentId) || attachmentId <= 0) {
            throw new Error('Enter a valid Odoo attachment ID.');
        }
        const { client, settings } = await buildClient();
        const result = await (0, poBillAutomationService_1.runPoBillAutomation)(client, {
            attachmentId,
            purchaseOrderSearch,
            mode,
            aiConfig: settings.ai,
        });
        await renderPage(res, {
            status: {
                type: result.canAutoProceed ? 'success' : mode === 'review' ? 'info' : 'warning',
                message: mode === 'review'
                    ? result.actionsTaken.some((action) => /^Logged (?:ETR|NO PIN) note on /i.test(action))
                        ? 'Review completed. The PIN note was logged on the matched PO.'
                        : 'Review completed. No PO note was logged because no bill-ready PO match was selected.'
                    : result.canAutoProceed
                        ? 'Auto gates passed. The app ran PO attachment, bill creation, receipt validation, and activity actions.'
                        : 'Auto mode stopped before bill/receipt actions because one or more gates failed.',
            },
            result,
            form,
            loadRecentPdfs,
        });
    }
    catch (error) {
        await renderPage(res, {
            status: {
                type: 'danger',
                message: error instanceof Error ? error.message : 'PO bill automation failed.',
            },
            form,
            loadRecentPdfs,
        });
    }
});
router.post('/po-bill-automation/run-scheduler', async (req, res) => {
    const pdfPage = String(req.body.pdfPage || '1');
    const loadRecentPdfs = req.body.loadPdfs === '1';
    void (0, schedulerService_1.runPoBillSchedulerCycle)('manual').catch(async (error) => {
        await (0, logService_1.logEvent)('error', 'Manual PO bill scheduler background run failed', {
            error: error instanceof Error ? error.message : 'Unknown failure in manual PO bill scheduler.',
        });
    });
    const query = new URLSearchParams({
        message: 'PO bill scheduler run initiated in background.',
        pdfPage,
    });
    if (loadRecentPdfs)
        query.set('loadPdfs', '1');
    res.redirect(`/po-bill-automation?${query.toString()}`);
});
router.post('/po-bill-automation/stop-scheduler', async (req, res) => {
    const pdfPage = String(req.body.pdfPage || '1');
    const loadRecentPdfs = req.body.loadPdfs === '1';
    try {
        const runtimeState = await (0, repositories_1.getSchedulerRuntimeState)();
        const requested = await (0, repositories_1.requestSchedulerStop)(runtimeState.lockRunId);
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
    }
    catch (error) {
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
exports.default = router;
