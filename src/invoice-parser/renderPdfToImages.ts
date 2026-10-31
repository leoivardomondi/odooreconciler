import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { resolveProjectFile } from '../utils/paths';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);
const DEFAULT_PDF_RENDER_SCALE = 1.5;
const DEFAULT_PDF_RENDER_MAX_PAGES = 2;
const DEFAULT_PDF_LOAD_TIMEOUT_MS = 15_000;
const DEFAULT_PDF_PAGE_RENDER_TIMEOUT_MS = 20_000;

export interface RenderedPageImage {
  pageNumber: number;
  imagePath: string;
}

async function ensureTempDir() {
  const tempDir = resolveProjectFile(process.env.TEMP_DIR || 'tmp', 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

function positiveNumberFromEnv(name: string, fallback: number, min: number, max?: number) {
  const raw = Number(process.env[name] || fallback);
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.min(Math.max(value, min), max ?? value);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
  onTimeout?: () => void,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          try {
            onTimeout?.();
          } finally {
            reject(new Error(message));
          }
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function writeCrop(input: {
  canvas: any;
  canvasModule: typeof import('@napi-rs/canvas');
  imagePath: string;
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const cropCanvas = input.canvasModule.createCanvas(input.width, input.height);
  const cropContext = cropCanvas.getContext('2d');
  cropContext.drawImage(input.canvas, input.x, input.y, input.width, input.height, 0, 0, input.width, input.height);
  await fs.writeFile(input.imagePath, await cropCanvas.encode('png'));
}

async function extractEmbeddedJpegsFromPdf(
  buffer: Buffer,
  tempDir: string,
  baseName: string,
): Promise<RenderedPageImage[]> {
  const images: RenderedPageImage[] = [];
  let searchOffset = 0;
  let pageNumber = 1;

  while (searchOffset < buffer.length) {
    const streamStart = buffer.indexOf(Buffer.from('stream'), searchOffset);
    if (streamStart === -1) break;

    let dataStart = streamStart + 6;
    while (dataStart < buffer.length && (buffer[dataStart] === 0x0d || buffer[dataStart] === 0x0a)) {
      dataStart += 1;
    }

    const streamEnd = buffer.indexOf(Buffer.from('endstream'), dataStart);
    if (streamEnd !== -1) {
      let candidateJpeg: Buffer | null = null;

      // Case A: Raw embedded JPEG stream (FF D8 FF)
      if (
        dataStart + 3 < buffer.length &&
        buffer[dataStart] === 0xff &&
        buffer[dataStart + 1] === 0xd8 &&
        buffer[dataStart + 2] === 0xff
      ) {
        let eoiIndex = -1;
        for (let i = streamEnd - 1; i >= dataStart; i -= 1) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
            eoiIndex = i + 2;
            break;
          }
        }

        if (eoiIndex > dataStart) {
          candidateJpeg = buffer.subarray(dataStart, eoiIndex);
        }
      } else if (
        // Case B: Flate-compressed JPEG stream (/Filter [ /FlateDecode /DCTDecode ]) starting with zlib header 0x78
        dataStart + 2 < buffer.length &&
        buffer[dataStart] === 0x78
      ) {
        try {
          const rawStream = buffer.subarray(dataStart, streamEnd);
          const inflated = zlib.inflateSync(rawStream);
          if (
            inflated.length > 40_000 &&
            inflated[0] === 0xff &&
            inflated[1] === 0xd8 &&
            inflated[2] === 0xff
          ) {
            candidateJpeg = inflated;
          }
        } catch {
          // Non-fatal: not a zlib stream or inflate failed
        }
      }

      if (candidateJpeg && candidateJpeg.length > 40_000) {
        const imagePath = path.join(tempDir, `${baseName}-page-${pageNumber}.jpg`);
        await fs.writeFile(imagePath, candidateJpeg);
        images.push({ pageNumber, imagePath });
        pageNumber += 1;
      }
    }

    searchOffset = streamStart + 6;
  }

  return images;
}

export async function renderPdfToImages(filePath: string): Promise<{
  images: RenderedPageImage[];
  warnings: string[];
}> {
  const extension = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) {
    return { images: [{ pageNumber: 1, imagePath: filePath }], warnings: [] };
  }

  const warnings: string[] = [];
  const tempDir = await ensureTempDir();
  const baseName = `${path.basename(filePath, extension)}-${Date.now()}`;

  // Step 1: For scanned PDFs (CamScanner, HP, Canon, mobile scanners), directly extract
  // embedded raw JPEGs. This is instantaneous (<10ms), preserves full scanner DPI,
  // and prevents heavy PDF.js canvas allocation crashes on huge bitmaps.
  try {
    const fileBuffer = await fs.readFile(filePath);
    const embeddedImages = await extractEmbeddedJpegsFromPdf(fileBuffer, tempDir, baseName);
    if (embeddedImages.length > 0) {
      return { images: embeddedImages, warnings };
    }
  } catch (extractError) {
    // Non-fatal: proceed to standard PDF.js canvas rendering
  }

  let pdf: any = null;
  try {
    const canvasModule = await import('@napi-rs/canvas');
    const { ensurePdfjsGlobals } = await import('../utils/polyfills');
    ensurePdfjsGlobals(canvasModule);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await fs.readFile(filePath));
    const documentTask = pdfjs.getDocument({
      data,
      disableWorker: true,
      isEvalSupported: false,
    } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
    pdf = await withTimeout(
      documentTask.promise,
      positiveNumberFromEnv('PDF_RENDER_LOAD_TIMEOUT_MS', DEFAULT_PDF_LOAD_TIMEOUT_MS, 5_000),
      `PDF.js document load timed out after ${positiveNumberFromEnv('PDF_RENDER_LOAD_TIMEOUT_MS', DEFAULT_PDF_LOAD_TIMEOUT_MS, 5_000)}ms.`,
      () => {
        if (typeof (documentTask as any).destroy === 'function') {
          const destroyed = (documentTask as any).destroy();
          if (destroyed && typeof destroyed.catch === 'function') {
            void destroyed.catch(() => undefined);
          }
        }
      },
    );
    const images: RenderedPageImage[] = [];
    const maxPages = Math.min(
      pdf.numPages,
      Math.floor(positiveNumberFromEnv('PDF_RENDER_MAX_PAGES', DEFAULT_PDF_RENDER_MAX_PAGES, 1, 10)),
    );
    if (pdf.numPages > maxPages) {
      warnings.push(`PDF rendering limited to first ${maxPages} of ${pdf.numPages} page(s).`);
    }

    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const renderScale = positiveNumberFromEnv('OCR_RENDER_SCALE', DEFAULT_PDF_RENDER_SCALE, 1, 2);
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');

      const renderTask = page.render({ canvasContext: context, viewport, canvas } as unknown as Parameters<typeof page.render>[0]);
      try {
        const pageTimeoutMs = positiveNumberFromEnv(
          'PDF_RENDER_PAGE_TIMEOUT_MS',
          DEFAULT_PDF_PAGE_RENDER_TIMEOUT_MS,
          5_000,
        );
        await withTimeout(
          renderTask.promise,
          pageTimeoutMs,
          `PDF.js page ${pageNumber} render timed out after ${pageTimeoutMs}ms.`,
          () => {
            if (typeof (renderTask as any).cancel === 'function') {
              (renderTask as any).cancel();
            }
          },
        );
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : String(error));
        if (typeof (page as any).cleanup === 'function') {
          (page as any).cleanup();
        }
        break;
      }
      const imagePath = path.join(tempDir, `${baseName}-page-${pageNumber}.png`);
      await fs.writeFile(imagePath, await canvas.encode('png'));
      images.push({ pageNumber, imagePath });

      if (process.env.OCR_INCLUDE_CROPS === 'true') {
        const crops = [
          {
            suffix: 'header',
            x: 0,
            y: 0,
            width: canvas.width,
            height: Math.floor(canvas.height * 0.42),
          },
          {
            suffix: 'items',
            x: 0,
            y: Math.floor(canvas.height * 0.32),
            width: canvas.width,
            height: Math.floor(canvas.height * 0.34),
          },
          {
            suffix: 'totals',
            x: Math.floor(canvas.width * 0.58),
            y: Math.floor(canvas.height * 0.56),
            width: Math.floor(canvas.width * 0.42),
            height: Math.floor(canvas.height * 0.24),
          },
        ];

        for (const crop of crops) {
          const cropPath = path.join(tempDir, `${baseName}-page-${pageNumber}-${crop.suffix}.png`);
          await writeCrop({ canvas, canvasModule, imagePath: cropPath, ...crop });
          images.push({ pageNumber, imagePath: cropPath });
        }
      }

      if (typeof (page as any).cleanup === 'function') {
        (page as any).cleanup();
      }
    }

    return { images, warnings };
  } catch (error) {
    warnings.push(`PDF rendering failed: ${error instanceof Error ? error.message : String(error)}`);
    return { images: [], warnings };
  } finally {
    if (pdf) {
      if (typeof (pdf as any).destroy === 'function') {
        await (pdf as any).destroy().catch(() => undefined);
      }
    }
  }
}
