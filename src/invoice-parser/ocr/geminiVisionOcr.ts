import fs from 'fs/promises';
import { AiInvoiceExtractionConfig, OcrPageResult } from '../types';
import { getGeminiOAuthAccessToken } from '../../services/geminiOAuthService';

const DEFAULT_GEMINI_OCR_MODEL = 'gemini-3.6-flash';

export async function geminiVisionOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  ocrConfig?: AiInvoiceExtractionConfig['ocr'],
  geminiApiKey?: string,
  geminiOAuthConnected?: boolean,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];

  let oauth: { accessToken: string; projectId: string } | null = null;
  let oauthError: unknown = null;
  try {
    // Match the main Gemini extractor: a connected OAuth account takes
    // precedence over stale or invalid API keys saved in OCR settings.
    oauth = await getGeminiOAuthAccessToken();
  } catch (error) {
    oauthError = error;
    oauth = null;
  }
  const apiKey = oauth
    ? undefined
    : ocrConfig?.apiKey || geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey && !oauth) {
    return {
      pages: [],
      warnings: [
        ...(geminiOAuthConnected && oauthError
          ? [`Google Gemini OAuth connection failed: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}`]
          : []),
        'Google Gemini Vision OCR skipped because no Gemini API key or OAuth connection is configured.',
      ],
    };
  }
  if (geminiOAuthConnected && oauthError) {
    warnings.push(
      `Google Gemini OAuth connection failed: ${oauthError instanceof Error ? oauthError.message : String(oauthError)}. Falling back to the configured Gemini API key.`,
    );
  }
  if (oauth) warnings.push('Google Gemini Vision OCR using the connected OAuth account.');

  const configuredModel = ocrConfig?.model?.trim();
  const model = configuredModel &&
    configuredModel !== 'nvidia/nemotron-ocr-v2' &&
    configuredModel !== 'gemini-flash-latest'
    ? configuredModel
    : DEFAULT_GEMINI_OCR_MODEL;
  const configuredBaseUrl = ocrConfig?.endpoint?.trim().replace(/\/+$/, '');
  const baseUrl = configuredBaseUrl &&
    !/ai\.api\.nvidia\.com|\/cv\/nvidia\//i.test(configuredBaseUrl)
    ? configuredBaseUrl
    : 'https://generativelanguage.googleapis.com/v1beta';
  const pages: OcrPageResult[] = [];

  try {
    for (const image of imagePaths) {
      const buffer = await fs.readFile(image.imagePath);
      const base64 = buffer.toString('base64');
      const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

      let attempt = 0;
      let response: Response | null = null;
      let detail = '';

      while (attempt <= 2) {
        attempt += 1;
        response = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(30000),
          headers: {
            'Content-Type': 'application/json',
            ...(oauth
              ? {
                  Authorization: `Bearer ${oauth.accessToken}`,
                  'x-goog-user-project': oauth.projectId,
                }
              : { 'X-goog-api-key': apiKey || '' }),
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: 'Transcribe all text from this scanned image page exactly as written line-by-line. Output only the extracted plain text without code blocks, markdown wrappers, or extra explanations.',
                  },
                  {
                    inline_data: {
                      mime_type: 'image/png',
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

        if (response.ok) break;

        const errJson = await response.clone().json().catch(() => null);
        detail = errJson?.error?.message || 'API error';

        if (attempt <= 2 && [429, 500, 502, 503, 504].includes(response.status)) {
          const match = detail.match(/retry\s+in\s+([\d.]+)\s*s/i);
          const seconds = match?.[1] ? parseFloat(match[1]) : NaN;
          const backoffMs = !Number.isNaN(seconds) && seconds > 0
            ? Math.min(Math.round(seconds * 1000), 8000)
            : attempt * 2500;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        break;
      }

      if (!response || !response.ok) {
        if ([400, 401, 403].includes(response?.status || 0)) {
          warnings.push(`Google Gemini Vision OCR stopped after a credential/configuration error (HTTP ${response?.status}): ${detail}. Falling back to the other OCR engines.`);
          break;
        }
        if (response?.status === 429) {
          warnings.push(`Google Gemini Vision OCR rate limited page ${image.pageNumber} (HTTP 429): ${detail}. Falling back to other OCR engines.`);
        } else {
          warnings.push(`Google Gemini Vision OCR page ${image.pageNumber} failed (HTTP ${response?.status || '#'}): ${detail}`);
        }
        continue;
      }

      const resJson = await response.json();
      const text = resJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      pages.push({
        pageNumber: image.pageNumber,
        text,
        confidence: 0.95,
        imagePath: image.imagePath,
        engine: 'gemini_vision',
      });
    }

    return { pages, warnings };
  } catch (error) {
    return {
      pages: [],
      warnings: [`Google Gemini Vision OCR failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
