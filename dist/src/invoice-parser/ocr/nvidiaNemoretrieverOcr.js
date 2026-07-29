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
exports.nvidiaNemoretrieverOcr = nvidiaNemoretrieverOcr;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT = 180_000;
function mimeTypeForImage(imagePath) {
    const ext = path_1.default.extname(imagePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg')
        return 'image/jpeg';
    return 'image/png';
}
function resolveOcrEndpoint(endpoint) {
    return endpoint.trim().replace(/\/+$/, '');
}
async function readNvidiaSizedImage(imagePath) {
    const original = await promises_1.default.readFile(imagePath);
    let imageB64 = original.toString('base64');
    let mediaType = mimeTypeForImage(imagePath);
    if (imageB64.length <= NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT) {
        return { imageB64, mediaType, resized: false };
    }
    const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
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
function collectTextDetections(value) {
    if (!value || typeof value !== 'object') {
        return [];
    }
    const record = value;
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
        const item = detection;
        const text = typeof item.text === 'string' ? item.text : '';
        const confidence = typeof item.confidence === 'number' ? item.confidence : null;
        return text.trim() ? { text: text.trim(), confidence } : null;
    })
        .filter((entry) => Boolean(entry));
}
function collectTextFields(value, texts = []) {
    if (!value || typeof value !== 'object') {
        return texts;
    }
    if (Array.isArray(value)) {
        value.forEach((entry) => collectTextFields(entry, texts));
        return texts;
    }
    const record = value;
    Object.entries(record).forEach(([key, entry]) => {
        if (typeof entry === 'string' &&
            /^(text|content|markdown|ocr_text|recognized_text|transcription)$/i.test(key) &&
            !entry.startsWith('data:image/')) {
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
function parseNvidiaOcrPageResponse(payload, image) {
    const record = payload && typeof payload === 'object' ? payload : {};
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
        .filter((confidence) => typeof confidence === 'number');
    const confidence = confidenceValues.length > 0
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : null;
    return {
        pageNumber: image.pageNumber,
        imagePath: image.imagePath,
        text,
        confidence,
        engine: 'nvidia_nemoretriever',
    };
}
async function nvidiaNemoretrieverOcr(images, config) {
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
        const pages = [];
        const warnings = [];
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
                const message = (json && typeof json === 'object' && 'error' in json ? String(json.error) : '') ||
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
    }
    catch (error) {
        return {
            pages: [],
            warnings: [`NVIDIA Nemotron OCR failed: ${error instanceof Error ? error.message : String(error)}`],
        };
    }
}
