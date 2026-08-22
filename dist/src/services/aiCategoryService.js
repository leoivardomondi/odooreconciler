"use strict";
/**
 * AI-Powered M-Pesa Transaction Categorization Service
 *
 * Uses configured AI providers (OpenAI, NVIDIA, Gemini, Anthropic, OpenRouter)
 * to analyze M-Pesa transaction notes/details and determine the best-fit category.
 *
 * Includes a keyword-based fallback system when AI is unavailable, with special
 * emphasis on Transport-related keyword detection.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_LABELS = exports.MPESA_CATEGORIES = void 0;
exports.trainMpesaCategoryFromTransaction = trainMpesaCategoryFromTransaction;
exports.analyzeTransportKeywords = analyzeTransportKeywords;
exports.categorizeByKeywords = categorizeByKeywords;
exports.categorizeWithAi = categorizeWithAi;
exports.categorizeBatchWithAi = categorizeBatchWithAi;
exports.extractTransportIndicators = extractTransportIndicators;
exports.getTransportKeywordRules = getTransportKeywordRules;
exports.getCategoryDefinitions = getCategoryDefinitions;
const repositories_1 = require("../models/repositories");
const db_1 = require("../models/db");
const geminiOAuthService_1 = require("./geminiOAuthService");
// ─── Category Definitions ───────────────────────────────────────────────
const MPESA_CATEGORIES = [
    'staff_lunch_expense',
    'staff_transport_expense',
    'staff_overtime_expense',
    'advance_salary',
    'staff_loan',
    'transport_expense',
    'office_water_expense',
    'supplier_payment',
    'customer_receipt',
    'mpesa_charge',
    'cash_withdrawal',
    'refunds',
    'outgoing_payment',
    'bank_transfer',
    'internal_transfer',
    'unknown',
];
exports.MPESA_CATEGORIES = MPESA_CATEGORIES;
const CATEGORY_LABELS = {
    staff_lunch_expense: 'Staff lunch',
    staff_transport_expense: 'Staff transport',
    staff_overtime_expense: 'Staff overtime',
    advance_salary: 'Advance Salary',
    staff_loan: 'Staff loan',
    transport_expense: 'Transport',
    office_water_expense: 'Office water',
    supplier_payment: 'Supplier payment',
    customer_receipt: 'Customer receipt',
    mpesa_charge: 'M-Pesa charge',
    cash_withdrawal: 'Cash withdrawal',
    refunds: 'Refunds',
    outgoing_payment: 'Outgoing payment',
    bank_transfer: 'Bank transfer',
    internal_transfer: 'Internal transfer',
    unknown: 'Unknown',
};
exports.CATEGORY_LABELS = CATEGORY_LABELS;
const CATEGORY_DESCRIPTIONS = {
    staff_lunch_expense: 'Payment for staff meals/lunch, usually smaller amounts paid around mid-morning or lunchtime',
    staff_transport_expense: 'Transport fare for staff members, e.g. paying boda boda, tuk-tuk, matatu, uber, taxi for work-related staff movement',
    staff_overtime_expense: 'Overtime payment to staff members',
    advance_salary: 'Salary advance given to an employee before payday',
    staff_loan: 'Loan given to a staff member',
    transport_expense: 'General transport expense — carrying/delivering goods/materials, paying for truck/lorry/tuktuk/pickup transport, fuel for delivery, logistics. Includes paying boda boda, tuk-tuk, or any vehicle for moving items between locations (e.g. "carrying boards from timsales", "transport of marine boards", "delivery to site")',
    office_water_expense: 'Payment for office drinking water, water dispenser refills',
    supplier_payment: 'Payment to a supplier/vendor for goods or services, paybill, till number, merchant payment',
    customer_receipt: 'Money received from a customer/client',
    mpesa_charge: 'M-Pesa transaction charges/fees',
    cash_withdrawal: 'Cash withdrawal from M-Pesa agent',
    refunds: 'Refund — returning money to a customer/client, sales refund, reversing a payment, commission/token payment',
    outgoing_payment: 'General outgoing payment that doesn\'t fit other categories',
    bank_transfer: 'Transfer to/from a bank account',
    internal_transfer: 'Internal transfer between own accounts/numbers, money sent to/deposited into a bank account, moving funds to own bank',
    unknown: 'Unable to determine category',
};
const TRAINING_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'for',
    'from',
    'in',
    'into',
    'is',
    'of',
    'on',
    'or',
    'paid',
    'payment',
    'to',
    'the',
    'this',
    'that',
    'via',
    'with',
    'ya',
]);
function normalizeCategoryText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function getCategorizationText(input) {
    const noteText = String(input.notes || '').trim();
    const rawDetails = String(input.rawDetails || '').trim();
    const parts = [
        input.details,
        noteText,
        input.counterparty || '',
        rawDetails,
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    return {
        noteText,
        rawDetails,
        combined: parts.join(' '),
        detailsOnly: String(input.details || '').trim(),
        counterpartyOnly: String(input.counterparty || '').trim(),
    };
}
function extractCategoryCandidatesFromText(value) {
    const normalized = normalizeCategoryText(value);
    if (!normalized) {
        return [];
    }
    const candidates = [];
    for (const rule of OTHER_CATEGORY_KEYWORDS) {
        if (rule.patterns.some((pattern) => pattern.test(normalized))) {
            candidates.push(rule.category);
        }
    }
    return [...new Set(candidates)];
}
function scoreTrainingMatch(rule, text) {
    const sources = [
        ['notes', text.notes],
        ['details', text.details],
        ['counterparty', text.counterparty],
        ['raw', text.rawDetails],
        ['any', text.combined],
    ];
    const scopeTexts = sources.filter(([scope]) => rule.matchScope === scope || rule.matchScope === 'any');
    let matched = false;
    for (const [, scopeText] of scopeTexts) {
        if (scopeText && normalizeCategoryText(scopeText).includes(rule.matchText)) {
            matched = true;
            break;
        }
    }
    if (!matched) {
        return null;
    }
    const specificity = Math.min(30, rule.matchText.length);
    const sourceBoost = rule.source === 'manual' ? 10 : rule.source === 'review' ? 6 : 3;
    const scopeBoost = rule.matchScope === 'notes' ? 8 : rule.matchScope === 'details' ? 6 : rule.matchScope === 'counterparty' ? 5 : 2;
    const hitBoost = Math.min(8, Math.max(0, rule.hitCount - 1));
    return specificity + sourceBoost + scopeBoost + hitBoost;
}
async function loadActiveMpesaCategoryTrainingRules() {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id,
        match_scope,
        match_text,
        category,
        source,
        sample_text,
        confidence,
        active,
        hit_count,
        created_at,
        updated_at
      FROM mpesa_category_training_rules
      WHERE active = 1
      ORDER BY updated_at DESC, hit_count DESC, LENGTH(match_text) DESC
      LIMIT 250
    `);
    return rows
        .map((row) => ({
        id: row.id,
        matchScope: (['any', 'notes', 'details', 'counterparty', 'raw'].includes(row.match_scope)
            ? row.match_scope
            : 'any'),
        matchText: normalizeCategoryText(row.match_text),
        category: MPESA_CATEGORIES.includes(row.category)
            ? row.category
            : 'unknown',
        source: (['manual', 'ai', 'review'].includes(row.source) ? row.source : 'manual'),
        sampleText: row.sample_text || null,
        confidence: Number(row.confidence || 1) || 1,
        active: Boolean(row.active),
        hitCount: Number(row.hit_count || 1) || 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }))
        .filter((row) => Boolean(row.matchText) && row.category !== 'unknown');
}
function buildTrainingPhraseCandidates(input) {
    const text = getCategorizationText(input);
    const noteTokens = normalizeCategoryText(text.noteText)
        .split(' ')
        .filter((token) => token && !TRAINING_STOP_WORDS.has(token));
    const detailTokens = normalizeCategoryText(text.detailsOnly)
        .split(' ')
        .filter((token) => token && !TRAINING_STOP_WORDS.has(token));
    const counterpartyTokens = normalizeCategoryText(text.counterpartyOnly)
        .split(' ')
        .filter((token) => token && !TRAINING_STOP_WORDS.has(token));
    const combinedTokens = normalizeCategoryText(text.combined)
        .split(' ')
        .filter((token) => token && !TRAINING_STOP_WORDS.has(token));
    const candidates = [];
    if (text.noteText) {
        const candidate = normalizeCategoryText(text.noteText);
        if (candidate.length >= 3) {
            candidates.push({ matchScope: 'notes', matchText: candidate.slice(0, 80), sampleText: text.noteText });
        }
        if (noteTokens.length >= 2) {
            candidates.push({
                matchScope: 'notes',
                matchText: noteTokens.slice(0, 4).join(' '),
                sampleText: text.noteText,
            });
        }
    }
    if (detailTokens.length >= 2) {
        candidates.push({
            matchScope: 'details',
            matchText: detailTokens.slice(0, 4).join(' '),
            sampleText: text.detailsOnly,
        });
    }
    if (counterpartyTokens.length >= 2) {
        candidates.push({
            matchScope: 'counterparty',
            matchText: counterpartyTokens.slice(0, 4).join(' '),
            sampleText: text.counterpartyOnly,
        });
    }
    if (combinedTokens.length >= 2) {
        candidates.push({
            matchScope: 'any',
            matchText: combinedTokens.slice(0, 4).join(' '),
            sampleText: text.combined,
        });
    }
    return candidates
        .map((candidate) => ({
        ...candidate,
        matchText: candidate.matchText.trim(),
        sampleText: candidate.sampleText.trim(),
    }))
        .filter((candidate, index, list) => {
        if (!candidate.matchText || candidate.matchText.length < 3) {
            return false;
        }
        return list.findIndex((entry) => entry.matchScope === candidate.matchScope && entry.matchText === candidate.matchText) === index;
    });
}
async function saveMpesaCategoryTrainingRule(input) {
    const normalizedMatchText = normalizeCategoryText(input.matchText);
    if (!normalizedMatchText || normalizedMatchText.length < 3) {
        return;
    }
    const id = `${input.matchScope}:${normalizedMatchText}:${input.category}`;
    const dialect = (0, db_1.getDatabaseDialect)();
    const source = input.source || 'manual';
    const confidence = Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, Number(input.confidence))) : 1;
    if (dialect === 'mysql') {
        await (0, db_1.execute)(`
        INSERT INTO mpesa_category_training_rules (
          id, match_scope, match_text, category, source, sample_text, confidence, active, hit_count, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          source = VALUES(source),
          sample_text = VALUES(sample_text),
          confidence = GREATEST(confidence, VALUES(confidence)),
          active = 1,
          hit_count = hit_count + 1,
          updated_at = CURRENT_TIMESTAMP
      `, [id, input.matchScope, normalizedMatchText, input.category, source, input.sampleText.slice(0, 1000), confidence]);
        return;
    }
    await (0, db_1.execute)(`
      INSERT INTO mpesa_category_training_rules (
        id, match_scope, match_text, category, source, sample_text, confidence, active, hit_count, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(match_scope, match_text, category)
      DO UPDATE SET
        source = excluded.source,
        sample_text = excluded.sample_text,
        confidence = MAX(confidence, excluded.confidence),
        active = 1,
        hit_count = hit_count + 1,
        updated_at = CURRENT_TIMESTAMP
    `, [id, input.matchScope, normalizedMatchText, input.category, source, input.sampleText.slice(0, 1000), confidence]);
}
async function trainMpesaCategoryFromTransaction(input) {
    const candidates = buildTrainingPhraseCandidates(input);
    if (candidates.length === 0) {
        return;
    }
    const preferred = candidates.find((candidate) => candidate.matchScope === 'notes') ||
        candidates.find((candidate) => candidate.matchScope === 'details') ||
        candidates[0];
    if (!preferred) {
        return;
    }
    await saveMpesaCategoryTrainingRule({
        category: input.category,
        matchScope: preferred.matchScope,
        matchText: preferred.matchText,
        sampleText: preferred.sampleText,
        source: input.source || 'manual',
        confidence: input.source === 'ai' ? 0.7 : 1,
    });
}
const TRANSPORT_KEYWORD_RULES = [
    // ── TIER 1: Explicit transport vehicle mentions (strongest signals) ──
    {
        pattern: /\b(tuk[ -]?tuk|tuktuk|tuk tuk)\b/i,
        weight: 10,
        label: 'Mentions tuk-tuk (three-wheeler transport)',
    },
    {
        pattern: /\b(boda[ -]?boda|bodaboda|boda boda)\b/i,
        weight: 10,
        label: 'Mentions boda boda (motorcycle transport)',
    },
    {
        pattern: /\b(lorry|lorries|matatu|matatus|pick[ -]?up|pickup)\b/i,
        weight: 9,
        label: 'Mentions lorry/matatu/pickup vehicle',
    },
    {
        pattern: /\b(taxi|uber|bolt|little ride|nduthi|motorbike|motorcycle)\b/i,
        weight: 8,
        label: 'Mentions taxi/uber/bolt/motorcycle',
    },
    {
        pattern: /\b(truck|trailer|canter|fuso|mitsubishi|isuzu|hiace|nissan|probox)\b/i,
        weight: 9,
        label: 'Mentions truck/canter/transport vehicle brand',
    },
    {
        pattern: /\b(driver|turnboy|loader|conductor|rider)\b/i,
        weight: 7,
        label: 'Mentions driver/turnboy/loader/conductor/rider',
    },
    {
        pattern: /\b(pick[ -]?up|pickup)\b.*\b(load|loaded|loading|carry|carrying|board|goods|material)\b/i,
        weight: 9,
        label: 'Pickup loading/carrying goods or boards',
    },
    {
        pattern: /\b(load|loaded|loading|carry|carrying)\b.*\b(pick[ -]?up|pickup)\b/i,
        weight: 9,
        label: 'Loading/carrying onto a pickup',
    },
    // ── TIER 2: Transport action words ──
    {
        pattern: /\b(transport|transporting|transportation|delivery|delivering|deliveries)\b/i,
        weight: 9,
        label: 'Mentions transport/delivery explicitly',
    },
    {
        pattern: /\b(carrying|carry|carried|ferrying|ferry|hauling|haul|bringing|bring)\b/i,
        weight: 8,
        label: 'Mentions carrying/ferrying/hauling/bringing goods',
    },
    {
        pattern: /\b(loading|offloading|load|offload|unload|unloading)\b/i,
        weight: 6,
        label: 'Mentions loading/offloading',
    },
    {
        pattern: /\b(moving|move|moved|shifting|shift)\s+(goods|items|boards|materials?|stock|supplies)\b/i,
        weight: 8,
        label: 'Mentions moving/shifting goods/materials',
    },
    {
        pattern: /\b(collection|collecting|collect|pick[ -]?up|drop[ -]?off)\b.*\b(from|to|at)\b/i,
        weight: 6,
        label: 'Mentions collection/pickup/drop-off with location',
    },
    // ── TIER 3: Goods/materials being transported ──
    {
        pattern: /\b(boards?|timber|marine\s*boards?|plywood|mdf|chipboard|lumber|hardwood|softwood)\b.*\b(carry|transport|deliver|load|from)\b/i,
        weight: 8,
        label: 'Mentions boards/timber being carried/transported',
    },
    {
        pattern: /\b(carry|transport|deliver|load|from)\b.*\b(boards?|timber|marine\s*boards?|plywood|mdf|chipboard|lumber)\b/i,
        weight: 8,
        label: 'Transport action combined with boards/timber',
    },
    // ── TIER 4: Location-based transport indicators ──
    {
        pattern: /\b(from|to)\s+(timsales|comp[iy]ly|kikomi|industrial\s*area|mombasa\s*road|lunga\s*lunga|jkia|airport|nakuru|mombasa|kisumu|eldoret)\b/i,
        weight: 5,
        label: 'Mentions transport between known locations',
    },
    {
        pattern: /\b(from|to)\s+\w+\b.*\b(carry|transport|deliver|move|send)\b/i,
        weight: 5,
        label: 'Location-to-location transport action',
    },
    // ── TIER 5: Transport cost/payment patterns ──
    {
        pattern: /\b(fuel|diesel|petrol|gasoline|fueling)\b/i,
        weight: 6,
        label: 'Mentions fuel/diesel/petrol (often transport-related)',
    },
    {
        pattern: /\b(road\s*(toll|fee)|parking|weighbridge)\b/i,
        weight: 5,
        label: 'Mentions road toll/parking/weighbridge',
    },
    {
        pattern: /\b(per\s*(trip|load|delivery|board|item|km|kilometer))\b/i,
        weight: 5,
        label: 'Per-trip or per-load pricing',
    },
    // ── TIER 6: Paying for transport ──
    {
        pattern: /\b(pay|paying|paid|payment)\b.*\b(transport|fare|delivery|boda|tuk[ -]?tuk|lorry|truck|driver)\b/i,
        weight: 7,
        label: 'Payment explicitly for transport/delivery',
    },
    {
        pattern: /\b(pay|paying|paid)\s+\w+\s+(for|wa)\s+(transport|fare|delivery|carrying)\b/i,
        weight: 7,
        label: 'Paying someone for transport/carrying',
    },
    {
        pattern: /\b(pay|paying|paid)\s+(lakeland|driver|boda|tuk)\b/i,
        weight: 7,
        label: 'Paying a transport provider by name/keyword',
    },
    // ── TIER 7: Kenyan transport context ──
    {
        pattern: /\b(stage|bus\s*stop|bus\s*stage|terminus)\b/i,
        weight: 4,
        label: 'Mentions stage/bus stop/terminus',
    },
    {
        pattern: /\b(site|workshop|factory|warehouse|godown|yard)\b.*\b(delivery|transport|carry|move)\b/i,
        weight: 5,
        label: 'Site/factory/warehouse delivery context',
    },
];
const OTHER_CATEGORY_KEYWORDS = [
    {
        category: 'staff_lunch_expense',
        patterns: [
            /\b(lunch|food|meal|eating|breakfast|dinner|supper|snacks?|chai|tea)\b/i,
            /\b(restaurant|cafe|hotel|kibandaski|eatery)\b/i,
            /\b(lunch|food)\s+(for|ya)\s+(staff|workers?|employees?|wafanyi)\b/i,
        ],
    },
    {
        category: 'staff_transport_expense',
        patterns: [
            /\b(staff|employee|worker)\b.*\b(transport|fare|boda|tuk|taxi|uber|matatu|bus)\b/i,
            /\b(transport|fare|boda|tuk|taxi|uber)\b.*\b(staff|employee|worker)\b/i,
        ],
    },
    {
        category: 'staff_overtime_expense',
        patterns: [
            /\b(overtime|ot\b|extra\s*hours|night\s*shift|weekend\s*work)\b/i,
            /\b(overtime\s*(done|worked|on))\b/i,
        ],
    },
    {
        category: 'advance_salary',
        patterns: [
            /\b(salary\s*advance|advance\s*salary|advance\s*pay|wages?\s*advance)\b/i,
        ],
    },
    {
        category: 'staff_loan',
        patterns: [
            /\b(loan|staff\s*loan|employee\s*loan|mkopo)\b/i,
        ],
    },
    {
        category: 'office_water_expense',
        patterns: [
            /\b(water|maifan|mineral\s*water|dispenser|drinking\s*water|aqua)\b/i,
        ],
    },
    {
        category: 'supplier_payment',
        patterns: [
            /\b(supplier|vendor|wholesale|distributor|merchant|till|paybill|pay\s*bill|buy\s*goods)\b/i,
            /\b(payment\s*(to|for)\s*(supplier|vendor|company))\b/i,
        ],
    },
    {
        category: 'mpesa_charge',
        patterns: [
            /\b(charge|charges|fee|fees|transaction\s*cost)\b/i,
        ],
    },
    {
        category: 'cash_withdrawal',
        patterns: [
            /\b(withdraw|withdrawal|cash\s*out|agent\s*withdraw)\b/i,
        ],
    },
    {
        category: 'refunds',
        patterns: [
            /\b(refund|refunds?|refunding|reversal|reversing|reverse|customer\s*refund|sales\s*refund)\b/i,
            /\b(token|commission)\s+(to|for|ya)\b/i,
            /\b(token|commission)\b/i,
        ],
    },
    {
        category: 'bank_transfer',
        patterns: [
            /\b(bank|kcb|equity|coop|cooperative|nbk|stanbic|absa|standard\s*chartered|ncba|dtb|family\s*bank)\b.*\b(transfer|send|deposit)\b/i,
            /\b(transfer|send)\b.*\b(bank|account)\b/i,
        ],
    },
    {
        category: 'internal_transfer',
        patterns: [
            /\b(own\s*(account|number)|between\s*(my|own|accounts))\b/i,
            /\b(sent|send|deposited|deposit)\s+(to|into|in)\s+(the\s+)?(bank|account|abc|kcb|equity|coop|stanbic|absa|ncba)\b/i,
            /\b(sent|send)\s+to\s+(the\s+)?bank\b/i,
            /\b(deposited|deposit)\s+(to|into|in)\b/i,
        ],
    },
];
// ─── AI Provider Configuration ──────────────────────────────────────────
const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
// ─── AI Prompt Builder ──────────────────────────────────────────────────
function buildCategoryPrompt(input) {
    const categoryList = MPESA_CATEGORIES.map((cat) => `  - "${cat}": ${CATEGORY_DESCRIPTIONS[cat]}`).join('\n');
    return [
        'You are an expert M-Pesa transaction categorizer for a Kenyan furniture manufacturing business (Urban Vibe Interior Design).',
        '',
        'Analyze the M-Pesa transaction below and assign the SINGLE best-fitting category.',
        'Return a JSON object with "category", "confidence" (0.0-1.0), and "reason" (brief explanation).',
        'Do NOT include markdown, code fences, or any text outside the JSON.',
        '',
        'CATEGORIES:',
        categoryList,
        '',
        'KEY GUIDELINES:',
        '- "transport_expense" is for moving GOODS/MATERIALS (e.g. carrying boards, delivering items, paying lorry/truck/tuktuk/boda/pickup for cargo, rider bringing equipment). Look for mentions of vehicles (tuktuk, lorry, truck, boda, pickup, canter, rider), carrying/transporting/delivering/loading materials, "pickup that loaded boards from...", or paying for fuel/delivery.',
        '- "staff_transport_expense" is for STAFF fare ONLY — a person traveling for work, NOT goods being moved.',
        '- "supplier_payment" is for paying a business/vendor/merchant for products/services (till, paybill, merchant payment).',
        '- "staff_lunch_expense" is for buying food/meals for staff (e.g. "lunch for staff").',
        '- "staff_overtime_expense" is for overtime payments to staff (e.g. "overtime done on 19th").',
        '- "advance_salary" is for salary advances to employees (e.g. "salary advance").',
        '- "customer_receipt" is money RECEIVED (paidIn), not sent.',
        '- "office_water_expense" is specifically for drinking water/dispenser refills.',
        '- "refunds" is for returning money (refunds, sales refund, reversal, commission/token payments e.g. "token to beatrice comply").',
        '- "internal_transfer" is for money sent/deposited to own bank accounts (e.g. "sent to the bank", "deposited to ABC bank").',
        '- "bank_transfer" is for transfers between different bank accounts.',
        '- If the note says refund/reversal/return money, choose "refunds" even when the transaction is an outgoing payment.',
        '- If the note mentions lunch/meal/food for staff, choose "staff_lunch_expense".',
        '- If the note is clearly describing a different business rule, trust the note first, then the details, then the counterparty, then raw details.',
        '- Use "unknown" only if genuinely ambiguous.',
        '',
        'TRANSACTION TO CATEGORIZE:',
        `  Details: ${input.details}`,
        input.notes ? `  Notes: ${input.notes}` : '',
        `  Counterparty: ${input.counterparty || 'N/A'}`,
        `  Direction: ${input.direction}`,
        `  Amount: ${input.amount !== null ? `KES ${input.amount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : 'N/A'}`,
        `  Phone: ${input.phoneNumber || 'N/A'}`,
        input.rawDetails ? `  Raw Notes: ${input.rawDetails}` : '',
        '',
        'Return ONLY valid JSON:',
    ].join('\n');
}
function categoryResponseSchema() {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'confidence', 'reason'],
        properties: {
            category: {
                type: 'string',
                enum: [...MPESA_CATEGORIES],
            },
            confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
            },
            reason: {
                type: 'string',
                maxLength: 300,
            },
        },
    };
}
/**
 * Analyze transaction text for transport-related keywords.
 * Returns detailed analysis including which rules matched and confidence.
 */
