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
import { fastAutoOrientImage, preprocessImage } from './preprocess/imagePreprocess';
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
import { isTesseractEnabled } from '../utils/tesseractData';

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
  const imagePaths = pages.flatMap((page) => [
    ...(page.image_path ? [page.image_path] : []),
    ...(page.image_variants || []),
  ]);
  const fullPageImages = imagePaths.filter((imagePath) => /-page-\d+(?:-[a-z]+)*\.[a-z]+$/i.test(imagePath));
  return fullPageImages.length > 0 ? fullPageImages : imagePaths;
}

function assessHandwriting(input: { ocrText: string; invoice: ParsedInvoice }) {
  const reasons: string[] = [];
  const normalized = input.ocrText.replace(/\s+/g, ' ').trim();
  const alphaNumericCount = (normalized.match(/[a-z0-9]/gi) || []).length;
  const suspiciousMarks = (normalized.match(/[|_~`{}<>]/g) || []).length;
  const lowTextSignal = normalized.length > 0 && alphaNumericCount < Math.max(35, normalized.length * 0.38);
  const recoveredRows = input.invoice.warnings.some((warning) => /handwritten invoice rows were recovered/i.test(warning));
  const lowConfidence = input.invoice.confidence.overall < 0.68;

  if (recoveredRows) reasons.push('handwritten line-item recovery was required');
  if (lowTextSignal) reasons.push('OCR returned sparse or fragmented text');
  if (suspiciousMarks >= 3) reasons.push('OCR returned handwriting-like noise');
  if (lowConfidence) reasons.push('overall extraction confidence is low');

  const confidence = Number((
    (recoveredRows ? 0.45 : 0) +
    (lowTextSignal ? 0.25 : 0) +
    (suspiciousMarks >= 3 ? 0.15 : 0) +
    (lowConfidence ? 0.15 : 0)
  ).toFixed(2));
  const detected = confidence >= 0.35;
  return { detected, confidence, reviewRequired: detected && confidence >= 0.55, reasons };
}

export function isVisionConfigured(config?: ParseSupplierInvoiceInput['aiConfig']): boolean {
  if (!config?.enabled || config.provider === 'disabled') return false;

  const provider = config.provider;
  const model = (config.model || '').trim().toLowerCase();

  switch (provider) {
    case 'openai': {
      // Exclude text-only or embedding models
      const isTextOnly = /^(o3-mini|o1-mini|gpt-3\.5|text-embedding)/i.test(model);
      if (isTextOnly) return false;
      return Boolean(config.apiKeys?.openai || process.env.OPENAI_API_KEY);
    }
    case 'nvidia': {
      const isVision =
        model === 'google/gemma-4-31b-it' ||
        model === 'minimaxai/minimax-m3.1-flash' ||
        model === 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1' ||
        model.startsWith('meta/llama-3.2-');
      if (!isVision) return false;
      return Boolean(
        config.apiKeys?.nvidia ||
        process.env.NVIDIA_API_KEY ||
        (config.model && config.nvidiaModelKeys?.[config.model]),
      );
    }
    case 'gemini': {
      return Boolean(config.apiKeys?.gemini || process.env.GEMINI_API_KEY || config.geminiOAuth?.connected);
    }
    case 'anthropic': {
      return Boolean(config.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY);
    }
    case 'openrouter': {
      const isVision = /(vision|vl|gpt-4o|claude-3|gemini)/i.test(model);
      if (!isVision) return false;
      return Boolean(config.apiKeys?.openrouter || process.env.OPENROUTER_API_KEY);
    }
    default:
      return false;
  }
}

export const isGemmaVisionConfigured = isVisionConfigured;

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
        `OCR fallback configured: ${input.aiConfig.ocr.model || input.aiConfig.ocr.provider} runs only if the primary invoice AI path fails or is below confidence threshold.`,
      );
    }

    let ocrText = '';
    let visionFirstAttempted = false;
    let visionFirstFailed = false;
    let rawPages: ParsedInvoice['raw']['pages'] = [
      {
        page_number: 1,
        text: pdfTextResult.text,
        ocr_used: false,
      },
    ];

    if (isVisionConfigured(input.aiConfig)) {
      visionFirstAttempted = true;
      const rendered = await renderPdfToImages(input.filePath);
      warnings.push(...rendered.warnings);
      rendered.images.forEach((image) => tempFilesToClean.add(image.imagePath));

      const fullPageImages = rendered.images.filter((image) =>
        /-page-\d+\.(?:png|jpe?g|webp)$/i.test(image.imagePath) || rendered.images.length === 1,
      );
      const orientedVisionImages = await Promise.all(
        fullPageImages.map(async (image) => {
          const oriented = await fastAutoOrientImage(image.imagePath);
          warnings.push(...oriented.warnings);
          if (oriented.imagePath !== image.imagePath) {
            tempFilesToClean.add(oriented.imagePath);
          }
          return {
            pageNumber: image.pageNumber,
            imagePath: oriented.imagePath,
          };
        }),
      );
      const visionImages = orientedVisionImages.map((image) => image.imagePath);
      rawPages = orientedVisionImages.map((image) => ({
        page_number: image.pageNumber,
        text: '',
        ocr_used: false,
        image_path: image.imagePath,
      }));

      const visionResult = await extractInvoiceWithAi({
        imagePaths: visionImages,
        ocrText: '',
        pdfText: pdfTextResult.text,
        originalFilename: input.originalFilename,
        config: input.aiConfig,
      });
      warnings.push(...visionResult.warnings);

      const confidenceThreshold = Number(input.aiConfig?.confidenceThreshold || 0.75);
      const visionConfidence = visionResult.extraction?.confidence ?? 0;
      const hasUsableExtraction = Boolean(
        visionResult.extraction &&
        (visionResult.extraction.supplier ||
          visionResult.extraction.totals?.amount_due ||
          (visionResult.extraction.items && visionResult.extraction.items.length > 0)),
      );
      if (visionResult.extraction && (visionConfidence >= confidenceThreshold || hasUsableExtraction)) {
        let visionInvoice = mergeAiInvoiceExtraction(emptyInvoice(input, warnings), visionResult.extraction);
        visionInvoice = normalizeInvoiceTotals(visionInvoice);
        const filenameDate = extractIsoDateFromFilename(input.originalFilename);
        if (!visionInvoice.invoice_date) {
          visionInvoice.invoice_date = filenameDate;
        } else if (filenameDate && visionInvoice.invoice_date) {
          const fileYear = Number(filenameDate.slice(0, 4));
          const invYear = Number(visionInvoice.invoice_date.slice(0, 4));
          if (Math.abs(fileYear - invYear) >= 2) {
            visionInvoice.warnings.push(`Extracted invoice year ${invYear} conflicted significantly with scan filename date ${filenameDate}; corrected to filename date.`);
            visionInvoice.invoice_date = filenameDate;
          }
        }
        if (!visionInvoice.supplier_key || visionInvoice.supplier_key === 'UNKNOWN') {
          const detected = detectSupplier(visionInvoice.supplier || '');
          if (detected.key !== 'UNKNOWN') {
            visionInvoice.supplier_key = detected.key;
            if (!visionInvoice.supplier) visionInvoice.supplier = detected.supplier;
          }
        }
        const safeInvNum = sanitizeInvoiceNumberFromAddress(
          visionInvoice.invoice_number,
          visionResult.extraction.notes?.join(' ') || visionInvoice.supplier || '',
        );
        if (visionInvoice.invoice_number && !safeInvNum) {
          visionInvoice.invoice_number = null;
          visionInvoice.warnings.push('A PO Box/address value was rejected as an invoice number.');
        }
        visionInvoice = {
          ...visionInvoice,
          confidence: computeConfidence(visionInvoice),
          raw: { ...visionInvoice.raw, pages: rawPages },
          warnings: validateInvoice(visionInvoice),
        };
        return visionInvoice;
      }

      visionFirstFailed = true;
      const modelLabel = `${input.aiConfig?.provider || 'AI'} ${input.aiConfig?.model || ''}`.trim();
      warnings.push(
        visionResult.extraction
          ? `End-to-end vision extraction (${modelLabel}) confidence ${visionConfidence.toFixed(2)} was below configured threshold ${confidenceThreshold.toFixed(2)}; OCR fallback started.`
          : `End-to-end vision extraction (${modelLabel}) returned no usable structured result; OCR fallback started.`,
      );
    }

    const hasActiveOcrEngine =
      isTesseractEnabled() ||
      Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS) ||
      (input.aiConfig?.ocr?.enabled && input.aiConfig.ocr.provider !== 'disabled');

    if ((visionFirstFailed || input.alwaysOcr || !looksReadableInvoiceText(pdfTextResult.text)) && hasActiveOcrEngine) {
      warnings.push(
        visionFirstFailed
          ? 'Primary end-to-end vision extraction was below threshold or failed, so OCR fallback was started.'
          : input.alwaysOcr
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
          for (const variantPath of processed.variantPaths || []) tempFilesToClean.add(variantPath);
          return {
            pageNumber: image.pageNumber,
            imagePath: processed.imagePath,
            imageVariants: processed.variantPaths,
          };
        }),
      );

      const ocr = await runOcr(
        preprocessed,
        preferredOcr,
        input.aiConfig?.ocr,
        input.aiConfig?.apiKeys?.gemini,
        input.aiConfig?.geminiOAuth?.connected,
      );
      warnings.push(...ocr.warnings);
      ocrText = normalizeText(ocr.pages.map((page) => page.text).join('\n\n'));
      const imageVariantsByPage = new Map(
        preprocessed.map((page) => [page.pageNumber, page.imageVariants || []]),
      );
      rawPages = ocr.pages.map((page) => ({
        page_number: page.pageNumber,
        text: page.text,
        ocr_used: true,
        image_path: page.imagePath,
        image_variants: imageVariantsByPage.get(page.pageNumber),
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
    const fallbackFilenameDate = extractIsoDateFromFilename(input.originalFilename);
    if (fallbackFilenameDate && withSupplier.invoice_date) {
      const fileYear = Number(fallbackFilenameDate.slice(0, 4));
      const invYear = Number(withSupplier.invoice_date.slice(0, 4));
      if (Math.abs(fileYear - invYear) >= 2) {
        withSupplier.warnings.push(`Extracted invoice year ${invYear} conflicted significantly with scan filename date ${fallbackFilenameDate}; corrected to filename date.`);
        withSupplier.invoice_date = fallbackFilenameDate;
      }
    }
    let finalInvoice = normalizeInvoiceTotals(withSupplier);
    finalInvoice = recoverHandwrittenInvoiceItems(finalInvoice);
    finalInvoice = normalizeInvoiceTotals(finalInvoice);
    finalInvoice = {
      ...finalInvoice,
      handwriting: assessHandwriting({ ocrText, invoice: finalInvoice }),
    };
    finalInvoice = {
      ...finalInvoice,
      warnings: validateInvoice(finalInvoice),
    };

    if (
        (!visionFirstAttempted || visionFirstFailed) && (input.forceAi
        ? input.aiConfig?.enabled && input.aiConfig.provider !== 'disabled'
        : input.aiConfig
        ? Boolean(finalInvoice.handwriting?.detected) || shouldUseConfiguredAiInvoiceExtraction(finalInvoice, input.aiConfig)
        : shouldUseAiInvoiceExtraction(finalInvoice))
    ) {
      if (input.aiConfig?.enabled && input.aiConfig.provider !== 'disabled') {
        warnings.push(
          isVisionConfigured(input.aiConfig)
            ? `AI interpretation configured: ${input.aiConfig.provider} ${input.aiConfig.model || ''} retrying with OCR/PDF text after primary vision pass.`
            : `AI interpretation configured: ${input.aiConfig.provider} ${input.aiConfig.model || ''} reads OCR/PDF text after OCR.`,
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
