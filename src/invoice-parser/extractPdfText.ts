import fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import { normalizeText } from './core/normalizeText';

export async function extractPdfText(filePath: string) {
  try {
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    return {
      text: normalizeText(parsed.text || ''),
      warnings: [] as string[],
    };
  } catch (error) {
    return {
      text: '',
      warnings: [
        `PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
}
