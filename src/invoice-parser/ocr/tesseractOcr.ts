import { OcrPageResult } from '../types';

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  return Promise.race([
    operation,
    new Promise<T>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

export async function tesseractOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];

  try {
    const tesseract = await import('tesseract.js');
    const recognizer = tesseract.default?.recognize || tesseract.recognize;
    const pages: OcrPageResult[] = [];
    const timeoutMs = Math.max(30_000, Number(process.env.OCR_PAGE_TIMEOUT_MS || 120_000));

    for (const image of imagePaths) {
      const result = await withTimeout(
        recognizer(image.imagePath, 'eng'),
        timeoutMs,
        `Tesseract OCR page ${image.pageNumber}`,
      );
      pages.push({
        pageNumber: image.pageNumber,
        text: result.data.text || '',
        confidence: typeof result.data.confidence === 'number' ? result.data.confidence / 100 : null,
        imagePath: image.imagePath,
        engine: 'tesseract',
      });
    }

    return { pages, warnings };
  } catch (error) {
    return {
      pages: [],
      warnings: [`Tesseract OCR failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