function analyzeTransportKeywords(input) {
    const combinedText = [
        input.details,
        input.counterparty || '',
        input.rawDetails || '',
    ]
        .filter(Boolean)
        .join(' ');
    const matchedRules = [];
    let totalWeight = 0;
    for (const rule of TRANSPORT_KEYWORD_RULES) {
        if (rule.pattern.test(combinedText)) {
            matchedRules.push({ label: rule.label, weight: rule.weight });
            totalWeight += rule.weight;
        }
    }
    // Determine sub-type
    let subType = 'unknown';
    if (matchedRules.length > 0) {
        const staffIndicators = /\b(staff|employee|worker|personal\s*transport|fare\s*for\s*(me|him|her))\b/i;
        const goodsIndicators = /\b(goods|boards?|timber|marine|materials?|items?|stock|supplies|delivery|carrying|loading|cargo|hauling)\b/i;
        const hasStaff = staffIndicators.test(combinedText);
        const hasGoods = goodsIndicators.test(combinedText);
        if (hasGoods && !hasStaff) {
            subType = 'goods_transport';
        }
        else if (hasStaff && !hasGoods) {
            subType = 'staff_transport';
        }
        else if (hasGoods && hasStaff) {
            subType = 'goods_transport'; // Default to goods if both present
        }
        else {
            // Check vehicle type for hint
            if (/\b(truck|lorry|canter|trailer|pick[ -]?up)\b/i.test(combinedText)) {
                subType = 'goods_transport';
            }
            else if (/\b(boda|tuk[ -]?tuk|taxi|uber|bolt|matatu)\b/i.test(combinedText)) {
                // Could be either; check for goods keywords nearby
                if (/\b(carry|deliver|goods|boards?|timber|material)\b/i.test(combinedText)) {
                    subType = 'goods_transport';
                }
                else {
                    subType = 'staff_transport';
                }
            }
        }
    }
    // Calculate confidence from weight
    // Max possible weight is sum of all rule weights ≈ 167
    // Use a logarithmic scale: confidence = min(1, log2(weight+1) / log2(maxWeight+1))
    const maxPossibleWeight = TRANSPORT_KEYWORD_RULES.reduce((sum, r) => sum + r.weight, 0);
    const confidence = totalWeight > 0
        ? Math.min(1, Math.log2(totalWeight + 1) / Math.log2(maxPossibleWeight + 1))
        : 0;
    return {
        isTransport: totalWeight >= 5, // Minimum threshold: at least one moderate signal
        confidence: Math.round(confidence * 100) / 100,
        matchedRules,
        totalWeight,
        subType,
    };
}
/**
 * Keyword-based fallback categorization for all categories.
 * Used when AI is unavailable or as a supplement.
 */
