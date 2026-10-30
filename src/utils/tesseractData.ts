import fs from 'fs';
import path from 'path';
import { resolveFromProjectRoot } from './paths';

const trainedDataPath = resolveFromProjectRoot('eng.traineddata');

/**
 * Tesseract OCR is disabled by default. Invoice extraction relies on the
 * configured AI vision provider (e.g. OpenAI GPT-4o), which reads scans and
 * handwriting far more accurately. Tesseract was slow on the shared host and
 * produced misleading values (e.g. handwritten "4,100" read as "21100").
 * Set TESSERACT_ENABLED=true to re-enable it as a local fallback.
 */
export function isTesseractEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.TESSERACT_ENABLED || '').toLowerCase());
}

export function getBundledTesseractOptions() {
  if (!fs.existsSync(trainedDataPath)) {
    throw new Error(`Bundled Tesseract language data is missing: ${trainedDataPath}`);
  }
  return {
    langPath: path.dirname(trainedDataPath),
    gzip: false,
    cacheMethod: 'none' as const,
  };
}

export function getBundledTesseractDataPath() {
  return trainedDataPath;
}
