import fs from 'fs/promises';
import path from 'path';
import { AiInvoiceExtractionConfig, OcrPageResult } from '../types';

const NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT = 180_000;

function mimeTypeForImage(imagePath: string) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

function resolveOcrEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}

async function readNvidiaSizedImage(imagePath: string) {
  const original = await fs.readFile(imagePath);
  let imageB64 = original.toString('base64');
  let mediaType = mimeTypeForImage(imagePath);

  if (imageB64.length <= NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT) {
    return { imageB64, mediaType, resized: false };
  }

  const canvasModule = await import('@napi-rs/canvas');
  const source = await canvasModule.loadImage(imagePath);
  const maxWidths = [1400, 1100, 900, 700, 550];

  for (const maxWidth of maxWidths) {
    const scale = Math.min(1, maxWidth / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = canvasModule.createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0, width, height);

    const jpeg = await canvas.encode('jpeg', 78);
    imageB64 = jpeg.toString('base64');
    mediaType = 'image/jpeg';

    if (imageB64.length <= NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT) {
      return { imageB64, mediaType, resized: true };
    }
  }

  return { imageB64, mediaType, resized: true };
}

function collectTextDetections(value: unknown): Array<{ text: string; confidence: number | null }> {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const detections = Array.isArray(record.text_detections)
    ? record.text_detections
    : Array.isArray(record.detections)
      ? record.detections
      : [];

  return detections
    .map((detection) => {
      if (!detection || typeof detection !== 'object') {
        return null;
      }
      const item = detection as Record<string, unknown>;
      const text = typeof item.text === 'string' ? item.text : '';
      const confidence = typeof item.confidence === 'number' ? item.confidence : null;
      return text.trim() ? { text: text.trim(), confidence } : null;
    })
    .filter((entry): entry is { text: string; confidence: number | null } => Boolean(entry));
}

function collectTextFields(value: unknown, texts: string[] = []): string[] {
  if (!value || typeof value !== 'object') {
    return texts;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectTextFields(entry, texts));
    return texts;
  }

  const record = value as Record<string, unknown>;
  Object.entries(record).forEach(([key, entry]) => {
    if (
      typeof entry === 'string' &&
      /^(text|content|markdown|ocr_text|recognized_text|transcription)$/i.test(key) &&
      !entry.startsWith('data:image/')
    ) {
      const trimmed = entry.trim();
      if (trimmed) {
        texts.push(trimmed);
      }
      return;
    }

    collectTextFields(entry, texts);
  });

  return texts;
}

function parseNvidiaOcrPageResponse(
  payload: unknown,
  image: { pageNumber: number; imagePath: string },
): OcrPageResult | null {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const data = Array.isArray(record.data) ? record.data : Array.isArray(record.output) ? record.output : [];
  const detections = collectTextDetections(data[0] || record);
  const detectionText = detections.map((detection) => detection.text).join('\n');
  const fallbackText = collectTextFields(record).join('\n');
  const text = detectionText || fallbackText;

  if (!text.trim()) {
    return null;
  }

  const confidenceValues = detections
    .map((detection) => detection.confidence)
    .filter((confidence): confidence is number => typeof confidence === 'number');
  const confidence =
    confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null;

  return {
    pageNumber: image.pageNumber,
    imagePath: image.imagePath,
    text,
    confidence,
    engine: 'nvidia_nemoretriever' as const,
  };
}

export async function nvidiaNemoretrieverOcr(
  images: Array<{ pageNumber: number; imagePath: string }>,
  config: AiInvoiceExtractionConfig['ocr'] | undefined,
): Promise<{ pages: OcrPageResult[]; warnings: string[] }> {
  if (!config?.enabled || config.provider !== 'nvidia_nemoretriever') {
    return { pages: [], warnings: [] };
  }
  if (!config.apiKey) {
    return { pages: [], warnings: ['NVIDIA Nemotron OCR skipped because OCR API key is not configured.'] };
  }

  const endpoint = resolveOcrEndpoint(config.endpoint);
  if (!endpoint) {
    return { pages: [], warnings: ['NVIDIA Nemotron OCR skipped because OCR endpoint is not configured.'] };
  }

  try {
    const pages: OcrPageResult[] = [];
    const warnings: string[] = [];

    for (const image of images) {
      const { imageB64, mediaType, resized } = await readNvidiaSizedImage(image.imagePath);
      if (imageB64.length > NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT) {
        warnings.push(`NVIDIA Nemotron OCR skipped page ${image.pageNumber} because the image still exceeds direct upload size after resizing.`);
        continue;
      }
      if (resized) {
        warnings.push(`NVIDIA Nemotron OCR resized page ${image.pageNumber} to fit direct upload size.`);
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          input: [
            {
              type: 'image_url',
              url: `data:${mediaType};base64,${imageB64}`,
            },
          ],
        }),
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          (json && typeof json === 'object' && 'error' in json ? String((json as { error?: unknown }).error) : '') ||
          `HTTP ${response.status}`;
        warnings.push(`NVIDIA Nemotron OCR failed on page ${image.pageNumber}: ${message}`);
        continue;
      }

      const page = parseNvidiaOcrPageResponse(json, image);
      if (page) {
        pages.push(page);
      }
    }

    return {
      pages,
      warnings: [
        ...warnings,
        pages.length > 0
          ? `NVIDIA Nemotron OCR extracted text from ${pages.length}/${images.length} page(s).`
          : 'NVIDIA Nemotron OCR returned no readable text.',
      ],
    };
  } catch (error) {
    return {
      pages: [],
      warnings: [`NVIDIA Nemotron OCR failed: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