function categorizeByKeywords(input) {
    const combinedText = [
        input.details,
        input.notes || '',
        input.counterparty || '',
        input.rawDetails || '',
    ]
        .filter(Boolean)
        .join(' ');
    // First check transport (most nuanced)
    const transportAnalysis = analyzeTransportKeywords({
        details: input.details,
        counterparty: input.counterparty,
        rawDetails: input.rawDetails,
        direction: input.direction,
    });
    if (transportAnalysis.isTransport && transportAnalysis.confidence >= 0.3) {
        const category = transportAnalysis.subType === 'staff_transport'
            ? 'staff_transport_expense'
            : 'transport_expense';
        return {
            category,
            confidence: transportAnalysis.confidence,
            reason: `Matched transport keywords: ${transportAnalysis.matchedRules
                .slice(0, 3)
                .map((r) => r.label)
                .join('; ')}`,
            method: 'keyword',
        };
    }
    // Check other categories
    for (const rule of OTHER_CATEGORY_KEYWORDS) {
        const matchCount = rule.patterns.filter((p) => p.test(combinedText)).length;
        if (matchCount > 0) {
            const confidence = Math.min(0.85, 0.4 + matchCount * 0.2);
            const matchedPatterns = rule.patterns
                .filter((p) => p.test(combinedText))
                .slice(0, 2);
            return {
                category: rule.category,
                confidence: Math.round(confidence * 100) / 100,
                reason: `Matched keyword patterns: ${matchedPatterns.map((p) => p.source).join(', ')}`,
                method: 'keyword',
            };
        }
    }
    // Default based on direction
    if (input.direction === 'in' || (input.paidIn && input.paidIn > 0)) {
        return {
            category: 'customer_receipt',
            confidence: 0.3,
            reason: 'Default: incoming payment with no specific category match',
            method: 'keyword',
        };
    }
    if (input.direction === 'out' ||
        (input.withdrawn && input.withdrawn > 0)) {
        return {
            category: 'outgoing_payment',
            confidence: 0.3,
            reason: 'Default: outgoing payment with no specific category match',
            method: 'keyword',
        };
    }
    return {
        category: 'unknown',
        confidence: 0.1,
        reason: 'Unable to determine category from available text',
        method: 'keyword',
    };
}
async function resolveStrongCategorizationOverride(input) {
    const text = getCategorizationText(input);
    const manualCandidates = [];
    for (const category of extractCategoryCandidatesFromText(text.noteText)) {
        manualCandidates.push({
            category,
            confidence: 0.98,
            reason: `Note explicitly mentions ${CATEGORY_LABELS[category]}.`,
        });
    }
    for (const category of extractCategoryCandidatesFromText(text.detailsOnly)) {
        manualCandidates.push({
            category,
            confidence: 0.82,
            reason: `Details strongly match ${CATEGORY_LABELS[category]}.`,
        });
    }
    for (const category of extractCategoryCandidatesFromText(text.counterpartyOnly)) {
        manualCandidates.push({
            category,
            confidence: 0.72,
            reason: `Counterparty text suggests ${CATEGORY_LABELS[category]}.`,
        });
    }
    const trainingRules = await loadActiveMpesaCategoryTrainingRules().catch(() => []);
    let bestTraining = null;
    for (const rule of trainingRules) {
        const score = scoreTrainingMatch(rule, {
            notes: text.noteText,
            details: text.detailsOnly,
            counterparty: text.counterpartyOnly,
            rawDetails: text.rawDetails,
            combined: text.combined,
        });
        if (score === null) {
            continue;
        }
        const candidateConfidence = Math.max(0.6, Math.min(0.99, rule.confidence || 1));
        const reason = `Learned rule matched "${rule.sampleText || rule.matchText}".`;
        if (!bestTraining || score > bestTraining.score) {
            bestTraining = {
                category: rule.category,
                confidence: candidateConfidence,
                reason,
                score,
            };
        }
    }
    const sortedManual = manualCandidates.sort((left, right) => right.confidence - left.confidence);
    const bestManual = sortedManual[0] || null;
    if (!bestManual && !bestTraining) {
        return null;
    }
    const chosen = bestTraining && (!bestManual || bestTraining.score >= 20 || bestTraining.confidence > bestManual.confidence)
        ? bestTraining
        : bestManual;
    if (!chosen) {
        return null;
    }
    return {
        category: chosen.category,
        confidence: chosen.confidence,
        reason: chosen.reason,
    };
}
// ─── AI API Call Helpers ────────────────────────────────────────────────
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
    if (directStart < 0)
        return stripped;
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
        if (inString)
            continue;
        if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0)
                return stripped.slice(directStart, index + 1);
        }
    }
    return stripped.slice(directStart);
}
function isTextOnlyNvidiaModel(model) {
    return /^openai\/gpt-oss-/i.test(model.trim());
}
function defaultModelForProvider(provider) {
    switch (provider) {
        case 'nvidia': return 'openai/gpt-oss-20b';
        case 'gemini': return 'gemini-flash-latest';
        case 'anthropic': return 'claude-sonnet-4-5-20250929';
        case 'openrouter': return 'openai/gpt-4.1';
        case 'openai':
        default: return 'gpt-4.1';
    }
}
// ─── AI API Calls ───────────────────────────────────────────────────────
async function callOpenAiCompatibleCategoryApi(input) {
    const defaultUrl = input.provider === 'nvidia'
        ? NVIDIA_CHAT_URL
        : input.provider === 'openrouter'
            ? OPENROUTER_CHAT_URL
            : OPENAI_CHAT_URL;
    const endpoint = input.baseUrl
        ? `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`
        : defaultUrl;
    const body = {
        model: input.model,
        temperature: 0,
        max_tokens: 500,
        messages: [
            {
                role: 'user',
                content: input.provider === 'nvidia' && isTextOnlyNvidiaModel(input.model)
                    ? input.prompt
                    : [{ type: 'text', text: input.prompt }],
            },
        ],
    };
    if (input.provider !== 'nvidia') {
        body.response_format = { type: 'json_object' };
    }
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
            ...(input.provider === 'openrouter'
                ? {
                    'HTTP-Referer': 'https://app.urbanvibeinteriordesign.co.ke',
                    'X-Title': 'M-Pesa Categorization',
                }
                : {}),
        },
        body: JSON.stringify(body),
    });
    const responseJson = await response.json().catch(() => null);
    if (!response.ok) {
        const message = responseJson?.error?.message ||
            responseJson?.detail ||
            responseJson?.message ||
            JSON.stringify(responseJson || {}).slice(0, 500) ||
            `${input.provider} API returned HTTP ${response.status}.`;
        throw new Error(`${input.provider} API returned HTTP ${response.status}: ${message}`);
    }
    return extractChatOutputText(responseJson);
}
async function callGeminiCategoryApi(input) {
    const baseUrl = input.baseUrl.replace(/\/+$/, '') || GEMINI_BASE_URL;
    const endpoint = `${baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`;
    const response = await fetch(endpoint, {
        method: 'POST',
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
                    parts: [{ text: input.prompt }],
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
async function callAnthropicCategoryApi(input) {
    const endpoint = input.baseUrl
        ? `${input.baseUrl.replace(/\/+$/, '')}/messages`
        : ANTHROPIC_MESSAGES_URL;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'x-api-key': input.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: input.model,
            max_tokens: 500,
            temperature: 0,
            messages: [
                {
                    role: 'user',
                    content: [{ type: 'text', text: input.prompt }],
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
/**
 * Use AI to categorize an M-Pesa transaction based on its notes/details.
 *
 * Falls back to keyword-based categorization if:
 * - No AI provider is configured
 * - The AI call fails
 * - AI_INVOICE_EXTRACTION_ENABLED is not set
 *
 * @param input - Transaction details to categorize
 * @returns Categorization result with category, confidence, and reasoning
 */
async function categorizeWithAi(input) {
    // Always run keyword analysis for transport insights
    const transportAnalysis = analyzeTransportKeywords({
        details: input.details,
        counterparty: input.counterparty,
        rawDetails: input.rawDetails,
        direction: input.direction,
    });
    const strongOverride = await resolveStrongCategorizationOverride(input);
    if (strongOverride) {
        return {
            category: strongOverride.category,
            categoryLabel: CATEGORY_LABELS[strongOverride.category],
            confidence: strongOverride.confidence,
            reason: strongOverride.reason,
            method: 'keyword',
            transportAnalysis,
        };
    }
    // Try AI first
    const aiResult = await tryAiCategorization(input);
    if (aiResult) {
        return {
            ...aiResult,
            transportAnalysis,
        };
    }
    // Fallback to keyword-based
    const keywordResult = categorizeByKeywords({
        details: input.details,
        counterparty: input.counterparty,
        direction: input.direction,
        paidIn: input.paidIn,
        withdrawn: input.withdrawn,
        notes: input.notes,
        rawDetails: input.rawDetails,
    });
    return {
        ...keywordResult,
        categoryLabel: CATEGORY_LABELS[keywordResult.category],
        transportAnalysis,
    };
}
async function tryAiCategorization(input) {
    try {
        const settings = await (0, repositories_1.getSettings)();
        const config = settings?.ai;
        if (!config?.enabled || config.provider === 'disabled') {
            return null;
        }
        let apiKey = config.apiKeys?.[config.provider];
        let accessToken = '';
        let projectId = '';
        if (config.provider === 'gemini' && config.geminiOAuth?.connected) {
            try {
                const oauth = await (0, geminiOAuthService_1.getGeminiOAuthAccessToken)();
                accessToken = oauth.accessToken;
                projectId = oauth.projectId;
                apiKey = '';
            }
            catch (err) {
                console.warn('Google Gemini OAuth token refresh failed, attempting fallback to API Key if available:', err instanceof Error ? err.message : String(err));
                apiKey = config.apiKeys?.gemini || '';
            }
        }
        if (!apiKey && !accessToken)
            return null;
        const model = config.model?.trim() || defaultModelForProvider(config.provider);
        const prompt = buildCategoryPrompt({
            details: input.details,
            counterparty: input.counterparty,
            direction: input.direction,
            amount: input.direction === 'in' ? input.paidIn : input.withdrawn,
            phoneNumber: input.phoneNumber || null,
            notes: input.notes || null,
            rawDetails: input.rawDetails,
        });
        let outputText = '';
        if (config.provider === 'openai' || config.provider === 'nvidia' || config.provider === 'openrouter') {
            outputText = await callOpenAiCompatibleCategoryApi({
                provider: config.provider,
                apiKey,
                model,
                baseUrl: config.baseUrl,
                prompt,
            });
        }
        else if (config.provider === 'gemini') {
            outputText = await callGeminiCategoryApi({
                apiKey,
                accessToken,
                projectId,
                model,
                baseUrl: config.baseUrl,
                prompt,
            });
        }
        else if (config.provider === 'anthropic') {
            outputText = await callAnthropicCategoryApi({
                apiKey,
                model,
                baseUrl: config.baseUrl,
                prompt,
            });
        }
        if (!outputText)
            return null;
        const jsonText = extractJsonObjectText(outputText);
        const parsed = JSON.parse(jsonText);
        const category = MPESA_CATEGORIES.includes(parsed.category)
            ? parsed.category
            : 'unknown';
        const confidence = typeof parsed.confidence === 'number' &&
            parsed.confidence >= 0 &&
            parsed.confidence <= 1
            ? Math.round(parsed.confidence * 100) / 100
            : 0.5;
        const reason = typeof parsed.reason === 'string' && parsed.reason.trim()
            ? parsed.reason.trim().slice(0, 300)
            : `AI categorized as ${CATEGORY_LABELS[category]}`;
        return {
            category,
            categoryLabel: CATEGORY_LABELS[category],
            confidence,
            reason,
            method: 'ai',
            aiProvider: config.provider,
            aiModel: model,
        };
    }
    catch {
        return null;
    }
}
/**
 * Categorize multiple transactions in batch.
 * Respects rate limits by introducing delays between AI calls.
 */
async function categorizeBatchWithAi(transactions) {
    const results = [];
    const chunkSize = 5;
    for (let i = 0; i < transactions.length; i += chunkSize) {
        const chunk = transactions.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(chunk.map(async (tx) => {
            const result = await categorizeWithAi(tx);
            return { id: tx.id, ...result };
        }));
        results.push(...chunkResults);
        // Rate limiting: small delay between chunk calls
        if (i + chunkSize < transactions.length) {
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }
    return results;
}
// ─── Transport Keyword Extraction (Public API) ──────────────────────────
/**
 * Extract the key transport-indicating words from a transaction's notes.
 * Useful for displaying to users WHY something was categorized as Transport.
 */
function extractTransportIndicators(input) {
    const analysis = analyzeTransportKeywords({
        details: input.details,
        counterparty: input.counterparty,
        rawDetails: input.rawDetails,
        direction: 'out',
    });
    // Extract the actual matched words from the text
    const combinedText = [
        input.details,
        input.counterparty || '',
        input.rawDetails || '',
    ]
        .filter(Boolean)
        .join(' ');
    const indicators = [];
    // Extract specific transport keywords found in the text
    const transportTerms = [
        'tuktuk', 'tuk tuk', 'boda boda', 'bodaboda', 'boda',
        'lorry', 'truck', 'pickup', 'pick-up', 'canter', 'matatu',
        'transport', 'delivery', 'delivering', 'carrying', 'carry',
        'loading', 'offloading', 'ferrying', 'hauling',
        'fuel', 'diesel', 'petrol',
        'driver', 'turnboy', 'loader',
        'fare', 'trip',
    ];
    for (const term of transportTerms) {
        const regex = new RegExp(`\\b${term}\\b`, 'i');
        if (regex.test(combinedText)) {
            indicators.push(term);
        }
    }
    // Also add matched rule labels as insights
    if (analysis.matchedRules.length > 0) {
        for (const rule of analysis.matchedRules.slice(0, 3)) {
            if (!indicators.some((ind) => rule.label.toLowerCase().includes(ind.toLowerCase()))) {
                indicators.push(rule.label);
            }
        }
    }
    return [...new Set(indicators)].slice(0, 8);
}
/**
 * Get all transport-related keyword rules for display/analysis purposes.
 * Useful for admin UI to show what patterns are being detected.
 */
function getTransportKeywordRules() {
    return TRANSPORT_KEYWORD_RULES;
}
/**
 * Get all category definitions for display purposes.
 */
function getCategoryDefinitions() {
    return { ...CATEGORY_DESCRIPTIONS };
}
