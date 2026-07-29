"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const repositories_1 = require("../models/repositories");
const logService_1 = require("../services/logService");
const mailTransport_1 = require("../services/mailTransport");
const odooClient_1 = require("../services/odooClient");
const payrollBridgeService_1 = require("../services/payrollBridgeService");
const helpers_1 = require("../utils/helpers");
const shopFloorReporting_1 = require("../utils/shopFloorReporting");
const router = (0, express_1.Router)();
const NVIDIA_AI_MODELS = [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
    'meta/llama-3.2-90b-vision-instruct',
    'meta/llama-3.2-11b-vision-instruct',
];
const GEMINI_AI_MODELS = ['gemini-flash-latest', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro'];
const OPENAI_AI_MODELS = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o'];
const KNOWN_PROVIDER_MODELS = [...NVIDIA_AI_MODELS, ...GEMINI_AI_MODELS, ...OPENAI_AI_MODELS];
function normalizeAiModelForProvider(provider, model) {
    const trimmed = model.trim();
    if (provider === 'gemini' && (!trimmed || NVIDIA_AI_MODELS.includes(trimmed) || OPENAI_AI_MODELS.includes(trimmed))) {
        return 'gemini-flash-latest';
    }
    if (provider === 'nvidia' && (!trimmed || GEMINI_AI_MODELS.includes(trimmed) || OPENAI_AI_MODELS.includes(trimmed))) {
        return 'openai/gpt-oss-20b';
    }
    if (provider === 'openai' && (!trimmed || NVIDIA_AI_MODELS.includes(trimmed) || GEMINI_AI_MODELS.includes(trimmed))) {
        return 'gpt-4.1';
    }
    return trimmed;
}
const credentialValidators = [
    (0, express_validator_1.body)('baseUrl').trim().notEmpty().withMessage('Odoo Base URL is required.').isURL({
        require_protocol: true,
    }),
    (0, express_validator_1.body)('database').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('username').trim().notEmpty().withMessage('Username is required.'),
    (0, express_validator_1.body)('apiKey').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('clearStoredApiKey').optional({ values: 'falsy' }).trim(),
];
const mappingValidators = [
    (0, express_validator_1.body)('edgeJsonField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('processedField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('processedAtField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('logField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('attachmentNameField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('attachmentIdField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('previousJsonField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('signatureField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('stockProcessedField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('stockSignatureField').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('deltaJsonField').optional({ values: 'falsy' }).trim(),
];
const parserValidators = [
    (0, express_validator_1.body)('filenameKeyword').trim().notEmpty().withMessage('Filename keyword is required.'),
    (0, express_validator_1.body)('sectionHeader').trim().notEmpty().withMessage('Section header is required.'),
    (0, express_validator_1.body)('productLinePattern').trim().notEmpty().withMessage('Product line regex is required.'),
    (0, express_validator_1.body)('thicknessLabel').trim().notEmpty().withMessage('Thickness label is required.'),
    (0, express_validator_1.body)('lengthLabel').trim().notEmpty().withMessage('Length label is required.'),
    (0, express_validator_1.body)('rollLengthLabel').trim().notEmpty().withMessage('Roll length label is required.'),
];
const aiValidators = [
    (0, express_validator_1.body)('aiEnabled').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('aiProvider').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('aiModelPreset').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('aiModel').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('aiBaseUrl').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('aiConfidenceThreshold').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('aiMaxImages').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('openaiApiKey').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('nvidiaApiKey').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('geminiApiKey').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('anthropicApiKey').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('openrouterApiKey').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('ocrProvider').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('ocrEnabled').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('ocrModel').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('ocrEndpoint').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('ocrApiKey').optional({ values: 'falsy' }).trim(),
];
const schedulerValidators = [
    (0, express_validator_1.body)('schedulerEnabled').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('schedulerIntervalMinutes').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('schedulerBatchSize').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('schedulerConfirmedFromDate').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('schedulerCronToken').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('schedulerUseInProcessInterval').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerEnabled').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerIntervalMinutes').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerBatchSize').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerFromDate').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerCronToken').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerUseInProcessInterval').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerMaxRetryAttempts').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerTransientRetryHours').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerRetryBackoffHours').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('poBillSchedulerStableSkipRetryDays').optional({ values: 'falsy' }).trim(),
];
const stockValidators = [
    (0, express_validator_1.body)('stockLocationId').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('stockLocationName').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('stockWarehouseId').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('stockPickingTypeId').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('stockMissingSoAlertUserLogin').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('stockMissingComponentAlertUserLogin').optional({ values: 'falsy' }).trim(),
];
const mailValidators = [
    (0, express_validator_1.body)('mailPreset').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('mailTransport').optional({ values: 'falsy' }).isIn(['smtp']).withMessage('Mail transport must be SMTP.'),
    (0, express_validator_1.body)('mailFallbackTransport')
        .optional({ values: 'falsy' })
        .isIn(['none'])
        .withMessage('Mail fallback transport must be none.'),
    (0, express_validator_1.body)('mailHost').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('mailPort').optional({ values: 'falsy' }).isInt({ min: 1, max: 65535 }).withMessage('SMTP port must be between 1 and 65535.'),
    (0, express_validator_1.body)('mailConnectionTimeoutMs')
        .optional({ values: 'falsy' })
        .isInt({ min: 1000, max: 300000 })
        .withMessage('Connection timeout must be between 1000 and 300000 ms.'),
    (0, express_validator_1.body)('mailGreetingTimeoutMs')
        .optional({ values: 'falsy' })
        .isInt({ min: 1000, max: 300000 })
        .withMessage('Greeting timeout must be between 1000 and 300000 ms.'),
    (0, express_validator_1.body)('mailSocketTimeoutMs')
        .optional({ values: 'falsy' })
        .isInt({ min: 1000, max: 300000 })
        .withMessage('Socket timeout must be between 1000 and 300000 ms.'),
    (0, express_validator_1.body)('mailTestRecipient').optional({ values: 'falsy' }).trim().isEmail().withMessage('Enter a valid test recipient email.'),
    (0, express_validator_1.body)('shopFloorReportingStartDate')
        .optional({ values: 'falsy' })
        .trim()
        .isISO8601({ strict: true, strictSeparator: true })
        .withMessage('Shop-floor reporting start date must be a valid date.'),
    ...Array.from({ length: 5 }, (_value, index) => {
        const accountNumber = index + 1;
        return [
            (0, express_validator_1.body)(`mailAccount${accountNumber}Label`).optional({ values: 'falsy' }).trim(),
            (0, express_validator_1.body)(`mailAccount${accountNumber}Username`).optional({ values: 'falsy' }).trim(),
            (0, express_validator_1.body)(`mailAccount${accountNumber}Password`).optional({ values: 'falsy' }).trim(),
            (0, express_validator_1.body)(`mailAccount${accountNumber}FromEmail`)
                .optional({ values: 'falsy' })
                .trim()
                .isEmail()
                .withMessage(`Account ${accountNumber} From Email must be valid.`),
            (0, express_validator_1.body)(`mailAccount${accountNumber}FromName`).optional({ values: 'falsy' }).trim(),
        ];
    }).flat(),
];
const payrollBridgeValidators = [
    (0, express_validator_1.body)('payrollBridgeUrl')
        .optional({ values: 'falsy' })
        .trim()
        .isURL({ require_protocol: true })
        .withMessage('Payroll bridge URL must include http:// or https://.'),
    (0, express_validator_1.body)('payrollBridgeToken').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('payrollAdvanceSource').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('payrollAutoCreatePayRun').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('payrollSalaryStructure').optional({ values: 'falsy' }).trim(),
    (0, express_validator_1.body)('payrollPayRunNameTemplate').optional({ values: 'falsy' }).trim(),
];
const validators = [
    ...credentialValidators,
    ...mappingValidators,
    ...parserValidators,
    ...aiValidators,
    ...schedulerValidators,
    ...stockValidators,
];
const MAIL_ACCOUNT_FORM_COUNT = 5;
const EMAIL_AUTOMATION_FORM_COUNT = 20;
function hasMailSource(source) {
    return Object.keys(source).some((key) => key.startsWith('mail'));
}
function boolFromSource(source, key, fallback, submitted) {
    if (!submitted) {
        return fallback;
    }
    return source[key] === 'on' || source[key] === 'true';
}
function positiveNumberFromSource(source, key, fallback) {
    const parsed = Number(source[key] || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function parseRetryBackoffHours(value) {
    const parsed = String(value || '')
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0)
        .slice(0, 10);
    return parsed.length ? parsed : [12, 24, 48, 96, 168];
}
function applyMailPreset(mail, preset) {
    if (preset === 'zoho-587') {
        return {
            ...mail,
            transport: 'smtp',
            fallbackTransport: 'none',
            host: 'smtp.zoho.com',
            port: 587,
            secure: false,
            requireTls: true,
            ignoreTls: false,
        };
    }
    if (preset === 'zoho-465') {
        return {
            ...mail,
            transport: 'smtp',
            fallbackTransport: 'none',
            host: 'smtp.zoho.com',
            port: 465,
            secure: true,
            requireTls: false,
            ignoreTls: false,
        };
    }
    if (preset === 'cpanel-465') {
        return {
            ...mail,
            transport: 'smtp',
            fallbackTransport: 'none',
            port: 465,
            secure: true,
            requireTls: false,
            ignoreTls: false,
        };
    }
    return mail;
}
function detectMailPreset(mail) {
    if (mail.host === 'smtp.zoho.com' && mail.port === 587 && !mail.secure && mail.requireTls) {
        return 'zoho-587';
    }
    if (mail.host === 'smtp.zoho.com' && mail.port === 465 && mail.secure) {
        return 'zoho-465';
    }
    return 'custom';
}
function buildMailConfigFromSource(source, existing) {
    const submitted = hasMailSource(source);
    const accounts = [];
    for (let index = 0; index < MAIL_ACCOUNT_FORM_COUNT; index += 1) {
        const accountNumber = index + 1;
        const existingAccount = existing.accounts[index] || {
            label: accountNumber === 1 ? 'Primary' : `Account ${accountNumber}`,
            username: '',
            password: '',
            fromEmail: '',
            fromName: existing.accounts[0]?.fromName || 'Urban Vibe Access',
            enabled: false,
        };
        const username = (source[`mailAccount${accountNumber}Username`] ?? existingAccount.username).trim();
        const submittedPassword = (source[`mailAccount${accountNumber}Password`] || '').trim();
        const password = source[`mailAccount${accountNumber}ClearPassword`] === 'on'
            ? ''
            : submittedPassword || existingAccount.password || '';
        const fromEmail = (source[`mailAccount${accountNumber}FromEmail`] ?? existingAccount.fromEmail).trim();
        accounts.push({
            label: (source[`mailAccount${accountNumber}Label`] ?? (existingAccount.label || `Account ${accountNumber}`)).trim(),
            username,
            password: username ? password : '',
            fromEmail: fromEmail || username,
            fromName: (source[`mailAccount${accountNumber}FromName`] ?? (existingAccount.fromName || 'Urban Vibe Access')).trim(),
            enabled: boolFromSource(source, `mailAccount${accountNumber}Enabled`, existingAccount.enabled, submitted),
        });
    }
    const mail = applyMailPreset({
        ...existing,
        transport: 'smtp',
        fallbackTransport: 'none',
        host: (source.mailHost ?? existing.host).trim(),
        port: positiveNumberFromSource(source, 'mailPort', existing.port || 587),
        secure: boolFromSource(source, 'mailSecure', existing.secure, submitted),
        requireTls: boolFromSource(source, 'mailRequireTls', existing.requireTls, submitted),
        ignoreTls: boolFromSource(source, 'mailIgnoreTls', existing.ignoreTls, submitted),
        tlsRejectUnauthorized: boolFromSource(source, 'mailTlsRejectUnauthorized', existing.tlsRejectUnauthorized, submitted),
        connectionTimeoutMs: positiveNumberFromSource(source, 'mailConnectionTimeoutMs', existing.connectionTimeoutMs || 30000),
        greetingTimeoutMs: positiveNumberFromSource(source, 'mailGreetingTimeoutMs', existing.greetingTimeoutMs || 30000),
        socketTimeoutMs: positiveNumberFromSource(source, 'mailSocketTimeoutMs', existing.socketTimeoutMs || 45000),
        testRecipient: (source.mailTestRecipient ?? (existing.testRecipient || '')).trim(),
        shopFloorReportingStartDate: (0, shopFloorReporting_1.normalizeShopFloorReportingStartDate)(source.shopFloorReportingStartDate ?? existing.shopFloorReportingStartDate),
        accounts,
        automations: hasMailSource(source) && source.mailAutomationCount !== undefined
            ? Array.from({ length: Math.min(EMAIL_AUTOMATION_FORM_COUNT, Math.max(0, Number(source.mailAutomationCount) || 0)) }, (_value, index) => {
                const number = index + 1;
                const current = existing.automations[index];
                const systemKey = (source[`mailAutomation${number}SystemKey`] || current?.systemKey || 'custom');
                const frequency = (source[`mailAutomation${number}Frequency`] || current?.frequency || 'daily');
                return {
                    id: (source[`mailAutomation${number}Id`] || current?.id || `custom-${Date.now()}-${number}`).replace(/[^a-zA-Z0-9_-]/g, ''),
                    name: (source[`mailAutomation${number}Name`] || current?.name || `Email ${number}`).trim(),
                    systemKey: ['shop-floor-reminders', 'weekly-shop-floor-report', 'mpesa-review', 'mo-overtime'].includes(systemKey) ? systemKey : 'custom',
                    enabled: source[`mailAutomation${number}Enabled`] === 'on',
                    frequency: ['hourly', 'daily', 'weekly'].includes(frequency) ? frequency : 'daily',
                    interval: Math.min(168, Math.max(1, Number(source[`mailAutomation${number}Interval`]) || 1)),
                    dayOfWeek: Math.min(6, Math.max(0, Number(source[`mailAutomation${number}DayOfWeek`]) || 0)),
                    hour: Math.min(23, Math.max(0, Number(source[`mailAutomation${number}Hour`]) || 0)),
                    recipients: (source[`mailAutomation${number}Recipients`] || '').trim(),
                    subject: (source[`mailAutomation${number}Subject`] || '').trim(),
                    body: source[`mailAutomation${number}Body`] || '',
                    lastSentAt: current?.id === source[`mailAutomation${number}Id`] ? current.lastSentAt : '',
                };
            }).filter((item, index) => item.name && source[`mailAutomation${index + 1}Remove`] !== 'on')
            : existing.automations,
    }, source.mailPreset || '');
    return {
        ...mail,
        transport: 'smtp',
        fallbackTransport: 'none',
        accounts: mail.accounts.map((account, index) => ({
            ...account,
            label: account.label || (index === 0 ? 'Primary' : `Account ${index + 1}`),
            fromName: account.fromName || 'Urban Vibe Access',
        })),
    };
}
function buildMailFormValues(source, existing) {
    const mail = hasMailSource(source) ? buildMailConfigFromSource(source, existing) : existing;
    const accounts = Array.from({ length: MAIL_ACCOUNT_FORM_COUNT }, (_value, index) => {
        const account = mail.accounts[index] || {
            label: index === 0 ? 'Primary' : `Account ${index + 1}`,
            username: '',
            password: '',
            fromEmail: '',
            fromName: mail.accounts[0]?.fromName || 'Urban Vibe Access',
            enabled: false,
        };
        return {
            index: index + 1,
            label: account.label,
            username: account.username,
            fromEmail: account.fromEmail,
            fromName: account.fromName,
            enabled: account.enabled,
            hasPassword: Boolean(account.password),
        };
    });
    return {
        mailPreset: source.mailPreset || detectMailPreset(mail),
        mailTransport: mail.transport,
        mailFallbackTransport: mail.fallbackTransport,
        mailHost: mail.host,
        mailPort: String(mail.port || 587),
        mailSecure: mail.secure,
        mailRequireTls: mail.requireTls,
        mailIgnoreTls: mail.ignoreTls,
        mailTlsRejectUnauthorized: mail.tlsRejectUnauthorized,
        mailConnectionTimeoutMs: String(mail.connectionTimeoutMs || 30000),
        mailGreetingTimeoutMs: String(mail.greetingTimeoutMs || 30000),
        mailSocketTimeoutMs: String(mail.socketTimeoutMs || 45000),
        mailTestRecipient: source.mailTestRecipient ?? mail.testRecipient,
        shopFloorReportingStartDate: source.shopFloorReportingStartDate ?? mail.shopFloorReportingStartDate,
        mailAccounts: accounts,
        mailAutomations: mail.automations,
    };
}
function hasPayrollBridgeSource(source) {
    return Object.keys(source).some((key) => key.startsWith('payroll'));
}
function buildPayrollBridgeConfigFromSource(source, existing) {
    const submitted = hasPayrollBridgeSource(source);
    const submittedToken = (source.payrollBridgeToken || '').trim();
    return {
        url: (source.payrollBridgeUrl ?? existing.url).trim(),
        token: source.clearPayrollBridgeToken === 'on'
            ? ''
            : submittedToken || existing.token || '',
        source: (source.payrollAdvanceSource ?? existing.source).trim() || 'app.urbanvibeinteriordesign.co.ke',
        autoCreatePayRun: boolFromSource(source, 'payrollAutoCreatePayRun', existing.autoCreatePayRun, submitted),
        salaryStructure: (source.payrollSalaryStructure ?? existing.salaryStructure).trim() || 'All',
        payRunNameTemplate: (source.payrollPayRunNameTemplate ?? existing.payRunNameTemplate).trim() || '{monthName} {year}',
    };
}
function buildPayrollBridgeFormValues(source, existing) {
    const payrollBridge = hasPayrollBridgeSource(source)
        ? buildPayrollBridgeConfigFromSource(source, existing)
        : existing;
    return {
        payrollBridgeUrl: source.payrollBridgeUrl ?? payrollBridge.url,
        hasPayrollBridgeToken: Boolean(existing.token),
        payrollAdvanceSource: source.payrollAdvanceSource ?? payrollBridge.source,
        payrollAutoCreatePayRun: payrollBridge.autoCreatePayRun,
        payrollSalaryStructure: source.payrollSalaryStructure ?? payrollBridge.salaryStructure,
        payrollPayRunNameTemplate: source.payrollPayRunNameTemplate ?? payrollBridge.payRunNameTemplate,
    };
}
function getSettingsSectionLabel(section) {
    const labels = {
        odoo: 'Odoo credentials',
        mappings: 'field mappings',
        parser: 'parser settings',
        ai: 'AI invoice extraction settings',
        ocr: 'OCR settings',
        scheduler: 'background scheduler settings',
        poBillScheduler: 'PO bill scheduler settings',
        stock: 'stock reconciliation settings',
        payrollBridge: 'payroll bridge settings',
    };
    return section && labels[section] ? labels[section] : 'settings';
}
async function buildFormValues(source, existing, availableFields = []) {
    const resolvedExisting = existing || (await (0, repositories_1.getSettings)());
    const resolvedMappings = (0, helpers_1.resolveFieldMappings)(resolvedExisting.fieldMappings, availableFields);
    return {
        baseUrl: source.baseUrl ?? resolvedExisting.odoo.baseUrl,
        database: source.database ?? resolvedExisting.odoo.database,
        username: source.username ?? resolvedExisting.odoo.username,
        apiKey: '',
        clearStoredApiKey: source.clearStoredApiKey === 'on',
        hasStoredApiKey: Boolean(resolvedExisting.odoo.apiKey),
        edgeJsonField: source.edgeJsonField ?? resolvedMappings.edgeJsonField,
        processedField: source.processedField ?? resolvedMappings.processedField,
        processedAtField: source.processedAtField ?? resolvedMappings.processedAtField,
        logField: source.logField ?? resolvedMappings.logField,
        attachmentNameField: source.attachmentNameField ?? resolvedMappings.attachmentNameField,
        attachmentIdField: source.attachmentIdField ?? resolvedMappings.attachmentIdField,
        previousJsonField: source.previousJsonField ?? resolvedMappings.previousJsonField,
        signatureField: source.signatureField ?? resolvedMappings.signatureField,
        stockProcessedField: source.stockProcessedField ?? resolvedMappings.stockProcessedField,
        stockSignatureField: source.stockSignatureField ?? resolvedMappings.stockSignatureField,
        deltaJsonField: source.deltaJsonField ?? resolvedMappings.deltaJsonField,
        filenameKeyword: source.filenameKeyword ?? resolvedExisting.parser.filenameKeyword,
        sectionHeader: source.sectionHeader ?? resolvedExisting.parser.sectionHeader,
        stopHeadersCsv: source.stopHeadersCsv ?? resolvedExisting.parser.stopHeadersCsv,
        productLinePattern: source.productLinePattern ?? resolvedExisting.parser.productLinePattern,
        thicknessLabel: source.thicknessLabel ?? resolvedExisting.parser.thicknessLabel,
        lengthLabel: source.lengthLabel ?? resolvedExisting.parser.lengthLabel,
        rollLengthLabel: source.rollLengthLabel ?? resolvedExisting.parser.rollLengthLabel,
        postChatterOnSuccess: source.postChatterOnSuccess === 'on' ||
            (source.postChatterOnSuccess === undefined && resolvedExisting.parser.postChatterOnSuccess),
        chatterTemplate: source.chatterTemplate ?? resolvedExisting.parser.chatterTemplate,
        aiEnabled: source.aiEnabled === 'on' ||
            (source.aiEnabled === undefined && resolvedExisting.ai.enabled),
        aiProvider: source.aiProvider ?? resolvedExisting.ai.provider,
        aiModelPreset: source.aiModelPreset ?? normalizeAiModelForProvider(source.aiProvider ?? resolvedExisting.ai.provider, resolvedExisting.ai.model),
        aiModel: source.aiModel ?? normalizeAiModelForProvider(source.aiProvider ?? resolvedExisting.ai.provider, resolvedExisting.ai.model),
        aiBaseUrl: source.aiBaseUrl ?? resolvedExisting.ai.baseUrl,
        aiConfidenceThreshold: source.aiConfidenceThreshold ?? String(resolvedExisting.ai.confidenceThreshold),
        aiMaxImages: source.aiMaxImages ?? String(resolvedExisting.ai.maxImages),
        hasOpenaiApiKey: Boolean(resolvedExisting.ai.apiKeys.openai),
        hasNvidiaApiKey: Boolean(resolvedExisting.ai.apiKeys.nvidia),
        hasGeminiApiKey: Boolean(resolvedExisting.ai.apiKeys.gemini),
        hasAnthropicApiKey: Boolean(resolvedExisting.ai.apiKeys.anthropic),
        hasOpenrouterApiKey: Boolean(resolvedExisting.ai.apiKeys.openrouter),
        ocrProvider: source.ocrProvider ?? resolvedExisting.ai.ocr.provider,
        ocrEnabled: source.ocrEnabled === 'on' ||
            (source.ocrEnabled === undefined && resolvedExisting.ai.ocr.enabled),
        ocrModel: source.ocrModel ?? resolvedExisting.ai.ocr.model,
        ocrEndpoint: source.ocrEndpoint ?? resolvedExisting.ai.ocr.endpoint,
        hasOcrApiKey: Boolean(resolvedExisting.ai.ocr.apiKey),
        schedulerEnabled: source.schedulerEnabled === 'on' ||
            (source.schedulerEnabled === undefined && resolvedExisting.scheduler.enabled),
        schedulerIntervalMinutes: source.schedulerIntervalMinutes ?? String(resolvedExisting.scheduler.intervalMinutes),
        schedulerBatchSize: source.schedulerBatchSize ?? String(resolvedExisting.scheduler.batchSize),
        schedulerConfirmedFromDate: source.schedulerConfirmedFromDate ?? resolvedExisting.scheduler.confirmedFromDate,
        schedulerCronToken: source.schedulerCronToken ?? resolvedExisting.scheduler.cronToken,
        schedulerUseInProcessInterval: source.schedulerUseInProcessInterval === 'on' ||
            (source.schedulerUseInProcessInterval === undefined &&
                resolvedExisting.scheduler.useInProcessInterval),
        poBillSchedulerEnabled: source.poBillSchedulerEnabled === 'on' ||
            (source.poBillSchedulerEnabled === undefined && resolvedExisting.poBillScheduler.enabled),
        poBillSchedulerIntervalMinutes: source.poBillSchedulerIntervalMinutes ?? String(resolvedExisting.poBillScheduler.intervalMinutes),
        poBillSchedulerBatchSize: source.poBillSchedulerBatchSize ?? String(resolvedExisting.poBillScheduler.batchSize),
        poBillSchedulerFromDate: source.poBillSchedulerFromDate ?? resolvedExisting.poBillScheduler.fromDate,
        poBillSchedulerCronToken: source.poBillSchedulerCronToken ?? resolvedExisting.poBillScheduler.cronToken,
        poBillSchedulerUseInProcessInterval: source.poBillSchedulerUseInProcessInterval === 'on' ||
            (source.poBillSchedulerUseInProcessInterval === undefined &&
                resolvedExisting.poBillScheduler.useInProcessInterval),
        poBillSchedulerMaxRetryAttempts: source.poBillSchedulerMaxRetryAttempts ?? String(resolvedExisting.poBillScheduler.maxRetryAttempts),
        poBillSchedulerTransientRetryHours: source.poBillSchedulerTransientRetryHours ?? String(resolvedExisting.poBillScheduler.transientRetryHours),
        poBillSchedulerRetryBackoffHours: source.poBillSchedulerRetryBackoffHours ?? resolvedExisting.poBillScheduler.retryBackoffHours.join(', '),
        poBillSchedulerStableSkipRetryDays: source.poBillSchedulerStableSkipRetryDays ?? String(resolvedExisting.poBillScheduler.stableSkipRetryDays),
        stockLocationId: source.stockLocationId ?? resolvedExisting.stock.locationId,
        stockLocationName: source.stockLocationName ?? resolvedExisting.stock.locationName,
        stockWarehouseId: source.stockWarehouseId ?? resolvedExisting.stock.warehouseId,
        stockPickingTypeId: source.stockPickingTypeId ?? resolvedExisting.stock.pickingTypeId,
        stockMissingSoAlertUserLogin: source.stockMissingSoAlertUserLogin ?? resolvedExisting.stock.missingSoAlertUserLogin,
        stockMissingComponentAlertUserLogin: source.stockMissingComponentAlertUserLogin ?? resolvedExisting.stock.missingComponentAlertUserLogin,
        ...buildMailFormValues(source, resolvedExisting.mail),
        ...buildPayrollBridgeFormValues(source, resolvedExisting.payrollBridge),
    };
}
function getSubmittedApiKey(source, existing) {
    return source.apiKey?.trim() || existing.odoo.apiKey;
}
async function loadSaleOrderFieldState(source, existing) {
    const cached = await (0, repositories_1.getCachedModelFields)('sale.order');
    const baseUrl = (0, helpers_1.sanitizeBaseUrl)(source.baseUrl ?? existing.odoo.baseUrl);
    const username = (source.username ?? existing.odoo.username).trim();
    const database = (source.database ?? existing.odoo.database).trim();
    const apiKey = getSubmittedApiKey(source, existing);
    if (!baseUrl || !username || !apiKey) {
        return {
            fields: cached.fields,
            fetchedAt: cached.fetchedAt,
            source: cached.fields.length > 0 ? 'cache' : 'unavailable',
            errorMessage: cached.fields.length > 0 ? null : 'Connect to Odoo to load live sale.order fields.',
        };
    }
    try {
        const client = new odooClient_1.OdooClient({
            baseUrl,
            database,
            username,
            apiKey,
        });
        const fields = await client.getSaleOrderFields();
        const saved = await (0, repositories_1.saveCachedModelFields)('sale.order', fields);
        return {
            fields: saved.fields,
            fetchedAt: saved.fetchedAt,
            source: 'live',
            errorMessage: null,
        };
    }
    catch (error) {
        return {
            fields: cached.fields,
            fetchedAt: cached.fetchedAt,
            source: cached.fields.length > 0 ? 'cache' : 'unavailable',
            errorMessage: error instanceof Error
                ? error.message
                : 'Could not load sale.order fields from Odoo.',
        };
    }
}
function sanitizeFieldMappings(source, availableFields, existingMappings) {
    const allowed = new Set(availableFields.map((field) => field.name));
    const submitted = {
        edgeJsonField: source.edgeJsonField ?? existingMappings.edgeJsonField,
        processedField: source.processedField ?? existingMappings.processedField,
        processedAtField: source.processedAtField ?? existingMappings.processedAtField,
        logField: source.logField ?? existingMappings.logField,
        attachmentNameField: source.attachmentNameField ?? existingMappings.attachmentNameField,
        attachmentIdField: source.attachmentIdField ?? existingMappings.attachmentIdField,
        previousJsonField: source.previousJsonField ?? existingMappings.previousJsonField,
        signatureField: source.signatureField ?? existingMappings.signatureField,
        stockProcessedField: source.stockProcessedField ?? existingMappings.stockProcessedField,
        stockSignatureField: source.stockSignatureField ?? existingMappings.stockSignatureField,
        deltaJsonField: source.deltaJsonField ?? existingMappings.deltaJsonField,
    };
    const sanitized = (0, helpers_1.createEmptyFieldMappings)();
    const invalidSelections = [];
    Object.keys(submitted).forEach((key) => {
        const value = submitted[key].trim();
        if (!value) {
            sanitized[key] = '';
            return;
        }
        if (!allowed.has(value)) {
            invalidSelections.push(value);
            sanitized[key] = '';
            return;
        }
        sanitized[key] = value;
    });
    return {
        sanitized,
        invalidSelections,
    };
}
function buildMappingDiagnostics(source, availableFields, existingMappings) {
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
    const availableByName = new Map(availableFields.map((field) => [field.name, field]));
    const sanitizedMappings = sanitizeFieldMappings(source, availableFields, existingMappings).sanitized;
    return Object.keys(labels).map((key) => {
        const selectedField = (source[key] ?? existingMappings[key] ?? '').trim();
        const matchedField = availableByName.get(sanitizedMappings[key]);
        if (matchedField) {
            return {
                key,
                label: labels[key],
                selectedField: matchedField.name,
                status: 'matched',
                fieldType: matchedField.type,
                fieldLabel: matchedField.label,
            };
        }
        if (!selectedField) {
            return {
                key,
                label: labels[key],
                selectedField: '',
                status: 'missing',
                fieldType: '',
                fieldLabel: '',
            };
        }
        return {
            key,
            label: labels[key],
            selectedField,
            status: 'inaccessible',
            fieldType: '',
            fieldLabel: '',
        };
    });
}
async function renderSettingsPage(res, options = {}) {
    const existing = options.existing || (await (0, repositories_1.getSettings)());
    const source = options.source || {};
    const saleOrderFieldState = await loadSaleOrderFieldState(source, existing);
    const form = await buildFormValues(source, existing, saleOrderFieldState.fields);
    const mappingSource = {
        edgeJsonField: form.edgeJsonField,
        processedField: form.processedField,
        processedAtField: form.processedAtField,
        logField: form.logField,
        attachmentNameField: form.attachmentNameField,
        attachmentIdField: form.attachmentIdField,
        previousJsonField: form.previousJsonField,
        signatureField: form.signatureField,
        stockProcessedField: form.stockProcessedField,
        stockSignatureField: form.stockSignatureField,
        deltaJsonField: form.deltaJsonField,
    };
    const missingMappings = (0, helpers_1.getMissingFieldMappingLabels)(sanitizeFieldMappings(mappingSource, saleOrderFieldState.fields, existing.fieldMappings).sanitized);
    const mappingDiagnostics = buildMappingDiagnostics(mappingSource, saleOrderFieldState.fields, existing.fieldMappings);
    res.render('settings', {
        pageTitle: 'Settings',
        form,
        status: options.status ?? null,
        validationErrors: options.validationErrors || [],
        connection: existing.connection,
        saleOrderFields: saleOrderFieldState.fields,
        saleOrderFieldState,
        missingMappings,
        mappingDiagnostics,
    });
}
router.get('/settings', async (req, res) => {
    const message = typeof req.query.message === 'string' ? req.query.message : '';
    const error = typeof req.query.error === 'string' ? req.query.error : '';
    await renderSettingsPage(res, {
        status: message
            ? { type: 'success', message }
            : error
                ? { type: 'danger', message: error }
                : null,
    });
});
router.get('/settings/mail', (_req, res) => {
    res.redirect('/settings');
});
router.post('/settings/mail', mailValidators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    if (!errors.isEmpty()) {
        return renderSettingsPage(res.status(422), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message: 'Please fix the outgoing mail settings.' },
            validationErrors: errors.array(),
        });
    }
    try {
        const mail = buildMailConfigFromSource(req.body, currentSettings.mail);
        const saved = await (0, repositories_1.saveSettings)({
            baseUrl: currentSettings.odoo.baseUrl,
            database: currentSettings.odoo.database,
            username: currentSettings.odoo.username,
            apiKey: '',
            keepExistingApiKey: true,
            mail,
        });
        await (0, logService_1.logEvent)('info', 'Outgoing mail settings updated', {
            transport: saved.mail.transport,
            fallbackTransport: saved.mail.fallbackTransport,
            host: saved.mail.host,
            port: saved.mail.port,
            secure: saved.mail.secure,
            requireTls: saved.mail.requireTls,
            enabledAccounts: saved.mail.accounts
                .filter((account) => account.enabled && account.username)
                .map((account) => ({
                label: account.label,
                username: account.username,
                fromEmail: account.fromEmail,
                hasPassword: Boolean(account.password),
            })),
        });
        return res.redirect('/settings?message=' + encodeURIComponent('Outgoing mail settings saved.'));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save outgoing mail settings.';
        await (0, logService_1.logEvent)('error', 'Outgoing mail settings update failed', { error: message }).catch(() => undefined);
        return renderSettingsPage(res.status(500), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message },
        });
    }
});
router.post('/settings/test-mail', mailValidators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    const validationErrors = errors.array();
    if (!req.body.mailTestRecipient?.trim()) {
        validationErrors.push({ msg: 'Enter a test recipient email before sending a test message.' });
    }
    if (validationErrors.length) {
        return renderSettingsPage(res.status(422), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message: 'Please fix the outgoing mail settings before testing.' },
            validationErrors,
        });
    }
    const mail = buildMailConfigFromSource(req.body, currentSettings.mail);
    const recipient = req.body.mailTestRecipient.trim();
    try {
        const result = await (0, mailTransport_1.sendMailWithConfig)(mail, {
            to: recipient,
            subject: 'Urban Vibe mail test',
            text: [
                'This is a test email from the Urban Vibe reconciler app.',
                '',
                'If you received this, the outgoing mail settings can hand messages to the mail provider.',
            ].join('\n'),
        });
        await (0, logService_1.logEvent)('info', 'Outgoing mail test succeeded', {
            recipient,
            transport: result.transport,
            username: result.username,
            fromEmail: result.fromEmail,
            host: mail.host,
            port: mail.port,
            secure: mail.secure,
            requireTls: mail.requireTls,
        });
        return renderSettingsPage(res, {
            existing: currentSettings,
            source: req.body,
            status: {
                type: 'success',
                message: `Test email accepted for ${recipient} using ${result.transport}${result.username ? ` (${result.username})` : ''}. Save the settings if this test used new values.`,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Mail test failed.';
        await (0, logService_1.logEvent)('error', 'Outgoing mail test failed', {
            recipient,
            host: mail.host,
            port: mail.port,
            secure: mail.secure,
            requireTls: mail.requireTls,
            transport: mail.transport,
            error: message,
        }).catch(() => undefined);
        return renderSettingsPage(res.status(502), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message },
        });
    }
});
router.get('/settings/payroll-bridge', (_req, res) => {
    res.redirect('/settings');
});
router.post('/settings/payroll-bridge', payrollBridgeValidators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    if (!errors.isEmpty()) {
        return renderSettingsPage(res.status(422), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message: 'Please fix the payroll bridge settings.' },
            validationErrors: errors.array(),
        });
    }
    try {
        const payrollBridge = buildPayrollBridgeConfigFromSource(req.body, currentSettings.payrollBridge);
        const saved = await (0, repositories_1.saveSettings)({
            baseUrl: currentSettings.odoo.baseUrl,
            database: currentSettings.odoo.database,
            username: currentSettings.odoo.username,
            apiKey: '',
            keepExistingApiKey: true,
            payrollBridge,
            keepExistingPayrollBridgeToken: true,
            clearPayrollBridgeToken: req.body.clearPayrollBridgeToken === 'on',
        });
        await (0, logService_1.logEvent)('info', 'Payroll bridge settings updated', {
            url: saved.payrollBridge.url,
            source: saved.payrollBridge.source,
            autoCreatePayRun: saved.payrollBridge.autoCreatePayRun,
            salaryStructure: saved.payrollBridge.salaryStructure,
            payRunNameTemplate: saved.payrollBridge.payRunNameTemplate,
            hasToken: Boolean(saved.payrollBridge.token),
        });
        return res.redirect('/settings?message=' + encodeURIComponent('Payroll bridge settings saved.'));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save payroll bridge settings.';
        await (0, logService_1.logEvent)('error', 'Payroll bridge settings update failed', { error: message }).catch(() => undefined);
        return renderSettingsPage(res.status(500), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message },
        });
    }
});
router.post('/settings/test-payroll-bridge', payrollBridgeValidators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    if (!errors.isEmpty()) {
        return renderSettingsPage(res.status(422), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message: 'Please fix the payroll bridge settings before testing.' },
            validationErrors: errors.array(),
        });
    }
    const payrollBridge = buildPayrollBridgeConfigFromSource(req.body, currentSettings.payrollBridge);
    try {
        const result = await (0, payrollBridgeService_1.testPayrollBridgeConnection)(payrollBridge);
        await (0, logService_1.logEvent)('info', 'Payroll bridge test succeeded', {
            url: payrollBridge.url,
            source: payrollBridge.source,
            autoCreatePayRun: payrollBridge.autoCreatePayRun,
            hasToken: Boolean(payrollBridge.token),
            probeCount: result.count || 0,
        });
        return renderSettingsPage(res, {
            existing: currentSettings,
            source: req.body,
            status: {
                type: 'success',
                message: 'Payroll bridge accepted the token. Save the settings if this test used new values.',
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Payroll bridge test failed.';
        await (0, logService_1.logEvent)('error', 'Payroll bridge test failed', {
            url: payrollBridge.url,
            source: payrollBridge.source,
            autoCreatePayRun: payrollBridge.autoCreatePayRun,
            hasToken: Boolean(payrollBridge.token),
            error: message,
        }).catch(() => undefined);
        return renderSettingsPage(res.status(502), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message },
        });
    }
});
router.post('/settings', validators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    const saleOrderFieldState = await loadSaleOrderFieldState(req.body, currentSettings);
    const form = await buildFormValues(req.body, currentSettings, saleOrderFieldState.fields);
    if (!errors.isEmpty()) {
        return res.status(422).render('settings', {
            pageTitle: 'Settings',
            form,
            status: { type: 'danger', message: 'Please fix the settings form errors.' },
            validationErrors: errors.array(),
            connection: currentSettings.connection,
            saleOrderFields: saleOrderFieldState.fields,
            saleOrderFieldState,
            missingMappings: [],
            mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
        });
    }
    try {
        const sanitizedMappings = saleOrderFieldState.fields.length > 0
            ? sanitizeFieldMappings(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings)
            : { sanitized: currentSettings.fieldMappings, invalidSelections: [] };
        const aiProvider = req.body.aiProvider?.trim() || 'disabled';
        const aiModelPreset = req.body.aiModelPreset?.trim() || '';
        const submittedAiModel = aiModelPreset === 'custom'
            ? req.body.aiModel?.trim() || ''
            : aiModelPreset || req.body.aiModel?.trim() || '';
        const aiModel = normalizeAiModelForProvider(aiProvider, submittedAiModel);
        const saved = await (0, repositories_1.saveSettings)({
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            database: req.body.database?.trim() || '',
            username: req.body.username?.trim() || '',
            apiKey: req.body.apiKey?.trim() || '',
            keepExistingApiKey: true,
            clearStoredApiKey: req.body.clearStoredApiKey === 'on',
            fieldMappings: sanitizedMappings.sanitized,
            parser: {
                filenameKeyword: req.body.filenameKeyword?.trim(),
                sectionHeader: req.body.sectionHeader?.trim(),
                stopHeadersCsv: req.body.stopHeadersCsv?.trim() || '',
                productLinePattern: req.body.productLinePattern?.trim(),
                thicknessLabel: req.body.thicknessLabel?.trim(),
                lengthLabel: req.body.lengthLabel?.trim(),
                rollLengthLabel: req.body.rollLengthLabel?.trim(),
                postChatterOnSuccess: req.body.postChatterOnSuccess === 'on',
                chatterTemplate: req.body.chatterTemplate?.trim(),
            },
            ai: {
                enabled: req.body.aiEnabled === 'on' || aiProvider !== 'disabled',
                provider: aiProvider,
                model: aiModel,
                baseUrl: req.body.aiBaseUrl?.trim() || '',
                confidenceThreshold: Number(req.body.aiConfidenceThreshold || 0.75),
                maxImages: Number(req.body.aiMaxImages || 3),
                apiKeys: {
                    openai: req.body.openaiApiKey?.trim() || '',
                    nvidia: req.body.nvidiaApiKey?.trim() || '',
                    gemini: req.body.geminiApiKey?.trim() || '',
                    anthropic: req.body.anthropicApiKey?.trim() || '',
                    openrouter: req.body.openrouterApiKey?.trim() || '',
                },
                clearApiKeys: {
                    openai: req.body.clearOpenaiApiKey === 'on',
                    nvidia: req.body.clearNvidiaApiKey === 'on',
                    gemini: req.body.clearGeminiApiKey === 'on',
                    anthropic: req.body.clearAnthropicApiKey === 'on',
                    openrouter: req.body.clearOpenrouterApiKey === 'on',
                },
                ocr: {
                    provider: req.body.ocrProvider?.trim() || 'disabled',
                    enabled: req.body.ocrEnabled === 'on' || req.body.ocrProvider === 'nvidia_nemoretriever',
                    model: req.body.ocrModel?.trim() || 'nvidia/nemotron-ocr-v2',
                    endpoint: req.body.ocrEndpoint?.trim() ||
                        'https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2',
                    apiKey: req.body.ocrApiKey?.trim() || '',
                    clearApiKey: req.body.clearOcrApiKey === 'on',
                },
            },
            scheduler: {
                enabled: req.body.schedulerEnabled === 'on',
                intervalMinutes: Number(req.body.schedulerIntervalMinutes || 15),
                batchSize: Number(req.body.schedulerBatchSize || 15),
                confirmedFromDate: req.body.schedulerConfirmedFromDate?.trim() || '2026-04-08 00:00:00',
                cronToken: req.body.schedulerCronToken?.trim() || '',
                useInProcessInterval: req.body.schedulerUseInProcessInterval === 'on',
            },
            poBillScheduler: {
                enabled: req.body.poBillSchedulerEnabled === 'on',
                intervalMinutes: Number(req.body.poBillSchedulerIntervalMinutes || 15),
                batchSize: 1,
                fromDate: req.body.poBillSchedulerFromDate?.trim() || '2026-01-01 00:00:00',
                cronToken: req.body.poBillSchedulerCronToken?.trim() || '',
                useInProcessInterval: req.body.poBillSchedulerUseInProcessInterval === 'on',
                maxRetryAttempts: Math.max(1, Math.min(20, Number(req.body.poBillSchedulerMaxRetryAttempts || 5))),
                transientRetryHours: Math.max(1, Math.min(168, Number(req.body.poBillSchedulerTransientRetryHours || 2))),
                retryBackoffHours: parseRetryBackoffHours(req.body.poBillSchedulerRetryBackoffHours),
                stableSkipRetryDays: Math.max(1, Math.min(365, Number(req.body.poBillSchedulerStableSkipRetryDays || 14))),
            },
            stock: {
                locationId: req.body.stockLocationId?.trim() || '',
                locationName: req.body.stockLocationName?.trim() || '',
                warehouseId: req.body.stockWarehouseId?.trim() || '',
                pickingTypeId: req.body.stockPickingTypeId?.trim() || '',
                missingSoAlertUserLogin: req.body.stockMissingSoAlertUserLogin?.trim() || '',
                missingComponentAlertUserLogin: req.body.stockMissingComponentAlertUserLogin?.trim() || '',
            },
        });
        await (0, logService_1.logEvent)('info', 'Application settings updated', {
            baseUrl: saved.odoo.baseUrl,
            username: saved.odoo.username,
            fieldMappings: saved.fieldMappings,
            parser: saved.parser,
            ai: {
                enabled: saved.ai.enabled,
                provider: saved.ai.provider,
                model: saved.ai.model,
                baseUrl: saved.ai.baseUrl,
                confidenceThreshold: saved.ai.confidenceThreshold,
                maxImages: saved.ai.maxImages,
                configuredKeys: Object.fromEntries(Object.entries(saved.ai.apiKeys).map(([key, value]) => [key, Boolean(value)])),
                ocr: {
                    provider: saved.ai.ocr.provider,
                    enabled: saved.ai.ocr.enabled,
                    model: saved.ai.ocr.model,
                    endpoint: saved.ai.ocr.endpoint,
                    hasApiKey: Boolean(saved.ai.ocr.apiKey),
                },
            },
            invalidFieldSelections: sanitizedMappings.invalidSelections,
        });
        const sectionLabel = getSettingsSectionLabel(req.body.settingsSection);
        const statusMessage = sanitizedMappings.invalidSelections.length
            ? `${sectionLabel.charAt(0).toUpperCase()}${sectionLabel.slice(1)} saved. Some invalid field selections were cleared because they are not available in Odoo.`
            : `${sectionLabel.charAt(0).toUpperCase()}${sectionLabel.slice(1)} saved successfully.`;
        await renderSettingsPage(res, {
            existing: saved,
            status: { type: sanitizedMappings.invalidSelections.length ? 'warning' : 'success', message: statusMessage },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not save settings.';
        res.status(500).render('settings', {
            pageTitle: 'Settings',
            form,
            status: { type: 'danger', message },
            validationErrors: [],
            connection: currentSettings.connection,
            saleOrderFields: saleOrderFieldState.fields,
            saleOrderFieldState,
            missingMappings: [],
            mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
        });
    }
});
router.post('/settings/test-connection', [...credentialValidators, ...mappingValidators, ...parserValidators], async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    const saleOrderFieldState = await loadSaleOrderFieldState(req.body, currentSettings);
    const form = await buildFormValues(req.body, currentSettings, saleOrderFieldState.fields);
    if (!errors.isEmpty()) {
        return res.status(422).render('settings', {
            pageTitle: 'Settings',
            form,
            status: { type: 'danger', message: 'Please fix the settings fields before testing.' },
            validationErrors: errors.array(),
            connection: currentSettings.connection,
            saleOrderFields: saleOrderFieldState.fields,
            saleOrderFieldState,
            missingMappings: [],
            mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
        });
    }
    const clearStoredApiKey = req.body.clearStoredApiKey === 'on';
    const apiKey = req.body.apiKey?.trim() || (clearStoredApiKey ? '' : currentSettings.odoo.apiKey);
    if (!apiKey) {
        return res.status(422).render('settings', {
            pageTitle: 'Settings',
            form,
            status: {
                type: 'danger',
                message: 'Provide an API key or leave the existing stored one in place before testing.',
            },
            validationErrors: [],
            connection: currentSettings.connection,
            saleOrderFields: saleOrderFieldState.fields,
            saleOrderFieldState,
            missingMappings: [],
            mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
        });
    }
    try {
        const client = new odooClient_1.OdooClient({
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            database: req.body.database?.trim() || '',
            username: req.body.username?.trim() || '',
            apiKey,
        });
        const result = await client.testConnection();
        await (0, repositories_1.updateConnectionStatus)('success', `Connected as ${result.user?.name || req.body.username}.`, result.version);
        await (0, logService_1.logEvent)('info', 'Odoo connection test succeeded from settings', {
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            username: req.body.username?.trim() || '',
            version: result.version,
        });
        res.render('settings', {
            pageTitle: 'Settings',
            form,
            status: {
                type: 'success',
                message: `Connection successful. Odoo version ${result.version}.`,
            },
            validationErrors: [],
            connection: (await (0, repositories_1.getSettings)()).connection,
            saleOrderFields: saleOrderFieldState.fields,
            saleOrderFieldState,
            missingMappings: [],
            mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Odoo connection test failed.';
        await (0, repositories_1.updateConnectionStatus)('error', message, null);
        await (0, logService_1.logEvent)('error', 'Odoo connection test failed from settings', {
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(req.body.baseUrl),
            username: req.body.username?.trim() || '',
            error: message,
        });
        res.status(502).render('settings', {
            pageTitle: 'Settings',
            form,
            status: { type: 'danger', message },
            validationErrors: [],
            connection: (await (0, repositories_1.getSettings)()).connection,
            saleOrderFields: saleOrderFieldState.fields,
            saleOrderFieldState,
            missingMappings: [],
            mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
        });
    }
});
router.post('/settings/refresh-fields', credentialValidators, async (req, res) => {
    const errors = (0, express_validator_1.validationResult)(req);
    const currentSettings = await (0, repositories_1.getSettings)();
    if (!errors.isEmpty()) {
        return renderSettingsPage(res.status(422), {
            existing: currentSettings,
            source: req.body,
            status: { type: 'danger', message: 'Provide valid Odoo credentials to refresh fields.' },
            validationErrors: errors.array(),
        });
    }
    const saleOrderFieldState = await loadSaleOrderFieldState(req.body, currentSettings);
    if (saleOrderFieldState.fields.length === 0) {
        return res.status(502).render('settings', {
            pageTitle: 'Settings',
            form: await buildFormValues(req.body, currentSettings, saleOrderFieldState.fields),
            status: {
                type: 'danger',
                message: saleOrderFieldState.errorMessage || 'Could not load sale.order fields from Odoo.',
            },
            validationErrors: [],
            connection: currentSettings.connection,
            saleOrderFields: saleOrderFieldState.fields,
            saleOrderFieldState,
            missingMappings: [],
            mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
        });
    }
    res.render('settings', {
        pageTitle: 'Settings',
        form: await buildFormValues(req.body, currentSettings, saleOrderFieldState.fields),
        status: { type: 'success', message: 'Live sale.order fields refreshed from Odoo.' },
        validationErrors: [],
        connection: currentSettings.connection,
        saleOrderFields: saleOrderFieldState.fields,
        saleOrderFieldState,
        missingMappings: (0, helpers_1.getMissingFieldMappingLabels)(sanitizeFieldMappings(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings).sanitized),
        mappingDiagnostics: buildMappingDiagnostics(req.body, saleOrderFieldState.fields, currentSettings.fieldMappings),
    });
});
router.post('/settings/clear-cache', async (_req, res) => {
    try {
        const clearedCount = await (0, repositories_1.clearCachedModelFields)();
        res.setHeader('Clear-Site-Data', '"cache"');
        await (0, logService_1.logEvent)('info', 'Application cache cleared from settings', {
            clearedModelFieldCacheRows: clearedCount,
        });
        res.redirect(`/settings?message=${encodeURIComponent(`Cache cleared. Removed ${clearedCount} cached Odoo field list${clearedCount === 1 ? '' : 's'}.`)}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Could not clear cache.';
        await (0, logService_1.logEvent)('error', 'Application cache clear failed from settings', { error: message });
        res.redirect(`/settings?error=${encodeURIComponent(message)}`);
    }
});
router.get('/settings/clear-cache', (_req, res) => {
    res.redirect('/settings?message=Use the Clear Cache button to clear cached field lists.');
});
exports.default = router;
