import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import { PreferredOcr } from '../invoice-parser';
import {
  createInvoiceExtractionJob,
  getInvoiceExtractionJobById,
} from '../models/repositories';
import { wakeInvoiceExtractionJobWorker } from '../services/invoiceExtractionJobService';
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

function uploadInvoiceFile(api = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
        ? 'The file is too large. Maximum upload size is 20 MB.'
        : error instanceof Error ? error.message : 'Invoice upload failed.';
      if (api) {
        res.status(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
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
  const preferredOcr: PreferredOcr =
    req.query.preferredOcr === 'google' || req.query.preferredOcr === 'tesseract'
      ? req.query.preferredOcr
      : 'auto';
  const jobId = String(req.query.job || '').trim();

  try {
    const extractionJob = jobId ? await getInvoiceExtractionJobById(jobId) : null;
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
  } catch (error) {
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

    const job = await createInvoiceExtractionJob({
      originalFilename: req.file.originalname,
      preferredOcr,
      storedFilename: path.relative(resolveProjectFile(process.env.UPLOAD_DIR || 'uploads', 'uploads'), req.file.path).replace(/\\/g, '/'),
    });
    wakeInvoiceExtractionJobWorker();
    res.redirect(`/invoice-parser?job=${encodeURIComponent(job.id)}&preferredOcr=${encodeURIComponent(preferredOcr)}`);
  } catch (error) {
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

    const preferredOcr: PreferredOcr =
      req.body.preferredOcr === 'google' || req.body.preferredOcr === 'tesseract'
        ? req.body.preferredOcr
        : 'auto';
    const job = await createInvoiceExtractionJob({
      originalFilename: req.file.originalname,
      preferredOcr,
      storedFilename: path.relative(resolveProjectFile(process.env.UPLOAD_DIR || 'uploads', 'uploads'), req.file.path).replace(/\\/g, '/'),
    });
    wakeInvoiceExtractionJobWorker();
    res.status(202).json({ ok: true, jobId: job.id, status: job.status });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Invoice upload failed.' });
  }
});

router.get('/invoice-parser/extraction-jobs/:jobId', async (req, res) => {
  try {
    const job = await getInvoiceExtractionJobById(req.params.jobId);
    res.json({ ok: true, job });
  } catch (error) {
    res.status(404).json({ ok: false, error: error instanceof Error ? error.message : 'Invoice job not found.' });
  }
});

export default router;
