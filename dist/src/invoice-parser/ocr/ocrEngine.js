"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOcr = runOcr;
const googleVisionOcr_1 = require("./googleVisionOcr");
const nvidiaNemoretrieverOcr_1 = require("./nvidiaNemoretrieverOcr");
const geminiVisionOcr_1 = require("./geminiVisionOcr");
const tesseractOcr_1 = require("./tesseractOcr");
async function runOcr(imagePaths, preferredOcr, ocrConfig, geminiApiKey) {
    const warnings = [];
    const useGemini = preferredOcr === 'gemini_vision' ||
        ocrConfig?.provider === 'gemini_vision';
    if (useGemini) {
        const gemini = await (0, geminiVisionOcr_1.geminiVisionOcr)(imagePaths, ocrConfig, geminiApiKey);
        warnings.push(...gemini.warnings);
        if (gemini.pages.length > 0) {
            return { pages: gemini.pages, warnings };
        }
    }
    const nvidia = await (0, nvidiaNemoretrieverOcr_1.nvidiaNemoretrieverOcr)(imagePaths, ocrConfig);
    warnings.push(...nvidia.warnings);
    if (nvidia.pages.length > 0) {
        return { pages: nvidia.pages, warnings };
    }
    const useGoogle = preferredOcr === 'google' ||
        ocrConfig?.provider === 'google' ||
        (preferredOcr === 'auto' && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS));
    if (useGoogle) {
        const google = await (0, googleVisionOcr_1.googleVisionOcr)(imagePaths);
        warnings.push(...google.warnings);
        if (google.pages.length > 0 || preferredOcr === 'google') {
            return { pages: google.pages, warnings };
        }
    }
    const tesseract = await (0, tesseractOcr_1.tesseractOcr)(imagePaths);
    warnings.push(...tesseract.warnings);
    return { pages: tesseract.pages, warnings };
}
