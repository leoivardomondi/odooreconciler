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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMpesaStatement = extractMpesaStatement;
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const promises_1 = require("fs/promises");
const extractPdfText_1 = require("../invoice-parser/extractPdfText");
const renderPdfToImages_1 = require("../invoice-parser/renderPdfToImages");
const ocrEngine_1 = require("../invoice-parser/ocr/ocrEngine");
const imagePreprocess_1 = require("../invoice-parser/preprocess/imagePreprocess");
const aiCategoryService_1 = require("./aiCategoryService");
const FULL_PAGE_IMAGE_PATTERN = /-page-\d+\.[a-z]+$/i;
const NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT = 180_000;
const NVIDIA_TABLE_STRUCTURE_ENDPOINT = process.env.NVIDIA_TABLE_STRUCTURE_ENDPOINT ||
    'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-table-structure-v1';
const MPESA_RECEIPT_PATTERN = /\b(?=[A-Z0-9]{10}\b)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/i;
const PHONE_PATTERN = /\b(?:254\d{9}|0[17]\d{8})\b/;
const MASKED_PHONE_PATTERN = /\b(?:254\d{3}\*{3}\d{3}|0[17]\d{2}\*{3}\d{3})\b/;
const DATE_TIME_PATTERN = /(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s*(?:\n|\s)?(\d{1,2}:\d{2}(?::\d{2})?)/;
const VENDOR_STOP_WORDS = new Set([
    'and',
    'co',
    'company',
    'enterprise',
    'enterprises',
    'limited',
    'ltd',
    'plc',
    'the',
]);
const KNOWN_MPESA_PAYER_ALIASES = [
    {
        customerName: 'OKEVAM FURNITURE',
        payerNames: ['Kevin Okumayia Amalanda'],
    },
];
function normalizeSpaces(value) {
    return value.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function isMpesaReceiptText(value) {
    return /^[A-Z0-9]{10}$/i.test(value) && /[A-Z]/i.test(value);
}
function joinSplitReceiptLines(value) {
    return value.replace(/\b([A-Z0-9]{6,9})\s*\n\s*([A-Z0-9]{1,4})\s*\n\s*(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/g, (match, first, second, date) => {
        const receipt = `${first}${second}`;
        if (!isMpesaReceiptText(receipt)) {
            return match;
        }
        return `${receipt}\n${date}`;
    });
}
function prepareMpesaStatementText(value) {
    return joinSplitReceiptLines(normalizeSpaces(value))
        .replace(/\b([A-Z0-9]{10})(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/g, '$1\n$2')
        .replace(/([A-Za-z])Completed(?=\d)/g, '$1 Completed')
        .replace(/(Completed)(?=\d)/g, '$1 ');
}
function titleCaseName(value) {
    return value
        .toLowerCase()
        .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
        .replace(/\bLtd\b/g, 'LTD')
        .trim();
}
function cleanPartyName(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .replace(/\b(?:completed|customer|merchant|payment|transfer|od|other|party|status)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^-+|-+$/g, '')
        .trim();
}
function normalizeSearch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function mimeTypeForImage(imagePath) {
    const ext = path_1.default.extname(imagePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg')
        return 'image/jpeg';
    return 'image/png';
}
async function readNvidiaSizedImage(imagePath) {
    const original = await (0, promises_1.readFile)(imagePath);
    let imageB64 = original.toString('base64');
    let mediaType = mimeTypeForImage(imagePath);
    if (imageB64.length <= NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT) {
        return { imageB64, mediaType, resized: false };
    }
    const canvasModule = await Promise.resolve().then(() => __importStar(require('@napi-rs/canvas')));
    const source = await canvasModule.loadImage(imagePath);
    const maxWidths = [1400, 1100, 900, 700, 550];
    for (const maxWidth of maxWidths) {
        const scale = Math.min(1, maxWidth / source.width);
        const width = Math.max(1, Math.round(source.width * scale));
        const height = Math.max(1, Math.round(source.height * scale));
        const canvas = canvasModule.createCanvas(width, height);
        const context = canvas.getContext('2d');
        context.drawImage(source, 0, 0, width, height);
        const jpeg = await canvas.encode('jpeg', 78);
        imageB64 = jpeg.toString('base64');
        mediaType = 'image/jpeg';
        if (imageB64.length <= NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT) {
            return { imageB64, mediaType, resized: true };
        }
    }
    return { imageB64, mediaType, resized: true };
}
function collectBoundingBoxCounts(payload) {
    const data = payload && typeof payload === 'object' && Array.isArray(payload.data)
        ? payload.data
        : [];
    const counts = {
        tables: 0,
        rows: 0,
        columns: 0,
        cells: 0,
    };
    for (const item of data) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const boxes = item.bounding_boxes || {};
        counts.tables += Array.isArray(boxes.table) ? boxes.table.length : 0;
        counts.rows += Array.isArray(boxes.row) ? boxes.row.length : 0;
        counts.columns += Array.isArray(boxes.column) ? boxes.column.length : 0;
        counts.cells += Array.isArray(boxes.cell) ? boxes.cell.length : 0;
    }
    return counts;
}
async function runNvidiaTableStructure(input) {
    if (!input.apiKey) {
        input.warnings.push('NVIDIA table structure skipped because NVIDIA API key is not configured.');
        return [];
    }
    const summaries = [];
    for (const image of input.images) {
        try {
            const { imageB64, mediaType, resized } = await readNvidiaSizedImage(image.imagePath);
            if (imageB64.length > NVIDIA_DIRECT_UPLOAD_BASE64_LIMIT) {
                input.warnings.push(`NVIDIA table structure skipped page ${image.pageNumber} because the image exceeds direct upload size after resizing.`);
                continue;
            }
            if (resized) {
                input.warnings.push(`NVIDIA table structure resized page ${image.pageNumber} to fit direct upload size.`);
            }
            const response = await axios_1.default.post(NVIDIA_TABLE_STRUCTURE_ENDPOINT, {
                input: [
                    {
                        type: 'image_url',
                        url: `data:${mediaType};base64,${imageB64}`,
                    },
                ],
            }, {
                headers: {
                    Authorization: `Bearer ${input.apiKey}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                responseType: 'json',
                timeout: 45_000,
            });
            const counts = collectBoundingBoxCounts(response.data);
            summaries.push({ pageNumber: image.pageNumber, ...counts });
        }
        catch (error) {
            const message = axios_1.default.isAxiosError(error)
                ? (typeof error.response?.data === 'string'
                    ? error.response.data
                    : JSON.stringify(error.response?.data || error.message))
                : error instanceof Error
                    ? error.message
                    : String(error);
            input.warnings.push(`NVIDIA table structure failed on page ${image.pageNumber}: ${message}`);
        }
    }
    const totals = summaries.reduce((sum, page) => ({
        tables: sum.tables + page.tables,
        rows: sum.rows + page.rows,
        columns: sum.columns + page.columns,
        cells: sum.cells + page.cells,
    }), { tables: 0, rows: 0, columns: 0, cells: 0 });
    if (summaries.length > 0) {
        input.warnings.push(`NVIDIA table structure detected ${totals.cells} cell(s), ${totals.rows} row(s), ${totals.columns} column(s), and ${totals.tables} table region(s).`);
    }
    return summaries;
}
function parseMoney(value) {
    const cleaned = value.replace(/(?:kes|ksh)/gi, '').replace(/,/g, '').trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}
function collectDecimalMoneyValues(text) {
    const matches = text.match(/\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g) || [];
    return matches
        .map(parseMoney)
        .filter((value) => typeof value === 'number');
}
function collectMoneyValues(text) {
    const matches = text.match(/(?:KES|KSH|KSh)?\s*-?\d[\d,]*(?:\.\d{1,2})?/g) || [];
    return matches
        .map((match) => {
        const normalized = match.trim();
        const digitsOnly = normalized.replace(/\D/g, '');
        if (digitsOnly.length >= 8 && !/[,.]/.test(normalized) && !/kes|ksh/i.test(normalized)) {
            return null;
        }
        return parseMoney(normalized);
    })
        .filter((value) => typeof value === 'number');
}
function normalizeDateMatch(value) {
    if (!value) {
        return null;
    }
    const parts = value.replace(/\//g, '-').split('-').map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
        return null;
    }
    let year = parts[0];
    let month = parts[1];
    let day = parts[2];
    if (String(parts[0]).length !== 4) {
        day = parts[0];
        month = parts[1];
        year = parts[2];
    }
    if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function extractDateAndTime(row) {
    const match = row.match(DATE_TIME_PATTERN) ||
        row.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\b/) ||
        row.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\b/) ||
        row.match(/\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b/) ||
        row.match(/\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/);
    return {
        transactionDate: normalizeDateMatch(match?.[1] || null),
        completionTime: match?.[2] || null,
        matchedText: match?.[0] || '',
    };
}
function classifyTransaction(details, paidIn, withdrawn) {
    const normalized = normalizeSearch(details);
    if (paidIn && paidIn > 0 && (!withdrawn || paidIn >= withdrawn)) {
        return { direction: 'in', transactionType: 'customer_receipt' };
    }
    if (withdrawn && withdrawn > 0) {
        // Bank/internal transfer patterns (check before generic charge/supplier)
        if (/\b(sent|send|deposited|deposit)\s+(to|into|in)\s+(the\s+)?(bank|account|abc|kcb|equity|coop|stanbic|absa|ncba)\b/i.test(normalized)) {
            return { direction: 'out', transactionType: 'internal_transfer' };
        }
        if (/\b(sent|send)\s+to\s+(the\s+)?bank\b/i.test(normalized)) {
            return { direction: 'out', transactionType: 'internal_transfer' };
        }
        if (/\b(charge|charges|fee|fees)\b/.test(normalized)) {
            return { direction: 'out', transactionType: 'mpesa_charge' };
        }
        if (/\b(pay bill|paybill|buy goods|merchant|till|payment to|paid to|business payment)\b/.test(normalized)) {
            return { direction: 'out', transactionType: 'supplier_payment' };
        }
        if (/\b(withdraw|withdrawal|agent)\b/.test(normalized)) {
            return { direction: 'out', transactionType: 'cash_withdrawal' };
        }
        if (/\b(refund|reversal|reverse|sales\s*refund)\b/i.test(normalized)) {
            return { direction: 'out', transactionType: 'refunds' };
        }
        return { direction: 'out', transactionType: 'outgoing_payment' };
    }
    if (/\b(received|funds received|reversal|deposit)\b/.test(normalized)) {
        return { direction: 'in', transactionType: 'customer_receipt' };
    }
    if (/\b(charge|charges|fee|fees)\b/.test(normalized)) {
        return { direction: 'out', transactionType: 'mpesa_charge' };
    }
    if (/\b(pay bill|paybill|buy goods|merchant|till|transfer to|payment to|paid to|sent to)\b/.test(normalized)) {
        return { direction: 'out', transactionType: 'supplier_payment' };
    }
    return { direction: 'unknown', transactionType: 'unknown' };
}
function extractCounterparty(details) {
    const phoneNumber = details.match(PHONE_PATTERN)?.[0] || details.match(MASKED_PHONE_PATTERN)?.[0] || null;
    const patterns = [
        /\bMerchant Payment Online from\s+(?:254\d{3}\*{3}\d{3}|0[17]\d{2}\*{3}\d{3}|254\d{9}|0[17]\d{8})\s*-\s+(.+?)(?:\s+Completed|\s+Customer|\s+Merchant|$)/i,
        /\bMerchant Payment from\s+(?:254\d{3}\*{3}\d{3}|0[17]\d{2}\*{3}\d{3}|254\d{9}|0[17]\d{8})\s*-\s+(.+?)(?:\s+Completed|\s+Customer|\s+Merchant|$)/i,
        /\bMerchant Customer Payment to\s+(?:254\d{3}\*{3}\d{3}|0[17]\d{2}\*{3}\d{3}|254\d{9}|0[17]\d{8})\s*-\s+(.+?)(?:\s+Completed|\s+Merchant|\s+Customer|$)/i,
        /\bMerchant Payments to\s+\d+\s*-\s+(.+?)(?:\s+Completed|\s+OD|\s+Payment|\s+Transfer|$)/i,
        /\bCharge to\s+\d+\s*-\s+(.+?)(?:\s+Completed|\s+OD|\s+Payment|\s+Transfer|$)/i,
        /\b(?:received|funds received)\s+from\s+(.+?)(?:\s+(?:254\d{3}\*{3}\d{3}|0[17]\d{2}\*{3}\d{3}|254\d{9}|0[17]\d{8})|$)/i,
        /\b(?:transfer|sent|payment|paid)\s+to\s+(.+?)(?:\s+(?:254\d{3}\*{3}\d{3}|0[17]\d{2}\*{3}\d{3}|254\d{9}|0[17]\d{8})|$)/i,
        /\b(?:pay\s*bill|paybill|buy goods|merchant payment)\s+(?:to\s+)?(.+?)(?:\s+(?:account|acc|till|paybill)\b|$)/i,
        /\bwithdrawal\s+(?:from|at)\s+(.+?)(?:\s+(?:254\d{3}\*{3}\d{3}|0[17]\d{2}\*{3}\d{3}|254\d{9}|0[17]\d{8})|$)/i,
    ];
    for (const pattern of patterns) {
        const match = details.match(pattern);
        const value = cleanPartyName(match?.[1]);
        if (value) {
            return { counterparty: titleCaseName(value.slice(0, 180)), phoneNumber };
        }
    }
    return { counterparty: null, phoneNumber };
}
function summarizeDetails(input) {
    const details = input.rawDetails;
    if (input.classified.transactionType === 'mpesa_charge') {
        if (/\bpay merchant charge\b/i.test(details)) {
            return 'Pay merchant charge';
        }
        if (/merchant to customer payment charge/i.test(details)) {
            return input.counterparty ? `Customer payment charge - ${input.counterparty}` : 'Customer payment charge';
        }
        if (/merchant to merchant payment charge/i.test(details)) {
            return input.counterparty ? `Merchant payment charge - ${input.counterparty}` : 'Merchant payment charge';
        }
        return 'M-Pesa charge';
    }
    if (input.classified.direction === 'in') {
        return input.counterparty ? `Received from ${input.counterparty}` : 'Received payment';
    }
    if (input.classified.direction === 'out') {
        if (/merchant customer payment/i.test(details)) {
            return input.counterparty ? `Paid customer ${input.counterparty}` : 'Paid customer';
        }
        if (/merchant payments to/i.test(details)) {
            return input.counterparty ? `Paid ${input.counterparty}` : 'Merchant payment';
        }
        return input.counterparty ? `Paid ${input.counterparty}` : 'Outgoing payment';
    }
    return cleanPartyName(details).slice(0, 120) || 'Transaction';
}
function isMorningCompletionTime(value) {
    const hour = Number(String(value || '').match(/^(\d{1,2}):/)?.[1]);
    return Number.isFinite(hour) && hour >= 0 && hour < 12;
}
function isJanetAwinoOchieng(value) {
    const normalized = normalizeSearch(value);
    return normalized.includes('janet awino ochieng') || normalized.includes('janet ochieng');
}
function isGeorgeOkullo(value) {
    const normalized = normalizeSearch(value);
    return normalized.includes('george okullo');
}
function isMaifanMineralWater(value) {
    const normalized = normalizeSearch(value);
    return normalized.includes('maifan mineral water');
}
function isRiderTransport(value) {
    const normalized = normalizeSearch(value);
    return /\brider\b/i.test(normalized) && /\b(bring|bringing|carry|carrying|deliver|delivering|transport|machine|equipment)\b/i.test(normalized);
}
function isSalaryAdvance(value) {
    const normalized = normalizeSearch(value);
    return /\b(salary\s*advance|advance\s*salary)\b/i.test(normalized);
}
function isStaffLunch(value) {
    const normalized = normalizeSearch(value);
    return /\blunch\b/i.test(normalized) && /\b(for|ya)\s+(staff|workers?|employees?|wafanyi)\b/i.test(normalized);
}
function isStaffOvertime(value) {
    const normalized = normalizeSearch(value);
    return /\bovertime\b/i.test(normalized) && /\b(done|worked|on)\b/i.test(normalized);
}
function isRefundOrToken(text) {
    const normalized = normalizeSearch(text);
    return /\b(refund|sales\s*refund|reversal|reversing)\b/i.test(normalized) ||
        (/\b(token|commission)\b/i.test(normalized) && /\b(to|for|ya)\b/i.test(normalized));
}
function isBankDeposit(text) {
    const normalized = normalizeSearch(text);
    return /\b(sent|send|deposited|deposit)\s+(to|into|in)\s+(the\s+)?(bank|account|abc|kcb|equity|coop)\b/i.test(normalized) ||
        /\b(sent|send)\s+to\s+(the\s+)?bank\b/i.test(normalized);
}
function applyMpesaBusinessRules(input) {
    const partyText = `${input.counterparty || ''} ${input.rawDetails} ${input.otherPartyText || ''}`;
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isMorningCompletionTime(input.completionTime) &&
        isJanetAwinoOchieng(partyText)) {
        return {
            details: 'Staff lunch',
            classified: {
                ...input.classified,
                transactionType: 'staff_lunch_expense',
            },
            userCategory: 'staff_lunch_expense',
        };
    }
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isGeorgeOkullo(partyText)) {
        return {
            details: 'Transport by George',
            classified: {
                ...input.classified,
                transactionType: 'transport_expense',
            },
            userCategory: 'transport_expense',
        };
    }
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isMaifanMineralWater(partyText)) {
        return {
            details: 'Paid Maifan Mineral Water LTD',
            classified: {
                ...input.classified,
                transactionType: 'office_water_expense',
            },
            userCategory: 'office_water_expense',
        };
    }
    // ── Rider transport (e.g. "Rider bringing the sharpening machine") ──
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isRiderTransport(partyText)) {
        return {
            details: input.details,
            classified: {
                ...input.classified,
                transactionType: 'transport_expense',
            },
            userCategory: 'transport_expense',
        };
    }
    // ── Salary advance ──
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isSalaryAdvance(partyText)) {
        return {
            details: input.details,
            classified: {
                ...input.classified,
                transactionType: 'advance_salary',
            },
            userCategory: 'advance_salary',
        };
    }
    // ── Staff lunch ──
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isStaffLunch(partyText)) {
        return {
            details: input.details,
            classified: {
                ...input.classified,
                transactionType: 'staff_lunch_expense',
            },
            userCategory: 'staff_lunch_expense',
        };
    }
    // ── Staff overtime ──
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isStaffOvertime(partyText)) {
        return {
            details: input.details,
            classified: {
                ...input.classified,
                transactionType: 'staff_overtime_expense',
            },
            userCategory: 'staff_overtime_expense',
        };
    }
    // ── Refunds / Commission tokens ──
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isRefundOrToken(partyText)) {
        return {
            details: input.details,
            classified: {
                ...input.classified,
                transactionType: 'refunds',
            },
            userCategory: 'refunds',
        };
    }
    // ── Bank deposit / Sent to bank ──
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0 &&
        isBankDeposit(partyText)) {
        return {
            details: input.details,
            classified: {
                ...input.classified,
                transactionType: 'internal_transfer',
            },
            userCategory: 'internal_transfer',
        };
    }
    // AI-powered keyword transport detection for transactions that don't match named-person rules
    if (input.classified.direction === 'out' &&
        input.classified.transactionType !== 'mpesa_charge' &&
        input.withdrawn &&
        input.withdrawn > 0) {
        const transportAnalysis = (0, aiCategoryService_1.analyzeTransportKeywords)({
            details: input.details,
            counterparty: input.counterparty,
            rawDetails: input.rawDetails,
            direction: 'out',
        });
        // Strong transport signal: weight >= 6 and confidence >= 0.35
        if (transportAnalysis.isTransport && transportAnalysis.totalWeight >= 6) {
            const category = transportAnalysis.subType === 'staff_transport'
                ? 'staff_transport_expense'
                : 'transport_expense';
            const label = transportAnalysis.matchedRules
                .slice(0, 3)
                .map((r) => r.label)
                .join('; ');
            return {
                details: input.details,
                classified: {
                    ...input.classified,
                    transactionType: category,
                },
                userCategory: category,
                aiTransportNote: `Transport keyword match: ${label}`,
            };
        }
    }
    return {
        details: input.details,
        classified: input.classified,
        userCategory: input.classified.transactionType === 'unknown' ? null : input.classified.transactionType,
    };
}
function initialReviewStatusForTransaction(input) {
    return input.transactionType === 'mpesa_charge' ||
        input.transactionType === 'customer_receipt' ||
        input.direction === 'in' ||
        Number(input.paidIn || 0) > 0
        ? 'verified'
        : 'new';
}
function cleanupDetails(row, receiptNumber, dateText) {
    let details = row;
    if (receiptNumber) {
        details = details.replace(receiptNumber, ' ');
    }
    if (dateText) {
        details = details.replace(dateText, ' ');
    }
    details = details
        .replace(/\b(?:completion time|receipt no\.?|details|paid in|withdrawn|balance|transaction status|completed)\b/gi, ' ')
        .replace(/(?:KES|KSH|KSh)?\s*-?\d[\d,]*(?:\.\d{1,2})?/g, ' ')
        .replace(/\b(?:customer\s+merchant\s+payment|merchant\s+customer\s+payment|od\s+payment\s+transfer)\b/gi, ' ')
        .replace(/\b\d{6,8}-\s*[A-Z\s]+$/i, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
    // Detect and trim overlapping/merged transaction text from the next row
    details = trimTrailingTransactionOverlap(details);
    return details || row.slice(0, 240);
}
/**
 * When OCR merges two adjacent M-Pesa transactions into one text block,
 * this function detects the boundary and discards the trailing overlap.
 *
 * Looks for patterns that strongly indicate a NEW transaction starting:
 * - M-Pesa transaction type keywords appearing mid-text
 * - Another receipt number appearing mid-text
 * - A date+time pattern that looks like a new transaction timestamp
 */
function trimTrailingTransactionOverlap(details) {
    if (!details)
        return details;
    // Only cut on UNQUESTIONABLE overlap signals — patterns that cannot appear
    // inside a single valid transaction's detail text:
    const overlapPatterns = [
        // Another receipt number mid-text (e.g. "UEPTQBVEI4" appearing later)
        // This is the strongest and least ambiguous signal of merged transactions
        {
            pattern: new RegExp(`\\b(${MPESA_RECEIPT_PATTERN.source})\\b`, 'i'),
            label: 'receipt_number',
        },
        // "Business Buy Goods" — M-Pesa till receipt start keyword
        {
            pattern: /\bBusiness\s+Buy\s+Goods\b/i,
            label: 'till_receipt',
        },
        // "Organization Transfer" — bank/internal transfer start keyword
        {
            pattern: /\bOrganization\s+Transfer\b/i,
            label: 'org_transfer',
        },
    ];
    let bestCutIndex = details.length;
    for (const { pattern, label } of overlapPatterns) {
        const match = pattern.exec(details);
        if (!match || match.index < 5)
            continue;
        // For receipt numbers: only cut if the receipt appears well into the text (at least after 30 chars)
        if (label === 'receipt_number' && match.index < 30)
            continue;
        if (match.index < bestCutIndex) {
            bestCutIndex = match.index;
        }
    }
    // Also check for cases where we found more than 3 money values
    // (which strongly suggests two transactions got merged)
    const moneyMatches = details.match(/\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g) || [];
    if (moneyMatches.length > 3 && bestCutIndex === details.length) {
        // Try to find a natural boundary between the 3rd and 4th money value
        const thirdMatch = moneyMatches[2];
        const fourthMatch = moneyMatches[3];
        if (thirdMatch && fourthMatch) {
            const thirdIdx = details.lastIndexOf(thirdMatch) + thirdMatch.length;
            const fourthIdx = details.indexOf(fourthMatch, thirdIdx);
            if (fourthIdx > thirdIdx && fourthIdx < bestCutIndex) {
                bestCutIndex = fourthIdx;
            }
        }
    }
    if (bestCutIndex < details.length) {
        return details.slice(0, bestCutIndex).trim();
    }
    return details;
}
function parseTransactionRow(row, rowIndex) {
    const receiptDateMatch = row.match(new RegExp(`^\\s*(${MPESA_RECEIPT_PATTERN.source})\\s*(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})`, 'i'));
    const receiptNumber = (receiptDateMatch?.[1] || row.match(MPESA_RECEIPT_PATTERN)?.[0] || null)?.toUpperCase() || null;
    const normalizedRow = receiptDateMatch
        ? row.replace(receiptDateMatch[0], `${receiptDateMatch[1]} ${receiptDateMatch[2]}`)
        : row;
    const date = extractDateAndTime(normalizedRow);
    const textWithoutDateAndReceipt = normalizedRow
        .replace(date.matchedText, ' ')
        .replace(receiptNumber || '', ' ');
    const moneyValues = collectMoneyValues(textWithoutDateAndReceipt);
    if (!receiptNumber && !date.transactionDate && moneyValues.length < 2) {
        return null;
    }
    if (moneyValues.length === 0) {
        return null;
    }
    let paidIn = null;
    let withdrawn = null;
    let balance = null;
    if (moneyValues.length >= 3) {
        paidIn = moneyValues[moneyValues.length - 3] || null;
        withdrawn = moneyValues[moneyValues.length - 2] || null;
        balance = moneyValues[moneyValues.length - 1] || null;
    }
    else if (moneyValues.length === 2) {
        balance = moneyValues[1];
    }
    const rawDetails = cleanupDetails(normalizedRow, receiptNumber, date.matchedText);
    const preliminary = classifyTransaction(rawDetails, paidIn, withdrawn);
    if (moneyValues.length === 2) {
        if (preliminary.direction === 'in') {
            paidIn = moneyValues[0];
        }
        else {
            withdrawn = moneyValues[0];
        }
    }
    const classified = classifyTransaction(rawDetails, paidIn, withdrawn);
    const amount = classified.direction === 'in'
        ? paidIn
        : classified.direction === 'out'
            ? withdrawn
            : paidIn || withdrawn || moneyValues[0] || null;
    const counterparty = extractCounterparty(rawDetails);
    const details = summarizeDetails({
        rawDetails,
        classified,
        counterparty: counterparty.counterparty,
        paidIn,
        withdrawn,
    });
    const businessRule = applyMpesaBusinessRules({
        completionTime: date.completionTime,
        rawDetails,
        details,
        classified,
        counterparty: counterparty.counterparty,
        withdrawn,
    });
    return {
        rowIndex,
        transactionDate: date.transactionDate,
        completionTime: date.completionTime,
        receiptNumber,
        details: businessRule.details,
        paidIn,
        withdrawn,
        balance,
        amount,
        direction: businessRule.classified.direction,
        counterparty: counterparty.counterparty,
        phoneNumber: counterparty.phoneNumber,
        transactionType: businessRule.classified.transactionType,
        matchedPoId: null,
        matchedPoName: null,
        matchConfidence: null,
        userCategory: businessRule.userCategory,
        userSupplier: counterparty.counterparty,
        reviewStatus: initialReviewStatusForTransaction({
            transactionType: businessRule.classified.transactionType,
            direction: businessRule.classified.direction,
            paidIn,
        }),
        notes: null,
        aiNotes: null,
        candidates: [],
        raw: { row: normalizedRow, rawDetails },
    };
}
function isReceiptLine(value) {
    return isMpesaReceiptText(value);
}
function parseStructuredTransactionBlock(block, startRowIndex) {
    const receiptNumber = block[0]?.toUpperCase() || null;
    const transactionDate = normalizeDateMatch(block[1] || null);
    const completionTime = block[2] || null;
    if (!receiptNumber || !transactionDate || !completionTime) {
        return [];
    }
    const rest = block.slice(3);
    // Find ALL "Completed" lines — each one is a separate row (e.g. charge + payment
    // sharing the same receipt number)
    const completedIndices = [];
    for (let i = 0; i < rest.length; i += 1) {
        if (/\bCompleted\b/i.test(rest[i])) {
            completedIndices.push(i);
        }
    }
    if (completedIndices.length === 0) {
        return [];
    }
    const results = [];
    for (let ci = 0; ci < completedIndices.length; ci += 1) {
        const completedIndex = completedIndices[ci];
        const completedLine = rest[completedIndex];
        const [detailTail = '', afterCompleted = ''] = completedLine.split(/Completed/i);
        // Details: everything from the start of rest (or from the previous Completed+1)
        // up to this Completed line
        const detailStart = ci === 0 ? 0 : completedIndices[ci - 1] + 1;
        const detailLines = rest.slice(detailStart, completedIndex);
        if (detailTail.trim()) {
            detailLines.push(detailTail.trim());
        }
        // Amounts: the 3 numbers after "Completed"
        const amountValues = collectDecimalMoneyValues([afterCompleted, ...rest.slice(completedIndex + 1, completedIndex + 3)].join(' '));
        if (amountValues.length < 3) {
            continue;
        }
        const paidIn = amountValues[0] || null;
        const withdrawn = amountValues[1] || null;
        const balance = amountValues[2] || null;
        // Other party text: lines after this Completed until the next Completed (or end of block)
        const nextCompleted = completedIndices[ci + 1];
        const afterLines = nextCompleted !== undefined ? rest.slice(completedIndex + 1, nextCompleted) : rest.slice(completedIndex + 1);
        const otherPartyText = afterLines.join(' ');
        const rawDetails = trimTrailingTransactionOverlap(normalizeSpaces(detailLines.join(' ')));
        const partySource = `${rawDetails} ${otherPartyText}`;
        const classified = classifyTransaction(rawDetails, paidIn, withdrawn);
        const counterparty = extractCounterparty(partySource);
        const details = summarizeDetails({
            rawDetails,
            classified,
            counterparty: counterparty.counterparty,
            paidIn,
            withdrawn,
        });
        const businessRule = applyMpesaBusinessRules({
            completionTime,
            rawDetails,
            details,
            classified,
            counterparty: counterparty.counterparty,
            otherPartyText,
            withdrawn,
        });
        const amount = classified.direction === 'in'
            ? paidIn
            : classified.direction === 'out'
                ? withdrawn
                : paidIn || withdrawn || null;
        const rowIndex = startRowIndex + ci;
        results.push({
            rowIndex,
            transactionDate,
            completionTime,
            receiptNumber,
            details: businessRule.details,
            paidIn,
            withdrawn,
            balance,
            amount,
            direction: businessRule.classified.direction,
            counterparty: counterparty.counterparty,
            phoneNumber: counterparty.phoneNumber,
            transactionType: businessRule.classified.transactionType,
            matchedPoId: null,
            matchedPoName: null,
            matchConfidence: null,
            userCategory: businessRule.userCategory,
            userSupplier: counterparty.counterparty,
            reviewStatus: initialReviewStatusForTransaction({
                transactionType: businessRule.classified.transactionType,
                direction: businessRule.classified.direction,
                paidIn,
            }),
            notes: null,
            aiNotes: null,
            candidates: [],
            raw: { row: block.join('\n'), rawDetails, otherPartyText },
        });
    }
    return results;
}
function parseStructuredTransactionsFromText(text) {
    const lines = prepareMpesaStatementText(text)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const transactions = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!isReceiptLine(lines[index]) || !normalizeDateMatch(lines[index + 1] || null)) {
            continue;
        }
        let endIndex = index + 3;
        while (endIndex < lines.length &&
            !(isReceiptLine(lines[endIndex]) && normalizeDateMatch(lines[endIndex + 1] || null)) &&
            !/^M-PESA FULL STATEMENT$/i.test(lines[endIndex])) {
            // Break on unambiguous transaction-start keywords on their own line.
            // These are safe here (unlike trimTrailingTransactionOverlap) because
            // we're operating on line boundaries, not within a single detail blob.
            // NOTE: "Merchant Payment Online" is NOT a boundary — it appears as a
            // description line WITHIN transactions (e.g. "Merchant Payment Online from 254...")
            if (/\b(Business\s+Buy\s+Goods|Organization\s+Transfer|Customer\s+Merchant\s+Payment|Pay\s*Bill|Withdraw(al)?\s+(From|At|Cash)|(Send|Sent)\s+to|Funds\s+Received)\b/i.test(lines[endIndex])) {
                break;
            }
            endIndex += 1;
        }
        const blockTransactions = parseStructuredTransactionBlock(lines.slice(index, endIndex), transactions.length + 1);
        if (blockTransactions.length > 0) {
            for (const trx of blockTransactions) {
                transactions.push(trx);
            }
        }
        index = Math.max(index, endIndex - 1);
    }
    return transactions;
}
function collectPotentialRows(text) {
    const rows = [];
    let current = '';
    for (const line of normalizeSpaces(text).split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || /^(receipt|completion|details|paid in|withdrawn|balance|transaction statement)/i.test(trimmed)) {
            continue;
        }
        const startsTransaction = new RegExp(`^${MPESA_RECEIPT_PATTERN.source}\\s*\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}`, 'i').test(trimmed) ||
            /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/.test(trimmed) ||
            /\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\s+\d{1,2}:\d{2}/.test(trimmed);
        if (startsTransaction && current) {
            rows.push(current.trim());
            current = trimmed;
            continue;
        }
        current = current ? `${current} ${trimmed}` : trimmed;
        if (current.length > 1200) {
            rows.push(current.trim());
            current = '';
        }
    }
    if (current) {
        rows.push(current.trim());
    }
    return rows;
}
function parseTransactionsFromText(text) {
    const structured = parseStructuredTransactionsFromText(text);
    if (structured.length > 0) {
        return structured;
    }
    return collectPotentialRows(prepareMpesaStatementText(text))
        .map((row, index) => parseTransactionRow(row, index + 1))
        .filter((transaction) => Boolean(transaction));
}
function vendorTokens(value) {
    return normalizeSearch(expandKnownMpesaPartyAliases(value))
        .split(' ')
        .filter((token) => token.length >= 3 && !VENDOR_STOP_WORDS.has(token));
}
function hasAllSearchTokens(value, phrase) {
    const valueTokens = new Set(normalizeSearch(value)
        .split(' ')
        .filter(Boolean));
    return normalizeSearch(phrase)
        .split(' ')
        .filter(Boolean)
        .every((token) => valueTokens.has(token));
}
function expandKnownMpesaPartyAliases(value) {
    const raw = String(value || '');
    const additions = [];
    for (const alias of KNOWN_MPESA_PAYER_ALIASES) {
        if (hasAllSearchTokens(raw, alias.customerName)) {
            additions.push(...alias.payerNames);
        }
        if (alias.payerNames.some((payerName) => hasAllSearchTokens(raw, payerName))) {
            additions.push(alias.customerName);
        }
    }
    return [raw, ...additions].join(' ');
}
function findKnownMpesaPayerAlias(transactionText, customerText) {
    return KNOWN_MPESA_PAYER_ALIASES.find((alias) => hasAllSearchTokens(customerText, alias.customerName) &&
        alias.payerNames.some((payerName) => hasAllSearchTokens(transactionText, payerName)));
}
function findKnownMpesaPayerAliasForTransaction(transactionText) {
    return KNOWN_MPESA_PAYER_ALIASES.find((alias) => alias.payerNames.some((payerName) => hasAllSearchTokens(transactionText, payerName)));
}
function mergeInvoicesById(invoices) {
    return [...new Map(invoices.map((invoice) => [invoice.id, invoice])).values()];
}
function buildPaymentsByInvoiceId(payments) {
    const paymentsByInvoiceId = new Map();
    for (const payment of payments) {
        for (const invoiceId of getPaymentInvoiceIds(payment)) {
            paymentsByInvoiceId.set(invoiceId, [...(paymentsByInvoiceId.get(invoiceId) || []), payment]);
        }
    }
    return paymentsByInvoiceId;
}
async function readCustomerInvoicesByIds(client, invoiceIds, warnings) {
    const uniqueIds = [...new Set(invoiceIds)].filter((id) => Number.isFinite(id));
    if (!uniqueIds.length) {
        return [];
    }
    try {
        return await client.readRecords('account.move', uniqueIds, [
            'id',
            'name',
            'ref',
            'company_id',
            'partner_id',
            'invoice_date',
            'date',
            'amount_total',
            'amount_residual',
            'currency_id',
            'state',
            'move_type',
            'payment_state',
        ]);
    }
    catch (error) {
        warnings.push(`Linked payment invoice lookup skipped: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}
function scorePurchaseOrderCandidate(transaction, purchaseOrder) {
    const reasons = [];
    let score = 0;
    if (transaction.amount && purchaseOrder.amount_total) {
        const delta = Math.abs(transaction.amount - purchaseOrder.amount_total);
        const percent = delta / Math.max(purchaseOrder.amount_total, 1);
        if (delta <= 1) {
            score += 55;
            reasons.push('Amount matches exactly.');
        }
        else if (percent <= 0.02) {
            score += 45;
            reasons.push(`Amount is within 2% of PO total ${purchaseOrder.amount_total}.`);
        }
        else if (percent <= 0.05) {
            score += 30;
            reasons.push(`Amount is within 5% of PO total ${purchaseOrder.amount_total}.`);
        }
        else if (percent <= 0.1) {
            score += 15;
            reasons.push(`Amount is within 10% of PO total ${purchaseOrder.amount_total}.`);
        }
    }
    const vendorName = Array.isArray(purchaseOrder.partner_id) ? purchaseOrder.partner_id[1] : null;
    const transactionTokens = new Set(vendorTokens(`${transaction.counterparty || ''} ${transaction.details}`));
    const poTokens = vendorTokens(vendorName);
    const overlap = poTokens.filter((token) => transactionTokens.has(token));
    if (overlap.length > 0) {
        const vendorScore = Math.min(25, 10 + overlap.length * 8);
        score += vendorScore;
        reasons.push(`Vendor text overlaps on ${overlap.slice(0, 4).join(', ')}.`);
    }
    if (transaction.transactionDate && purchaseOrder.date_order) {
        const transactionMs = Date.parse(transaction.transactionDate);
        const poMs = Date.parse(purchaseOrder.date_order);
        if (Number.isFinite(transactionMs) && Number.isFinite(poMs)) {
            const days = Math.round(Math.abs(transactionMs - poMs) / (24 * 60 * 60 * 1000));
            if (days <= 7) {
                score += 15;
                reasons.push(`PO date is within ${days} day(s).`);
            }
            else if (days <= 30) {
                score += 10;
                reasons.push(`PO date is within ${days} day(s).`);
            }
            else if (days <= 60) {
                score += 5;
                reasons.push(`PO date is within ${days} day(s).`);
            }
        }
    }
    if (purchaseOrder.invoice_status !== 'invoiced' && ['purchase', 'to approve'].includes(String(purchaseOrder.state || ''))) {
        score += 5;
        reasons.push('PO is bill-ready or close to approval.');
    }
    return {
        id: purchaseOrder.id,
        name: purchaseOrder.name,
        vendorName,
        dateOrder: purchaseOrder.date_order || null,
        amountTotal: purchaseOrder.amount_total || null,
        score: Math.min(100, score),
        reasons,
    };
}
function scoreInvoiceAmount(transaction, invoice, reasons) {
    const invoiceAmounts = [
        { value: invoice.amount_residual, label: 'open invoice balance' },
        { value: invoice.amount_total, label: 'invoice total' },
    ].filter((entry) => typeof entry.value === 'number' && entry.value > 0);
    let bestScore = 0;
    let bestReason = '';
    for (const invoiceAmount of invoiceAmounts) {
        const delta = Math.abs((transaction.amount || 0) - invoiceAmount.value);
        const percent = delta / Math.max(invoiceAmount.value, 1);
        if (delta <= 1 && bestScore < 55) {
            bestScore = 55;
            bestReason = `Amount matches ${invoiceAmount.label}.`;
        }
        else if (percent <= 0.02 && bestScore < 45) {
            bestScore = 45;
            bestReason = `Amount is within 2% of ${invoiceAmount.label} ${invoiceAmount.value}.`;
        }
        else if (percent <= 0.05 && bestScore < 30) {
            bestScore = 30;
            bestReason = `Amount is within 5% of ${invoiceAmount.label} ${invoiceAmount.value}.`;
        }
        else if (percent <= 0.1 && bestScore < 15) {
            bestScore = 15;
            bestReason = `Amount is within 10% of ${invoiceAmount.label} ${invoiceAmount.value}.`;
        }
    }
    if (bestReason) {
        reasons.push(bestReason);
    }
    return bestScore;
}
function getPaymentInvoiceIds(payment) {
    return Array.isArray(payment.reconciled_invoice_ids)
        ? payment.reconciled_invoice_ids.map(Number).filter((id) => Number.isFinite(id))
        : [];
}
function scoreLinkedPaymentAmount(transaction, payment, reasons) {
    if (!transaction.amount || !payment.amount) {
        return 0;
    }
    const delta = Math.abs(transaction.amount - payment.amount);
    const percent = delta / Math.max(payment.amount, 1);
    const coveredInvoiceCount = getPaymentInvoiceIds(payment).length;
    const invoiceText = coveredInvoiceCount > 1 ? `${coveredInvoiceCount} invoices` : 'this invoice';
    const paymentName = payment.name || payment.ref || String(payment.id);
    if (delta <= 1) {
        reasons.push(`Batched payment ${paymentName} matches the M-Pesa paid-in amount and covers ${invoiceText}.`);
        return 60;
    }
    if (percent <= 0.02) {
        reasons.push(`Batched payment ${paymentName} is within 2% of the M-Pesa paid-in amount and covers ${invoiceText}.`);
        return 45;
    }
    if (percent <= 0.05) {
        reasons.push(`Batched payment ${paymentName} is within 5% of the M-Pesa paid-in amount and covers ${invoiceText}.`);
        return 30;
    }
    if (percent <= 0.1) {
        reasons.push(`Batched payment ${paymentName} is within 10% of the M-Pesa paid-in amount and covers ${invoiceText}.`);
        return 15;
    }
    return 0;
}
function scoreCustomerInvoiceCandidate(transaction, invoice, linkedPayments = []) {
    const reasons = [];
    let score = transaction.amount ? scoreInvoiceAmount(transaction, invoice, reasons) : 0;
    const invoiceDate = invoice.invoice_date || null;
    const customerName = Array.isArray(invoice.partner_id) ? invoice.partner_id[1] : null;
    const paymentText = linkedPayments
        .map((payment) => {
        const paymentPartner = Array.isArray(payment.partner_id) ? payment.partner_id[1] : '';
        return `${payment.name || ''} ${payment.ref || ''} ${paymentPartner}`;
    })
        .join(' ');
    const transactionText = `${transaction.counterparty || ''} ${transaction.details}`;
    const invoiceText = `${customerName || ''} ${invoice.ref || ''} ${invoice.name} ${paymentText}`;
    const knownAlias = findKnownMpesaPayerAlias(transactionText, invoiceText);
    if (knownAlias) {
        score += 25;
        reasons.push(`Known payer alias: ${knownAlias.payerNames.join(', ')} pays for ${knownAlias.customerName}.`);
    }
    // Check linked payments' Paid By field against the M-Pesa Other Party (counterparty)
    const counterparty = transaction.counterparty || null;
    if (counterparty) {
        const counterpartyTokens = vendorTokens(counterparty);
        for (const payment of linkedPayments) {
            if (payment.paid_by) {
                const paidByTokens = vendorTokens(payment.paid_by);
                const paidByOverlap = paidByTokens.filter((token) => counterpartyTokens.includes(token));
                if (paidByOverlap.length > 0) {
                    const paidByScore = Math.min(25, 10 + paidByOverlap.length * 8);
                    score += paidByScore;
                    reasons.push(`Other Party "${counterparty}" matches Paid By "${payment.paid_by}" on payment ${payment.name || payment.id}.`);
                    break; // Only score once for the first matching payment
                }
            }
        }
    }
    const bestLinkedPaymentScore = linkedPayments.reduce((bestScore, payment) => Math.max(bestScore, scoreLinkedPaymentAmount(transaction, payment, reasons)), 0);
    score += bestLinkedPaymentScore;
    const transactionTokens = new Set(vendorTokens(transactionText));
    const invoiceTokens = vendorTokens(invoiceText);
    const overlap = invoiceTokens.filter((token) => transactionTokens.has(token));
    if (overlap.length > 0) {
        const customerScore = Math.min(25, 10 + overlap.length * 8);
        score += customerScore;
        reasons.push(`Customer text overlaps on ${overlap.slice(0, 4).join(', ')}.`);
    }
    const rawText = normalizeSearch(`${transaction.details} ${transaction.counterparty || ''}`);
    if (invoice.name && rawText.includes(normalizeSearch(invoice.name))) {
        score += 15;
        reasons.push('Invoice number appears in the transaction text.');
    }
    else if (invoice.ref && rawText.includes(normalizeSearch(invoice.ref))) {
        score += 15;
        reasons.push('Invoice reference appears in the transaction text.');
    }
    if (invoiceDate) {
        score += 10;
        reasons.push(`Invoice date used: ${invoiceDate}.`);
    }
    if (invoice.payment_state && !['paid', 'reversed'].includes(String(invoice.payment_state))) {
        score += 5;
        reasons.push(`Invoice payment state is ${invoice.payment_state}.`);
    }
    return {
        id: invoice.id,
        name: `Invoice ${invoice.name}`,
        vendorName: customerName,
        dateOrder: invoiceDate,
        amountTotal: invoice.amount_residual || invoice.amount_total || null,
        score: Math.min(100, score),
        reasons,
    };
}
async function addOdooReconciliationCandidates(transactions, client, warnings) {
    if (!client) {
        return transactions;
    }
    let purchaseOrders = [];
    let customerInvoices = [];
    let customerPayments = [];
    const hasPurchasePaymentRows = transactions.some((transaction) => transaction.direction === 'out' &&
        Boolean(transaction.amount) &&
        transaction.transactionType !== 'mpesa_charge' &&
        transaction.transactionType !== 'staff_lunch_expense' &&
        transaction.transactionType !== 'transport_expense' &&
        transaction.transactionType !== 'office_water_expense');
    const hasSalesReceiptRows = transactions.some((transaction) => transaction.direction === 'in' && Boolean(transaction.amount) && transaction.transactionType !== 'mpesa_charge');
    if (hasPurchasePaymentRows) {
        try {
            purchaseOrders = await client.searchPurchaseOrders({
                fromDate: '2026-01-01 00:00:00',
                limit: 300,
            });
        }
        catch (error) {
            warnings.push(`PO candidate matching skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (hasSalesReceiptRows) {
        try {
            customerInvoices = await client.searchCustomerInvoicesSince('2026-01-01', 500);
        }
        catch (error) {
            warnings.push(`Customer invoice matching skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
            customerPayments = await client.searchInboundCustomerPaymentsSince('2026-01-01', 500);
            const linkedInvoiceIds = customerPayments.flatMap(getPaymentInvoiceIds);
            const linkedInvoices = await readCustomerInvoicesByIds(client, linkedInvoiceIds, warnings);
            customerInvoices = mergeInvoicesById([...customerInvoices, ...linkedInvoices]);
        }
        catch (error) {
            warnings.push(`Customer payment matching skipped: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const paymentsByInvoiceId = buildPaymentsByInvoiceId(customerPayments);
    return transactions.map((transaction) => {
        if (transaction.direction === 'in' && transaction.amount && transaction.transactionType !== 'mpesa_charge') {
            const transactionText = `${transaction.counterparty || ''} ${transaction.details}`;
            const restrictiveAlias = findKnownMpesaPayerAliasForTransaction(transactionText);
            const eligibleInvoices = restrictiveAlias
                ? customerInvoices.filter((invoice) => {
                    const customerName = Array.isArray(invoice.partner_id) ? invoice.partner_id[1] : '';
                    return hasAllSearchTokens(customerName, restrictiveAlias.customerName);
                })
                : customerInvoices;
            const candidates = [
                ...eligibleInvoices.map((invoice) => scoreCustomerInvoiceCandidate(transaction, invoice, paymentsByInvoiceId.get(invoice.id) || [])),
            ]
                .filter((candidate) => candidate.score >= 25)
                .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
                .slice(0, 5);
            const best = candidates[0] || null;
            return {
                ...transaction,
                candidates,
                matchedPoId: best && best.score >= 70 ? best.id : null,
                matchedPoName: best && best.score >= 70 ? best.name : null,
                matchConfidence: best ? best.score : null,
                reviewStatus: best && best.score >= 70 ? 'verified' : transaction.reviewStatus,
            };
        }
        if (transaction.direction !== 'out' ||
            !transaction.amount ||
            transaction.transactionType === 'mpesa_charge' ||
            transaction.transactionType === 'staff_lunch_expense' ||
            transaction.transactionType === 'transport_expense' ||
            transaction.transactionType === 'office_water_expense') {
            return transaction;
        }
        // ── Auto-match by PO reference in transaction text ──
        // If the notes/rawDetails mention a PO number, find and match it directly
        const searchText = [
            transaction.details,
            transaction.counterparty || '',
            transaction.notes || '',
            typeof transaction.raw?.rawDetails === 'string' ? transaction.raw.rawDetails : '',
            typeof transaction.raw?.otherPartyText === 'string' ? transaction.raw.otherPartyText : '',
        ].join(' ');
        const poRefMatch = searchText.match(/\b(?:PO[:\s#-]*)?(\d{2,7})\b/i);
        if (poRefMatch) {
            const poIdStr = poRefMatch[1];
            const poIdNum = parseInt(poIdStr, 10);
            // Try matching by exact PO name containing the number (both string and numeric)
            const exactPo = purchaseOrders.find((po) => {
                const poDigits = po.name.replace(/\D/g, '');
                return poDigits === poIdStr ||
                    parseInt(poDigits, 10) === poIdNum ||
                    po.name.toLowerCase().includes(`p${poIdStr.toLowerCase()}`) ||
                    po.name.toLowerCase().includes(`po${poIdStr.toLowerCase()}`);
            });
            if (exactPo) {
                const vendorName = Array.isArray(exactPo.partner_id) ? exactPo.partner_id[1] : null;
                return {
                    ...transaction,
                    candidates: [{
                            id: exactPo.id,
                            name: exactPo.name,
                            vendorName,
                            dateOrder: exactPo.date_order || null,
                            amountTotal: exactPo.amount_total || null,
                            score: 100,
                            reasons: [`PO referenced in transaction text: "${poRefMatch[0].trim()}".`],
                        }],
                    matchedPoId: exactPo.id,
                    matchedPoName: exactPo.name,
                    matchConfidence: 100,
                };
            }
        }
        const candidates = purchaseOrders
            .map((purchaseOrder) => scorePurchaseOrderCandidate(transaction, purchaseOrder))
            .filter((candidate) => candidate.score >= 25)
            .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
            .slice(0, 5);
        const best = candidates[0] || null;
        return {
            ...transaction,
            candidates,
            matchedPoId: best && best.score >= 70 ? best.id : null,
            matchedPoName: best && best.score >= 70 ? best.name : null,
            matchConfidence: best ? best.score : null,
        };
    });
}
async function extractMpesaStatement(input) {
    const warnings = [];
    const tempFilesToClean = new Set();
    try {
        const pdfText = await (0, extractPdfText_1.extractPdfText)(input.filePath);
        warnings.push(...pdfText.warnings);
        let ocrText = '';
        const extension = path_1.default.extname(input.filePath).toLowerCase();
        let renderedPageImages = null;
        let pageCount = 0;
        const getRenderedPageImages = async () => {
            if (renderedPageImages) {
                return renderedPageImages;
            }
            const rendered = await (0, renderPdfToImages_1.renderPdfToImages)(input.filePath);
            warnings.push(...rendered.warnings);
            rendered.images.forEach((img) => tempFilesToClean.add(img.imagePath));
            const fullPageImages = rendered.images.filter((image) => FULL_PAGE_IMAGE_PATTERN.test(image.imagePath));
            renderedPageImages = fullPageImages.length > 0 ? fullPageImages : rendered.images;
            pageCount = fullPageImages.length > 0 ? fullPageImages.length : rendered.images.length;
            return renderedPageImages;
        };
        const nvidiaTableApiKey = input.aiConfig?.apiKeys?.nvidia ||
            input.aiConfig?.ocr?.apiKey ||
            process.env.NVIDIA_API_KEY ||
            '';
        const shouldRunNvidiaTableStructure = Boolean(nvidiaTableApiKey) ||
            input.aiConfig?.provider === 'nvidia' ||
            input.aiConfig?.ocr?.provider === 'nvidia_nemoretriever';
        if (shouldRunNvidiaTableStructure) {
            const tableImages = await getRenderedPageImages();
            await runNvidiaTableStructure({
                images: tableImages,
                apiKey: nvidiaTableApiKey,
                warnings,
            });
        }
        const shouldOcr = input.aiConfig?.ocr?.enabled || pdfText.text.length < 500 || extension !== '.pdf';
        if (shouldOcr) {
            const imageInputs = await getRenderedPageImages();
            const preprocessed = await Promise.all(imageInputs.map(async (image) => {
                const processed = await (0, imagePreprocess_1.preprocessImage)(image.imagePath);
                warnings.push(...processed.warnings);
                tempFilesToClean.add(processed.imagePath);
                return { pageNumber: image.pageNumber, imagePath: processed.imagePath };
            }));
            const preferredOcr = input.preferredOcr || input.aiConfig?.ocr?.provider || 'auto';
            const ocr = await (0, ocrEngine_1.runOcr)(preprocessed, preferredOcr, input.aiConfig?.ocr, input.aiConfig?.apiKeys?.gemini || process.env.GEMINI_API_KEY, input.aiConfig?.geminiOAuth?.connected);
            warnings.push(...ocr.warnings);
            ocrText = ocr.pages.map((page) => page.text).join('\n\n');
        }
        const combinedText = normalizeSpaces([pdfText.text, ocrText].filter(Boolean).join('\n\n'));
        let transactions = parseTransactionsFromText(combinedText);
        if (transactions.length === 0) {
            warnings.push('No M-Pesa transaction rows were detected. The PDF may need table extraction or a cleaner statement export.');
        }
        transactions = await addOdooReconciliationCandidates(transactions, input.odooClient || null, warnings);
        return {
            transactions,
            warnings: [...new Set(warnings)],
            rawTextPreview: combinedText.slice(0, 6000),
            pageCount,
        };
    }
    finally {
        for (const filePath of tempFilesToClean) {
            if (filePath !== input.filePath) {
                await (0, promises_1.unlink)(filePath).catch(() => undefined);
            }
        }
    }
}
