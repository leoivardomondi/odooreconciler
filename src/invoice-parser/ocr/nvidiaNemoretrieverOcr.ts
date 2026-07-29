import fs from 'fs/promises';
import path from 'path';
import { AiInvoiceExtractionConfig, OcrPageResult } from '../types';

const NVIDIA_HIGH_QUALITY_BASE64_LIMIT = 900_000;
const NVIDIA_COMPATIBILITY_BASE64_LIMIT = 180_000;
const NVIDIA_MAX_ATTEMPTS = 2;
const NVIDIA_REQUEST_TIMEOUT_MS = 30_000;

function mimeTypeForImage(imagePath: string) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

function resolveOcrEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '');
}

async function readNvidiaSizedImages(imagePath: string) {
  const original = await fs.readFile(imagePath);
  const candidates: Array<{ imageB64: string; mediaType: string; description: string }> = [];
  const originalB64 = original.toString('base64');

  if (originalB64.length <= NVIDIA_HIGH_QUALITY_BASE64_LIMIT) {
    candidates.push({ imageB64: originalB64, mediaType: mimeTypeForImage(imagePath), description: 'original' });
  }

  const canvasModule = await import('@napi-rs/canvas');
  const source = await canvasModule.loadImage(imagePath);
  const profiles = [
    { maxWidth: 1800, quality: 88, target: NVIDIA_HIGH_QUALITY_BASE64_LIMIT, description: 'high-resolution' },
    { maxWidth: 1400, quality: 84, target: 500_000, description: 'balanced' },
    { maxWidth: 1100, quality: 80, target: 300_000, description: 'compact' },
    { maxWidth: 900, quality: 76, target: NVIDIA_COMPATIBILITY_BASE64_LIMIT, description: 'compatibility' },
    { maxWidth: 700, quality: 72, target: NVIDIA_COMPATIBILITY_BASE64_LIMIT, description: 'small compatibility' },
  ];

  for (const profile of profiles) {
    const scale = Math.min(1, profile.maxWidth / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = canvasModule.createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0, width, height);

    const imageB64 = (await canvas.encode('jpeg', profile.quality)).toString('base64');
    if (imageB64.length <= profile.target) {
      const duplicate = candidates.some((candidate) => candidate.imageB64.length === imageB64.length);
      if (!duplicate) {
        candidates.push({ imageB64, mediaType: 'image/jpeg', description: profile.description });
      }
    }
  }

  return candidates.sort((a, b) => b.imageB64.length - a.imageB64.length);
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
      const prediction = item.text_prediction && typeof item.text_prediction === 'object'
        ? item.text_prediction as Record<string, unknown>
        : item;
      const text = typeof prediction.text === 'string' ? prediction.text : '';
      const confidence = typeof prediction.confidence === 'number' ? prediction.confidence : null;
      return text.trim() ? { text: text.trim(), confidence } : null;
    })
    .filter((entry): entry is { text: string; confidence: number | null } => Boolean(entry));
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = Number(response.headers.get('retry-after') || '');
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(30_000, retryAfter * 1000)
    : Math.min(8_000, 750 * (2 ** attempt));
}

async function wait(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function postNvidiaOcr(endpoint: string, apiKey: string, imageB64: string, mediaType: string) {
  let lastResponse: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < NVIDIA_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          input: [{ type: 'image_url', url: `data:${mediaType};base64,${imageB64}` }],
          merge_levels: ['word'],
        }),
        signal: AbortSignal.timeout(NVIDIA_REQUEST_TIMEOUT_MS),
      });
      lastResponse = response;
      if (response.ok || response.status === 400 || response.status === 401 || response.status === 403 || response.status === 413 || response.status === 422) {
        return response;
      }
      await wait(retryDelayMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt + 1 < NVIDIA_MAX_ATTEMPTS) {
        await wait(Math.min(8_000, 750 * (2 ** attempt)));
      }
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error('NVIDIA OCR request failed before receiving a response.');
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
      const candidates = await readNvidiaSizedImages(image.imagePath);
      if (!candidates.length) {
        warnings.push(`NVIDIA Nemotron OCR skipped page ${image.pageNumber} because no compatible image could be prepared.`);
        continue;
      }
      let page: OcrPageResult | null = null;
      let lastFailure = '';
      for (const candidate of candidates) {
        const response = await postNvidiaOcr(endpoint, config.apiKey, candidate.imageB64, candidate.mediaType);
        const json = await response.json().catch(() => null);
        if (response.ok) {
          page = parseNvidiaOcrPageResponse(json, image);
          if (page) {
            if (candidate.description !== 'original') {
              warnings.push(`NVIDIA Nemotron OCR used the ${candidate.description} image for page ${image.pageNumber}.`);
            }
            break;
          }
          lastFailure = 'no readable text returned';
          continue;
        }
        const message =
          (json && typeof json === 'object' && 'error' in json ? String((json as { error?: unknown }).error) : '') ||
          `HTTP ${response.status}`;
        lastFailure = message;
        if (response.status !== 413 && response.status !== 422) break;
      }
      if (page) {
        pages.push(page);
      } else {
        warnings.push(`NVIDIA Nemotron OCR failed on page ${image.pageNumber}: ${lastFailure || 'no readable text returned'}`);
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
