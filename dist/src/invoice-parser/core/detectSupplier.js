"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectSupplier = detectSupplier;
const normalizeText_1 = require("./normalizeText");
function titleCaseSupplier(value) {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .replace(/\b([a-z])/g, (letter) => letter.toUpperCase())
        .replace(/\bLtd\b/g, 'LTD')
        .replace(/\bLimited\b/g, 'Limited');
}
function extractHeaderSupplier(text) {
    const lines = text
        .split('\n')
        .map((line) => line.replace(/[^A-Z0-9&.,' -]/gi, ' ').replace(/\s+/g, ' ').trim())
        .filter((line) => line.length >= 4)
        .slice(0, 45);
    const blocked = /\b(receipt|invoice|billing|shipping|description|quantity|price|amount|vat|total|paybill|terms|tel|email|box|street|road|pin|buyer|date|carriage|owners?\s+risk|subject\s+to|goods\s+once|received?\s+the\s+above|urban\s*vibe)\b/i;
    const buyerLinePattern = /\b(?:bill\s*to|invoice\s*to|sold\s*to|ship\s*to|deliver(?:ed)?\s*to|customer|buyer|client|urban\s*vibe)\b/i;
    const disclaimerPattern = /\b(?:carriage\s+paid|owners?\s+risk|subject\s+to|goods\s+once\s+sold|received?\s+the\s+above|in\s+good\s+order|condition)\b/i;
    const companyPattern = /\b([A-Z][A-Z0-9&.,' -]{2,80}\b(?:ENTERPRISES?|TRADERS?|SUPPLIERS?|STATIONERS?|COMPANY|CO\.?|LTD|LIMITED|HARDWARE|TIMBER|SUPERMARKET|INDUSTRIES|INDUSTRIAL)\b(?:\s+LTD|\s+LIMITED)?)\b/i;
    const candidates = [];
    for (const line of lines) {
        // Ignore lines that are invoice title indicators e.g. "Sales Invoice", "Tax Invoice", "SalesInvoice Co"
        if (/\b(?:sales|tax|proforma|cash)\s*[li1]nvoice\b/i.test(line) || /sales[li1]nvoice/i.test(line) || /[li1]nvoice\s*co\b/i.test(line)) {
            continue;
        }
        if (buyerLinePattern.test(line) || disclaimerPattern.test(line)) {
            continue;
        }
        if (blocked.test(line) && !/\b(LTD|LIMITED|ENTERPRISES?|COMPANY|CO\.?)\b/i.test(line)) {
            continue;
        }
        const match = line.match(companyPattern);
        const supplier = match?.[1]
            ?.replace(/\b(RECEIPT|INVOICE)\b/gi, '')
            ?.replace(/^(?:TO|FROM|M\/S|MESSRS)\s+/i, '')
            .trim();
        if (supplier && supplier.length >= 5) {
            if (/\b(?:sales|tax|proforma|cash)\s*[li1]nvoice\b/i.test(supplier) ||
                /sales[li1]nvoice/i.test(supplier) ||
                /[li1]nvoice\s*co\b/i.test(supplier) ||
                buyerLinePattern.test(supplier) ||
                disclaimerPattern.test(supplier)) {
                continue;
            }
            // Reject single-generic-word fragments such as "Water LTD" or "Company LTD"
            const nonSuffixWords = supplier
                .replace(/[^A-Za-z0-9\s]/g, ' ')
                .trim()
                .split(/\s+/)
                .filter((w) => !/^(?:CO|COMPANY|LTD|LIMITED|INC|CORP|PLC)$/i.test(w));
            if (nonSuffixWords.length === 0 ||
                (nonSuffixWords.length === 1 && /^(?:WATER|HARDWARE|ENTERPRISES?|SUPPLIERS?|TRADERS?|STATIONERS?|SUPERMARKET|GENERAL|TIMBER|GLASS)$/i.test(nonSuffixWords[0]))) {
                continue;
            }
            let priority = 1;
            if (/\b(LTD|LIMITED)\b/i.test(supplier)) {
                priority = 3;
            }
            else if (/\b(ENTERPRISES?|SUPPLIERS?|TRADERS?)\b/i.test(supplier)) {
                priority = 2;
            }
            candidates.push({ name: titleCaseSupplier(supplier), priority });
        }
    }
    candidates.sort((left, right) => right.priority - left.priority);
    return candidates[0]?.name || null;
}
function detectSupplier(text) {
    const normalized = (0, normalizeText_1.normalizeForSearch)(text);
    if (normalized.includes('comply industries')) {
        return { key: 'COMPLY', supplier: 'Comply Industries Limited', confidence: 0.98 };
    }
    if (normalized.includes('timsales limited')) {
        return { key: 'TIMSALES', supplier: 'Timsales Limited', confidence: 0.98 };
    }
    if (normalized.includes('p000591147n') || normalized.includes('po00s91147n')) {
        return { key: 'TIMSALES', supplier: 'Timsales Limited', confidence: 0.8 };
    }
    if (normalized.includes('vinyl supreme ceilings')) {
        return { key: 'VINYL_SUPREME', supplier: 'Vinyl Supreme Ceilings & Decor Limited', confidence: 0.98 };
    }
    if (normalized.includes('tiptop') ||
        normalized.includes('tip top') ||
        normalized.includes('tif tof') ||
        normalized.includes('p052392555g') ||
        normalized.includes('ziwaniwoodskenya')) {
        return { key: 'TIPTOP', supplier: 'Tiptop Woods Co. Ltd', confidence: 0.98 };
    }
    if (normalized.includes('joinben company')) {
        return { key: 'JOINBEN', supplier: 'Joinben Company Limited', confidence: 0.98 };
    }
    const headerSupplier = extractHeaderSupplier(text);
    if (headerSupplier) {
        return { key: 'UNKNOWN', supplier: headerSupplier, confidence: 0.65 };
    }
    return { key: 'UNKNOWN', supplier: null, confidence: 0.15 };
}
