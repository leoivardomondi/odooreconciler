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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSupplierInvoice = parseSupplierInvoice;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const detectDocumentType_1 = require("./core/detectDocumentType");
const detectSupplier_1 = require("./core/detectSupplier");
const extractDates_1 = require("./core/extractDates");
const normalizeText_1 = require("./core/normalizeText");
const normalizeTotals_1 = require("./core/normalizeTotals");
const recoverHandwrittenItems_1 = require("./core/recoverHandwrittenItems");
const validateInvoice_1 = require("./core/validateInvoice");
const extractPdfText_1 = require("./extractPdfText");
const renderPdfToImages_1 = require("./renderPdfToImages");
const ocrEngine_1 = require("./ocr/ocrEngine");
const imagePreprocess_1 = require("./preprocess/imagePreprocess");
const comply_parser_1 = require("./parsers/comply.parser");
const generic_parser_1 = require("./parsers/generic.parser");
const joinben_parser_1 = require("./parsers/joinben.parser");
const timsales_parser_1 = require("./parsers/timsales.parser");
const tiptop_parser_1 = require("./parsers/tiptop.parser");
const vinyl_parser_1 = require("./parsers/vinyl.parser");
const aiInvoiceExtractor_1 = require("./aiInvoiceExtractor");
const confidence_1 = require("./core/confidence");
function resolveOcrMode(input) {
    if (input === 'google' || input === 'tesseract' || input === 'auto') {
        return input;
    }
    const configured = process.env.OCR_ENGINE_DEFAULT;
    return configured === 'google' || configured === 'tesseract' || configured === 'auto'
        ? configured
        : 'auto';
}
function emptyInvoice(input, warnings) {
    return {
        supplier: null,
        supplier_key: 'UNKNOWN',
        document_type: 'unknown',
        invoice_number: null,
        invoice_date: null,
        customer: null,
        currency: 'KES',
        items: [],
        totals: { goods_total: null, vat: null, amount_due: null },
        confidence: {
            supplier: 0,
            invoice_number: 0,
            date: 0,
            items: 0,
            totals: 0,
            overall: 0,
        },
        warnings,
        raw: {
            pdf_text: '',
            ocr_text: '',
            pages: [
                {
                    page_number: 1,
                    text: '',
                    ocr_used: false,
                    image_path: path_1.default.extname(input.filePath).toLowerCase() === '.pdf' ? undefined : input.filePath,
                },
            ],
        },
    };
}
function parseBySupplier(context) {
    switch (context.supplierKey) {
        case 'COMPLY':
            return (0, comply_parser_1.parseComplyInvoice)(context);
        case 'TIMSALES':
            return (0, timsales_parser_1.parseTimsalesInvoice)(context);
        case 'VINYL_SUPREME':
            return (0, vinyl_parser_1.parseVinylInvoice)(context);
        case 'TIPTOP':
            return (0, tiptop_parser_1.parseTiptopInvoice)(context);
        case 'JOINBEN':
            return (0, joinben_parser_1.parseJoinbenInvoice)(context);
        case 'UNKNOWN':
        default:
            return (0, generic_parser_1.parseGenericInvoice)(context);
    }
}
function removeResolvedValidationWarnings(warnings) {
    const resolvedWarnings = new Set([
        'Invoice date was not found.',
        'No invoice line items were extracted.',
        'Goods total plus VAT does not match amount due.',
    ]);
    return warnings.filter((warning) => !resolvedWarnings.has(warning));
}
function selectFullPageImagePaths(pages) {
    const imagePaths = pages.flatMap((page) => (page.image_path ? [page.image_path] : []));
    const fullPageImages = imagePaths.filter((imagePath) => /-page-\d+\.[a-z]+$/i.test(imagePath));
    return fullPageImages.length > 0 ? fullPageImages : imagePaths;
}
async function parseSupplierInvoice(input) {
    const warnings = [];
    const tempFilesToClean = new Set();
    try {
        const preferredOcr = resolveOcrMode(input.preferredOcr);
        const pdfTextResult = await (0, extractPdfText_1.extractPdfText)(input.filePath);
        warnings.push(...pdfTextResult.warnings);
        if (input.aiConfig?.ocr?.enabled && input.aiConfig.ocr.provider !== 'disabled') {
            warnings.push(`OCR pipeline configured: ${input.aiConfig.ocr.model || input.aiConfig.ocr.provider} reads scanned pages before invoice AI.`);
        }
        let ocrText = '';
        let rawPages = [
            {
                page_number: 1,
                text: pdfTextResult.text,
                ocr_used: false,
            },
        ];
        if (input.alwaysOcr || !(0, normalizeText_1.looksReadableInvoiceText)(pdfTextResult.text)) {
            warnings.push(input.alwaysOcr
                ? 'OCR was forced so scanned/garbled invoice pages can be cross-checked against embedded PDF text.'
                : 'Embedded PDF text was unreadable or suspicious, so OCR was attempted.');
            const rendered = await (0, renderPdfToImages_1.renderPdfToImages)(input.filePath);
            warnings.push(...rendered.warnings);
            rendered.images.forEach((image) => tempFilesToClean.add(image.imagePath));
            const preprocessed = await Promise.all(rendered.images.map(async (image) => {
                const processed = await (0, imagePreprocess_1.preprocessImage)(image.imagePath);
                warnings.push(...processed.warnings);
                tempFilesToClean.add(processed.imagePath);
                return { pageNumber: image.pageNumber, imagePath: processed.imagePath };
            }));
            const ocr = await (0, ocrEngine_1.runOcr)(preprocessed, preferredOcr, input.aiConfig?.ocr);
            warnings.push(...ocr.warnings);
            ocrText = (0, normalizeText_1.normalizeText)(ocr.pages.map((page) => page.text).join('\n\n'));
            rawPages = ocr.pages.map((page) => ({
                page_number: page.pageNumber,
                text: page.text,
                ocr_used: true,
                image_path: page.imagePath,
            }));
        }
        const combinedText = (0, normalizeText_1.normalizeText)([ocrText, pdfTextResult.text].filter(Boolean).join('\n\n'));
        if (!combinedText) {
            return emptyInvoice(input, [...new Set(warnings.concat('No readable text was extracted from the invoice.'))]);
        }
        const supplier = (0, detectSupplier_1.detectSupplier)(combinedText);
        const documentType = (0, detectDocumentType_1.detectDocumentType)(combinedText);
        const context = {
            text: combinedText,
            pdfText: pdfTextResult.text,
            ocrText,
            supplierKey: supplier.key,
            documentType,
            originalFilename: input.originalFilename,
            warnings,
        };
        const parsed = parseBySupplier(context);
        const withSupplier = {
            ...parsed,
            supplier: parsed.supplier || supplier.supplier,
            invoice_date: parsed.invoice_date || (0, extractDates_1.extractIsoDateFromFilename)(input.originalFilename),
            raw: {
                ...parsed.raw,
                pdf_text: pdfTextResult.text,
                ocr_text: ocrText,
                pages: rawPages,
            },
        };
        let finalInvoice = (0, normalizeTotals_1.normalizeInvoiceTotals)(withSupplier);
        finalInvoice = (0, recoverHandwrittenItems_1.recoverHandwrittenInvoiceItems)(finalInvoice);
        finalInvoice = (0, normalizeTotals_1.normalizeInvoiceTotals)(finalInvoice);
        finalInvoice = {
            ...finalInvoice,
            warnings: (0, validateInvoice_1.validateInvoice)(finalInvoice),
        };
        if (input.forceAi
            ? input.aiConfig?.enabled && input.aiConfig.provider !== 'disabled'
            : input.aiConfig
                ? (0, aiInvoiceExtractor_1.shouldUseConfiguredAiInvoiceExtraction)(finalInvoice, input.aiConfig)
                : (0, aiInvoiceExtractor_1.shouldUseAiInvoiceExtraction)(finalInvoice)) {
            if (input.aiConfig?.enabled && input.aiConfig.provider !== 'disabled') {
                warnings.push(`AI interpretation configured: ${input.aiConfig.provider} ${input.aiConfig.model || ''} reads OCR/PDF text after OCR.`);
            }
            let aiImagePaths = selectFullPageImagePaths(finalInvoice.raw.pages);
            if (aiImagePaths.length === 0) {
                const rendered = await (0, renderPdfToImages_1.renderPdfToImages)(input.filePath);
                rendered.images.forEach((image) => tempFilesToClean.add(image.imagePath));
                finalInvoice = {
                    ...finalInvoice,
                    warnings: [...finalInvoice.warnings, ...rendered.warnings],
                    raw: {
                        ...finalInvoice.raw,
                        pages: rendered.images.map((image) => ({
                            page_number: image.pageNumber,
                            text: '',
                            ocr_used: false,
                            image_path: image.imagePath,
                        })),
                    },
                };
                aiImagePaths = rendered.images.map((image) => image.imagePath);
            }
            const aiResult = await (0, aiInvoiceExtractor_1.extractInvoiceWithAi)({
                imagePaths: aiImagePaths,
                ocrText,
                pdfText: pdfTextResult.text,
                originalFilename: input.originalFilename,
                config: input.aiConfig,
            });
            finalInvoice = {
                ...finalInvoice,
                warnings: [...finalInvoice.warnings, ...aiResult.warnings],
            };
            if (aiResult.extraction) {
                const merged = (0, aiInvoiceExtractor_1.mergeAiInvoiceExtraction)(finalInvoice, aiResult.extraction);
                let normalizedMerged = (0, normalizeTotals_1.normalizeInvoiceTotals)(merged);
                normalizedMerged = (0, recoverHandwrittenItems_1.recoverHandwrittenInvoiceItems)(normalizedMerged);
                normalizedMerged = (0, normalizeTotals_1.normalizeInvoiceTotals)(normalizedMerged);
                finalInvoice = {
                    ...normalizedMerged,
                    confidence: (0, confidence_1.computeConfidence)(normalizedMerged),
                    warnings: removeResolvedValidationWarnings(normalizedMerged.warnings),
                };
                finalInvoice = {
                    ...finalInvoice,
                    warnings: (0, validateInvoice_1.validateInvoice)(finalInvoice),
                };
            }
        }
        return finalInvoice;
    }
    finally {
        for (const filePath of tempFilesToClean) {
            if (filePath !== input.filePath) {
                await promises_1.default.unlink(filePath).catch(() => undefined);
            }
        }
    }
}
__exportStar(require("./types"), exports);
