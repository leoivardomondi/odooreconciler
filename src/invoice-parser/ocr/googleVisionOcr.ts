import fs from 'fs/promises';
import { OcrPageResult } from '../types';

export async function googleVisionOcr(
  imagePaths: Array<{ pageNumber: number; imagePath: string }>,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  const warnings: string[] = [];

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { pages: [], warnings: ['Google Vision OCR skipped because GOOGLE_APPLICATION_CREDENTIALS is not set.'] };
  }

  try {
    const vision = await import('@google-cloud/vision');
    const client = new vision.ImageAnnotatorClient();
    const pages: OcrPageResult[] = [];

    for (const image of imagePaths) {
      const [result] = await client.documentTextDetection({
        image: { content: await fs.readFile(image.imagePath) },
      });
      const text = result.fullTextAnnotation?.text || result.textAnnotations?.[0]?.description || '';
      pages.push({
        pageNumber: image.pageNumber,
        text,
        confidence: null,
        imagePath: image.imagePath,
        engine: 'google',
      });
    }

    return { pages, warnings };
  } catch (error) {
    return {
      pages: [],
      warnings: [`Google Vision OCR failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
