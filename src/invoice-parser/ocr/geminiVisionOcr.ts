import fs from 'fs/promises';
import path from 'path';
import { AiInvoiceExtractionConfig, OcrPageResult } from '../types';
import { getGeminiOAuthAccessToken } from '../../services/geminiOAuthService';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function mimeTypeForImage(imagePath: string) {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

function normalizeGeminiOcrModel(rawModel?: string): string {
  const trimmed = String(rawModel || '').trim().replace(/^models\//i, '');
  if (!trimmed || /^nvidia\//i.test(trimmed)) {
    return 'gemini-3.8-flash';
  }
  return trimmed;
}

function buildGeminiOcrModelTryOrder(primaryModel: string): string[] {
  const fallbacks = primaryModel.endsWith('-lite')
    ? ['gemini-3.8-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite', 'gemini-2.5-flash']
    : ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  return [...new Set([primaryModel, ...fallbacks])];
}

export async function geminiVisionOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  ocrConfig?: AiInvoiceExtractionConfig['ocr'],
  geminiApiKey?: string,
  geminiOAuthConnected?: boolean,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];

  if (process.env.DISABLE_GEMINI === 'true') {
    return {
      pages: [],
      warnings: ['Google Gemini Vision OCR is disabled (DISABLE_GEMINI=true).'],
    };
  }

  let accessToken = '';
  let projectId = '';
  const apiKey = (ocrConfig?.apiKey || geminiApiKey || process.env.GEMINI_API_KEY || '').trim();

  if (geminiOAuthConnected) {
    try {
      const oauth = await getGeminiOAuthAccessToken();
      accessToken = oauth.accessToken;
      projectId = oauth.projectId;
    } catch (err) {
      if (!apiKey) {
        return {
          pages: [],
          warnings: [`Google Gemini Vision OCR OAuth failed: ${err instanceof Error ? err.message : String(err)}`],
        };
      }
    }
  }

  if (!accessToken && !apiKey) {
    return {
      pages: [],
      warnings: ['Google Gemini Vision OCR skipped because no Gemini API key or OAuth connection is configured.'],
    };
  }

  const configuredEndpoint = String(ocrConfig?.endpoint || '').trim().replace(/\/+$/, '');
  const baseUrl =
    configuredEndpoint && !/ai\.api\.nvidia\.com|\/cv\/nvidia\//i.test(configuredEndpoint)
      ? configuredEndpoint
      : GEMINI_BASE_URL;
  const primaryModel = normalizeGeminiOcrModel(ocrConfig?.model);
  const modelsToTry = buildGeminiOcrModelTryOrder(primaryModel);

  const pages: OcrPageResult[] = [];

  for (const image of imagePaths) {
    try {
      let buffer: Buffer = await fs.readFile(image.imagePath);
      let mediaType = mimeTypeForImage(image.imagePath);
      if (buffer.length > 800_000) {
        try {
          const canvasModule = await import('@napi-rs/canvas');
          const img = await canvasModule.loadImage(buffer);
          const maxDim = 1800;
          const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
          const targetW = Math.max(1, Math.round(img.width * scale));
          const targetH = Math.max(1, Math.round(img.height * scale));
          const canvas = canvasModule.createCanvas(targetW, targetH);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, targetW, targetH);
          buffer = Buffer.from(await canvas.encode('jpeg', 85));
          mediaType = 'image/jpeg';
        } catch {
          // Retain original buffer if canvas resize fails
        }
      }
      const base64 = buffer.toString('base64');

      let response: Response | null = null;
      let payload: any = null;

      for (const model of modelsToTry) {
        const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
        response = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(45000),
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken
              ? {
                  Authorization: `Bearer ${accessToken}`,
                  ...(projectId ? { 'x-goog-user-project': projectId } : {}),
                }
              : { 'X-goog-api-key': apiKey }),
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'Transcribe all visible text from this invoice/receipt image line by line as plain text. Preserve numbers, dates, PINs, quantities, unit prices, and totals accurately. Do not add commentary.',
                  },
                  {
                    inline_data: {
                      mime_type: mediaType,
                      data: base64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
            },
          }),
        });

        payload = await response.json().catch(() => null);
        if (response.ok) break;
        if (response.status === 404 && modelsToTry.length > 1) {
          continue;
        }
        break;
      }

      if (!response || !response.ok) {
        warnings.push(
          `Google Gemini Vision OCR failed on page ${image.pageNumber}: ${
            payload?.error?.message || `HTTP ${response?.status || '#'}`
          }`,
        );
        continue;
      }

      const text = (payload?.candidates?.[0]?.content?.parts || [])
        .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();

      if (text) {
        pages.push({
          pageNumber: image.pageNumber,
          text,
          confidence: 0.9,
          imagePath: image.imagePath,
          engine: 'gemini_vision',
        });
      }
    } catch (err) {
      warnings.push(
        `Google Gemini Vision OCR error on page ${image.pageNumber}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { pages, warnings };
}
