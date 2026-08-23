"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPdfText = extractPdfText;
const promises_1 = __importDefault(require("fs/promises"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const normalizeText_1 = require("./core/normalizeText");
async function extractPdfText(filePath) {
    try {
        const buffer = await promises_1.default.readFile(filePath);
        const parsed = await (0, pdf_parse_1.default)(buffer);
        return {
            text: (0, normalizeText_1.normalizeText)(parsed.text || ''),
            pageCount: Number(parsed.numpages || 0),
            warnings: [],
        };
    }
    catch (error) {
        return {
            text: '',
            pageCount: 0,
            warnings: [
                `PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`,
            ],
        };
    }
}
