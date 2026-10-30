import fs from 'fs/promises';
import path from 'path';
import { resolveProjectFile } from '../utils/paths';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);

export interface RenderedPageImage {
  pageNumber: number;
  imagePath: string;
}

async function ensureTempDir() {
  const tempDir = resolveProjectFile(process.env.TEMP_DIR || 'tmp', 'tmp');
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
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

    if (
      dataStart + 3 < buffer.length &&
      buffer[dataStart] === 0xff &&
      buffer[dataStart + 1] === 0xd8 &&
      buffer[dataStart + 2] === 0xff
    ) {
      const streamEnd = buffer.indexOf(Buffer.from('endstream'), dataStart);
      if (streamEnd !== -1) {
        let eoiIndex = -1;
        for (let i = streamEnd - 1; i >= dataStart; i -= 1) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
            eoiIndex = i + 2;
            break;
          }
        }

        if (eoiIndex > dataStart) {
          const jpegData = buffer.subarray(dataStart, eoiIndex);
          // High-res scanned page JPEGs are typically > 40KB
          if (jpegData.length > 40_000) {
            const imagePath = path.join(tempDir, `${baseName}-page-${pageNumber}.jpg`);
            await fs.writeFile(imagePath, jpegData);
            images.push({ pageNumber, imagePath });
            pageNumber += 1;
          }
        }
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
    if (!(globalThis as any).ImageData) {
      (globalThis as any).ImageData = canvasModule.ImageData;
    }
    if (!(globalThis as any).DOMMatrix) {
      (globalThis as any).DOMMatrix = canvasModule.DOMMatrix;
    }
    if (!(globalThis as any).Path2D) {
      (globalThis as any).Path2D = canvasModule.Path2D;
    }

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(await fs.readFile(filePath));
    const documentTask = pdfjs.getDocument({
      data,
      disableWorker: true,
      isEvalSupported: false,
    } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
    pdf = await documentTask.promise;
    const images: RenderedPageImage[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const renderScale = Math.max(1.5, Math.min(3, Number(process.env.OCR_RENDER_SCALE || 2.25)));
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');

      await page.render({ canvasContext: context, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise;
      const imagePath = path.join(tempDir, `${baseName}-page-${pageNumber}.png`);
      await fs.writeFile(imagePath, await canvas.encode('png'));
      images.push({ pageNumber, imagePath });

      if (process.env.OCR_INCLUDE_CROPS !== 'false') {
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
