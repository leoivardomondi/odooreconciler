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
exports.fastAutoOrientImage = fastAutoOrientImage;
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
    const invoiceTerms = (normalized.match(/\b(invoice|receipt|total|amount|vat|tax|date|quantity|price|description|supplier|buyer|goods|order|delivery|comply|mdf|boards|laboratories|supply|limited)\b/g) || []).length;
    return {
        score: confidence + Math.min(35, readableCharacters / 12) + Math.min(30, invoiceTerms * 5),
        invoiceTerms,
        readableCharacters,
    };
}
async function fastAutoOrientImage(imagePath) {
    const warnings = [];
    if (process.env.OCR_AUTO_ORIENT === 'false' ||
        /-page-\d+-(header|items|totals)-ocr\.png$/i.test(imagePath)) {
        return { imagePath, angle: 0, warnings };
    }
    const MAX_DETECT_TIMEOUT_MS = 15_000;
    let timer;
    const timeoutPromise = new Promise((resolve) => {
        timer = setTimeout(() => {
            warnings.push(`Auto-orientation timed out after ${MAX_DETECT_TIMEOUT_MS / 1000}s; retaining original orientation.`);
            resolve({ imagePath, angle: 0, warnings });
        }, MAX_DETECT_TIMEOUT_MS);
    });
    const detectionPromise = (async () => {
        try {
            const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
            const imageBuffer = await promises_1.default.readFile(imagePath);
            const image = await canvasModule.loadImage(imageBuffer);
            // Rapid orientation detection using a small 800px thumbnail (<1s per test)
            const scale = Math.min(1, 800 / Math.max(image.width, image.height));
            const thumbWidth = Math.round(image.width * scale);
            const thumbHeight = Math.round(image.height * scale);
            const tesseract = await Promise.resolve().then(() => __importStar(require('tesseract.js')));
            const worker = await tesseract.createWorker('eng', undefined, (0, tesseractData_1.getBundledTesseractOptions)());
            try {
                // Step 1: Test Angle 0 first
                const canvas0 = canvasModule.createCanvas(thumbWidth, thumbHeight);
                const ctx0 = canvas0.getContext('2d');
                ctx0.drawImage(image, 0, 0, thumbWidth, thumbHeight);
                const buffer0 = await canvas0.encode('png');
                const res0 = await worker.recognize(buffer0);
                const score0 = orientationTextScore(res0.data.text || '', res0.data.confidence || 0);
                // If Angle 0 is already upright with recognized invoice keywords, short-circuit immediately in <1s
                if (score0.score >= 45 && score0.invoiceTerms >= 2) {
                    return { imagePath, angle: 0, warnings };
                }
                // Step 2: Test Angle 90 (the standard clockwise orientation for sideways scans)
                const canvas90 = canvasModule.createCanvas(thumbHeight, thumbWidth);
                const ctx90 = canvas90.getContext('2d');
                ctx90.translate(canvas90.width / 2, canvas90.height / 2);
                ctx90.rotate((90 * Math.PI) / 180);
                ctx90.drawImage(image, -thumbWidth / 2, -thumbHeight / 2, thumbWidth, thumbHeight);
                const buffer90 = await canvas90.encode('png');
                const res90 = await worker.recognize(buffer90);
                const score90 = orientationTextScore(res90.data.text || '', res90.data.confidence || 0);
                if (score90.invoiceTerms >= 1 && score90.score > score0.score + 5) {
                    // Angle 90 is upright and readable
                    const parsed = path_1.default.parse(imagePath);
                    const rotatedPath = path_1.default.join(parsed.dir, `${parsed.name}-oriented-90.png`);
                    const fullCanvas = canvasModule.createCanvas(image.height, image.width);
                    const fullCtx = fullCanvas.getContext('2d');
                    fullCtx.translate(fullCanvas.width / 2, fullCanvas.height / 2);
                    fullCtx.rotate((90 * Math.PI) / 180);
                    fullCtx.drawImage(image, -image.width / 2, -image.height / 2);
                    await promises_1.default.writeFile(rotatedPath, await fullCanvas.encode('png'));
                    warnings.push(`Auto-oriented ${path_1.default.basename(imagePath)} by 90 degrees for OCR.`);
                    return { imagePath: rotatedPath, angle: 90, warnings };
                }
                // Step 3: Test remaining orientations (180, 270) only if 0 and 90 are both inconclusive
                let best = score90.score > score0.score
                    ? { angle: 90, score: score90.score, terms: score90.invoiceTerms }
                    : { angle: 0, score: score0.score, terms: score0.invoiceTerms };
                for (const angle of [180, 270]) {
                    const swaps = angle === 270;
                    const canvas = canvasModule.createCanvas(swaps ? thumbHeight : thumbWidth, swaps ? thumbWidth : thumbHeight);
                    const ctx = canvas.getContext('2d');
                    ctx.translate(canvas.width / 2, canvas.height / 2);
                    ctx.rotate((angle * Math.PI) / 180);
                    ctx.drawImage(image, -thumbWidth / 2, -thumbHeight / 2, thumbWidth, thumbHeight);
                    const buf = await canvas.encode('png');
                    const res = await worker.recognize(buf);
                    const score = orientationTextScore(res.data.text || '', res.data.confidence || 0);
                    if (score.invoiceTerms > best.terms ||
                        (score.invoiceTerms === best.terms && score.score > best.score + 5)) {
                        best = { angle, score: score.score, terms: score.invoiceTerms };
                    }
                }
                if (best.angle === 0) {
                    return { imagePath, angle: 0, warnings };
                }
                const parsed = path_1.default.parse(imagePath);
                const rotatedPath = path_1.default.join(parsed.dir, `${parsed.name}-oriented-${best.angle}.png`);
                const swaps = best.angle === 90 || best.angle === 270;
                const fullCanvas = canvasModule.createCanvas(swaps ? image.height : image.width, swaps ? image.width : image.height);
                const fullCtx = fullCanvas.getContext('2d');
                fullCtx.translate(fullCanvas.width / 2, fullCanvas.height / 2);
                fullCtx.rotate((best.angle * Math.PI) / 180);
                fullCtx.drawImage(image, -image.width / 2, -image.height / 2);
                await promises_1.default.writeFile(rotatedPath, await fullCanvas.encode('png'));
                warnings.push(`Auto-oriented ${path_1.default.basename(imagePath)} by ${best.angle} degrees for OCR.`);
                return { imagePath: rotatedPath, angle: best.angle, warnings };
            }
            finally {
                await worker.terminate().catch(() => undefined);
            }
        }
        catch (error) {
            warnings.push(`Automatic image orientation failed for ${path_1.default.basename(imagePath)}: ${error instanceof Error ? error.message : String(error)}`);
            return { imagePath, angle: 0, warnings };
        }
    })();
    try {
        return await Promise.race([detectionPromise, timeoutPromise]);
    }
    finally {
        clearTimeout(timer);
    }
}
async function autoOrientImage(imagePath) {
    const result = await fastAutoOrientImage(imagePath);
    return { imagePath: result.imagePath, warnings: result.warnings };
}
async function preprocessImage(imagePath, options) {
    const warnings = [];
    if (process.env.OCR_PREPROCESS_IMAGES === 'false') {
        return { imagePath, warnings };
    }
    try {
        const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
        const imageBuffer = await promises_1.default.readFile(imagePath);
        const image = await canvasModule.loadImage(imageBuffer);
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
