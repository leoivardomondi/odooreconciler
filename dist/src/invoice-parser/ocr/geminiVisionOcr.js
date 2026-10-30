"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiVisionOcr = geminiVisionOcr;
async function geminiVisionOcr(_imagePaths, _ocrConfig, _geminiApiKey, _geminiOAuthConnected) {
    return {
        pages: [],
        warnings: ['Google Gemini Vision OCR is currently disabled.'],
    };
}
