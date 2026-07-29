"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_STOCK_CONFIG = exports.DEFAULT_PO_BILL_SCHEDULER_CONFIG = exports.DEFAULT_SCHEDULER_CONFIG = exports.DEFAULT_AI_EXTRACTION_CONFIG = exports.DEFAULT_PARSER_CONFIG = exports.DEFAULT_FIELD_MAPPINGS = void 0;
exports.createDefaultMailConfig = createDefaultMailConfig;
exports.safeJsonParse = safeJsonParse;
exports.createEmptyFieldMappings = createEmptyFieldMappings;
exports.resolveFieldMappings = resolveFieldMappings;
exports.getMissingFieldMappingLabels = getMissingFieldMappingLabels;
exports.resolveSignatureFieldMapping = resolveSignatureFieldMapping;
exports.formatOdooDateTime = formatOdooDateTime;
exports.sanitizeBaseUrl = sanitizeBaseUrl;
exports.getPreferredAppBaseUrl = getPreferredAppBaseUrl;
exports.toBoolean = toBoolean;
exports.hasOdooConfiguration = hasOdooConfiguration;
exports.isPdfAttachment = isPdfAttachment;
exports.isJobSummaryAttachment = isJobSummaryAttachment;
exports.sortAttachmentsNewestFirst = sortAttachmentsNewestFirst;
exports.formatDateTime = formatDateTime;
exports.formatFileSize = formatFileSize;
exports.getRelationLabel = getRelationLabel;
exports.sanitizeForLog = sanitizeForLog;
exports.truncate = truncate;
exports.renderTemplate = renderTemplate;
exports.buildProcessingLog = buildProcessingLog;
exports.normalizeMultilineText = normalizeMultilineText;
const dayjs_1 = __importDefault(require("dayjs"));
const timezone_1 = __importDefault(require("dayjs/plugin/timezone"));
const utc_1 = __importDefault(require("dayjs/plugin/utc"));
const env_1 = require("./env");
const shopFloorReporting_1 = require("./shopFloorReporting");
dayjs_1.default.extend(utc_1.default);
dayjs_1.default.extend(timezone_1.default);
exports.DEFAULT_FIELD_MAPPINGS = {
    edgeJsonField: 'x_studio_job_summary_edge_json',
    processedField: 'x_studio_job_summary_processed',
    processedAtField: 'x_studio_job_summary_last_processed_on',
    logField: 'x_studio_job_summary_processing_log',
    attachmentNameField: 'x_studio_last_job_summary_filename',
    attachmentIdField: 'x_studio_last_job_summary_attachment_id_1',
    previousJsonField: 'x_studio_previous_job_summary_json',
    signatureField: 'x_studio_job_summary_signature',
    stockProcessedField: 'x_studio_job_summary_stock_processed',
    stockSignatureField: 'x_studio_job_summary_stock_signature',
    deltaJsonField: 'x_studio_job_summary_delta_json',
};
exports.DEFAULT_PARSER_CONFIG = {
    filenameKeyword: 'job summary',
    sectionHeader: 'Edging Materials',
    stopHeadersCsv: '',
    productLinePattern: '^(.*?)(\\d+(?:\\.\\d+)?)\\s*mm$',
    thicknessLabel: 'Thickness',
    lengthLabel: 'Length',
    rollLengthLabel: 'Roll Length',
    postChatterOnSuccess: true,
    chatterTemplate: 'Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s).',
};
exports.DEFAULT_AI_EXTRACTION_CONFIG = {
    enabled: false,
    provider: 'disabled',
    model: 'gpt-4.1',
    baseUrl: '',
    confidenceThreshold: 0.75,
    maxImages: 3,
    apiKeys: {
        openai: '',
        nvidia: '',
        gemini: '',
        anthropic: '',
        openrouter: '',
    },
    ocr: {
        provider: 'disabled',
        enabled: false,
        model: 'nvidia/nemotron-ocr-v2',
        endpoint: 'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2',
        apiKey: '',
    },
};
exports.DEFAULT_SCHEDULER_CONFIG = {
    enabled: false,
    intervalMinutes: 15,
    batchSize: 15,
    confirmedFromDate: '2026-04-08 00:00:00',
    cronToken: '',
    useInProcessInterval: false,
};
exports.DEFAULT_PO_BILL_SCHEDULER_CONFIG = {
    enabled: false,
    intervalMinutes: 15,
    batchSize: 1,
    fromDate: '2026-01-01 00:00:00',
    cronToken: '',
    useInProcessInterval: false,
    maxRetryAttempts: 5,
    transientRetryHours: 2,
    retryBackoffHours: [12, 24, 48, 96, 168],
    stableSkipRetryDays: 14,
};
exports.DEFAULT_STOCK_CONFIG = {
    locationId: '',
    locationName: '',
    warehouseId: '',
    pickingTypeId: '',
    missingSoAlertUserLogin: '',
    missingComponentAlertUserLogin: '',
};
function positiveInteger(value, fallback) {
    const parsed = Number(value || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function numberedEnv(baseName, index) {
    return process.env[`${baseName}_${index}`] || '';
}
function createDefaultMailConfig() {
    const accounts = [];
    const primaryUsername = env_1.env.SMTP_USERNAME.trim();
    if (primaryUsername || env_1.env.SMTP_PASSWORD || env_1.env.SMTP_FROM_EMAIL.trim()) {
        accounts.push({
            label: 'Primary',
            username: primaryUsername,
            password: env_1.env.SMTP_PASSWORD,
            fromEmail: env_1.env.SMTP_FROM_EMAIL.trim() || primaryUsername,
            fromName: env_1.env.SMTP_FROM_NAME.trim() || 'Urban Vibe Access',
            enabled: Boolean(primaryUsername && env_1.env.SMTP_PASSWORD),
        });
    }
    for (let index = 2; index <= 10; index += 1) {
        const username = numberedEnv('SMTP_USERNAME', index).trim();
        const password = numberedEnv('SMTP_PASSWORD', index);
        const fromEmail = numberedEnv('SMTP_FROM_EMAIL', index).trim() || username;
        if (!username && !password && !fromEmail) {
            continue;
        }
        accounts.push({
            label: `Account ${index}`,
            username,
            password,
            fromEmail,
            fromName: numberedEnv('SMTP_FROM_NAME', index).trim() || env_1.env.SMTP_FROM_NAME.trim() || 'Urban Vibe Access',
            enabled: Boolean(username && password),
        });
    }
    if (!accounts.length) {
        accounts.push({
            label: 'Primary',
            username: '',
            password: '',
            fromEmail: env_1.env.SMTP_FROM_EMAIL.trim(),
            fromName: env_1.env.SMTP_FROM_NAME.trim() || 'Urban Vibe Access',
            enabled: false,
        });
    }
    return {
        transport: 'smtp',
        fallbackTransport: 'none',
        host: env_1.env.SMTP_HOST.trim(),
        port: positiveInteger(env_1.env.SMTP_PORT, 587),
        secure: env_1.env.SMTP_SECURE === 'true',
        requireTls: env_1.env.SMTP_REQUIRE_TLS === 'true',
        ignoreTls: env_1.env.SMTP_IGNORE_TLS === 'true',
        tlsRejectUnauthorized: env_1.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
        connectionTimeoutMs: positiveInteger(env_1.env.SMTP_CONNECTION_TIMEOUT_MS, 30000),
        greetingTimeoutMs: positiveInteger(env_1.env.SMTP_GREETING_TIMEOUT_MS, 30000),
        socketTimeoutMs: positiveInteger(env_1.env.SMTP_SOCKET_TIMEOUT_MS, 45000),
        testRecipient: '',
        accounts,
        automations: [
            { id: 'shop-floor-reminders', name: 'Shop-floor task reminders', systemKey: 'shop-floor-reminders', enabled: true, frequency: 'hourly', interval: 1, dayOfWeek: 1, hour: 8, recipients: '', subject: '', body: '', lastSentAt: '' },
            { id: 'weekly-shop-floor-report', name: 'Weekly shop-floor accountability report', systemKey: 'weekly-shop-floor-report', enabled: true, frequency: 'weekly', interval: 1, dayOfWeek: 3, hour: 8, recipients: '', subject: 'Wednesday Shop Floor Accountability Report', body: '', lastSentAt: '' },
            { id: 'mpesa-review', name: 'M-Pesa review pending', systemKey: 'mpesa-review', enabled: true, frequency: 'daily', interval: 1, dayOfWeek: 1, hour: 9, recipients: 'charles@urbanvibeinteriordesign.co.ke', subject: '', body: '', lastSentAt: '' },
            { id: 'mo-overtime', name: 'Large MO overtime suggestion', systemKey: 'mo-overtime', enabled: true, frequency: 'daily', interval: 1, dayOfWeek: 1, hour: 8, recipients: '', subject: '', body: '', lastSentAt: '' },
        ],
        shopFloorReportingStartDate: shopFloorReporting_1.SHOP_FLOOR_REPORTING_START_DATE,
    };
}
function safeJsonParse(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function createEmptyFieldMappings() {
    return {
        edgeJsonField: '',
        processedField: '',
        processedAtField: '',
        logField: '',
        attachmentNameField: '',
        attachmentIdField: '',
        previousJsonField: '',
        signatureField: '',
        stockProcessedField: '',
        stockSignatureField: '',
        deltaJsonField: '',
    };
}
function resolveFieldMappings(configured, availableFields) {
    const availableNames = new Set(availableFields.map((field) => field.name));
    const merged = {
        ...createEmptyFieldMappings(),
        ...(configured || {}),
    };
    return Object.keys(createEmptyFieldMappings()).reduce((accumulator, key) => {
        const configuredValue = merged[key].trim();
        if (configuredValue) {
            accumulator[key] = availableNames.has(configuredValue) ? configuredValue : '';
            return accumulator;
        }
        const defaultValue = exports.DEFAULT_FIELD_MAPPINGS[key].trim();
        accumulator[key] = availableNames.has(defaultValue) ? defaultValue : '';
        return accumulator;
    }, createEmptyFieldMappings());
}
function getMissingFieldMappingLabels(mappings) {
    const labels = {
        edgeJsonField: 'Edge JSON Field',
        processedField: 'Processed Field',
        processedAtField: 'Processed Date Field',
        logField: 'Log Field',
        attachmentNameField: 'Attachment Name Field',
        attachmentIdField: 'Attachment ID Field',
        previousJsonField: 'Previous JSON Field',
        signatureField: 'Signature Field',
        stockProcessedField: 'Stock Processed Field',
        stockSignatureField: 'Stock Signature Field',
        deltaJsonField: 'Stock Adjustment Input JSON Field',
    };
    return Object.keys(labels)
        .filter((key) => !mappings[key].trim())
        .map((key) => labels[key]);
}
function resolveSignatureFieldMapping(mappings) {
    return mappings.signatureField.trim();
}
function formatOdooDateTime(value) {
    return (0, dayjs_1.default)(value).utc().format('YYYY-MM-DD HH:mm:ss');
}
function sanitizeBaseUrl(value) {
    return value.trim().replace(/\/+$/, '');
}
function getPreferredAppBaseUrl(req) {
    const configured = sanitizeBaseUrl(env_1.env.APP_BASE_URL || '');
    const forwardedHost = req.get('x-forwarded-host');
    const host = forwardedHost || req.get('host') || '';
    const forwardedProto = req.get('x-forwarded-proto');
    const protocol = (forwardedProto || req.protocol || 'https').split(',')[0].trim() || 'https';
    const requestOrigin = host ? `${protocol}://${host}` : '';
    if (requestOrigin) {
        return requestOrigin;
    }
    if (configured) {
        return configured;
    }
    return 'https://app.urbanvibeinteriordesign.co.ke';
}
function toBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    return String(value).toLowerCase() === 'true';
}
function hasOdooConfiguration(settings) {
    return Boolean(settings.odoo.baseUrl.trim() && settings.odoo.username.trim() && settings.odoo.apiKey.trim());
}
function isPdfAttachment(attachment) {
    return (attachment.name.toLowerCase().endsWith('.pdf') ||
        String(attachment.mimetype || '').toLowerCase() === 'application/pdf');
}
function isJobSummaryAttachment(attachment, keyword) {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!isPdfAttachment(attachment)) {
        return false;
    }
    if (!normalizedKeyword) {
        return true;
    }
    return attachment.name.toLowerCase().includes(normalizedKeyword);
}
function sortAttachmentsNewestFirst(a, b) {
    const aDate = new Date(a.write_date || a.create_date || 0).getTime();
    const bDate = new Date(b.write_date || b.create_date || 0).getTime();
    if (aDate !== bDate) {
        return bDate - aDate;
    }
    return b.id - a.id;
}
function formatDateTime(value) {
    if (!value) {
        return '—';
    }
    const withoutTimezoneSuffix = String(value).replace(/\s+GMT[+-]\d{4}\s+\([^)]+\)$/i, '');
    if (withoutTimezoneSuffix !== value) {
        return withoutTimezoneSuffix;
    }
    const hasTimezoneMarker = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
    const date = hasTimezoneMarker
        ? (0, dayjs_1.default)(value).tz(env_1.env.APP_TIMEZONE)
        : dayjs_1.default.utc(value).tz(env_1.env.APP_TIMEZONE);
    return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : value;
}
function formatFileSize(value) {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return '—';
    }
    if (value < 1024) {
        return `${value} B`;
    }
    if (value < 1024 * 1024) {
        return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}
