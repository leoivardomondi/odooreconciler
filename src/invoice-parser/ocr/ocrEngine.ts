import { AiInvoiceExtractionConfig, PreferredOcr, OcrPageResult } from '../types';
import { googleVisionOcr } from './googleVisionOcr';
import { nvidiaNemoretrieverOcr } from './nvidiaNemoretrieverOcr';
import { tesseractOcr } from './tesseractOcr';

export async function runOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  preferredOcr: PreferredOcr,
  ocrConfig?: AiInvoiceExtractionConfig['ocr'],
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];
  const nvidia = await nvidiaNemoretrieverOcr(imagePaths, ocrConfig);
  warnings.push(...nvidia.warnings);
  if (nvidia.pages.length > 0) {
    return { pages: nvidia.pages, warnings };
  }

  const useGoogle =
    preferredOcr === 'google' ||
    (preferredOcr === 'auto' && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS));

  if (useGoogle) {
    const google = await googleVisionOcr(imagePaths);
    warnings.push(...google.warnings);
    if (google.pages.length > 0 || preferredOcr === 'google') {
      return { pages: google.pages, warnings };
    }
  }

  const tesseract = await tesseractOcr(imagePaths);
  warnings.push(...tesseract.warnings);
  return { pages: tesseract.pages, warnings };
}
