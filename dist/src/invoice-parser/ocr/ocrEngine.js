"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOcr = runOcr;
const googleVisionOcr_1 = require("./googleVisionOcr");
const nvidiaNemoretrieverOcr_1 = require("./nvidiaNemoretrieverOcr");
const geminiVisionOcr_1 = require("./geminiVisionOcr");
const tesseractOcr_1 = require("./tesseractOcr");
function mergeOcrPages(pages) {
    const grouped = new Map();
    for (const page of pages) {
        const entries = grouped.get(page.pageNumber) || [];
        entries.push(page);
        grouped.set(page.pageNumber, entries);
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => left - right)
        .map(([pageNumber, entries]) => {
        const seen = new Set();
        const text = entries
            .map((entry) => entry.text.trim())
            .filter((entry) => {
            if (!entry || seen.has(entry))
                return false;
            seen.add(entry);
            return true;
        })
            .join('\n\n');
        const confidenceValues = entries
            .map((entry) => entry.confidence)
            .filter((value) => typeof value === 'number');
        return {
            ...entries[0],
            pageNumber,
            text,
            confidence: confidenceValues.length > 0
                ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
                : null,
        };
    });
}
async function runOcr(imagePaths, preferredOcr, ocrConfig, geminiApiKey) {
    const warnings = [];
    const useGemini = preferredOcr === 'gemini_vision' ||
        ocrConfig?.provider === 'gemini_vision';
    if (useGemini) {
        const gemini = await (0, geminiVisionOcr_1.geminiVisionOcr)(imagePaths, ocrConfig, geminiApiKey);
        warnings.push(...gemini.warnings);
        if (gemini.pages.length > 0) {
            return { pages: mergeOcrPages(gemini.pages), warnings };
        }
    }
    const nvidia = await (0, nvidiaNemoretrieverOcr_1.nvidiaNemoretrieverOcr)(imagePaths, ocrConfig);
    warnings.push(...nvidia.warnings);
    if (nvidia.pages.length > 0) {
        return { pages: mergeOcrPages(nvidia.pages), warnings };
    }
    const useGoogle = preferredOcr === 'google' ||
        ocrConfig?.provider === 'google' ||
        (preferredOcr === 'auto' && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS));
    if (useGoogle) {
        const google = await (0, googleVisionOcr_1.googleVisionOcr)(imagePaths);
        warnings.push(...google.warnings);
        if (google.pages.length > 0 || preferredOcr === 'google') {
            return { pages: mergeOcrPages(google.pages), warnings };
        }
    }
    const tesseract = await (0, tesseractOcr_1.tesseractOcr)(imagePaths);
    warnings.push(...tesseract.warnings);
    return { pages: mergeOcrPages(tesseract.pages), warnings };
}