function getRelationLabel(value) {
    if (!value || !Array.isArray(value)) {
        return '—';
    }
    return value[1];
}
function sanitizeForLog(input) {
    const replacer = (value) => {
        if (Array.isArray(value)) {
            return value.map(replacer);
        }
        if (value && typeof value === 'object') {
            return Object.entries(value).reduce((accumulator, [key, nestedValue]) => {
                if (/(api.?key|authorization|token|password|datas|content)/i.test(key)) {
                    accumulator[key] = '[REDACTED]';
                }
                else {
                    accumulator[key] = replacer(nestedValue);
                }
                return accumulator;
            }, {});
        }
        if (typeof value === 'string') {
            return value.replace(/[\u0000-\u001f\u007f]/g, ' ');
        }
        return value;
    };
    const safeValue = replacer(input);
    return safeValue && typeof safeValue === 'object'
        ? safeValue
        : { value: safeValue };
}
function truncate(value, length = 240) {
    if (value.length <= length) {
        return value;
    }
    return `${value.slice(0, length - 3)}...`;
}
function renderTemplate(template, data) {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => {
        return String(data[key] ?? '');
    });
}
function buildProcessingLog(payload, attachmentName, historyId) {
    const timestamp = (0, dayjs_1.default)().tz(env_1.env.APP_TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
    const lines = [
        `Processed at: ${timestamp}`,
        `Timezone: ${env_1.env.APP_TIMEZONE}`,
        `History ID: ${historyId}`,
        `Attachment: ${attachmentName}`,
        `Section found: ${payload.sectionFound ? 'yes' : 'no'}`,
        `Items extracted: ${payload.items.length}`,
    ];
    if (payload.logs.length > 0) {
        lines.push('', 'Parser logs:');
        lines.push(...payload.logs.map((entry) => `- ${entry}`));
    }
    return lines.join('\n');
}
function normalizeMultilineText(value) {
    return value
        .replace(/\u00a0/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}
