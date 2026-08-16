"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const repositories_1 = require("../models/repositories");
const invoiceExtractionJobService_1 = require("../services/invoiceExtractionJobService");
const paths_1 = require("../utils/paths");
const router = (0, express_1.Router)();
const uploadDir = (0, paths_1.resolveProjectFile)(process.env.UPLOAD_DIR || 'uploads', 'uploads');
async function ensurePrivateUploadDirectory() {
    await promises_1.default.mkdir(uploadDir, { recursive: true });
    await promises_1.default.writeFile(path_1.default.join(uploadDir, '.htaccess'), 'Require all denied\n', { flag: 'wx' }).catch((error) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
            return;
        }
        throw error;
    });
}
const storage = multer_1.default.diskStorage({
    destination: async (_req, _file, callback) => {
        try {
            await ensurePrivateUploadDirectory();
            callback(null, uploadDir);
        }
        catch (error) {
            callback(error instanceof Error ? error : new Error(String(error)), uploadDir);
        }
    },
    filename: (_req, file, callback) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
        callback(null, `${Date.now()}-${safeName}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const extension = path_1.default.extname(file.originalname).toLowerCase();
        const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'];
        if (allowed.includes(extension)) {
            callback(null, true);
            return;
        }
        callback(new Error('Upload a PDF or image file.'));
    },
});
function uploadInvoiceFile(api = false) {
    return (req, res, next) => {
        upload.single('file')(req, res, (error) => {
            if (!error) {
                next();
                return;
            }
            const message = error instanceof multer_1.default.MulterError && error.code === 'LIMIT_FILE_SIZE'
                ? 'The file is too large. Maximum upload size is 20 MB.'
                : error instanceof Error ? error.message : 'Invoice upload failed.';
            if (api) {
                res.status(error instanceof multer_1.default.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
                    .json({ ok: false, error: message });
                return;
            }
            res.status(400).render('invoice-parser', {
                pageTitle: 'Invoice Parser',
                preferredOcr: req.body?.preferredOcr === 'google' || req.body?.preferredOcr === 'tesseract' ? req.body.preferredOcr : 'auto',
                parsedInvoice: null,
                extractionJob: null,
                status: { type: 'danger', message },
            });
        });
    };
}
router.get('/invoice-parser', async (req, res) => {
    const preferredOcr = req.query.preferredOcr === 'google' || req.query.preferredOcr === 'tesseract'
        ? req.query.preferredOcr
        : 'auto';
    const jobId = String(req.query.job || '').trim();
    try {
        const extractionJob = jobId ? await (0, repositories_1.getInvoiceExtractionJobById)(jobId) : null;
        res.render('invoice-parser', {
            pageTitle: 'Invoice Parser',
            preferredOcr,
            parsedInvoice: extractionJob?.result || null,
            extractionJob,
            status: extractionJob?.status === 'failed'
                ? { type: 'danger', message: extractionJob.errorMessage || 'Invoice parsing failed.' }
                : extractionJob?.status === 'completed'
                    ? { type: 'success', message: 'Invoice extraction completed.' }
                    : null,
        });
    }
    catch (error) {
        res.status(404).render('invoice-parser', {
            pageTitle: 'Invoice Parser',
            preferredOcr,
            parsedInvoice: null,
            extractionJob: null,
            status: { type: 'danger', message: error instanceof Error ? error.message : 'Invoice job not found.' },
        });
    }
});
router.post('/invoice-parser', uploadInvoiceFile(), async (req, res) => {
    const preferredOcr = req.body.preferredOcr === 'google' || req.body.preferredOcr === 'tesseract'
        ? req.body.preferredOcr
        : 'auto';
    try {
        if (!req.file) {
            throw new Error('Upload a PDF or image file.');
        }
        const job = await (0, repositories_1.createInvoiceExtractionJob)({
            originalFilename: req.file.originalname,
            preferredOcr,
            storedFilename: path_1.default.relative((0, paths_1.resolveProjectFile)(process.env.UPLOAD_DIR || 'uploads', 'uploads'), req.file.path).replace(/\\/g, '/'),
        });
        (0, invoiceExtractionJobService_1.wakeInvoiceExtractionJobWorker)();
        res.redirect(`/invoice-parser?job=${encodeURIComponent(job.id)}&preferredOcr=${encodeURIComponent(preferredOcr)}`);
    }
    catch (error) {
        res.status(400).render('invoice-parser', {
            pageTitle: 'Invoice Parser',
            preferredOcr,
            parsedInvoice: null,
            extractionJob: null,
            status: { type: 'danger', message: error instanceof Error ? error.message : 'Invoice upload failed.' },
        });
    }
});
router.post('/api/invoices/parse', uploadInvoiceFile(true), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'Upload a file in multipart field "file".' });
            return;
        }
        const preferredOcr = req.body.preferredOcr === 'google' || req.body.preferredOcr === 'tesseract'
            ? req.body.preferredOcr
            : 'auto';
        const job = await (0, repositories_1.createInvoiceExtractionJob)({
            originalFilename: req.file.originalname,
            preferredOcr,
            storedFilename: path_1.default.relative((0, paths_1.resolveProjectFile)(process.env.UPLOAD_DIR || 'uploads', 'uploads'), req.file.path).replace(/\\/g, '/'),
        });
        (0, invoiceExtractionJobService_1.wakeInvoiceExtractionJobWorker)();
        res.status(202).json({ ok: true, jobId: job.id, status: job.status });
    }
    catch (error) {
        res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Invoice upload failed.' });
    }
});
router.get('/invoice-parser/extraction-jobs/:jobId', async (req, res) => {
    try {
        const job = await (0, repositories_1.getInvoiceExtractionJobById)(req.params.jobId);
        res.json({ ok: true, job });
    }
    catch (error) {
        res.status(404).json({ ok: false, error: error instanceof Error ? error.message : 'Invoice job not found.' });
    }
});
exports.default = router;
