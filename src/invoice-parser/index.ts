import path from 'path';
import fs from 'fs/promises';
import { detectDocumentType } from './core/detectDocumentType';
import { detectSupplier } from './core/detectSupplier';
import { extractDateNear, extractIsoDateFromFilename } from './core/extractDates';
import { looksReadableInvoiceText, normalizeText } from './core/normalizeText';
import { normalizeInvoiceTotals } from './core/normalizeTotals';
import { recoverHandwrittenInvoiceItems } from './core/recoverHandwrittenItems';
import { validateInvoice } from './core/validateInvoice';
import { extractPdfText } from './extractPdfText';
import { renderPdfToImages } from './renderPdfToImages';
import { runOcr } from './ocr/ocrEngine';
import { preprocessImage } from './preprocess/imagePreprocess';
import { parseComplyInvoice } from './parsers/comply.parser';
import { parseGenericInvoice } from './parsers/generic.parser';
import { parseJoinbenInvoice } from './parsers/joinben.parser';
import { parseTimsalesInvoice } from './parsers/timsales.parser';
import { parseTiptopInvoice } from './parsers/tiptop.parser';
import { parseVinylInvoice } from './parsers/vinyl.parser';
import { ParsedInvoice, ParseSupplierInvoiceInput, ParserContext, PreferredOcr } from './types';
import {
  extractInvoiceWithAi,
  mergeAiInvoiceExtraction,
  shouldUseConfiguredAiInvoiceExtraction,
  shouldUseAiInvoiceExtraction,
} from './aiInvoiceExtractor';
import { computeConfidence } from './core/confidence';

function resolveOcrMode(input?: PreferredOcr): PreferredOcr {
  if (input === 'google' || input === 'tesseract' || input === 'auto') {
    return input;
  }

  const configured = process.env.OCR_ENGINE_DEFAULT;
  return configured === 'google' || configured === 'tesseract' || configured === 'auto'
    ? configured
    : 'auto';
}

function emptyInvoice(input: ParseSupplierInvoiceInput, warnings: string[]): ParsedInvoice {
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
          image_path: path.extname(input.filePath).toLowerCase() === '.pdf' ? undefined : input.filePath,
        },
      ],
    },
  };
}

function parseBySupplier(context: ParserContext): ParsedInvoice {
  switch (context.supplierKey) {
    case 'COMPLY':
      return parseComplyInvoice(context);
    case 'TIMSALES':
      return parseTimsalesInvoice(context);
    case 'VINYL_SUPREME':
      return parseVinylInvoice(context);
    case 'TIPTOP':
      return parseTiptopInvoice(context);
    case 'JOINBEN':
      return parseJoinbenInvoice(context);
    case 'UNKNOWN':
    default:
      return parseGenericInvoice(context);
  }
}

function removeResolvedValidationWarnings(warnings: string[]) {
  const resolvedWarnings = new Set([
    'Invoice date was not found.',
    'No invoice line items were extracted.',
    'Goods total plus VAT does not match amount due.',
  ]);

  return warnings.filter((warning) => !resolvedWarnings.has(warning));
}

function selectFullPageImagePaths(pages: ParsedInvoice['raw']['pages']) {
  const imagePaths = pages.flatMap((page) => (page.image_path ? [page.image_path] : []));
  const fullPageImages = imagePaths.filter((imagePath) => /-page-\d+\.[a-z]+$/i.test(imagePath));
  return fullPageImages.length > 0 ? fullPageImages : imagePaths;
}

function sanitizeInvoiceNumberFromAddress(value: string | null | undefined, text: string) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;

  const normalizedCandidate = normalizeText(candidate).replace(/\s+/g, ' ');
  const normalizedText = normalizeText(text).replace(/\s+/g, ' ');
  const escaped = normalizedCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // A scanner/AI can mistake a PO Box such as "835-40100" for an invoice
  // number. Keep it only when the same value is clearly labelled as an invoice,
  // receipt, or serial number.
  if (new RegExp(`\\b(?:p\\s*o|po)\\s+box\\s+${escaped}\\b`, 'i').test(normalizedText)) {
    const labelled = new RegExp(`\\b(?:invoice|receipt|serial)(?:\\s+number|\\s+no|\\s+#)?\\s*[:#-]?\\s*${escaped}\\b`, 'i');
    if (!labelled.test(normalizedText)) return null;
  }

  return candidate;
}

