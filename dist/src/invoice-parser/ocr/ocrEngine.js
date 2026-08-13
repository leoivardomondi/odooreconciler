"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUseGeminiVisionFallback = shouldUseGeminiVisionFallback;
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
function shouldUseGeminiVisionFallback(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return true;
    const tokens = normalized.split(' ').filter(Boolean);
    const shortTokenCount = tokens.filter((token) => token.length <= 1 && /[a-z0-9]/i.test(token)).length;
    const shortTokenRatio = tokens.length > 0 ? shortTokenCount / tokens.length : 1;
    const repeatedTotals = (normalized.match(/\b(?:total|tutal)\b/gi) || []).length;
    const repeatedInvoiceSignals = (normalized.match(/\b(?:invoice|invoicen|receipt|n?umber|vat|date)\b/gi) || []).length;
    const fragmentedSignals = (normalized.match(/\b(?:tutal|inyoice|invoicen|quast|desux|amqlent|recetv|n?imber)\b/gi) || []).length;
    return normalized.length < 180 ||
        (tokens.length >= 35 && shortTokenRatio >= 0.28) ||
        repeatedTotals >= 4 ||
        repeatedInvoiceSignals >= 8 ||
        fragmentedSignals >= 2;
}
async function maybeRunGeminiVisionFallback(pages, imagePaths, ocrConfig, geminiApiKey, geminiOAuthConnected, warnings) {
    if (!ocrConfig?.geminiFallbackEnabled || ocrConfig.provider === 'gemini_vision') {
        return pages;
    }
    const text = pages.map((page) => page.text).join('\n\n');
    if (!shouldUseGeminiVisionFallback(text))
        return pages;
    warnings.push('Gemini Vision OCR second pass started because the primary OCR result was fragmented, duplicated, or incomplete.');
    const gemini = await (0, geminiVisionOcr_1.geminiVisionOcr)(imagePaths, ocrConfig, geminiApiKey, geminiOAuthConnected);
    warnings.push(...gemini.warnings);
    if (gemini.pages.length === 0)
        return pages;
    warnings.push(`Gemini Vision OCR second pass extracted text from ${gemini.pages.length}/${imagePaths.length} page/crop image(s).`);
    const geminiPageNumbers = new Set(gemini.pages.map((page) => page.pageNumber));
    const primaryPagesWithoutGeminiResult = pages.filter((page) => !geminiPageNumbers.has(page.pageNumber));
    return mergeOcrPages([...primaryPagesWithoutGeminiResult, ...gemini.pages]);
}
async function runOcr(imagePaths, preferredOcr, ocrConfig, geminiApiKey, geminiOAuthConnected) {
    const warnings = [];
    const useGemini = preferredOcr === 'gemini_vision' ||
        ocrConfig?.provider === 'gemini_vision';
    if (useGemini) {
        const gemini = await (0, geminiVisionOcr_1.geminiVisionOcr)(imagePaths, ocrConfig, geminiApiKey, geminiOAuthConnected);
        warnings.push(...gemini.warnings);
        if (gemini.pages.length > 0) {
            return { pages: mergeOcrPages(gemini.pages), warnings };
        }
    }
    const nvidia = await (0, nvidiaNemoretrieverOcr_1.nvidiaNemoretrieverOcr)(imagePaths, ocrConfig);
    warnings.push(...nvidia.warnings);
    if (nvidia.pages.length > 0) {
        const pages = await maybeRunGeminiVisionFallback(nvidia.pages, imagePaths, ocrConfig, geminiApiKey, geminiOAuthConnected, warnings);
        return { pages, warnings };
    }
    const useGoogle = preferredOcr === 'google' ||
        ocrConfig?.provider === 'google' ||
        (preferredOcr === 'auto' && Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS));
    if (useGoogle) {
        const google = await (0, googleVisionOcr_1.googleVisionOcr)(imagePaths);
        warnings.push(...google.warnings);
        if (google.pages.length > 0 || preferredOcr === 'google') {
            const pages = await maybeRunGeminiVisionFallback(google.pages, imagePaths, ocrConfig, geminiApiKey, geminiOAuthConnected, warnings);
            return { pages, warnings };
        }
    }
    const tesseract = await (0, tesseractOcr_1.tesseractOcr)(imagePaths);
    warnings.push(...tesseract.warnings);
    const pages = await maybeRunGeminiVisionFallback(tesseract.pages, imagePaths, ocrConfig, geminiApiKey, geminiOAuthConnected, warnings);
    return { pages, warnings };
}
