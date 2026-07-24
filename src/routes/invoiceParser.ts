import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { Router } from 'express';
import { parseSupplierInvoice, PreferredOcr } from '../invoice-parser';
import { getSettings } from '../models/repositories';
import { resolveProjectFile } from '../utils/paths';

const router = Router();

const uploadDir = resolveProjectFile(process.env.UPLOAD_DIR || 'uploads', 'uploads');

async function ensurePrivateUploadDirectory() {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, '.htaccess'), 'Require all denied\n', { flag: 'wx' }).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return;
    }

    throw error;
  });
}

const storage = multer.diskStorage({
  destination: async (_req, _file, callback) => {
    try {
      await ensurePrivateUploadDirectory();
      callback(null, uploadDir);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)), uploadDir);
    }
  },
  filename: (_req, file, callback) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
    callback(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
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

    const settings = await getSettings();
    const parsedInvoice = await parseSupplierInvoice({
      filePath: req.file.path,
      originalFilename: req.file.originalname,
      preferredOcr,
      aiConfig: settings.ai,
    });

    res.json(parsedInvoice);
  } catch (error) {
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

    const preferredOcr: PreferredOcr =
      req.body.preferredOcr === 'google' || req.body.preferredOcr === 'tesseract'
        ? req.body.preferredOcr
        : 'auto';
    const settings = await getSettings();
    const parsedInvoice = await parseSupplierInvoice({
      filePath: req.file.path,
      originalFilename: req.file.originalname,
      preferredOcr,
      aiConfig: settings.ai,
    });

    res.json(parsedInvoice);
  } catch (error) {
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

export default router;