export async function parseSupplierInvoice(input: ParseSupplierInvoiceInput): Promise<ParsedInvoice> {
  const warnings: string[] = [];
  const tempFilesToClean = new Set<string>();
  try {
    const preferredOcr = resolveOcrMode(input.preferredOcr);
    const pdfTextResult = await extractPdfText(input.filePath);
    warnings.push(...pdfTextResult.warnings);
    if (input.aiConfig?.ocr?.enabled && input.aiConfig.ocr.provider !== 'disabled') {
      warnings.push(
        `OCR pipeline configured: ${input.aiConfig.ocr.model || input.aiConfig.ocr.provider} reads scanned pages before invoice AI.`,
      );
    }

    let ocrText = '';
    let rawPages: ParsedInvoice['raw']['pages'] = [
      {
        page_number: 1,
        text: pdfTextResult.text,
        ocr_used: false,
      },
    ];

    if (input.alwaysOcr || !looksReadableInvoiceText(pdfTextResult.text)) {
      warnings.push(
        input.alwaysOcr
          ? 'OCR was forced so scanned/garbled invoice pages can be cross-checked against embedded PDF text.'
          : 'Embedded PDF text was unreadable or suspicious, so OCR was attempted.',
      );
      const rendered = await renderPdfToImages(input.filePath);
      warnings.push(...rendered.warnings);
      rendered.images.forEach((image) => tempFilesToClean.add(image.imagePath));

      const preprocessed = await Promise.all(
        rendered.images.map(async (image) => {
          const processed = await preprocessImage(image.imagePath);
          warnings.push(...processed.warnings);
          tempFilesToClean.add(processed.imagePath);
          return { pageNumber: image.pageNumber, imagePath: processed.imagePath };
        }),
      );

      const ocr = await runOcr(
        preprocessed,
        preferredOcr,
        input.aiConfig?.ocr,
        input.aiConfig?.apiKeys?.gemini,
      );
      warnings.push(...ocr.warnings);
      ocrText = normalizeText(ocr.pages.map((page) => page.text).join('\n\n'));
      rawPages = ocr.pages.map((page) => ({
        page_number: page.pageNumber,
        text: page.text,
        ocr_used: true,
        image_path: page.imagePath,
      }));
    }

    const combinedText = normalizeText([ocrText, pdfTextResult.text].filter(Boolean).join('\n\n'));
    if (!combinedText) {
      return emptyInvoice(input, [...new Set(warnings.concat('No readable text was extracted from the invoice.'))]);
    }

    const supplier = detectSupplier(combinedText);
    const documentType = detectDocumentType(combinedText);
    const context: ParserContext = {
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
      // Receipt/invoice text always outranks scanner/Odoo filename metadata.
      invoice_date:
        parsed.invoice_date ||
        extractDateNear(combinedText, ['invoice date', 'receipt date', 'date issued', 'date']) ||
        extractIsoDateFromFilename(input.originalFilename),
      raw: {
        ...parsed.raw,
        pdf_text: pdfTextResult.text,
        ocr_text: ocrText,
        pages: rawPages,
      },
    };
    let finalInvoice = normalizeInvoiceTotals(withSupplier);
    finalInvoice = recoverHandwrittenInvoiceItems(finalInvoice);
    finalInvoice = normalizeInvoiceTotals(finalInvoice);
    finalInvoice = {
      ...finalInvoice,
      warnings: validateInvoice(finalInvoice),
    };

    if (
      input.forceAi
        ? input.aiConfig?.enabled && input.aiConfig.provider !== 'disabled'
        : input.aiConfig
        ? shouldUseConfiguredAiInvoiceExtraction(finalInvoice, input.aiConfig)
        : shouldUseAiInvoiceExtraction(finalInvoice)
    ) {
      if (input.aiConfig?.enabled && input.aiConfig.provider !== 'disabled') {
        warnings.push(
          `AI interpretation configured: ${input.aiConfig.provider} ${input.aiConfig.model || ''} reads OCR/PDF text after OCR.`,
        );
      }
      let aiImagePaths = selectFullPageImagePaths(finalInvoice.raw.pages);

      if (aiImagePaths.length === 0) {
        const rendered = await renderPdfToImages(input.filePath);
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

      try {
        const aiResult = await extractInvoiceWithAi({
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
          const merged = mergeAiInvoiceExtraction(finalInvoice, aiResult.extraction);
          let normalizedMerged = normalizeInvoiceTotals(merged);
          normalizedMerged = recoverHandwrittenInvoiceItems(normalizedMerged);
          normalizedMerged = normalizeInvoiceTotals(normalizedMerged);
          finalInvoice = {
            ...normalizedMerged,
            confidence: computeConfidence(normalizedMerged),
            warnings: removeResolvedValidationWarnings(normalizedMerged.warnings),
          };
          finalInvoice = {
            ...finalInvoice,
            warnings: validateInvoice(finalInvoice),
          };
        }
      } catch (aiError) {
        const errorMessage = aiError instanceof Error ? aiError.message : 'AI API request failed.';
        warnings.push(
          `AI API extraction skipped or quota exceeded (${errorMessage}). Falling back to local pdf-parse / OCR extraction.`,
        );
        finalInvoice = {
          ...finalInvoice,
          warnings: [...finalInvoice.warnings, ...warnings],
        };
      }
    }

    const safeInvoiceNumber = sanitizeInvoiceNumberFromAddress(finalInvoice.invoice_number, combinedText);
    if (finalInvoice.invoice_number && !safeInvoiceNumber) {
      finalInvoice = {
        ...finalInvoice,
        invoice_number: null,
        warnings: [...finalInvoice.warnings, 'A PO Box/address value was rejected as an invoice number.'],
      };
    }

    return finalInvoice;
  } finally {
    for (const filePath of tempFilesToClean) {
      if (filePath !== input.filePath) {
        await fs.unlink(filePath).catch(() => undefined);
      }
    }
  }
}

export * from './types';
