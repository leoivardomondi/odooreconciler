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

export function shouldUseGeminiVisionFallback(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return true;

  const tokens = normalized.split(' ').filter(Boolean);
  const shortTokenCount = tokens.filter(
    (token) => token.length <= 1 && /[a-z0-9]/i.test(token),
  ).length;
  const shortTokenRatio = tokens.length > 0 ? shortTokenCount / tokens.length : 1;
  const repeatedTotals = (normalized.match(/\b(?:total|tutal)\b/gi) || []).length;
  const repeatedInvoiceSignals =
    (normalized.match(/\b(?:invoice|invoicen|receipt|n?umber|vat|date)\b/gi) || []).length;
  const fragmentedSignals =
    (normalized.match(/\b(?:tutal|inyoice|invoicen|quast|desux|amqlent|recetv|n?imber)\b/gi) || []).length;

  return normalized.length < 180 ||
    (tokens.length >= 35 && shortTokenRatio >= 0.28) ||
    repeatedTotals >= 4 ||
    repeatedInvoiceSignals >= 8 ||
    fragmentedSignals >= 2;
}

async function maybeRunGeminiVisionFallback(
  pages: OcrPageResult[],
  _imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  _ocrConfig: AiInvoiceExtractionConfig['ocr'] | undefined,
  _geminiApiKey: string | undefined,
  _geminiOAuthConnected: boolean | undefined,
  _warnings: string[],
) {
  // Gemini is disabled for now
  return pages;
}

export async function runOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  preferredOcr: PreferredOcr,
  ocrConfig?: AiInvoiceExtractionConfig['ocr'],
  geminiApiKey?: string,
  geminiOAuthConnected?: boolean,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];

  const useGemini = false;

  if (useGemini) {
    const gemini = await geminiVisionOcr(imagePaths, ocrConfig, geminiApiKey, geminiOAuthConnected);
    warnings.push(...gemini.warnings);
    if (gemini.pages.length > 0) {
      return { pages: mergeOcrPages(gemini.pages), warnings };
    }
  }

  const nvidia = await nvidiaNemoretrieverOcr(imagePaths, ocrConfig);
  warnings.push(...nvidia.warnings);
  if (nvidia.pages.length > 0) {
    const pages = await maybeRunGeminiVisionFallback(
      nvidia.pages,
      imagePaths,
      ocrConfig,
      geminiApiKey,
      geminiOAuthConnected,
      warnings,
    );
    return { pages, warnings };
  }

  const useGoogle =
    preferredOcr === 'google' ||
    ocrConfig?.provider === 'google' ||
    (preferredOcr === 'auto' && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS));

  if (useGoogle) {
    const google = await googleVisionOcr(imagePaths);
    warnings.push(...google.warnings);
    if (google.pages.length > 0 || preferredOcr === 'google') {
      const pages = await maybeRunGeminiVisionFallback(
        google.pages,
        imagePaths,
        ocrConfig,
        geminiApiKey,
        geminiOAuthConnected,
        warnings,
      );
      return { pages, warnings };
    }
  }

  const tesseract = await tesseractOcr(imagePaths);
  warnings.push(...tesseract.warnings);
  const pages = await maybeRunGeminiVisionFallback(
    tesseract.pages,
    imagePaths,
    ocrConfig,
    geminiApiKey,
    geminiOAuthConnected,
    warnings,
  );
  return { pages, warnings };
}
