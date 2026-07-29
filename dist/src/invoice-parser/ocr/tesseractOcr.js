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
Object.defineProperty(exports, "__esModule", { value: true });
exports.tesseractOcr = tesseractOcr;
const tesseractData_1 = require("../../utils/tesseractData");
function withTimeout(operation, timeoutMs, label) {
    let timeoutHandle = null;
    return Promise.race([
        operation,
        new Promise((_resolve, reject) => {
            timeoutHandle = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
        }),
    ]).finally(() => {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    });
}
async function tesseractOcr(imagePaths) {
    const warnings = [];
    try {
        const tesseract = await Promise.resolve().then(() => __importStar(require('tesseract.js')));
        const recognizer = tesseract.default?.recognize || tesseract.recognize;
        const pages = [];
        const timeoutMs = Math.max(30_000, Number(process.env.OCR_PAGE_TIMEOUT_MS || 120_000));
        for (const image of imagePaths) {
            const result = await withTimeout(recognizer(image.imagePath, 'eng', (0, tesseractData_1.getBundledTesseractOptions)()), timeoutMs, `Tesseract OCR page ${image.pageNumber}`);
            pages.push({
                pageNumber: image.pageNumber,
                text: result.data.text || '',
                confidence: typeof result.data.confidence === 'number' ? result.data.confidence / 100 : null,
                imagePath: image.imagePath,
                engine: 'tesseract',
            });
        }
        return { pages, warnings };
    }
    catch (error) {
        return {
            pages: [],
            warnings: [`Tesseract OCR failed: ${error instanceof Error ? error.message : String(error)}`],
        };
    }
}
