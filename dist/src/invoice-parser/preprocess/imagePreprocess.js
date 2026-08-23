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
exports.preprocessImage = preprocessImage;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const tesseractData_1 = require("../../utils/tesseractData");
function clamp(value) {
    return Math.max(0, Math.min(255, value));
}
const ORIENTATION_ANGLES = [0, 90, 180, 270];
function orientationTextScore(text, confidence) {
    const normalized = text.toLowerCase();
    const readableCharacters = (normalized.match(/[a-z0-9]/g) || []).length;
    const invoiceTerms = (normalized.match(/\b(invoice|receipt|total|amount|vat|tax|date|quantity|price|description|supplier)\b/g) || []).length;
    return confidence + Math.min(35, readableCharacters / 12) + Math.min(30, invoiceTerms * 5);
}
async function writeRotatedImage(sourcePath, angle, outputPath) {
    const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
    const image = await canvasModule.loadImage(sourcePath);
    const swapsDimensions = angle === 90 || angle === 270;
    const canvas = canvasModule.createCanvas(swapsDimensions ? image.height : image.width, swapsDimensions ? image.width : image.height);
    const context = canvas.getContext('2d');
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((angle * Math.PI) / 180);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    await promises_1.default.writeFile(outputPath, await canvas.encode('png'));
}
async function autoOrientImage(imagePath) {
    const warnings = [];
    // Crops inherit the rendered page orientation and do not contain enough text
    // for reliable independent orientation detection.
    if (process.env.OCR_AUTO_ORIENT === 'false' || /-page-\d+-(header|items|totals)-ocr\.png$/i.test(imagePath)) {
        return { imagePath, warnings };
    }
    const parsed = path_1.default.parse(imagePath);
    const candidatePaths = new Map([[0, imagePath]]);
    let worker = null;
    let selectedPath = imagePath;
    try {
        const tesseract = await Promise.resolve().then(() => __importStar(require('tesseract.js')));
        worker = await tesseract.createWorker('eng', undefined, (0, tesseractData_1.getBundledTesseractOptions)());
        let best = { angle: 0, imagePath, score: Number.NEGATIVE_INFINITY };
        for (const angle of ORIENTATION_ANGLES) {
            let candidatePath = imagePath;
            if (angle !== 0) {
                candidatePath = path_1.default.join(parsed.dir, `${parsed.name}-rotate-${angle}.png`);
                await writeRotatedImage(imagePath, angle, candidatePath);
                candidatePaths.set(angle, candidatePath);
            }
            const result = await worker.recognize(candidatePath);
            const text = result.data.text || '';
            const confidence = typeof result.data.confidence === 'number' ? result.data.confidence : 0;
            const score = orientationTextScore(text, confidence);
            if (score > best.score) {
                best = { angle, imagePath: candidatePath, score };
            }
        }
        if (best.angle !== 0) {
            warnings.push(`Auto-oriented ${path_1.default.basename(imagePath)} by ${best.angle} degrees for OCR.`);
        }
        selectedPath = best.imagePath;
        return { imagePath: best.imagePath, warnings };
    }
    catch (error) {
        warnings.push(`Automatic image orientation failed for ${path_1.default.basename(imagePath)}: ${error instanceof Error ? error.message : String(error)}`);
        return { imagePath, warnings };
    }
    finally {
        await worker?.terminate().catch(() => undefined);
        // Keep the selected candidate only; the caller owns its normal temp-file cleanup.
        for (const candidatePath of candidatePaths.values()) {
            if (candidatePath !== selectedPath) {
                await promises_1.default.unlink(candidatePath).catch(() => undefined);
            }
        }
    }
}
async function preprocessImage(imagePath, options) {
    const warnings = [];
    if (process.env.OCR_PREPROCESS_IMAGES === 'false') {
        return { imagePath, warnings };
    }
    try {
        const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
        const image = await canvasModule.loadImage(imagePath);
        const canvas = canvasModule.createCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const contrast = Math.max(1, Number(process.env.OCR_CONTRAST || 1.35));
        const threshold = Math.max(0, Math.min(255, Number(process.env.OCR_THRESHOLD || 0)));
        const thresholdData = new Uint8ClampedArray(data);
        for (let index = 0; index < data.length; index += 4) {
            const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
            let adjusted = clamp((gray - 128) * contrast + 128);
            if (threshold > 0) {
                adjusted = adjusted >= threshold ? 255 : 0;
            }
            data[index] = adjusted;
            data[index + 1] = adjusted;
            data[index + 2] = adjusted;
            const handwritingThreshold = adjusted >= (threshold || 178) ? 255 : 0;
            thresholdData[index] = handwritingThreshold;
            thresholdData[index + 1] = handwritingThreshold;
            thresholdData[index + 2] = handwritingThreshold;
        }
        context.putImageData(imageData, 0, 0);
        const parsed = path_1.default.parse(imagePath);
        const processedPath = path_1.default.join(parsed.dir, `${parsed.name}-ocr.png`);
        await promises_1.default.writeFile(processedPath, await canvas.encode('png'));
        const thresholdCanvas = canvasModule.createCanvas(image.width, image.height);
        const thresholdContext = thresholdCanvas.getContext('2d');
        const thresholdImageData = thresholdContext.createImageData(image.width, image.height);
        thresholdImageData.data.set(thresholdData);
        thresholdContext.putImageData(thresholdImageData, 0, 0);
        const handwritingPath = path_1.default.join(parsed.dir, `${parsed.name}-handwriting.png`);
        await promises_1.default.writeFile(handwritingPath, await thresholdCanvas.encode('png'));
        const oriented = options?.autoOrient === false
            ? { imagePath: processedPath, warnings: [] }
            : await autoOrientImage(processedPath);
        warnings.push(...oriented.warnings);
        return { imagePath: oriented.imagePath, variantPaths: [handwritingPath], warnings };
    }
    catch (error) {
        warnings.push(`Image preprocessing failed for ${path_1.default.basename(imagePath)}: ${error instanceof Error ? error.message : String(error)}`);
        return { imagePath, warnings };
    }
}
