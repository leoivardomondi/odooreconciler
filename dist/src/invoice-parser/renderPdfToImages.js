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
const paths_1 = require("../utils/paths");
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);
async function ensureTempDir() {
    const tempDir = (0, paths_1.resolveProjectFile)(process.env.TEMP_DIR || 'tmp', 'tmp');
    await promises_1.default.mkdir(tempDir, { recursive: true });
    return tempDir;
}
async function writeCrop(input) {
    const cropCanvas = input.canvasModule.createCanvas(input.width, input.height);
    const cropContext = cropCanvas.getContext('2d');
    cropContext.drawImage(input.canvas, input.x, input.y, input.width, input.height, 0, 0, input.width, input.height);
    await promises_1.default.writeFile(input.imagePath, await cropCanvas.encode('png'));
}
async function renderPdfToImages(filePath) {
    const extension = path_1.default.extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension)) {
        return { images: [{ pageNumber: 1, imagePath: filePath }], warnings: [] };
    }
    const warnings = [];
    let pdf = null;
    try {
        const pdfjs = await Promise.resolve().then(() => __importStar(require('pdfjs-dist/legacy/build/pdf.mjs')));
        const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
        const data = new Uint8Array(await promises_1.default.readFile(filePath));
        const documentTask = pdfjs.getDocument({
            data,
            disableWorker: true,
            isEvalSupported: false,
        });
        pdf = await documentTask.promise;
        const tempDir = await ensureTempDir();
        const baseName = `${path_1.default.basename(filePath, extension)}-${Date.now()}`;
        const images = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const renderScale = Math.max(1.5, Math.min(3, Number(process.env.OCR_RENDER_SCALE || 2.25)));
            const viewport = page.getViewport({ scale: renderScale });
            const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
            const context = canvas.getContext('2d');
            await page.render({ canvasContext: context, viewport, canvas }).promise;
            const imagePath = path_1.default.join(tempDir, `${baseName}-page-${pageNumber}.png`);
            await promises_1.default.writeFile(imagePath, await canvas.encode('png'));
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
            await pdf.destroy().catch(() => undefined);
        }
    }
}
