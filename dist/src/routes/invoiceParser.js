"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const invoice_parser_1 = require("../invoice-parser");
const repositories_1 = require("../models/repositories");
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
router.get('/invoice-parser', (_req, res) => {
    res.redirect('/po-bill-automation');
});
router.post('/invoice-parser', upload.single('file'), async (req, res) => {
    const preferredOcr = req.body.preferredOcr === 'google' || req.body.preferredOcr === 'tesseract'
        ? req.body.preferredOcr
        : 'auto';
    try {
        if (!req.file) {
            throw new Error('Upload a PDF or image file.');
        }
        const settings = await (0, repositories_1.getSettings)();
        const parsedInvoice = await (0, invoice_parser_1.parseSupplierInvoice)({
            filePath: req.file.path,
            originalFilename: req.file.originalname,
            preferredOcr,
            aiConfig: settings.ai,
        });
        res.json(parsedInvoice);
    }
    catch (error) {
        res.status(400).json({
            error: error instanceof Error ? error.message : 'Invoice parsing failed.',
        });
    }
});
router.post('/api/invoices/parse', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'Upload a file in multipart field "file".' });
            return;
        }
        const preferredOcr = req.body.preferredOcr === 'google' || req.body.preferredOcr === 'tesseract'
            ? req.body.preferredOcr
            : 'auto';
        const settings = await (0, repositories_1.getSettings)();
        const parsedInvoice = await (0, invoice_parser_1.parseSupplierInvoice)({
            filePath: req.file.path,
            originalFilename: req.file.originalname,
            preferredOcr,
            aiConfig: settings.ai,
        });
        res.json(parsedInvoice);
    }
    catch (error) {
        res.status(500).json({
            supplier: null,
            supplier_key: 'UNKNOWN',
            document_type: 'unknown',
            invoice_number: null,
            invoice_date: null,
            customer: null,
            currency: 'KES',
            items: [],
            totals: { goods_total: null, vat: null, amount_due: null },
            confidence: { supplier: 0, invoice_number: 0, date: 0, items: 0, totals: 0, overall: 0 },
            warnings: [error instanceof Error ? error.message : 'Invoice parsing failed.'],
            raw: { pdf_text: '', ocr_text: '', pages: [] },
        });
    }
});
exports.default = router;
