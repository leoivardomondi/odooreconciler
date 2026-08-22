"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUseAiInvoiceExtraction = shouldUseAiInvoiceExtraction;
exports.shouldUseConfiguredAiInvoiceExtraction = shouldUseConfiguredAiInvoiceExtraction;
exports.extractInvoiceWithAi = extractInvoiceWithAi;
exports.mergeAiInvoiceExtraction = mergeAiInvoiceExtraction;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const geminiOAuthService_1 = require("../services/geminiOAuthService");
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
function asBoolean(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}
function mimeTypeForImage(imagePath) {
    const extension = path_1.default.extname(imagePath).toLowerCase();
    if (extension === '.jpg' || extension === '.jpeg')
        return 'image/jpeg';
    if (extension === '.webp')
        return 'image/webp';
    return 'image/png';
}
function roundMoney(value) {
    return typeof value === 'number' ? Math.round(value * 100) / 100 : null;
}
function coalesceText(left, right) {
    return left && left.trim() ? left : right || null;
}
function coalesceNumber(left, right) {
    return typeof left === 'number' ? left : typeof right === 'number' ? right : null;
}
function nearlyEqual(left, right, tolerance = 2) {
    if (typeof left !== 'number' || typeof right !== 'number')
        return false;
    return Math.abs(left - right) <= tolerance;
}
function defaultTotals() {
    return { goods_total: null, vat: null, amount_due: null };
}
function normalizeAiInvoiceExtraction(value) {
    const raw = (value && typeof value === 'object' ? value : {});
    const totals = raw.totals && typeof raw.totals === 'object' ? raw.totals : defaultTotals();
    return {
        supplier: raw.supplier || null,
        supplier_key: raw.supplier_key || null,
        document_type: raw.document_type || null,
        invoice_number: raw.invoice_number || null,
        serial_number: raw.serial_number || null,
        invoice_date: raw.invoice_date || null,
        date_of_supply: raw.date_of_supply || null,
        account_number: raw.account_number || null,
        order_number: raw.order_number || null,
        customer: raw.customer || null,
        customer_pin: raw.customer_pin || null,
        supplier_pin: raw.supplier_pin || null,
        sold_by: raw.sold_by || null,
        currency: raw.currency || 'KES',
        items: Array.isArray(raw.items) ? raw.items : [],
        totals: {
            goods_total: coalesceNumber(totals.goods_total, null),
            vat: coalesceNumber(totals.vat, null),
            amount_due: coalesceNumber(totals.amount_due, null),
        },
        confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
        notes: Array.isArray(raw.notes) ? raw.notes : [],
    };
}
function hasTotalProblem(invoice) {
    const { goods_total, vat, amount_due } = invoice.totals || defaultTotals();
    return (typeof goods_total === 'number' &&
        typeof vat === 'number' &&
        typeof amount_due === 'number' &&
        !nearlyEqual(roundMoney(goods_total + vat), amount_due));
}
function sumClearItemTotals(items) {
    const values = items
        .filter((item) => {
        const quantity = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : null;
        const unitPrice = typeof item.unit_price === 'number' && Number.isFinite(item.unit_price) ? item.unit_price : null;
        const netAmount = typeof item.net_amount === 'number' && Number.isFinite(item.net_amount) ? item.net_amount : null;
        return (quantity !== null &&
            unitPrice !== null &&
            netAmount !== null &&
            nearlyEqual(roundMoney(quantity * unitPrice), netAmount, Math.max(2, Math.abs(netAmount) * 0.03)));
    })
        .map((item) => item.net_amount)
        .filter((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return values.length > 0 ? roundMoney(values.reduce((sum, value) => sum + value, 0)) : null;
}
function totalSupportedByArithmetic(total, totals, itemTotal) {
    if (typeof total !== 'number') {
        return false;
    }
    if (typeof totals.goods_total === 'number' &&
        typeof totals.vat === 'number' &&
        nearlyEqual(roundMoney(totals.goods_total + totals.vat), total, Math.max(2, Math.abs(total) * 0.03))) {
        return true;
    }
    return typeof itemTotal === 'number' && nearlyEqual(itemTotal, total, Math.max(2, Math.abs(total) * 0.03));
}
function shouldUseAiInvoiceExtraction(invoice) {
    if (!asBoolean(process.env.AI_INVOICE_EXTRACTION_ENABLED) || !process.env.OPENAI_API_KEY) {
        return false;
    }
    const threshold = Number(process.env.AI_INVOICE_CONFIDENCE_THRESHOLD || 0.75);
    return (invoice.confidence.overall < threshold ||
        !invoice.invoice_date ||
        invoice.items.length === 0 ||
        hasTotalProblem(invoice));
}
function shouldUseConfiguredAiInvoiceExtraction(invoice, config) {
    if (!config) {
        return shouldUseAiInvoiceExtraction(invoice);
    }
    const provider = config.provider || 'disabled';
    const hasConfiguredCredential = provider === 'gemini'
        ? Boolean(config.apiKeys?.gemini || config.geminiOAuth?.connected)
        : provider !== 'disabled' && Boolean(config.apiKeys?.[provider]);
    if (!config.enabled || provider === 'disabled' || !hasConfiguredCredential) {
        return false;
    }
    const threshold = Number(config.confidenceThreshold || 0.75);
    return (invoice.confidence.overall < threshold ||
        !invoice.invoice_date ||
        invoice.items.length === 0 ||
        hasTotalProblem(invoice));
}
function extractionSchema() {
    const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    const nullableNumber = { anyOf: [{ type: 'number' }, { type: 'null' }] };
    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'supplier',
            'supplier_key',
            'document_type',
            'invoice_number',
            'serial_number',
            'invoice_date',
            'date_of_supply',
            'account_number',
            'order_number',
            'customer',
            'customer_pin',
            'supplier_pin',
            'sold_by',
            'currency',
            'items',
            'totals',
            'confidence',
            'notes',
        ],
        properties: {
            supplier: nullableString,
            supplier_key: {
                anyOf: [
                    { enum: ['COMPLY', 'TIMSALES', 'VINYL_SUPREME', 'TIPTOP', 'JOINBEN', 'UNKNOWN'] },
                    { type: 'null' },
                ],
            },
            document_type: {
                anyOf: [{ enum: ['invoice', 'cash_sale', 'delivery_note', 'receipt', 'mixed', 'unknown'] }, { type: 'null' }],
            },
            invoice_number: nullableString,
            serial_number: nullableString,
            invoice_date: nullableString,
            date_of_supply: nullableString,
            account_number: nullableString,
            order_number: nullableString,
            customer: nullableString,
            customer_pin: nullableString,
            supplier_pin: nullableString,
            sold_by: nullableString,
            currency: { anyOf: [{ const: 'KES' }, { type: 'null' }] },
            items: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['description', 'quantity', 'unit', 'unit_price', 'net_amount', 'vat_rate', 'raw_text', 'confidence'],
                    properties: {
                        description: { type: 'string' },
                        quantity: nullableNumber,
                        unit: nullableString,
                        unit_price: nullableNumber,
                        net_amount: nullableNumber,
                        vat_rate: nullableNumber,
                        raw_text: nullableString,
                        confidence: nullableNumber,
                    },
                },
            },
            totals: {
                type: 'object',
                additionalProperties: false,
                required: ['goods_total', 'vat', 'amount_due'],
                properties: {
                    goods_total: nullableNumber,
                    vat: nullableNumber,
                    amount_due: nullableNumber,
                },
            },
            confidence: { type: 'number' },
            notes: { type: 'array', items: { type: 'string' } },
        },
    };
}
function extractOutputText(response) {
    if (typeof response.output_text === 'string')
        return response.output_text;
    for (const output of response.output || []) {
        for (const content of output.content || []) {
            if (typeof content.text === 'string')
                return content.text;
        }
    }
    return '';
}
function extractChatOutputText(response) {
    const message = response?.choices?.[0]?.message;
    const content = message?.content || message?.reasoning_content;
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .filter(Boolean)
            .join('\n');
    }
    return '';
}
function stripNvidiaControlTokens(value) {
    return value
        // Gemma 4 can emit an empty thought channel even when thinking is disabled.
        .replace(/<\|channel>thought[\s\S]*?<channel\|>/gi, '')
        .replace(/<\|(?:think|analysis)\|>[\s\S]*?<\|\/(?:think|analysis)\|>/gi, '')
        .replace(/<\|(?:channel|message|eot_id|end_of_text|endoftext)\|>/gi, '')
        .replace(/<\|(?:start|end)_of_text\|>/gi, '')
        .trim();
}
function extractGeminiOutputText(response) {
    return (response?.candidates?.[0]?.content?.parts || [])
        .map((part) => (typeof part?.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n');
}
function extractAnthropicOutputText(response) {
    return (response?.content || [])
        .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
        .filter(Boolean)
        .join('\n');
}
function stripJsonFence(value) {
    return value
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}
function extractJsonObjectText(value) {
    const stripped = stripJsonFence(value);
    const directStart = stripped.indexOf('{');
    if (directStart < 0) {
        return stripped;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = directStart; index < stripped.length; index += 1) {
        const char = stripped[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (char === '\\') {
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            continue;
        }
        if (inString) {
            continue;
        }
        if (char === '{') {
            depth += 1;
        }
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return stripped.slice(directStart, index + 1);
            }
        }
    }
    return stripped.slice(directStart);
}
function parseLooseMoney(value) {
    if (!value)
        return null;
    const cleaned = value.replace(/KES|KSH|USD|,/gi, '').match(/-?\d+(?:\.\d+)?/);
    return cleaned ? Number(cleaned[0]) : null;
}
function parseLooseDateValue(value) {
    if (!value)
        return null;
    const iso = value.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso)
        return iso[0];
    const dayFirst = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
    if (dayFirst) {
        const year = dayFirst[3].length === 2 ? `20${dayFirst[3]}` : dayFirst[3];
        return `${year}-${dayFirst[2].padStart(2, '0')}-${dayFirst[1].padStart(2, '0')}`;
    }
    return null;
}
function firstLabelMatch(text, labels) {
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = text.match(new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:"|')?(?:\\*\\*)?${escaped}(?:\\*\\*)?(?:"|')?\\s*[:\\-]\\s*([^,\\n}\\]]+)`, 'i'));
        if (match?.[1]) {
            return match[1].replace(/\*\*/g, '').replace(/^["']|["']$/g, '').trim();
        }
    }
    return null;
}
function firstJsonKeyMatch(text, keys) {
    for (const key of keys) {
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = text.match(new RegExp(`["']${escaped}["']\\s*:\\s*(?:"([^"]*)"|(-?\\d+(?:\\.\\d+)?)|null)`, 'i'));
        if (match) {
            return match[1] ?? match[2] ?? null;
        }
    }
    return null;
}
function parseLooseAiInvoiceExtraction(outputText) {
    const text = outputText.replace(/\r/g, '\n');
    const supplier = firstJsonKeyMatch(text, ['supplier', 'vendor', 'seller']) ||
        firstLabelMatch(text, ['supplier', 'vendor', 'seller', 'company', 'business name']);
    const invoiceNumber = firstJsonKeyMatch(text, ['invoice_number', 'receipt_number', 'document_number', 'serial_number']) ||
        firstLabelMatch(text, ['invoice number', 'invoice no', 'receipt number', 'receipt no', 'document number']);
    const invoiceDate = parseLooseDateValue(firstJsonKeyMatch(text, ['invoice_date', 'receipt_date', 'date_of_supply', 'date']) ||
        firstLabelMatch(text, ['invoice date', 'receipt date', 'date', 'date issued']));
    const goodsTotal = parseLooseMoney(firstJsonKeyMatch(text, ['goods_total', 'subtotal', 'untaxed_total', 'net_total']) ||
        firstLabelMatch(text, ['goods total', 'subtotal', 'sub total', 'untaxed total', 'net total']));
    const vat = parseLooseMoney(firstJsonKeyMatch(text, ['vat', 'tax', 'tax_amount']) ||
        firstLabelMatch(text, ['vat', 'tax', 'tax amount']));
    const amountDue = parseLooseMoney(firstJsonKeyMatch(text, ['amount_due', 'grand_total', 'total_amount', 'total', 'amount_paid']) ||
        firstLabelMatch(text, ['amount due', 'grand total', 'total amount', 'total', 'amount paid']));
    if (!supplier && !invoiceNumber && !invoiceDate && amountDue === null && goodsTotal === null) {
        return null;
    }
    return {
        supplier,
        supplier_key: null,
        document_type: null,
        invoice_number: invoiceNumber,
        serial_number: null,
        invoice_date: invoiceDate,
        date_of_supply: null,
        account_number: null,
        order_number: firstJsonKeyMatch(text, ['order_number', 'po_number', 'purchase_order']) ||
            firstLabelMatch(text, ['order number', 'po number', 'purchase order']),
        customer: firstJsonKeyMatch(text, ['customer', 'buyer']) ||
            firstLabelMatch(text, ['customer', 'buyer']),
        customer_pin: firstJsonKeyMatch(text, ['customer_pin', 'buyer_pin']) ||
            firstLabelMatch(text, ['customer pin', 'buyer pin']),
        supplier_pin: firstJsonKeyMatch(text, ['supplier_pin', 'vendor_pin', 'seller_pin', 'pin']) ||
            firstLabelMatch(text, ['supplier pin', 'vendor pin', 'seller pin', 'pin']),
        sold_by: null,
        currency: 'KES',
        items: [],
        totals: {
            goods_total: goodsTotal,
            vat,
            amount_due: amountDue ?? (goodsTotal !== null && vat !== null ? roundMoney(goodsTotal + vat) : null),
        },
        confidence: 0.55,
        notes: ['Parsed from non-JSON AI response.'],
    };
}
function repairModelJson(value) {
    return value
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/"confidence"\s*:\s*"([0-9.]+)"/g, '"confidence": $1')
        .replace(/:\s*undefined\b/g, ': null')
        .replace(/\bNaN\b/g, 'null');
}
function mergeAiExtractions(extractions) {
    return extractions.reduce((merged, extraction) => {
        if (!merged)
            return normalizeAiInvoiceExtraction(extraction);
        const safeMerged = normalizeAiInvoiceExtraction(merged);
        const safeExtraction = normalizeAiInvoiceExtraction(extraction);
        return {
            ...safeMerged,
            supplier: coalesceText(safeMerged.supplier, safeExtraction.supplier),
            invoice_number: coalesceText(safeMerged.invoice_number, safeExtraction.invoice_number),
            serial_number: coalesceText(safeMerged.serial_number, safeExtraction.serial_number),
            invoice_date: coalesceText(safeMerged.invoice_date, safeExtraction.invoice_date),
            date_of_supply: coalesceText(safeMerged.date_of_supply, safeExtraction.date_of_supply),
            account_number: coalesceText(safeMerged.account_number, safeExtraction.account_number),
            order_number: coalesceText(safeMerged.order_number, safeExtraction.order_number),
            customer: coalesceText(safeMerged.customer, safeExtraction.customer),
            customer_pin: coalesceText(safeMerged.customer_pin, safeExtraction.customer_pin),
            supplier_pin: coalesceText(safeMerged.supplier_pin, safeExtraction.supplier_pin),
            sold_by: coalesceText(safeMerged.sold_by, safeExtraction.sold_by),
            items: safeMerged.items.length > 0 ? safeMerged.items : safeExtraction.items,
            totals: {
                goods_total: coalesceNumber(safeMerged.totals.goods_total, safeExtraction.totals.goods_total),
                vat: coalesceNumber(safeMerged.totals.vat, safeExtraction.totals.vat),
                amount_due: coalesceNumber(safeMerged.totals.amount_due, safeExtraction.totals.amount_due),
            },
            notes: [...safeMerged.notes, ...safeExtraction.notes],
        };
    }, null);
}
function parseLooseAiExtractions(outputText) {
    const chunks = outputText.split(/\n{2,}(?=(?:[*#\s-]*invoice|[*#\s-]*receipt|[*#\s-]*page|[{]))/i);
    const extractions = chunks
        .map(parseLooseAiInvoiceExtraction)
        .filter((entry) => Boolean(entry));
    if (extractions.length === 0) {
        const single = parseLooseAiInvoiceExtraction(outputText);
        return single ? [single] : [];
    }
    return extractions;
}
function buildExtractionPrompt(input) {
    return [
        'Extract this supplier invoice into one valid JSON object only.',
        'Do not include markdown, bullets, explanation, heading text, or code fences.',
        'Your first character must be { and your last character must be }.',
        'Use the invoice image as the authority when OCR text conflicts with the visible document.',
        'Handwritten mode: inspect every handwritten digit and word carefully; do not silently guess. Return null when a field cannot be read, and include the uncertainty in notes.',
        'For handwritten line items, preserve the visible row structure and return quantity, unit price, and net amount independently. Never derive a missing number just to make totals balance.',
        'Use arithmetic only as a validation signal: quantity x unit price should approximately equal net amount, and line totals should approximately reconcile to the invoice total.',
        'If this is a text-only model, use the OCR text as the authority and cross-check it against embedded PDF text.',
        'The original filename may come from a scanner or Odoo Documents. Treat it only as a weak corroborating vendor hint: remove labels such as RECEIPT/INVOICE, dates, and scan numbers, and tolerate truncated names such as ENTERPRIS matching ENTERPRISES. Never use the filename to invent the invoice number or invoice/receipt date, and never let it override clearly printed values in the invoice body.',
        'For ETR/receipt documents, final payable amount is usually labelled TOTAL, CASH, PAID, AMOUNT DUE, or GRAND TOTAL. Do not add VAT again when TOTAL/CASH is already VAT-inclusive.',
        'For Kenya buyer/client PIN, prefer CLIENT PIN, BUYER PIN, CUSTOMER PIN, or a PIN near Urban Vibe over supplier PIN.',
        'For Comply Industries invoices, amount due is goods total plus VAT; the visible AMOUNT DUE box is the grand total.',
        'Return ISO dates as YYYY-MM-DD. Use null for unreadable fields.',
        'JSON shape:',
        JSON.stringify(extractionSchema()),
        `Original filename (vendor hint only; never use for invoice number or date): ${input.originalFilename || ''}`,
        `OCR text:\n${input.ocrText.slice(0, 5000)}`,
        `Embedded PDF text:\n${input.pdfText.slice(0, 2500)}`,
    ].join('\n\n');
}
async function readImagesForAi(imagePaths) {
    return Promise.all(imagePaths.map(async (imagePath) => ({
        imagePath,
        mediaType: mimeTypeForImage(imagePath),
        base64: (await promises_1.default.readFile(imagePath)).toString('base64'),
    })));
}
function defaultModelForProvider(provider) {
    switch (provider) {
        case 'nvidia':
            return 'google/gemma-4-31b-it';
        case 'gemini':
            return 'gemini-flash-latest';
        case 'anthropic':
            return 'claude-sonnet-4-5-20250929';
        case 'openrouter':
            return 'openai/gpt-4.1';
        case 'openai':
        default:
            return 'gpt-4.1';
    }
}
function resolveConfiguredApiKey(config, provider, model) {
    if (provider === 'nvidia' && model && config.nvidiaModelKeys?.[model]) {
        return config.nvidiaModelKeys[model];
    }
    if (provider === 'disabled')
        return '';
    return config.apiKeys?.[provider] || (provider === 'nvidia' ? process.env.NVIDIA_API_KEY || '' : '');
}
async function resolveConfiguredCredential(config, provider, model) {
    if (provider !== 'gemini') {
        return { apiKey: resolveConfiguredApiKey(config, provider, model) };
    }
    if (config.geminiOAuth?.connected) {
        try {
            const oauth = await (0, geminiOAuthService_1.getGeminiOAuthAccessToken)();
            return { accessToken: oauth.accessToken, projectId: oauth.projectId };
        }
        catch (err) {
            const apiKey = resolveConfiguredApiKey(config, provider, model);
            if (apiKey)
                return { apiKey };
            throw err;
        }
    }
    const apiKey = resolveConfiguredApiKey(config, provider, model);
    if (apiKey)
        return { apiKey };
    return {};
}
function providerHasConfiguredCredential(config, provider, model) {
    return Boolean(provider === 'gemini'
        ? config.geminiOAuth?.connected || resolveConfiguredApiKey(config, provider, model)
        : resolveConfiguredApiKey(config, provider, model));
}
function isTextOnlyNvidiaModel(model) {
    const m = model.trim();
    return /^openai\/gpt-oss-/i.test(m) || /^z-ai\//i.test(m);
}
function usesConfiguredOcr(config) {
    return Boolean(config?.ocr?.enabled && config.ocr.provider !== 'disabled' && config.ocr.apiKey);
}
function nvidiaVisionFallbackModel(model) {
    return isTextOnlyNvidiaModel(model) ? 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1' : model;
}
function aiExtractionNeedsVisionFallback(extraction) {
    if (!extraction) {
        return true;
    }
    const safe = normalizeAiInvoiceExtraction(extraction);
    return safe.items.length === 0 || safe.totals.amount_due === null;
}
async function callOpenAiCompatibleInvoiceAi(input) {
    const defaultUrl = input.provider === 'nvidia'
        ? NVIDIA_CHAT_URL
        : input.provider === 'openrouter'
            ? OPENROUTER_CHAT_URL
            : OPENAI_CHAT_URL;
    const configuredBaseUrl = input.baseUrl.replace(/\/+$/, '');
    const endpoint = configuredBaseUrl
        ? /\/chat\/completions$/i.test(configuredBaseUrl)
            ? configuredBaseUrl
            : `${configuredBaseUrl}/chat/completions`
        : defaultUrl;
    const isGemmaVision = input.provider === 'nvidia' && input.model === 'google/gemma-4-31b-it';
    const multimodalContent = [
        ...input.images.map((image) => ({
            type: 'image_url',
            image_url: {
                url: `data:${image.mediaType};base64,${image.base64}`,
                detail: input.provider === 'nvidia' ? 'auto' : 'high',
            },
        })),
        { type: 'text', text: input.prompt },
    ];
    const body = {
        model: input.model,
        temperature: isGemmaVision ? 1.0 : 0,
        max_tokens: isGemmaVision ? 4096 : 4000,
        stream: false,
        messages: [
            {
                role: 'user',
                content: input.provider === 'nvidia' && isTextOnlyNvidiaModel(input.model)
                    ? input.prompt
                    : multimodalContent,
            },
        ],
    };
    // NVIDIA's Gemma endpoint documents the OpenAI-compatible chat fields but
    // does not document response_format. Keep the strict JSON instruction in
    // the prompt and let the parser handle a fenced/annotated response.
    if (input.provider !== 'nvidia') {
        body.response_format = { type: 'json_object' };
    }
    if (isGemmaVision) {
        body.top_p = 0.95;
        body.top_k = 64;
        body.chat_template_kwargs = {
            enable_thinking: false,
            visual_token_budget: 1120,
        };
    }
    const requestTimeoutMs = isGemmaVision ? 300000 : 60000;
    const headers = {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        ...(input.provider === 'nvidia' ? { Accept: 'application/json' } : {}),
        ...(input.provider === 'openrouter'
            ? {
                'HTTP-Referer': 'https://app.urbanvibeinteriordesign.co.ke',
                'X-Title': 'PO Bill Automation',
            }
            : {}),
    };
    let response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers,
        body: JSON.stringify(body),
    });
    let responseJson = await response.json().catch(() => null);
    // NVIDIA may accept a request asynchronously with HTTP 202. Poll the
    // documented status endpoint until the same request is fulfilled or the
    // original Gemma timeout budget is exhausted.
    if (input.provider === 'nvidia' && response.status === 202) {
        const requestId = responseJson?.requestId || responseJson?.request_id;
        if (!requestId) {
            throw new Error('nvidia API returned HTTP 202 without a requestId for status polling.');
        }
        const statusBaseUrl = endpoint.replace(/\/chat\/completions\/?$/i, '');
        const statusEndpoint = `${statusBaseUrl}/status/${encodeURIComponent(String(requestId))}`;
        const deadline = Date.now() + requestTimeoutMs;
        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0)
                break;
            const statusResponse = await fetch(statusEndpoint, {
                method: 'GET',
                signal: AbortSignal.timeout(Math.min(30000, remainingMs)),
                headers: {
                    Authorization: `Bearer ${input.apiKey}`,
                    Accept: 'application/json',
                },
            });
            const statusJson = await statusResponse.json().catch(() => null);
            if (statusResponse.status === 202) {
                continue;
            }
            response = statusResponse;
            responseJson = statusJson?.response || statusJson;
            break;
        }
        if (response.status === 202) {
            throw new Error(`nvidia API request ${requestId} remained pending for ${Math.round(requestTimeoutMs / 1000)} seconds.`);
        }
    }
    if (!response.ok) {
        const message = responseJson?.error?.message ||
            responseJson?.detail ||
            responseJson?.message ||
            JSON.stringify(responseJson || {}).slice(0, 500) ||
            `${input.provider} API returned HTTP ${response.status}.`;
        throw new Error(`${input.provider} API returned HTTP ${response.status}: ${message}`);
    }
    const outputText = extractChatOutputText(responseJson);
    return input.provider === 'nvidia' ? stripNvidiaControlTokens(outputText) : outputText;
}
async function callGeminiInvoiceAi(input) {
    const baseUrl = input.baseUrl.replace(/\/+$/, '') || GEMINI_BASE_URL;
    const endpoint = `${baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`;
    const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: {
            'Content-Type': 'application/json',
            ...(input.accessToken
                ? {
                    Authorization: `Bearer ${input.accessToken}`,
                    'x-goog-user-project': input.projectId || '',
                }
                : { 'X-goog-api-key': input.apiKey || '' }),
        },
        body: JSON.stringify({
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: input.prompt },
                        ...input.images.map((image) => ({
                            inline_data: {
                                mime_type: image.mediaType,
                                data: image.base64,
                            },
                        })),
                    ],
                },
            ],
            generationConfig: {
                temperature: 0,
                response_mime_type: 'application/json',
            },
        }),
    });
    const responseJson = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(responseJson?.error?.message || `Gemini API returned HTTP ${response.status}.`);
    }
    return extractGeminiOutputText(responseJson);
}
async function callAnthropicInvoiceAi(input) {
    const endpoint = input.baseUrl
        ? `${input.baseUrl.replace(/\/+$/, '')}/messages`
        : ANTHROPIC_MESSAGES_URL;
    const response = await fetch(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(60000),
        headers: {
            'x-api-key': input.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: input.model,
            max_tokens: 4000,
            temperature: 0,
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: input.prompt },
                        ...input.images.map((image) => ({
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: image.mediaType,
                                data: image.base64,
                            },
                        })),
                    ],
                },
            ],
        }),
    });
    const responseJson = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(responseJson?.error?.message || `Anthropic API returned HTTP ${response.status}.`);
    }
    return extractAnthropicOutputText(responseJson);
}
async function extractInvoiceWithAi(input) {
    if (input.config) {
        return extractInvoiceWithConfiguredAi(input);
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return { extraction: null, warnings: ['AI invoice extraction skipped because OPENAI_API_KEY is not configured.'] };
    }
    const imagePaths = input.imagePaths.slice(0, Number(process.env.AI_INVOICE_MAX_IMAGES || 3));
    if (imagePaths.length === 0) {
        return { extraction: null, warnings: ['AI invoice extraction skipped because no rendered invoice image was available.'] };
    }
    const imageContent = await Promise.all(imagePaths.map(async (imagePath) => {
        const base64 = (await promises_1.default.readFile(imagePath)).toString('base64');
        return {
            type: 'input_image',
            image_url: `data:${mimeTypeForImage(imagePath)};base64,${base64}`,
            detail: 'high',
        };
    }));
    const model = process.env.OPENAI_INVOICE_MODEL || 'gpt-4.1';
    const response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model,
            input: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: [
                                'Extract this supplier invoice into strict JSON.',
                                'Use the invoice image as the authority when OCR text conflicts with the visible document.',
                                'For Comply Industries invoices, amount due is goods total plus VAT; the visible AMOUNT DUE box is the grand total.',
                                'Return ISO dates as YYYY-MM-DD. Use null for unreadable fields.',
                                `Original filename: ${input.originalFilename || ''}`,
                                `OCR text:\n${input.ocrText.slice(0, 5000)}`,
                                `Embedded PDF text:\n${input.pdfText.slice(0, 2500)}`,
                            ].join('\n\n'),
                        },
                        ...imageContent,
                    ],
                },
            ],
            text: {
                format: {
                    type: 'json_schema',
                    name: 'supplier_invoice_extraction',
                    strict: true,
                    schema: extractionSchema(),
                },
            },
        }),
    });
    const responseJson = await response.json().catch(() => null);
    if (!response.ok) {
        const message = responseJson?.error?.message || `OpenAI API returned HTTP ${response.status}.`;
        return { extraction: null, warnings: [`AI invoice extraction failed: ${message}`] };
    }
    const outputText = extractOutputText(responseJson);
    if (!outputText) {
        return { extraction: null, warnings: ['AI invoice extraction failed: the model returned no JSON text.'] };
    }
    try {
        return { extraction: normalizeAiInvoiceExtraction(JSON.parse(outputText)), warnings: [] };
    }
    catch (error) {
        return {
            extraction: null,
            warnings: [`AI invoice extraction failed: ${error instanceof Error ? error.message : String(error)}`],
        };
    }
}
async function extractInvoiceWithConfiguredAi(input) {
    const primaryProvider = input.config.provider || 'disabled';
    if (!input.config.enabled || primaryProvider === 'disabled') {
        return { extraction: null, warnings: ['AI invoice extraction skipped because it is disabled in Settings.'] };
    }
    // Only send full-page images to AI — crop variants (header/items/totals) are for OCR
    // accuracy only and would cause redundant sequential API calls for a single PDF page.
    const fullPageImagePaths = input.imagePaths.filter((p) => /-page-\d+\.[a-z]+$/i.test(p));
    const aiImagePaths = fullPageImagePaths.length > 0 ? fullPageImagePaths : input.imagePaths;
    const allSupportedProviders = [
        'gemini',
        'openai',
        'openrouter',
        'nvidia',
        'anthropic',
    ];
    const candidateProviders = [];
    if (providerHasConfiguredCredential(input.config, primaryProvider)) {
        candidateProviders.push(primaryProvider);
    }
    for (const p of allSupportedProviders) {
        if (p !== primaryProvider && providerHasConfiguredCredential(input.config, p)) {
            candidateProviders.push(p);
        }
    }
    if (candidateProviders.length === 0) {
        return {
            extraction: null,
            warnings: [`AI invoice extraction skipped because no API key or OAuth connection is configured for selected provider "${primaryProvider}".`],
        };
    }
    const overallWarnings = [];
    for (const provider of candidateProviders) {
        const configuredMaxImages = Number(input.config.maxImages || 0);
        const imageLimit = configuredMaxImages > 0
            ? Math.min(configuredMaxImages, aiImagePaths.length)
            : aiImagePaths.length;
        const imagePaths = aiImagePaths.slice(0, imageLimit);
        const model = provider === primaryProvider && input.config.model?.trim()
            ? input.config.model.trim()
            : defaultModelForProvider(provider);
        const canRunTextOnly = provider === 'nvidia' && isTextOnlyNvidiaModel(model);
        if (imagePaths.length === 0 && !canRunTextOnly) {
            continue;
        }
        try {
            const credential = await resolveConfiguredCredential(input.config, provider, model);
            if (!credential.apiKey && !credential.accessToken) {
                continue;
            }
            const apiKey = credential.apiKey || '';
            const prompt = buildExtractionPrompt(input);
            let outputText = '';
            const accumulatedWarnings = [];
            if (provider === 'openai' || provider === 'nvidia' || provider === 'openrouter') {
                if (provider === 'nvidia' && canRunTextOnly) {
                    outputText = await callOpenAiCompatibleInvoiceAi({
                        provider,
                        apiKey,
                        model,
                        baseUrl: input.config.baseUrl,
                        images: [],
                        prompt,
                    });
                    const textOnlyParsed = parseConfiguredAiOutputText(outputText, provider, model);
                    accumulatedWarnings.push(...textOnlyParsed.warnings);
                    if (!aiExtractionNeedsVisionFallback(textOnlyParsed.extraction) || imagePaths.length === 0) {
                        return {
                            extraction: textOnlyParsed.extraction,
                            warnings: [...overallWarnings, ...accumulatedWarnings, ...textOnlyParsed.warnings],
                        };
                    }
                    const visionModel = nvidiaVisionFallbackModel(model);
                    const outputs = [];
                    for (const imagePath of imagePaths) {
                        const images = await readImagesForAi([imagePath]);
                        outputs.push(await callOpenAiCompatibleInvoiceAi({
                            provider,
                            apiKey,
                            model: visionModel,
                            baseUrl: input.config.baseUrl,
                            images,
                            prompt,
                        }));
                    }
                    outputText = outputs.join('\n\n');
                    accumulatedWarnings.push(`AI invoice extraction retried with NVIDIA vision model ${visionModel} because text-only OCR interpretation missed items or total.`);
                }
                else if (provider === 'nvidia') {
                    // Gemma is multimodal and accepts multiple image parts in one user
                    // message. One request keeps page context together and avoids a
                    // serial model call (and timeout risk) for every physical page.
                    const images = await readImagesForAi(imagePaths);
                    outputText = await callOpenAiCompatibleInvoiceAi({
                        provider,
                        apiKey,
                        model,
                        baseUrl: input.config.baseUrl,
                        images,
                        prompt,
                    });
                }
                else {
                    const images = await readImagesForAi(imagePaths);
                    outputText = await callOpenAiCompatibleInvoiceAi({
                        provider,
                        apiKey,
                        model,
                        baseUrl: input.config.baseUrl,
                        images,
                        prompt,
                    });
                }
            }
            else if (provider === 'gemini') {
                const images = await readImagesForAi(imagePaths);
                outputText = await callGeminiInvoiceAi({
                    apiKey: credential.apiKey,
                    accessToken: credential.accessToken,
                    projectId: credential.projectId,
                    model,
                    baseUrl: input.config.baseUrl,
                    images,
                    prompt,
                });
            }
            else if (provider === 'anthropic') {
                const images = await readImagesForAi(imagePaths);
                outputText = await callAnthropicInvoiceAi({
                    apiKey,
                    model,
                    baseUrl: input.config.baseUrl,
                    images,
                    prompt,
                });
            }
            const parsed = parseConfiguredAiOutputText(outputText, provider, model);
            if (parsed.extraction) {
                return {
                    extraction: parsed.extraction,
                    warnings: [...overallWarnings, ...accumulatedWarnings, ...parsed.warnings],
                };
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            overallWarnings.push(`AI provider "${provider}" (${model}) failed: ${msg}. Attempting fallback provider...`);
        }
    }
    return {
        extraction: null,
        warnings: [...overallWarnings, 'All configured AI provider API keys failed or were exhausted.'],
    };
}
function parseConfiguredAiOutputText(outputText, provider, model) {
    if (!outputText) {
        return { extraction: null, warnings: [`AI invoice extraction failed: ${provider} returned no JSON text.`] };
    }
    const jsonText = extractJsonObjectText(outputText);
    if (jsonText.trim().startsWith('{')) {
        try {
            return {
                extraction: normalizeAiInvoiceExtraction(JSON.parse(jsonText)),
                warnings: [`AI invoice extraction used provider ${provider} with model ${model}.`],
            };
        }
        catch (jsonError) {
            const repaired = repairModelJson(jsonText);
            try {
                return {
                    extraction: normalizeAiInvoiceExtraction(JSON.parse(repaired)),
                    warnings: [
                        `AI invoice extraction used provider ${provider} with model ${model}; minor JSON repair was applied.`,
                    ],
                };
            }
            catch {
                const looseFromMalformedJson = mergeAiExtractions(parseLooseAiExtractions(jsonText)) ||
                    mergeAiExtractions(parseLooseAiExtractions(outputText));
                if (looseFromMalformedJson) {
                    return {
                        extraction: looseFromMalformedJson,
                        warnings: [
                            `AI invoice extraction used provider ${provider} with model ${model}, but malformed JSON was converted to invoice fields.`,
                        ],
                    };
                }
                throw jsonError;
            }
        }
    }
    const looseExtraction = mergeAiExtractions(parseLooseAiExtractions(outputText));
    if (looseExtraction) {
        return {
            extraction: looseExtraction,
            warnings: [
                `AI invoice extraction used provider ${provider} with model ${model}, but the response was converted from markdown/prose instead of strict JSON.`,
            ],
        };
    }
    throw new Error(`Model returned non-JSON text: ${outputText.slice(0, 240)}`);
}
function mergeAiInvoiceExtraction(invoice, ai) {
    const safeInvoiceTotals = invoice.totals || defaultTotals();
    const safeAi = normalizeAiInvoiceExtraction(ai);
    const invoiceItemTotal = sumClearItemTotals(invoice.items);
    const aiItemTotal = sumClearItemTotals(safeAi.items);
    const aiTotalsConsistent = typeof safeAi.totals.goods_total === 'number' &&
        typeof safeAi.totals.vat === 'number' &&
        typeof safeAi.totals.amount_due === 'number' &&
        nearlyEqual(roundMoney(safeAi.totals.goods_total + safeAi.totals.vat), safeAi.totals.amount_due);
    const existingTotal = safeInvoiceTotals.amount_due;
    const aiTotal = safeAi.totals.amount_due;
    const knownVat = typeof safeAi.totals.vat === 'number'
        ? safeAi.totals.vat
        : typeof safeInvoiceTotals.vat === 'number'
            ? safeInvoiceTotals.vat
            : null;
    const existingTotalSupported = totalSupportedByArithmetic(existingTotal, safeInvoiceTotals, invoiceItemTotal);
    const aiTotalSupported = totalSupportedByArithmetic(aiTotal, safeAi.totals, aiItemTotal ?? invoiceItemTotal);
    const parserTotalLooksLikeSubtotal = typeof existingTotal === 'number' &&
        typeof invoiceItemTotal === 'number' &&
        typeof safeInvoiceTotals.vat === 'number' &&
        safeInvoiceTotals.vat > 0 &&
        nearlyEqual(existingTotal, invoiceItemTotal, Math.max(2, Math.abs(invoiceItemTotal) * 0.03));
    const parserTotalLooksLikeGoodsSubtotal = typeof existingTotal === 'number' &&
        typeof safeInvoiceTotals.goods_total === 'number' &&
        typeof safeInvoiceTotals.vat === 'number' &&
        safeInvoiceTotals.vat > 0 &&
        nearlyEqual(existingTotal, safeInvoiceTotals.goods_total, Math.max(2, Math.abs(existingTotal) * 0.03));
    const aiTotalMatchesItemsPlusVat = typeof aiTotal === 'number' &&
        typeof invoiceItemTotal === 'number' &&
        typeof knownVat === 'number' &&
        knownVat > 0 &&
        nearlyEqual(roundMoney(invoiceItemTotal + knownVat), aiTotal, Math.max(2, Math.abs(aiTotal) * 0.03));
    const aiTotalMatchesGoodsPlusVat = typeof aiTotal === 'number' &&
        typeof safeInvoiceTotals.goods_total === 'number' &&
        typeof knownVat === 'number' &&
        knownVat > 0 &&
        nearlyEqual(roundMoney(safeInvoiceTotals.goods_total + knownVat), aiTotal, Math.max(2, Math.abs(aiTotal) * 0.03));
    const aiTotalsMatchParserLineItems = aiTotalsConsistent &&
        typeof invoiceItemTotal === 'number' &&
        typeof safeAi.totals.goods_total === 'number' &&
        nearlyEqual(safeAi.totals.goods_total, invoiceItemTotal, Math.max(2, Math.abs(invoiceItemTotal) * 0.03));
    const shouldTrustAiSubtotalCorrection = (parserTotalLooksLikeSubtotal || parserTotalLooksLikeGoodsSubtotal) &&
        typeof aiTotal === 'number' &&
        typeof existingTotal === 'number' &&
        aiTotal > existingTotal &&
        (aiTotalMatchesItemsPlusVat || aiTotalMatchesGoodsPlusVat || aiTotalsMatchParserLineItems);
    const shouldTrustAiTotals = existingTotal === null ||
        hasTotalProblem(invoice) ||
        shouldTrustAiSubtotalCorrection ||
        (typeof existingTotal === 'number' &&
            typeof aiTotal === 'number' &&
            !existingTotalSupported &&
            aiTotalSupported) ||
        (aiTotalsConsistent &&
            typeof existingTotal === 'number' &&
            typeof aiTotal === 'number' &&
            nearlyEqual(existingTotal, aiTotal));
    const shouldTrustAiItems = safeAi.items.length > 0 && (invoice.items.length === 0 || safeAi.confidence >= 0.7);
    const aiTotalConflict = typeof existingTotal === 'number' &&
        typeof aiTotal === 'number' &&
        !nearlyEqual(existingTotal, aiTotal);
    return {
        ...invoice,
        supplier: safeAi.supplier || invoice.supplier,
        supplier_key: safeAi.supplier_key || invoice.supplier_key,
        document_type: safeAi.document_type || invoice.document_type,
        invoice_number: safeAi.invoice_number || invoice.invoice_number,
        serial_number: safeAi.serial_number || invoice.serial_number,
        invoice_date: invoice.invoice_date || safeAi.invoice_date,
        date_of_supply: safeAi.date_of_supply || invoice.date_of_supply,
        customer: safeAi.customer || invoice.customer,
        customer_pin: safeAi.customer_pin || invoice.customer_pin,
        supplier_pin: safeAi.supplier_pin || invoice.supplier_pin,
        items: shouldTrustAiItems ? safeAi.items : invoice.items,
        totals: shouldTrustAiTotals
            ? {
                goods_total: shouldTrustAiSubtotalCorrection
                    ? safeAi.totals.goods_total ?? safeInvoiceTotals.goods_total ?? invoiceItemTotal
                    : safeAi.totals.goods_total ?? safeInvoiceTotals.goods_total,
                vat: shouldTrustAiSubtotalCorrection
                    ? knownVat
                    : safeAi.totals.vat ?? safeInvoiceTotals.vat,
                amount_due: safeAi.totals.amount_due ?? safeInvoiceTotals.amount_due,
            }
            : safeInvoiceTotals,
        warnings: [
            ...invoice.warnings,
            `AI invoice extraction used${safeAi.notes.length > 0 ? `: ${safeAi.notes.join(' ')}` : '.'}`,
            ...(shouldTrustAiSubtotalCorrection
                ? [`Parser payable total ${existingTotal} matched line-item subtotal; AI total ${aiTotal} matched line items plus VAT, so AI totals were used.`]
                : []),
            ...(aiTotalConflict
                ? shouldTrustAiTotals
                    ? [`Parser total ${existingTotal} was replaced by AI total ${aiTotal} because the AI total was arithmetically supported.`]
                    : [`AI total ${aiTotal} was ignored because parser total ${existingTotal} was arithmetically supported or stronger.`]
                : []),
        ],
        raw: {
            ...invoice.raw,
            ai_json: safeAi,
        },
    };
}
