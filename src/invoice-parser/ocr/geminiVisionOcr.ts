import fs from 'fs/promises';
import { AiInvoiceExtractionConfig, OcrPageResult } from '../types';

export async function geminiVisionOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  ocrConfig?: AiInvoiceExtractionConfig['ocr'],
  geminiApiKey?: string,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];

  const apiKey = ocrConfig?.apiKey || geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { pages: [], warnings: ['Google Gemini Vision OCR skipped because no Gemini API key is configured.'] };
  }

  const model = (ocrConfig?.model && ocrConfig.model.trim() && ocrConfig.model !== 'nvidia/nemotron-ocr-v2')
    ? ocrConfig.model.trim()
    : 'gemini-flash-latest';
  const pages: OcrPageResult[] = [];

  try {
    for (const image of imagePaths) {
      const buffer = await fs.readFile(image.imagePath);
      const base64 = buffer.toString('base64');

      const baseUrl = ocrConfig?.endpoint?.replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com/v1beta';
      const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;

      const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': apiKey,
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

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        warnings.push(`Google Gemini Vision OCR page ${image.pageNumber} failed (HTTP ${response.status}): ${errJson?.error?.message || 'API error'}`);
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
