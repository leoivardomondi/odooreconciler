"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBundledTesseractOptions = getBundledTesseractOptions;
exports.getBundledTesseractDataPath = getBundledTesseractDataPath;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("./paths");
const trainedDataPath = (0, paths_1.resolveFromProjectRoot)('eng.traineddata');
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
