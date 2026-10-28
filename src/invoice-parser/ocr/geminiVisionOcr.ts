import { AiInvoiceExtractionConfig, OcrPageResult } from '../types';

export async function geminiVisionOcr(
  _imagePaths: Array<{ pageNumber: number; imagePath: string }>,
  _ocrConfig?: AiInvoiceExtractionConfig['ocr'],
  _geminiApiKey?: string,
  _geminiOAuthConnected?: boolean,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  return {
    pages: [],
    warnings: ['Google Gemini Vision OCR is currently disabled.'],
  };
}
