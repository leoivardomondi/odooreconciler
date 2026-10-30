"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTesseractEnabled = isTesseractEnabled;
exports.getBundledTesseractOptions = getBundledTesseractOptions;
exports.getBundledTesseractDataPath = getBundledTesseractDataPath;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("./paths");
const trainedDataPath = (0, paths_1.resolveFromProjectRoot)('eng.traineddata');
/**
 * Tesseract OCR is disabled by default. Invoice extraction relies on the
 * configured AI vision provider (e.g. OpenAI GPT-4o), which reads scans and
 * handwriting far more accurately. Tesseract was slow on the shared host and
 * produced misleading values (e.g. handwritten "4,100" read as "21100").
 * Set TESSERACT_ENABLED=true to re-enable it as a local fallback.
 */
function isTesseractEnabled() {
    return ['1', 'true', 'yes', 'on'].includes(String(process.env.TESSERACT_ENABLED || '').toLowerCase());
}
function getBundledTesseractOptions() {
    if (!fs_1.default.existsSync(trainedDataPath)) {
        throw new Error(`Bundled Tesseract language data is missing: ${trainedDataPath}`);
    }
    return {
        langPath: path_1.default.dirname(trainedDataPath),
        gzip: false,
        cacheMethod: 'none',
    };
}
function getBundledTesseractDataPath() {
    return trainedDataPath;
}
