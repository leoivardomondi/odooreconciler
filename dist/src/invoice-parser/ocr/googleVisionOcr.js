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
exports.googleVisionOcr = googleVisionOcr;
const promises_1 = __importDefault(require("fs/promises"));
async function googleVisionOcr(imagePaths) {
    const warnings = [];
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return { pages: [], warnings: ['Google Vision OCR skipped because GOOGLE_APPLICATION_CREDENTIALS is not set.'] };
    }
    try {
        const vision = await Promise.resolve().then(() => __importStar(require('@google-cloud/vision')));
        const client = new vision.ImageAnnotatorClient();
        const pages = [];
        for (const image of imagePaths) {
            const [result] = await client.documentTextDetection({
                image: { content: await promises_1.default.readFile(image.imagePath) },
            });
            const text = result.fullTextAnnotation?.text || result.textAnnotations?.[0]?.description || '';
            pages.push({
                pageNumber: image.pageNumber,
                text,
                confidence: null,
                imagePath: image.imagePath,
                engine: 'google',
            });
        }
        return { pages, warnings };
    }
    catch (error) {
        return {
            pages: [],
            warnings: [`Google Vision OCR failed: ${error instanceof Error ? error.message : String(error)}`],
        };
    }
}
