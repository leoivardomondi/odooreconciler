"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPdfToImages = renderPdfToImages;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const zlib_1 = __importDefault(require("zlib"));
const paths_1 = require("../utils/paths");
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);
const DEFAULT_PDF_RENDER_SCALE = 1.5;
const DEFAULT_PDF_RENDER_MAX_PAGES = 2;
const DEFAULT_PDF_LOAD_TIMEOUT_MS = 15_000;
const DEFAULT_PDF_PAGE_RENDER_TIMEOUT_MS = 20_000;
async function ensureTempDir() {
    const tempDir = (0, paths_1.resolveProjectFile)(process.env.TEMP_DIR || 'tmp', 'tmp');
    await promises_1.default.mkdir(tempDir, { recursive: true });
    return tempDir;
}
function positiveNumberFromEnv(name, fallback, min, max) {
    const raw = Number(process.env[name] || fallback);
    const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
    return Math.min(Math.max(value, min), max ?? value);
}
async function withTimeout(promise, timeoutMs, message, onTimeout) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    try {
                        onTimeout?.();
                    }
                    finally {
                        reject(new Error(message));
                    }
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
async function writeCrop(input) {
    const cropCanvas = input.canvasModule.createCanvas(input.width, input.height);
    const cropContext = cropCanvas.getContext('2d');
    cropContext.drawImage(input.canvas, input.x, input.y, input.width, input.height, 0, 0, input.width, input.height);
    await promises_1.default.writeFile(input.imagePath, await cropCanvas.encode('png'));
}
async function extractEmbeddedJpegsFromPdf(buffer, tempDir, baseName) {
    const images = [];
    let searchOffset = 0;
    let pageNumber = 1;
    while (searchOffset < buffer.length) {
        const streamStart = buffer.indexOf(Buffer.from('stream'), searchOffset);
        if (streamStart === -1)
            break;
        let dataStart = streamStart + 6;
        while (dataStart < buffer.length && (buffer[dataStart] === 0x0d || buffer[dataStart] === 0x0a)) {
            dataStart += 1;
        }
        const streamEnd = buffer.indexOf(Buffer.from('endstream'), dataStart);
        if (streamEnd !== -1) {
            let candidateJpeg = null;
            // Case A: Raw embedded JPEG stream (FF D8 FF)
            if (dataStart + 3 < buffer.length &&
                buffer[dataStart] === 0xff &&
                buffer[dataStart + 1] === 0xd8 &&
                buffer[dataStart + 2] === 0xff) {
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
            }
            else if (
            // Case B: Flate-compressed JPEG stream (/Filter [ /FlateDecode /DCTDecode ]) starting with zlib header 0x78
            dataStart + 2 < buffer.length &&
                buffer[dataStart] === 0x78) {
                try {
                    const rawStream = buffer.subarray(dataStart, streamEnd);
                    const inflated = zlib_1.default.inflateSync(rawStream);
                    if (inflated.length > 40_000 &&
                        inflated[0] === 0xff &&
                        inflated[1] === 0xd8 &&
                        inflated[2] === 0xff) {
                        candidateJpeg = inflated;
                    }
                }
                catch {
                    // Non-fatal: not a zlib stream or inflate failed
                }
            }
            if (candidateJpeg && candidateJpeg.length > 40_000) {
                const imagePath = path_1.default.join(tempDir, `${baseName}-page-${pageNumber}.jpg`);
                await promises_1.default.writeFile(imagePath, candidateJpeg);
                images.push({ pageNumber, imagePath });
                pageNumber += 1;
            }
        }
        searchOffset = streamStart + 6;
    }
    return images;
}
async function renderPdfToImages(filePath) {
    const extension = path_1.default.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) {
        return { images: [{ pageNumber: 1, imagePath: filePath }], warnings: [] };
    }
    const warnings = [];
    const tempDir = await ensureTempDir();
    const baseName = `${path_1.default.basename(filePath, extension)}-${Date.now()}`;
    // Step 1: For scanned PDFs (CamScanner, HP, Canon, mobile scanners), directly extract
    // embedded raw JPEGs. This is instantaneous (<10ms), preserves full scanner DPI,
    // and prevents heavy PDF.js canvas allocation crashes on huge bitmaps.
    try {
        const fileBuffer = await promises_1.default.readFile(filePath);
        const embeddedImages = await extractEmbeddedJpegsFromPdf(fileBuffer, tempDir, baseName);
        if (embeddedImages.length > 0) {
            return { images: embeddedImages, warnings };
        }
    }
    catch (extractError) {
        // Non-fatal: proceed to standard PDF.js canvas rendering
    }
    let pdf = null;
    try {
        const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
        const { ensurePdfjsGlobals } = await Promise.resolve().then(() => __importStar(require('../utils/polyfills')));
        ensurePdfjsGlobals(canvasModule);
        const pdfjs = await Promise.resolve().then(() => __importStar(require('pdfjs-dist/legacy/build/pdf.mjs')));
        const data = new Uint8Array(await promises_1.default.readFile(filePath));
        const documentTask = pdfjs.getDocument({
            data,
            disableWorker: true,
            isEvalSupported: false,
        });
        pdf = await withTimeout(documentTask.promise, positiveNumberFromEnv('PDF_RENDER_LOAD_TIMEOUT_MS', DEFAULT_PDF_LOAD_TIMEOUT_MS, 5_000), `PDF.js document load timed out after ${positiveNumberFromEnv('PDF_RENDER_LOAD_TIMEOUT_MS', DEFAULT_PDF_LOAD_TIMEOUT_MS, 5_000)}ms.`, () => {
            if (typeof documentTask.destroy === 'function') {
                const destroyed = documentTask.destroy();
                if (destroyed && typeof destroyed.catch === 'function') {
                    void destroyed.catch(() => undefined);
                }
            }
        });
        const images = [];
        const maxPages = Math.min(pdf.numPages, Math.floor(positiveNumberFromEnv('PDF_RENDER_MAX_PAGES', DEFAULT_PDF_RENDER_MAX_PAGES, 1, 10)));
        if (pdf.numPages > maxPages) {
            warnings.push(`PDF rendering limited to first ${maxPages} of ${pdf.numPages} page(s).`);
        }
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const renderScale = positiveNumberFromEnv('OCR_RENDER_SCALE', DEFAULT_PDF_RENDER_SCALE, 1, 2);
            const viewport = page.getViewport({ scale: renderScale });
            const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext('2d');
            const renderTask = page.render({ canvasContext: context, viewport, canvas });
            try {
                const pageTimeoutMs = positiveNumberFromEnv('PDF_RENDER_PAGE_TIMEOUT_MS', DEFAULT_PDF_PAGE_RENDER_TIMEOUT_MS, 5_000);
                await withTimeout(renderTask.promise, pageTimeoutMs, `PDF.js page ${pageNumber} render timed out after ${pageTimeoutMs}ms.`, () => {
                    if (typeof renderTask.cancel === 'function') {
                        renderTask.cancel();
                    }
                });
            }
            catch (error) {
                warnings.push(error instanceof Error ? error.message : String(error));
                if (typeof page.cleanup === 'function') {
                    page.cleanup();
                }
                break;
            }
            const imagePath = path_1.default.join(tempDir, `${baseName}-page-${pageNumber}.png`);
            await promises_1.default.writeFile(imagePath, await canvas.encode('png'));
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
                    const cropPath = path_1.default.join(tempDir, `${baseName}-page-${pageNumber}-${crop.suffix}.png`);
                    await writeCrop({ canvas, canvasModule, imagePath: cropPath, ...crop });
                    images.push({ pageNumber, imagePath: cropPath });
                }
            }
            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
        }
        return { images, warnings };
    }
    catch (error) {
        warnings.push(`PDF rendering failed: ${error instanceof Error ? error.message : String(error)}`);
        return { images: [], warnings };
    }
    finally {
        if (pdf) {
            if (typeof pdf.destroy === 'function') {
                await pdf.destroy().catch(() => undefined);
            }
        }
    }
}
