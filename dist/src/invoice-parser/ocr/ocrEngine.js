"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runOcr = runOcr;
const googleVisionOcr_1 = require("./googleVisionOcr");
const nvidiaNemoretrieverOcr_1 = require("./nvidiaNemoretrieverOcr");
const tesseractOcr_1 = require("./tesseractOcr");
async function runOcr(imagePaths, preferredOcr, ocrConfig) {
    const warnings = [];
    const nvidia = await (0, nvidiaNemoretrieverOcr_1.nvidiaNemoretrieverOcr)(imagePaths, ocrConfig);
    warnings.push(...nvidia.warnings);
    if (nvidia.pages.length > 0) {
        return { pages: nvidia.pages, warnings };
    }
    const useGoogle = preferredOcr === 'google' ||
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
