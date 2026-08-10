import { AiInvoiceExtractionConfig, PreferredOcr, OcrPageResult } from '../types';
import { googleVisionOcr } from './googleVisionOcr';
import { nvidiaNemoretrieverOcr } from './nvidiaNemoretrieverOcr';
import { geminiVisionOcr } from './geminiVisionOcr';
import { tesseractOcr } from './tesseractOcr';

function mergeOcrPages(pages: OcrPageResult[]): OcrPageResult[] {
  const grouped = new Map<number, OcrPageResult[]>();
  for (const page of pages) {
    const entries = grouped.get(page.pageNumber) || [];
    entries.push(page);
    grouped.set(page.pageNumber, entries);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageNumber, entries]) => {
      const seen = new Set<string>();
      const text = entries
        .map((entry) => entry.text.trim())
        .filter((entry) => {
          if (!entry || seen.has(entry)) return false;
          seen.add(entry);
          return true;
        })
        .join('\n\n');
      const confidenceValues = entries
        .map((entry) => entry.confidence)
        .filter((value): value is number => typeof value === 'number');

      return {
        ...entries[0],
        pageNumber,
        text,
        confidence: confidenceValues.length > 0
          ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
          : null,
      };
    });
}

export async function runOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  preferredOcr: PreferredOcr,
  ocrConfig?: AiInvoiceExtractionConfig['ocr'],
  geminiApiKey?: string,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];

  const useGemini =
    preferredOcr === 'gemini_vision' ||
    ocrConfig?.provider === 'gemini_vision';

  if (useGemini) {
    const gemini = await geminiVisionOcr(imagePaths, ocrConfig, geminiApiKey);
    warnings.push(...gemini.warnings);
    if (gemini.pages.length > 0) {
      return { pages: mergeOcrPages(gemini.pages), warnings };
    }
  }

    const nvidia = await nvidiaNemoretrieverOcr(imagePaths, ocrConfig);
    warnings.push(...nvidia.warnings);
    if (nvidia.pages.length > 0) {
      return { pages: mergeOcrPages(nvidia.pages), warnings };
  }

  const useGoogle =
    preferredOcr === 'google' ||
    ocrConfig?.provider === 'google' ||
    (preferredOcr === 'auto' && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS));

  if (useGoogle) {
    const google = await googleVisionOcr(imagePaths);
    warnings.push(...google.warnings);
    if (google.pages.length > 0 || preferredOcr === 'google') {
      return { pages: mergeOcrPages(google.pages), warnings };
    }
  }

  const tesseract = await tesseractOcr(imagePaths);
  warnings.push(...tesseract.warnings);
  return { pages: mergeOcrPages(tesseract.pages), warnings };
}
