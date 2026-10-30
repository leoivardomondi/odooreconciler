"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const imagePreprocess_1 = require("./imagePreprocess");
(0, node_test_1.default)('fastAutoOrientImage skips orientation when OCR_AUTO_ORIENT is false', async () => {
    const prev = process.env.OCR_AUTO_ORIENT;
    try {
        process.env.OCR_AUTO_ORIENT = 'false';
        const result = await (0, imagePreprocess_1.fastAutoOrientImage)('some/path/image.png');
        strict_1.default.equal(result.angle, 0);
        strict_1.default.equal(result.imagePath, 'some/path/image.png');
    }
    finally {
        process.env.OCR_AUTO_ORIENT = prev;
    }
});
(0, node_test_1.default)('fastAutoOrientImage skips orientation on cropped invoice sections', async () => {
    const result = await (0, imagePreprocess_1.fastAutoOrientImage)('tmp/inv-page-1-header-ocr.png');
    strict_1.default.equal(result.angle, 0);
    strict_1.default.equal(result.imagePath, 'tmp/inv-page-1-header-ocr.png');
});
