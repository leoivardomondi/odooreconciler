import fs from 'fs';
import path from 'path';
import { resolveFromProjectRoot } from './paths';

const trainedDataPath = resolveFromProjectRoot('eng.traineddata');

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
