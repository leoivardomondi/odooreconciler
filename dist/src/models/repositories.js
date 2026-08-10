"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSettings = getSettings;
exports.saveSettings = saveSettings;
exports.getCachedModelFields = getCachedModelFields;
exports.saveCachedModelFields = saveCachedModelFields;
exports.clearCachedModelFields = clearCachedModelFields;
exports.insertSchedulerRun = insertSchedulerRun;
exports.updateSchedulerRun = updateSchedulerRun;
exports.getSchedulerRunById = getSchedulerRunById;
exports.getRecentSchedulerRuns = getRecentSchedulerRuns;
exports.getSchedulerRuntimeState = getSchedulerRuntimeState;
exports.acquireSchedulerRunLock = acquireSchedulerRunLock;
exports.markOrphanedStartedRunsAsFailed = markOrphanedStartedRunsAsFailed;
exports.clearStaleSchedulerRunLock = clearStaleSchedulerRunLock;
exports.touchSchedulerRunLock = touchSchedulerRunLock;
exports.releaseSchedulerRunLock = releaseSchedulerRunLock;
exports.requestSchedulerStop = requestSchedulerStop;
exports.markSchedulerRunSucceeded = markSchedulerRunSucceeded;
exports.markSchedulerRunFailed = markSchedulerRunFailed;
exports.updateConnectionStatus = updateConnectionStatus;
exports.createMpesaStatementBatch = createMpesaStatementBatch;
exports.replaceMpesaStatementBatchExtraction = replaceMpesaStatementBatchExtraction;
exports.getRecentMpesaStatementBatches = getRecentMpesaStatementBatches;
exports.getMpesaStatementBatchesWithOpenReviewCounts = getMpesaStatementBatchesWithOpenReviewCounts;
exports.hasMpesaStatementUploadedSince = hasMpesaStatementUploadedSince;
exports.hasMpesaReviewNotificationSince = hasMpesaReviewNotificationSince;
exports.getMpesaStatementBatchById = getMpesaStatementBatchById;
exports.deleteMpesaStatementBatch = deleteMpesaStatementBatch;
exports.getMpesaTransactionsByBatchId = getMpesaTransactionsByBatchId;
exports.getMpesaTransactionsByIds = getMpesaTransactionsByIds;
exports.getMpesaTransactionExplorerOptions = getMpesaTransactionExplorerOptions;
exports.getMpesaTransactionExplorerRows = getMpesaTransactionExplorerRows;
exports.getReviewedSalaryAdvanceTransactionsByPeriod = getReviewedSalaryAdvanceTransactionsByPeriod;
exports.getMatchedOutgoingTransactionsSince = getMatchedOutgoingTransactionsSince;
exports.getMatchedIncomingTransactionsSince = getMatchedIncomingTransactionsSince;
exports.autoVerifyMpesaTransactionsByRule = autoVerifyMpesaTransactionsByRule;
exports.updateMpesaTransactions = updateMpesaTransactions;
exports.updateMpesaTransactionAdminReviewFields = updateMpesaTransactionAdminReviewFields;
exports.insertLog = insertLog;
exports.getRecentLogs = getRecentLogs;
exports.insertHistory = insertHistory;
exports.updateHistory = updateHistory;
exports.getHistoryById = getHistoryById;
exports.getRecentHistory = getRecentHistory;
exports.insertExtractedResult = insertExtractedResult;
exports.getExtractedResultByHistoryId = getExtractedResultByHistoryId;
exports.getLatestExtractedResultByOrderId = getLatestExtractedResultByOrderId;
exports.getProcessedStockVariantIds = getProcessedStockVariantIds;
exports.getUnreversedProcessedStockItemsForOrder = getUnreversedProcessedStockItemsForOrder;
exports.insertProcessedStockItem = insertProcessedStockItem;
exports.markProcessedStockItemReversed = markProcessedStockItemReversed;
exports.getPoBillProcessedDocumentsByAttachmentIds = getPoBillProcessedDocumentsByAttachmentIds;
exports.getPoBillProcessedDocumentsByInvoiceFingerprint = getPoBillProcessedDocumentsByInvoiceFingerprint;
exports.getLatestPoBillProcessedDocumentsByPurchaseOrderIds = getLatestPoBillProcessedDocumentsByPurchaseOrderIds;
exports.upsertPoBillProcessedDocument = upsertPoBillProcessedDocument;
exports.acquirePoBillProcessingLock = acquirePoBillProcessingLock;
exports.releasePoBillProcessingLock = releasePoBillProcessingLock;
exports.acquireStockProcessingLock = acquireStockProcessingLock;
exports.releaseStockProcessingLock = releaseStockProcessingLock;
exports.isStockProcessingLocked = isStockProcessingLocked;
exports.insertAuthLoginChallenge = insertAuthLoginChallenge;
exports.getLatestActiveAuthLoginChallenge = getLatestActiveAuthLoginChallenge;
exports.updateAuthLoginChallenge = updateAuthLoginChallenge;
exports.consumeAllAuthChallengesForEmail = consumeAllAuthChallengesForEmail;
exports.insertAuthSession = insertAuthSession;
exports.getAuthSession = getAuthSession;
exports.touchAuthSession = touchAuthSession;
exports.revokeAuthSession = revokeAuthSession;
exports.revokeExpiredAuthSessions = revokeExpiredAuthSessions;
exports.insertAuthAttempt = insertAuthAttempt;
exports.countRecentAuthAttempts = countRecentAuthAttempts;
exports.insertAuthLoginEvent = insertAuthLoginEvent;
exports.getRecentAuthLoginEvents = getRecentAuthLoginEvents;
exports.getAuthUserLastSeenByEmail = getAuthUserLastSeenByEmail;
exports.upsertApprovedAuthUser = upsertApprovedAuthUser;
exports.getApprovedAuthUserByEmail = getApprovedAuthUserByEmail;
exports.getApprovedAuthUsers = getApprovedAuthUsers;
exports.countApprovedAuthUsers = countApprovedAuthUsers;
exports.getAppUserProfile = getAppUserProfile;
exports.saveAppUserProfile = saveAppUserProfile;
exports.getStockProductMirror = getStockProductMirror;
exports.upsertStockProductMirror = upsertStockProductMirror;
exports.removeStockProductsNotIn = removeStockProductsNotIn;
exports.updateStockProductMirrorQuantity = updateStockProductMirrorQuantity;
exports.markStockProductMirrorSyncFailed = markStockProductMirrorSyncFailed;
exports.createStaffOnboardingApplication = createStaffOnboardingApplication;
exports.updateStaffOnboardingSync = updateStaffOnboardingSync;
exports.importStaffOnboardingApplication = importStaffOnboardingApplication;
exports.getStaffOnboardingApplications = getStaffOnboardingApplications;
exports.getStaffOnboardingApplication = getStaffOnboardingApplication;
exports.beginStaffOnboardingApproval = beginStaffOnboardingApproval;
exports.finishStaffOnboardingApproval = finishStaffOnboardingApproval;
exports.createBoardIntakeQueueEntry = createBoardIntakeQueueEntry;
exports.updateBoardIntakeQueueEntry = updateBoardIntakeQueueEntry;
exports.getRecentBoardIntakeQueueEntries = getRecentBoardIntakeQueueEntries;
exports.getBoardIntakeQueueEntry = getBoardIntakeQueueEntry;
exports.claimBoardIntakeQueueEntry = claimBoardIntakeQueueEntry;
exports.getDueBoardIntakeQueueEntries = getDueBoardIntakeQueueEntries;
exports.releaseStaleBoardIntakeQueueEntry = releaseStaleBoardIntakeQueueEntry;
exports.getBoardIntakeLoggingReport = getBoardIntakeLoggingReport;
exports.getShopFloorIncidents = getShopFloorIncidents;
exports.createShopFloorIncident = createShopFloorIncident;
exports.resolveShopFloorIncident = resolveShopFloorIncident;
exports.getShopFloorAssignedItems = getShopFloorAssignedItems;
exports.assignShopFloorItem = assignShopFloorItem;
exports.getShopFloorFeatureFlags = getShopFloorFeatureFlags;
exports.saveShopFloorFeatureFlags = saveShopFloorFeatureFlags;
const uuid_1 = require("uuid");
const db_1 = require("./db");
const crypto_1 = require("../utils/crypto");
const helpers_1 = require("../utils/helpers");
const dateTime_1 = require("../utils/dateTime");
const env_1 = require("../utils/env");
const shopFloorReporting_1 = require("../utils/shopFloorReporting");
function nowMinusMinutesIso(windowMinutes) {
    return (0, dateTime_1.appDateTimeFromNow)(-Math.max(1, windowMinutes) * 60 * 1000);
}
function getSchedulerLockStaleMs() {
    const configuredMinutes = Number(env_1.env.SCHEDULER_LOCK_STALE_MINUTES || 10);
    const minutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0 ? configuredMinutes : 10;
    return minutes * 60 * 1000;
}
async function getSettingsRow() {
    let row = null;
    try {
        row = await (0, db_1.queryOne)(`
        SELECT
          odoo_base_url,
          odoo_database,
          odoo_username,
          odoo_api_key_encrypted,
          odoo_shop_floor_password_encrypted,
          field_mapping_json,
          parser_config_json,
          ai_config_json,
          scheduler_config_json,
          stock_config_json,
          mail_config_json,
          payroll_bridge_config_json,
          connection_status,
          connection_checked_at,
          connection_message,
          connection_version,
          updated_at
        FROM settings
        WHERE id = 1
      `);
    }
    catch (_error) {
        row = await (0, db_1.queryOne)(`
        SELECT
          odoo_base_url,
          odoo_database,
          odoo_username,
          odoo_api_key_encrypted,
          field_mapping_json,
          parser_config_json,
          ai_config_json,
          scheduler_config_json,
          stock_config_json,
          mail_config_json,
          payroll_bridge_config_json,
          connection_status,
          connection_checked_at,
          connection_message,
          connection_version,
          updated_at
        FROM settings
        WHERE id = 1
      `);
        if (row) {
            row.odoo_shop_floor_password_encrypted = '';
        }
    }
    if (!row) {
        throw new Error('Application settings row is missing.');
    }
    return row;
}
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function stringValue(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
function booleanValue(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        return value === 'true' || value === 'on' || value === '1';
    }
    return fallback;
}
function positiveNumberValue(value, fallback) {
    const parsed = Number(value || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function nonNegativeNumberValue(value, fallback) {
    const parsed = Number(value || '');
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function decryptMailPassword(encrypted, accountLabel) {
    if (!encrypted) {
        return '';
    }
    try {
        return (0, crypto_1.decryptSecret)(encrypted);
    }
    catch (error) {
        console.warn(`[settings] Stored SMTP password for ${accountLabel || 'mail account'} could not be decrypted. Re-save Outgoing Mail settings using the current APP_ENCRYPTION_KEY.`, error instanceof Error ? error.message : error);
        return '';
    }
}
function readMailConfig(mailConfigJson) {
    const defaults = (0, helpers_1.createDefaultMailConfig)();
    const raw = (0, helpers_1.safeJsonParse)(mailConfigJson, {});
    const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    const sourceAccounts = rawAccounts.length ? rawAccounts : defaults.accounts;
    const accounts = sourceAccounts.map((entry, index) => {
        const rawAccount = asRecord(entry);
        const fallbackAccount = defaults.accounts[index] || {
            label: index === 0 ? 'Primary' : `Account ${index + 1}`,
            username: '',
            password: '',
            fromEmail: '',
            fromName: defaults.accounts[0]?.fromName || 'Urban Vibe Access',
            enabled: false,
        };
        const label = stringValue(rawAccount.label, fallbackAccount.label || `Account ${index + 1}`);
        const encryptedPassword = stringValue(rawAccount.passwordEncrypted, '');
        const plainPassword = stringValue(rawAccount.password, fallbackAccount.password || '');
        return {
            label,
            username: stringValue(rawAccount.username, fallbackAccount.username).trim(),
            password: encryptedPassword ? decryptMailPassword(encryptedPassword, label) : plainPassword,
            fromEmail: stringValue(rawAccount.fromEmail, fallbackAccount.fromEmail).trim(),
            fromName: stringValue(rawAccount.fromName, fallbackAccount.fromName || 'Urban Vibe Access').trim(),
            enabled: booleanValue(rawAccount.enabled, fallbackAccount.enabled),
        };
    });
    const resolved = {
        transport: 'smtp',
        fallbackTransport: 'none',
        host: stringValue(raw.host, defaults.host).trim(),
        port: positiveNumberValue(raw.port, defaults.port),
        secure: booleanValue(raw.secure, defaults.secure),
        requireTls: booleanValue(raw.requireTls, defaults.requireTls),
        ignoreTls: booleanValue(raw.ignoreTls, defaults.ignoreTls),
        tlsRejectUnauthorized: booleanValue(raw.tlsRejectUnauthorized, defaults.tlsRejectUnauthorized),
        connectionTimeoutMs: positiveNumberValue(raw.connectionTimeoutMs, defaults.connectionTimeoutMs),
        greetingTimeoutMs: positiveNumberValue(raw.greetingTimeoutMs, defaults.greetingTimeoutMs),
        socketTimeoutMs: positiveNumberValue(raw.socketTimeoutMs, defaults.socketTimeoutMs),
        testRecipient: stringValue(raw.testRecipient, defaults.testRecipient || '').trim(),
        accounts,
        automations: (Array.isArray(raw.automations) ? raw.automations : defaults.automations).map((entry, index) => {
            const item = asRecord(entry);
            const fallback = defaults.automations[index];
            const systemKey = stringValue(item.systemKey, fallback?.systemKey || 'custom');
            const frequency = stringValue(item.frequency, fallback?.frequency || 'daily');
            return {
                id: stringValue(item.id, fallback?.id || `custom-${index + 1}`),
                name: stringValue(item.name, fallback?.name || `Email ${index + 1}`),
                systemKey: ['shop-floor-reminders', 'weekly-shop-floor-report', 'mpesa-review', 'mo-overtime', 'custom'].includes(systemKey) ? systemKey : 'custom',
                enabled: booleanValue(item.enabled, fallback?.enabled ?? false),
                frequency: ['hourly', 'daily', 'weekly'].includes(frequency) ? frequency : 'daily',
                interval: positiveNumberValue(item.interval, fallback?.interval || 1),
                dayOfWeek: Math.min(6, Math.max(0, Number(item.dayOfWeek ?? fallback?.dayOfWeek ?? 1))),
                hour: Math.min(23, Math.max(0, Number(item.hour ?? fallback?.hour ?? 8))),
                recipients: stringValue(item.recipients, fallback?.recipients || '').trim(),
                subject: stringValue(item.subject, fallback?.subject || '').trim(),
                body: stringValue(item.body, fallback?.body || ''),
                lastSentAt: stringValue(item.lastSentAt, ''),
            };
        }),
        shopFloorReportingStartDate: (0, shopFloorReporting_1.normalizeShopFloorReportingStartDate)(stringValue(raw.shopFloorReportingStartDate, defaults.shopFloorReportingStartDate)),
    };
    const normalizedHost = resolved.host.toLowerCase();
    if (normalizedHost === 'smtp.zoho.com' && resolved.port === 465) {
        return {
            ...resolved,
            transport: 'smtp',
            fallbackTransport: 'none',
            secure: true,
            requireTls: false,
            ignoreTls: false,
        };
    }
    if (normalizedHost === 'smtp.zoho.com' && resolved.port === 587) {
        return {
            ...resolved,
            transport: 'smtp',
            fallbackTransport: 'none',
            secure: false,
            requireTls: true,
            ignoreTls: false,
        };
    }
    return resolved;
}
function buildStoredMailConfig(mail) {
    return {
        ...mail,
        accounts: mail.accounts.map((account) => ({
            label: account.label,
            username: account.username,
            fromEmail: account.fromEmail,
            fromName: account.fromName,
            enabled: account.enabled,
            passwordEncrypted: account.password ? (0, crypto_1.encryptSecret)(account.password) : '',
        })),
    };
}
function defaultPayrollBridgeConfig() {
    return {
        url: env_1.env.PAYROLL_BRIDGE_URL || '',
        token: env_1.env.PAYROLL_BRIDGE_TOKEN || '',
        source: env_1.env.PAYROLL_ADVANCE_SOURCE || 'app.urbanvibeinteriordesign.co.ke',
        autoCreatePayRun: booleanValue(env_1.env.PAYROLL_AUTO_CREATE_PAYRUN, false),
        salaryStructure: env_1.env.PAYROLL_SALARY_STRUCTURE || 'All',
        payRunNameTemplate: env_1.env.PAYROLL_PAY_RUN_NAME_TEMPLATE || '{monthName} {year}',
    };
}
function decryptPayrollBridgeToken(encrypted) {
    if (!encrypted) {
        return '';
    }
    try {
        return (0, crypto_1.decryptSecret)(encrypted);
    }
    catch (error) {
        console.warn('[settings] Stored payroll bridge token could not be decrypted. Re-save Payroll Bridge settings using the current APP_ENCRYPTION_KEY.', error instanceof Error ? error.message : error);
        return '';
    }
}
function readPayrollBridgeConfig(payrollBridgeConfigJson) {
    const defaults = defaultPayrollBridgeConfig();
    const raw = (0, helpers_1.safeJsonParse)(payrollBridgeConfigJson, {});
    const encryptedToken = stringValue(raw.tokenEncrypted, '');
    const hasStoredToken = Object.prototype.hasOwnProperty.call(raw, 'tokenEncrypted') ||
        Object.prototype.hasOwnProperty.call(raw, 'token');
    const plainToken = hasStoredToken ? stringValue(raw.token, '') : defaults.token;
    return {
        url: stringValue(raw.url, defaults.url).trim(),
        token: encryptedToken ? decryptPayrollBridgeToken(encryptedToken) : plainToken,
        source: stringValue(raw.source, defaults.source).trim() || defaults.source,
        autoCreatePayRun: booleanValue(raw.autoCreatePayRun, defaults.autoCreatePayRun),
        salaryStructure: stringValue(raw.salaryStructure, defaults.salaryStructure).trim() || 'All',
        payRunNameTemplate: stringValue(raw.payRunNameTemplate, defaults.payRunNameTemplate).trim() ||
            '{monthName} {year}',
    };
}
function buildStoredPayrollBridgeConfig(payrollBridge) {
    return {
        url: payrollBridge.url,
        source: payrollBridge.source,
        autoCreatePayRun: payrollBridge.autoCreatePayRun,
        salaryStructure: payrollBridge.salaryStructure,
        payRunNameTemplate: payrollBridge.payRunNameTemplate,
        tokenEncrypted: payrollBridge.token ? (0, crypto_1.encryptSecret)(payrollBridge.token) : '',
    };
}
async function getSettings() {
    const row = await getSettingsRow();
    const rawFieldMappings = (0, helpers_1.safeJsonParse)(row.field_mapping_json, {});
    const fieldMappings = {
        ...(0, helpers_1.createEmptyFieldMappings)(),
        ...rawFieldMappings,
        logField: rawFieldMappings.logField ?? rawFieldMappings.processingLogField ?? '',
        processedAtField: rawFieldMappings.processedAtField ?? rawFieldMappings.lastProcessedAtField ?? '',
        attachmentNameField: rawFieldMappings.attachmentNameField ?? rawFieldMappings.lastAttachmentNameField ?? '',
        signatureField: rawFieldMappings.signatureField ?? '',
    };
    const parser = {
        ...helpers_1.DEFAULT_PARSER_CONFIG,
        ...(0, helpers_1.safeJsonParse)(row.parser_config_json, {}),
    };
    const rawAi = (0, helpers_1.safeJsonParse)(row.ai_config_json, {});
    const encryptedApiKeys = (0, helpers_1.safeJsonParse)(rawAi.apiKeysEncryptedJson, {});
    const rawAiOcr = (rawAi.ocr || {});
    const aiApiKeys = { ...helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.apiKeys };
    Object.keys(aiApiKeys).forEach((key) => {
        const encrypted = encryptedApiKeys[key];
        if (!encrypted) {
            aiApiKeys[key] = '';
            return;
        }
        try {
            aiApiKeys[key] = (0, crypto_1.decryptSecret)(encrypted);
        }
        catch (error) {
            console.warn(`[settings] Stored ${key} AI API key could not be decrypted. Re-save AI settings using the current APP_ENCRYPTION_KEY.`, error instanceof Error ? error.message : error);
            aiApiKeys[key] = '';
        }
    });
    let aiOcrApiKey = '';
    if (rawAiOcr.apiKeyEncrypted) {
        try {
            aiOcrApiKey = (0, crypto_1.decryptSecret)(rawAiOcr.apiKeyEncrypted);
        }
        catch (error) {
            console.warn('[settings] Stored NVIDIA OCR API key could not be decrypted. Re-save OCR settings using the current APP_ENCRYPTION_KEY.', error instanceof Error ? error.message : error);
        }
    }
    const ai = {
        ...helpers_1.DEFAULT_AI_EXTRACTION_CONFIG,
        ...rawAi,
        enabled: Boolean(rawAi.enabled),
        provider: rawAi.provider || helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.provider,
        confidenceThreshold: Number(rawAi.confidenceThreshold || helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.confidenceThreshold),
        maxImages: Number(rawAi.maxImages || helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.maxImages),
        apiKeys: aiApiKeys,
        ocr: {
            ...helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.ocr,
            ...rawAiOcr,
            enabled: Boolean(rawAiOcr.enabled),
            provider: rawAiOcr.provider || helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.ocr.provider,
            model: String(rawAiOcr.model || helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.ocr.model)
                .replace('nvidia/nemoretriever-ocr-v1', 'nvidia/nemotron-ocr-v2')
                .replace('nvidia/nemotron-ocr-v1', 'nvidia/nemotron-ocr-v2'),
            endpoint: String(rawAiOcr.endpoint || helpers_1.DEFAULT_AI_EXTRACTION_CONFIG.ocr.endpoint)
                .replace('nvidia/nemoretriever-ocr-v1', 'nvidia/nemotron-ocr-v2')
                .replace('nvidia/nemotron-ocr-v1', 'nvidia/nemotron-ocr-v2')
                .replace(/\/v1\/infer$/, ''),
            // The same NVIDIA API key can authorize both invoice AI and OCR.
            // Keep the dedicated OCR key as an override, but do not require users
            // to store an identical NVIDIA key twice.
            apiKey: aiOcrApiKey || aiApiKeys.nvidia,
        },
    };
    const rawScheduler = (0, helpers_1.safeJsonParse)(row.scheduler_config_json, {});
    const scheduler = {
        ...helpers_1.DEFAULT_SCHEDULER_CONFIG,
        ...rawScheduler,
    };
    delete scheduler.poBillScheduler;
    const poBillScheduler = {
        ...helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG,
        ...rawScheduler.poBillScheduler,
    };
    const stock = {
        ...helpers_1.DEFAULT_STOCK_CONFIG,
        ...(0, helpers_1.safeJsonParse)(row.stock_config_json, {}),
    };
    const mail = readMailConfig(row.mail_config_json);
    const payrollBridge = readPayrollBridgeConfig(row.payroll_bridge_config_json);
    let odooApiKey = '';
    let odooShopFloorPassword = '';
    if (row.odoo_api_key_encrypted) {
        try {
            odooApiKey = (0, crypto_1.decryptSecret)(row.odoo_api_key_encrypted);
        }
        catch (error) {
            console.warn('[settings] Stored Odoo API key could not be decrypted. Re-save the Odoo credentials in Settings using the current APP_ENCRYPTION_KEY.', error instanceof Error ? error.message : error);
        }
    }
    if (row.odoo_shop_floor_password_encrypted) {
        try {
            odooShopFloorPassword = (0, crypto_1.decryptSecret)(row.odoo_shop_floor_password_encrypted);
        }
        catch (error) {
            console.warn('[settings] Stored Odoo Shop Floor web password could not be decrypted. Re-save it in Settings using the current APP_ENCRYPTION_KEY.', error instanceof Error ? error.message : error);
        }
    }
    return {
        odoo: {
            baseUrl: row.odoo_base_url || '',
            database: row.odoo_database || '',
            username: row.odoo_username || '',
            apiKey: odooApiKey,
            shopFloorPassword: odooShopFloorPassword,
        },
        fieldMappings,
        parser: {
            ...parser,
            postChatterOnSuccess: Boolean(parser.postChatterOnSuccess),
        },
        ai,
        scheduler: {
            ...scheduler,
            enabled: Boolean(scheduler.enabled),
            useInProcessInterval: Boolean(scheduler.useInProcessInterval),
            intervalMinutes: Number(scheduler.intervalMinutes || helpers_1.DEFAULT_SCHEDULER_CONFIG.intervalMinutes),
            batchSize: Number(scheduler.batchSize || helpers_1.DEFAULT_SCHEDULER_CONFIG.batchSize),
        },
        poBillScheduler: {
            ...poBillScheduler,
            enabled: Boolean(poBillScheduler.enabled),
            useInProcessInterval: Boolean(poBillScheduler.useInProcessInterval),
            intervalMinutes: Number(poBillScheduler.intervalMinutes || helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.intervalMinutes),
            batchSize: Number(poBillScheduler.batchSize || helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.batchSize),
            fromDate: String(poBillScheduler.fromDate || helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.fromDate) === '2026-01-01 00:00:00'
                ? helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.fromDate
                : String(poBillScheduler.fromDate || helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.fromDate),
            cronToken: String(poBillScheduler.cronToken || ''),
            maxRetryAttempts: positiveNumberValue(poBillScheduler.maxRetryAttempts, helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.maxRetryAttempts),
            transientRetryHours: positiveNumberValue(poBillScheduler.transientRetryHours, helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.transientRetryHours),
            retryBackoffHours: Array.isArray(poBillScheduler.retryBackoffHours)
                ? poBillScheduler.retryBackoffHours.map(Number).filter((value) => Number.isFinite(value) && value > 0)
                : helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.retryBackoffHours,
            stableSkipRetryDays: Number(poBillScheduler.stableSkipRetryDays) === 14
                ? 0
                : nonNegativeNumberValue(poBillScheduler.stableSkipRetryDays, helpers_1.DEFAULT_PO_BILL_SCHEDULER_CONFIG.stableSkipRetryDays),
        },
        stock: {
            locationId: String(stock.locationId || ''),
            locationName: String(stock.locationName || ''),
            warehouseId: String(stock.warehouseId || ''),
            pickingTypeId: String(stock.pickingTypeId || ''),
            missingSoAlertUserLogin: String(stock.missingSoAlertUserLogin || ''),
            missingComponentAlertUserLogin: String(stock.missingComponentAlertUserLogin || ''),
        },
        mail,
        payrollBridge,
        connection: {
            status: row.connection_status || 'not_configured',
            checkedAt: row.connection_checked_at,
            message: row.connection_message,
            version: row.connection_version,
        },
        updatedAt: row.updated_at,
    };
}
async function saveSettings(input) {
    const existing = await getSettings();
    const nextApiKey = input.clearStoredApiKey
        ? (input.apiKey || '')
        : input.keepExistingApiKey && !input.apiKey
            ? existing.odoo.apiKey
            : input.apiKey || '';
    const nextShopFloorPassword = input.clearStoredShopFloorPassword
        ? (input.shopFloorPassword || '')
        : input.shopFloorPassword
            ? input.shopFloorPassword
            : input.keepExistingShopFloorPassword === false
                ? ''
                : existing.odoo.shopFloorPassword || '';
    const fieldMappings = {
        ...(0, helpers_1.createEmptyFieldMappings)(),
        ...existing.fieldMappings,
        ...input.fieldMappings,
    };
    const parser = {
        ...existing.parser,
        ...input.parser,
    };
    const submittedAi = input.ai || {};
    const submittedAiKeys = (submittedAi.apiKeys || {});
    const clearAiKeys = (submittedAi.clearApiKeys || {});
    const aiApiKeys = { ...existing.ai.apiKeys };
    Object.keys(aiApiKeys).forEach((key) => {
        if (clearAiKeys[key]) {
            aiApiKeys[key] = '';
            return;
        }
        const submitted = submittedAiKeys[key]?.trim();
        if (submitted) {
            aiApiKeys[key] = submitted;
        }
    });
    const encryptedAiKeys = Object.keys(aiApiKeys).reduce((accumulator, key) => {
        accumulator[key] = aiApiKeys[key] ? (0, crypto_1.encryptSecret)(aiApiKeys[key]) : '';
        return accumulator;
    }, {});
    const ai = {
        ...existing.ai,
        ...submittedAi,
        ocr: {
            ...existing.ai.ocr,
            ...(submittedAi.ocr || {}),
            apiKeyEncrypted: (submittedAi.ocr || {}).clearApiKey
                ? ''
                : (submittedAi.ocr || {}).apiKey?.trim()
                    ? (0, crypto_1.encryptSecret)((submittedAi.ocr || {}).apiKey.trim())
                    : existing.ai.ocr.apiKey
                        ? (0, crypto_1.encryptSecret)(existing.ai.ocr.apiKey)
                        : '',
        },
        apiKeysEncryptedJson: JSON.stringify(encryptedAiKeys),
    };
    delete ai.apiKeys;
    delete ai.clearApiKeys;
    delete ai.ocr.apiKey;
    delete ai.ocr.clearApiKey;
    const scheduler = {
        ...existing.scheduler,
        ...input.scheduler,
        poBillScheduler: {
            ...existing.poBillScheduler,
            ...input.poBillScheduler,
        },
    };
    const stock = {
        ...existing.stock,
        ...input.stock,
    };
    const mail = input.mail
        ? {
            ...existing.mail,
            ...input.mail,
            accounts: input.mail.accounts,
        }
        : existing.mail;
    const payrollBridge = input.payrollBridge
        ? {
            ...existing.payrollBridge,
            ...input.payrollBridge,
            token: input.clearPayrollBridgeToken
                ? ''
                : input.payrollBridge.token || (input.keepExistingPayrollBridgeToken ? existing.payrollBridge.token : ''),
        }
        : existing.payrollBridge;
    try {
        await (0, db_1.execute)(`
        UPDATE settings
        SET
          odoo_base_url = ?,
          odoo_database = ?,
          odoo_username = ?,
          odoo_api_key_encrypted = ?,
          odoo_shop_floor_password_encrypted = ?,
          field_mapping_json = ?,
          parser_config_json = ?,
          ai_config_json = ?,
          scheduler_config_json = ?,
          stock_config_json = ?,
          mail_config_json = ?,
          payroll_bridge_config_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `, [
            input.baseUrl,
            input.database,
            input.username,
            (0, crypto_1.encryptSecret)(nextApiKey),
            nextShopFloorPassword ? (0, crypto_1.encryptSecret)(nextShopFloorPassword) : '',
            JSON.stringify(fieldMappings),
            JSON.stringify(parser),
            JSON.stringify(ai),
            JSON.stringify(scheduler),
            JSON.stringify(stock),
            JSON.stringify(buildStoredMailConfig(mail)),
            JSON.stringify(buildStoredPayrollBridgeConfig(payrollBridge)),
        ]);
    }
    catch (_err) {
        await (0, db_1.execute)(`
        UPDATE settings
        SET
          odoo_base_url = ?,
          odoo_database = ?,
          odoo_username = ?,
          odoo_api_key_encrypted = ?,
          field_mapping_json = ?,
          parser_config_json = ?,
          ai_config_json = ?,
          scheduler_config_json = ?,
          stock_config_json = ?,
          mail_config_json = ?,
          payroll_bridge_config_json = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `, [
            input.baseUrl,
            input.database,
            input.username,
            (0, crypto_1.encryptSecret)(nextApiKey),
            JSON.stringify(fieldMappings),
            JSON.stringify(parser),
            JSON.stringify(ai),
            JSON.stringify(scheduler),
            JSON.stringify(stock),
            JSON.stringify(buildStoredMailConfig(mail)),
            JSON.stringify(buildStoredPayrollBridgeConfig(payrollBridge)),
        ]);
    }
    return getSettings();
}
async function getCachedModelFields(modelName) {
    const row = await (0, db_1.queryOne)(`
      SELECT model_name, fields_json, fetched_at
      FROM odoo_model_fields_cache
      WHERE model_name = ?
    `, [modelName]);
    if (!row) {
        return {
            modelName,
            fields: [],
            fetchedAt: null,
        };
    }
    return {
        modelName: row.model_name,
        fields: (0, helpers_1.safeJsonParse)(row.fields_json, []),
        fetchedAt: row.fetched_at,
    };
}
async function saveCachedModelFields(modelName, fields) {
    const dialect = (0, db_1.getDatabaseDialect)();
    if (dialect === 'mysql') {
        await (0, db_1.execute)(`
        INSERT INTO odoo_model_fields_cache (model_name, fields_json, fetched_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          fields_json = VALUES(fields_json),
          fetched_at = CURRENT_TIMESTAMP
      `, [modelName, JSON.stringify(fields)]);
    }
    else {
        await (0, db_1.execute)(`
        INSERT INTO odoo_model_fields_cache (model_name, fields_json, fetched_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(model_name) DO UPDATE SET
          fields_json = excluded.fields_json,
          fetched_at = CURRENT_TIMESTAMP
      `, [modelName, JSON.stringify(fields)]);
    }
    return getCachedModelFields(modelName);
}
async function clearCachedModelFields() {
    const result = await (0, db_1.execute)('DELETE FROM odoo_model_fields_cache');
    return result.affectedRows;
}
function mapSchedulerRun(row) {
    return {
        id: row.id,
        status: row.status,
        trigger: row.trigger_source,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        scannedCount: Number(row.scanned_count || 0),
        processedCount: Number(row.processed_count || 0),
        skippedCount: Number(row.skipped_count || 0),
        failedCount: Number(row.failed_count || 0),
        summary: row.summary,
        errorMessage: row.error_message,
        context: (0, helpers_1.safeJsonParse)(row.context_json, {}),
    };
}
async function insertSchedulerRun(entry) {
    const id = (0, uuid_1.v4)();
    await (0, db_1.execute)(`
      INSERT INTO scheduler_runs (
        id, status, trigger_source, finished_at, scanned_count, processed_count, skipped_count, failed_count, summary, error_message, context_json
      )
      VALUES (?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        entry.status,
        entry.trigger,
        entry.status === 'skipped' ? 1 : 0,
        Number(entry.scannedCount || 0),
        Number(entry.processedCount || 0),
        Number(entry.skippedCount || 0),
        Number(entry.failedCount || 0),
        entry.summary || null,
        entry.errorMessage || null,
        JSON.stringify(entry.context || {}),
    ]);
    return getSchedulerRunById(id);
}
async function updateSchedulerRun(id, patch) {
    const current = await getSchedulerRunById(id);
    await (0, db_1.execute)(`
      UPDATE scheduler_runs
      SET
        status = ?,
        scanned_count = ?,
        processed_count = ?,
        skipped_count = ?,
        failed_count = ?,
        summary = ?,
        error_message = ?,
        context_json = ?,
        finished_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE finished_at END
      WHERE id = ?
    `, [
        patch.status ?? current.status,
        patch.scannedCount ?? current.scannedCount,
        patch.processedCount ?? current.processedCount,
        patch.skippedCount ?? current.skippedCount,
        patch.failedCount ?? current.failedCount,
        patch.summary ?? current.summary,
        patch.errorMessage ?? current.errorMessage,
        JSON.stringify(patch.context ?? current.context),
        patch.finished ? 1 : 0,
        id,
    ]);
    return getSchedulerRunById(id);
}
async function getSchedulerRunById(id) {
    const row = await (0, db_1.queryOne)(`
      SELECT
        id, status, trigger_source, started_at, finished_at,
        scanned_count, processed_count, skipped_count, failed_count,
        summary, error_message, context_json
      FROM scheduler_runs
      WHERE id = ?
    `, [id]);
    if (!row) {
        throw new Error(`Scheduler run ${id} was not found.`);
    }
    return mapSchedulerRun(row);
}
async function getRecentSchedulerRuns(limit = 10) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, status, trigger_source, started_at, finished_at,
        scanned_count, processed_count, skipped_count, failed_count,
        summary, error_message, context_json
      FROM scheduler_runs
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `, [limit]);
    return rows.map(mapSchedulerRun);
}
function formatDbDateString(val) {
    if (!val)
        return null;
    if (val instanceof Date)
        return Number.isFinite(val.getTime()) ? val.toISOString() : null;
    if (typeof val === 'string' && val.trim())
        return val;
    return null;
}
function mapSchedulerRuntimeState(row) {
    return {
        lockRunId: row.lock_run_id,
        lockAcquiredAt: formatDbDateString(row.lock_acquired_at),
        stopRequestedAt: formatDbDateString(row.stop_requested_at),
        lastSuccessfulRunId: row.last_successful_run_id,
        lastSuccessfulFinishedAt: formatDbDateString(row.last_successful_finished_at),
        lastCheckpointAt: formatDbDateString(row.last_checkpoint_at),
        lastErrorRunId: row.last_error_run_id,
        lastErrorMessage: row.last_error_message,
        updatedAt: formatDbDateString(row.updated_at),
    };
}
async function getSchedulerRuntimeState() {
    const row = await (0, db_1.queryOne)(`
      SELECT
        lock_run_id,
        lock_acquired_at,
        stop_requested_at,
        last_successful_run_id,
        last_successful_finished_at,
        last_checkpoint_at,
        last_error_run_id,
        last_error_message,
        updated_at
      FROM scheduler_runtime_state
      WHERE id = 1
    `);
    if (!row) {
        throw new Error('Scheduler runtime state row is missing.');
    }
    return mapSchedulerRuntimeState(row);
}
async function acquireSchedulerRunLock(runId) {
    const current = await getSchedulerRuntimeState();
    const acquiredAt = current.lockAcquiredAt ? Date.parse(current.lockAcquiredAt) : 0;
    const isStale = !acquiredAt || acquiredAt < Date.now() - getSchedulerLockStaleMs();
    if (current.lockRunId && !isStale) {
        return false;
    }
    if (current.lockRunId && isStale) {
        await (0, db_1.execute)(`
        UPDATE scheduler_runtime_state
        SET
          lock_run_id = NULL,
          lock_acquired_at = NULL,
          stop_requested_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `);
    }
    const result = await (0, db_1.execute)(`
      UPDATE scheduler_runtime_state
      SET
        lock_run_id = ?,
        lock_acquired_at = CURRENT_TIMESTAMP,
        stop_requested_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND (lock_run_id IS NULL OR lock_run_id = ? OR lock_acquired_at IS NULL)
    `, [runId, runId]);
    return result.affectedRows > 0;
}
async function markOrphanedStartedRunsAsFailed() {
    const staleCutoff = (0, dateTime_1.appDateTimeFromNow)(-getSchedulerLockStaleMs());
    await (0, db_1.execute)(`
      UPDATE scheduler_runs
      SET
        status = 'failed',
        summary = 'Scheduler run timed out or was interrupted (lock expired after 10 minutes).',
        error_message = 'Scheduler lock expired while run was in started state.',
        finished_at = CURRENT_TIMESTAMP
      WHERE status = 'started' AND started_at <= ?
    `, [staleCutoff]);
}
async function clearStaleSchedulerRunLock() {
    const current = await getSchedulerRuntimeState();
    const acquiredAt = current.lockAcquiredAt ? Date.parse(current.lockAcquiredAt) : 0;
    const isStale = current.lockRunId && (!acquiredAt || acquiredAt < Date.now() - getSchedulerLockStaleMs());
    if (!current.lockRunId) {
        await markOrphanedStartedRunsAsFailed();
        return null;
    }
    const activeRun = await (0, db_1.queryOne)(`
      SELECT id, status, finished_at
      FROM scheduler_runs
      WHERE id = ?
    `, [current.lockRunId]);
    const runIsNotActive = !activeRun || activeRun.status !== 'started' || Boolean(activeRun.finished_at);
    if (!isStale && !runIsNotActive) {
        await markOrphanedStartedRunsAsFailed();
        return null;
    }
    if (activeRun && activeRun.status === 'started') {
        await (0, db_1.execute)(`
        UPDATE scheduler_runs
        SET
          status = 'failed',
          summary = 'Scheduler run timed out or was interrupted (lock expired after 10 minutes).',
          error_message = 'Scheduler lock expired while run was in started state.',
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'started'
      `, [activeRun.id]);
    }
    await (0, db_1.execute)(`
      UPDATE scheduler_runtime_state
      SET
        lock_run_id = NULL,
        lock_acquired_at = NULL,
        stop_requested_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `, [current.lockRunId]);
    await markOrphanedStartedRunsAsFailed();
    return current;
}
async function touchSchedulerRunLock(runId) {
    await (0, db_1.execute)(`
      UPDATE scheduler_runtime_state
      SET
        lock_acquired_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `, [runId]);
}
async function releaseSchedulerRunLock(runId) {
    await (0, db_1.execute)(`
      UPDATE scheduler_runtime_state
      SET
        lock_run_id = NULL,
        lock_acquired_at = NULL,
        stop_requested_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `, [runId]);
}
async function requestSchedulerStop(runId) {
    if (!runId) {
        return false;
    }
    const result = await (0, db_1.execute)(`
      UPDATE scheduler_runtime_state
      SET
        stop_requested_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `, [runId]);
    return result.affectedRows > 0;
}
async function markSchedulerRunSucceeded(runId, checkpointAt) {
    await (0, db_1.execute)(`
      UPDATE scheduler_runtime_state
      SET
        last_successful_run_id = ?,
        last_successful_finished_at = CURRENT_TIMESTAMP,
        last_checkpoint_at = COALESCE(?, last_checkpoint_at),
        last_error_run_id = NULL,
        last_error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [runId, checkpointAt]);
}
async function markSchedulerRunFailed(runId, message) {
    await (0, db_1.execute)(`
      UPDATE scheduler_runtime_state
      SET
        last_error_run_id = ?,
        last_error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [runId, message]);
}
async function updateConnectionStatus(status, message, version = null) {
    await (0, db_1.execute)(`
      UPDATE settings
      SET
        connection_status = ?,
        connection_checked_at = CURRENT_TIMESTAMP,
        connection_message = ?,
        connection_version = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [status, message, version]);
}
function mapMpesaBatchRow(row) {
    return {
        id: row.id,
        originalFilename: row.original_filename,
        storedFilename: row.stored_filename,
        status: row.status,
        transactionCount: Number(row.transaction_count || 0),
        matchedCount: Number(row.matched_count || 0),
        newCount: Number(row.new_count || 0),
        needsFollowupCount: Number(row.needs_followup_count || 0),
        warningCount: Number(row.warning_count || 0),
        warnings: (0, helpers_1.safeJsonParse)(row.warnings_json, []),
        rawTextPreview: row.raw_text_preview || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapMpesaTransactionRow(row) {
    const parseNullableNumber = (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };
    return {
        id: row.id,
        batchId: row.batch_id,
        rowIndex: Number(row.row_index || 0),
        transactionDate: row.transaction_date,
        completionTime: row.completion_time,
        receiptNumber: row.receipt_number,
        details: row.details || '',
        paidIn: parseNullableNumber(row.paid_in),
        withdrawn: parseNullableNumber(row.withdrawn),
        balance: parseNullableNumber(row.balance),
        amount: parseNullableNumber(row.amount),
        direction: row.direction || 'unknown',
        counterparty: row.counterparty,
        phoneNumber: row.phone_number,
        transactionType: row.transaction_type || 'unknown',
        matchedPoId: row.matched_po_id === null ? null : Number(row.matched_po_id),
        matchedPoName: row.matched_po_name,
        matchConfidence: parseNullableNumber(row.match_confidence),
        userCategory: row.user_category,
        userSupplier: row.user_supplier,
        reviewStatus: row.review_status || 'new',
        notes: row.notes,
        aiNotes: row.ai_notes,
        candidates: (0, helpers_1.safeJsonParse)(row.candidates_json, []),
        raw: (0, helpers_1.safeJsonParse)(row.raw_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapMpesaTransactionExplorerRow(row) {
    const transaction = mapMpesaTransactionRow(row);
    return {
        ...transaction,
        effectiveCategory: row.effective_category || transaction.userCategory || transaction.transactionType || 'unknown',
        batchOriginalFilename: row.batch_original_filename,
        batchStoredFilename: row.batch_stored_filename,
        batchCreatedAt: row.batch_created_at,
    };
}
function normalizeMpesaDateKey(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }
    const isoMatch = raw.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
    }
    const textDateMatch = raw.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\b/i);
    if (textDateMatch) {
        const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(textDateMatch[1].toLowerCase());
        if (monthIndex >= 0) {
            return `${textDateMatch[3]}-${String(monthIndex + 1).padStart(2, '0')}-${textDateMatch[2].padStart(2, '0')}`;
        }
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return raw.toLowerCase();
}
function normalizeMpesaTimeKey(value) {
    const match = String(value || '').match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
    if (!match) {
        return '';
    }
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}
function normalizeMpesaAmountKey(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(2) : '';
}
function mpesaRetryMergeKey(transaction) {
    return [
        String(transaction.receiptNumber || '').trim().toUpperCase(),
        normalizeMpesaDateKey(transaction.transactionDate),
        normalizeMpesaTimeKey(transaction.completionTime),
        normalizeMpesaAmountKey(transaction.paidIn),
        normalizeMpesaAmountKey(transaction.withdrawn),
        normalizeMpesaAmountKey(transaction.amount),
        transaction.direction || 'unknown',
    ].join('|');
}
function mergeMpesaRetriedTransactions(newTransactions, existingTransactions) {
    const existingByKey = new Map();
    for (const transaction of existingTransactions) {
        const key = mpesaRetryMergeKey(transaction);
        existingByKey.set(key, [...(existingByKey.get(key) || []), transaction]);
    }
    return newTransactions.map((transaction) => {
        const key = mpesaRetryMergeKey(transaction);
        const candidates = existingByKey.get(key) || [];
        const existing = candidates.shift();
        if (!existing) {
            return transaction;
        }
        const existingCategory = String(existing.userCategory || '').trim();
        const existingSupplier = String(existing.userSupplier || '').trim();
        const isIncomingReceipt = transaction.direction === 'in' && transaction.transactionType !== 'mpesa_charge';
        const existingMatchName = String(existing.matchedPoName || '').trim();
        const existingReceivableMatch = /^(invoice|payment)\s+/i.test(existingMatchName);
        const shouldPreserveMatch = existing.matchedPoId !== null &&
            existing.matchedPoId !== undefined &&
            (!isIncomingReceipt || existingReceivableMatch);
        return {
            ...transaction,
            matchedPoId: shouldPreserveMatch ? existing.matchedPoId : transaction.matchedPoId,
            matchedPoName: shouldPreserveMatch ? existing.matchedPoName : transaction.matchedPoName,
            matchConfidence: shouldPreserveMatch ? existing.matchConfidence : transaction.matchConfidence,
            userCategory: existingCategory && existingCategory !== existing.transactionType ? existingCategory : transaction.userCategory,
            userSupplier: existingSupplier && existingSupplier !== String(existing.counterparty || '').trim()
                ? existingSupplier
                : transaction.userSupplier,
            reviewStatus: existing.reviewStatus !== 'new' && (!isIncomingReceipt || existing.reviewStatus !== 'verified' || shouldPreserveMatch)
                ? existing.reviewStatus
                : transaction.reviewStatus,
            notes: existing.notes || transaction.notes,
        };
    });
}
async function createMpesaStatementBatch(input) {
    const id = (0, uuid_1.v4)();
    const matchedCount = input.transactions.filter((transaction) => Boolean(transaction.matchedPoId)).length;
    await (0, db_1.execute)(`
      INSERT INTO mpesa_statement_batches (
        id, original_filename, stored_filename, status, transaction_count, matched_count,
        warning_count, warnings_json, raw_text_preview
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        input.originalFilename,
        input.storedFilename,
        input.status,
        input.transactions.length,
        matchedCount,
        input.warnings.length,
        JSON.stringify(input.warnings),
        input.rawTextPreview,
    ]);
    for (const transaction of input.transactions) {
        await (0, db_1.execute)(`
        INSERT INTO mpesa_transactions (
          id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
          paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
          transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
          user_supplier, review_status, notes, ai_notes, candidates_json, raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
            (0, uuid_1.v4)(),
            id,
            transaction.rowIndex,
            transaction.transactionDate,
            transaction.completionTime,
            transaction.receiptNumber,
            transaction.details,
            transaction.paidIn,
            transaction.withdrawn,
            transaction.balance,
            transaction.amount,
            transaction.direction,
            transaction.counterparty,
            transaction.phoneNumber,
            transaction.transactionType,
            transaction.matchedPoId,
            transaction.matchedPoName,
            transaction.matchConfidence,
            transaction.userCategory,
            transaction.userSupplier,
            transaction.reviewStatus,
            transaction.notes,
            transaction.aiNotes || null,
            JSON.stringify(transaction.candidates || []),
            JSON.stringify(transaction.raw || {}),
        ]);
    }
    return getMpesaStatementBatchById(id);
}
async function replaceMpesaStatementBatchExtraction(id, input) {
    await getMpesaStatementBatchById(id);
    const existingTransactions = await getMpesaTransactionsByBatchId(id);
    const mergedTransactions = mergeMpesaRetriedTransactions(input.transactions, existingTransactions);
    const matchedCount = mergedTransactions.filter((transaction) => Boolean(transaction.matchedPoId)).length;
    await (0, db_1.execute)(`
      DELETE FROM mpesa_transactions
      WHERE batch_id = ?
    `, [id]);
    await (0, db_1.execute)(`
      UPDATE mpesa_statement_batches
      SET
        status = ?,
        transaction_count = ?,
        matched_count = ?,
        warning_count = ?,
        warnings_json = ?,
        raw_text_preview = ?,
        original_filename = COALESCE(?, original_filename),
        stored_filename = COALESCE(?, stored_filename),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
        input.status,
        mergedTransactions.length,
        matchedCount,
        input.warnings.length,
        JSON.stringify(input.warnings),
        input.rawTextPreview,
        input.originalFilename || null,
        input.storedFilename || null,
        id,
    ]);
    for (const transaction of mergedTransactions) {
        await (0, db_1.execute)(`
        INSERT INTO mpesa_transactions (
          id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
          paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
          transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
          user_supplier, review_status, notes, ai_notes, candidates_json, raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
            (0, uuid_1.v4)(),
            id,
            transaction.rowIndex,
            transaction.transactionDate,
            transaction.completionTime,
            transaction.receiptNumber,
            transaction.details,
            transaction.paidIn,
            transaction.withdrawn,
            transaction.balance,
            transaction.amount,
            transaction.direction,
            transaction.counterparty,
            transaction.phoneNumber,
            transaction.transactionType,
            transaction.matchedPoId,
            transaction.matchedPoName,
            transaction.matchConfidence,
            transaction.userCategory,
            transaction.userSupplier,
            transaction.reviewStatus,
            transaction.notes,
            transaction.aiNotes || null,
            JSON.stringify(transaction.candidates || []),
            JSON.stringify(transaction.raw || {}),
        ]);
    }
    return getMpesaStatementBatchById(id);
}
async function getRecentMpesaStatementBatches(limit = 12) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        b.id,
        b.original_filename,
        b.stored_filename,
        b.status,
        b.transaction_count,
        b.matched_count,
        COALESCE(SUM(CASE WHEN t.review_status = 'new' THEN 1 ELSE 0 END), 0) AS new_count,
        COALESCE(SUM(CASE WHEN t.review_status = 'needs_followup' THEN 1 ELSE 0 END), 0) AS needs_followup_count,
        b.warning_count,
        b.warnings_json,
        b.raw_text_preview,
        b.created_at,
        b.updated_at
      FROM mpesa_statement_batches b
      LEFT JOIN mpesa_transactions t ON t.batch_id = b.id
      GROUP BY
        b.id, b.original_filename, b.stored_filename, b.status, b.transaction_count,
        b.matched_count, b.warning_count, b.warnings_json, b.raw_text_preview,
        b.created_at, b.updated_at
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ?
    `, [limit]);
    return rows.map(mapMpesaBatchRow);
}
async function getMpesaStatementBatchesWithOpenReviewCounts() {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        b.id,
        b.original_filename,
        b.stored_filename,
        b.status,
        b.transaction_count,
        b.matched_count,
        COALESCE(SUM(CASE WHEN t.review_status = 'new' THEN 1 ELSE 0 END), 0) AS new_count,
        COALESCE(SUM(CASE WHEN t.review_status = 'needs_followup' THEN 1 ELSE 0 END), 0) AS needs_followup_count,
        b.warning_count,
        b.warnings_json,
        b.raw_text_preview,
        b.created_at,
        b.updated_at
      FROM mpesa_statement_batches b
      LEFT JOIN mpesa_transactions t ON t.batch_id = b.id
      GROUP BY
        b.id, b.original_filename, b.stored_filename, b.status, b.transaction_count,
        b.matched_count, b.warning_count, b.warnings_json, b.raw_text_preview,
        b.created_at, b.updated_at
      HAVING new_count > 0 OR needs_followup_count > 0
      ORDER BY b.created_at DESC, b.id DESC
    `);
    return rows.map(mapMpesaBatchRow);
}
async function hasMpesaStatementUploadedSince(since) {
    const row = await (0, db_1.queryOne)(`SELECT id FROM mpesa_statement_batches WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1`, [since]);
    return Boolean(row);
}
async function hasMpesaReviewNotificationSince(since) {
    const row = await (0, db_1.queryOne)(`
      SELECT id
      FROM logs
      WHERE message = 'M-Pesa review notification sent'
        AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [since]);
    return Boolean(row);
}
async function getMpesaStatementBatchById(id) {
    const row = await (0, db_1.queryOne)(`
      SELECT
        b.id,
        b.original_filename,
        b.stored_filename,
        b.status,
        b.transaction_count,
        b.matched_count,
        COALESCE(SUM(CASE WHEN t.review_status = 'new' THEN 1 ELSE 0 END), 0) AS new_count,
        COALESCE(SUM(CASE WHEN t.review_status = 'needs_followup' THEN 1 ELSE 0 END), 0) AS needs_followup_count,
        b.warning_count,
        b.warnings_json,
        b.raw_text_preview,
        b.created_at,
        b.updated_at
      FROM mpesa_statement_batches b
      LEFT JOIN mpesa_transactions t ON t.batch_id = b.id
      WHERE b.id = ?
      GROUP BY
        b.id, b.original_filename, b.stored_filename, b.status, b.transaction_count,
        b.matched_count, b.warning_count, b.warnings_json, b.raw_text_preview,
        b.created_at, b.updated_at
    `, [id]);
    if (!row) {
        throw new Error(`M-Pesa statement batch ${id} was not found.`);
    }
    return mapMpesaBatchRow(row);
}
async function deleteMpesaStatementBatch(id) {
    const batch = await getMpesaStatementBatchById(id);
    await (0, db_1.execute)(`
      DELETE FROM mpesa_transactions
      WHERE batch_id = ?
    `, [id]);
    await (0, db_1.execute)(`
      DELETE FROM mpesa_statement_batches
      WHERE id = ?
    `, [id]);
    return batch;
}
async function getMpesaTransactionsByBatchId(batchId) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
        paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
        transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
        user_supplier, review_status, notes, ai_notes, candidates_json, raw_json, created_at, updated_at
      FROM mpesa_transactions
      WHERE batch_id = ?
      ORDER BY row_index ASC, id ASC
    `, [batchId]);
    return rows.map(mapMpesaTransactionRow);
}
async function getMpesaTransactionsByIds(ids) {
    const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
    if (uniqueIds.length === 0) {
        return [];
    }
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
        paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
        transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
        user_supplier, review_status, notes, ai_notes, candidates_json, raw_json,
        created_at, updated_at
      FROM mpesa_transactions
      WHERE id IN (${placeholders})
    `, uniqueIds);
    return rows.map(mapMpesaTransactionRow);
}
async function getMpesaTransactionExplorerOptions() {
    const [categoryRows, monthRows, statementRows] = await Promise.all([
        (0, db_1.queryAll)(`
        SELECT DISTINCT COALESCE(NULLIF(user_category, ''), transaction_type, 'unknown') AS category
        FROM mpesa_transactions
        ORDER BY category ASC
      `),
        (0, db_1.queryAll)(`
        SELECT DISTINCT SUBSTR(transaction_date, 1, 7) AS month
        FROM mpesa_transactions
        WHERE transaction_date IS NOT NULL AND transaction_date <> ''
        ORDER BY month DESC
      `),
        (0, db_1.queryAll)(`
        SELECT id, original_filename, created_at, transaction_count
        FROM mpesa_statement_batches
        ORDER BY created_at DESC, id DESC
      `),
    ]);
    return {
        categories: categoryRows
            .map((row) => String(row.category || '').trim())
            .filter((category, index, list) => Boolean(category) && list.indexOf(category) === index),
        months: monthRows
            .map((row) => String(row.month || '').trim())
            .filter((month, index, list) => /^\d{4}-\d{2}$/.test(month) && list.indexOf(month) === index),
        statements: statementRows.map((row) => ({
            id: row.id,
            originalFilename: row.original_filename,
            createdAt: row.created_at,
            transactionCount: Number(row.transaction_count || 0),
        })),
    };
}
async function getMpesaTransactionExplorerRows(filters) {
    const dialect = (0, db_1.getDatabaseDialect)();
    const searchTextExpression = dialect === 'mysql'
        ? `LOWER(CONCAT_WS(' ', t.counterparty, t.user_supplier, t.details, t.phone_number, t.receipt_number, t.matched_po_name, t.notes, t.ai_notes, CAST(COALESCE(t.amount, 0) AS CHAR), CAST(COALESCE(t.balance, 0) AS CHAR), t.raw_json, b.original_filename))`
        : `LOWER(COALESCE(t.counterparty, '') || ' ' || COALESCE(t.user_supplier, '') || ' ' || COALESCE(t.details, '') || ' ' || COALESCE(t.phone_number, '') || ' ' || COALESCE(t.receipt_number, '') || ' ' || COALESCE(t.matched_po_name, '') || ' ' || COALESCE(t.notes, '') || ' ' || COALESCE(t.ai_notes, '') || ' ' || CAST(COALESCE(t.amount, 0) AS TEXT) || ' ' || CAST(COALESCE(t.balance, 0) AS TEXT) || ' ' || COALESCE(t.raw_json, '') || ' ' || COALESCE(b.original_filename, ''))`;
    const where = [];
    const params = [];
    const nameTokens = filters.name
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
    for (const token of nameTokens) {
        where.push(`${searchTextExpression} LIKE ?`);
        params.push(`%${token}%`);
    }
    if (filters.partyRole === 'sender') {
        where.push(`(t.direction = 'in' OR COALESCE(t.paid_in, 0) > 0)`);
    }
    else if (filters.partyRole === 'receiver') {
        where.push(`(t.direction = 'out' OR COALESCE(t.withdrawn, 0) > 0)`);
    }
    if (filters.category) {
        where.push(`COALESCE(NULLIF(t.user_category, ''), t.transaction_type, 'unknown') = ?`);
        params.push(filters.category);
    }
    if (filters.month) {
        where.push(`SUBSTR(t.transaction_date, 1, 7) = ?`);
        params.push(filters.month);
    }
    if (filters.reviewStatus) {
        where.push(`t.review_status = ?`);
        params.push(filters.reviewStatus);
    }
    if (filters.statementId) {
        where.push(`t.batch_id = ?`);
        params.push(filters.statementId);
    }
    const rows = await (0, db_1.queryAll)(`
      SELECT
        t.id,
        t.batch_id,
        t.row_index,
        t.transaction_date,
        t.completion_time,
        t.receipt_number,
        t.details,
        t.paid_in,
        t.withdrawn,
        t.balance,
        t.amount,
        t.direction,
        t.counterparty,
        t.phone_number,
        t.transaction_type,
        t.matched_po_id,
        t.matched_po_name,
        t.match_confidence,
        t.user_category,
        t.user_supplier,
        t.review_status,
        t.notes,
        t.ai_notes,
        t.candidates_json,
        t.raw_json,
        t.created_at,
        t.updated_at,
        COALESCE(NULLIF(t.user_category, ''), t.transaction_type, 'unknown') AS effective_category,
        b.original_filename AS batch_original_filename,
        b.stored_filename AS batch_stored_filename,
        b.created_at AS batch_created_at
      FROM mpesa_transactions t
      INNER JOIN mpesa_statement_batches b ON b.id = t.batch_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        SUBSTR(t.transaction_date, 1, 10) DESC,
        t.completion_time DESC,
        b.created_at DESC,
        t.row_index ASC,
        t.id ASC
    `, params);
    return rows.map(mapMpesaTransactionExplorerRow);
}
async function getReviewedSalaryAdvanceTransactionsByPeriod(input) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
        paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
        transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
        user_supplier, review_status, notes, ai_notes, candidates_json, raw_json, created_at, updated_at
      FROM mpesa_transactions
      WHERE COALESCE(NULLIF(user_category, ''), transaction_type) = 'advance_salary'
        AND review_status IN ('reviewed', 'verified')
        AND SUBSTR(transaction_date, 1, 10) >= ?
        AND SUBSTR(transaction_date, 1, 10) <= ?
      ORDER BY SUBSTR(transaction_date, 1, 10) ASC, completion_time ASC, row_index ASC, id ASC
    `, [input.periodStart, input.periodEnd]);
    return rows.map(mapMpesaTransactionRow);
}
/** Get all matched transactions across all batches from a given month onwards, skipping already-verified ones */
async function getMatchedOutgoingTransactionsSince(fromMonth) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
        paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
        transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
        user_supplier, review_status, notes, ai_notes, candidates_json, raw_json, created_at, updated_at
      FROM mpesa_transactions
      WHERE matched_po_id IS NOT NULL
        AND direction = 'out'
        AND transaction_type NOT IN ('mpesa_charge', 'staff_lunch_expense', 'staff_transport_expense', 'office_water_expense', 'cash_withdrawal', 'internal_transfer', 'bank_transfer')
        AND SUBSTR(transaction_date, 1, 7) >= ?
        AND (review_status IS NULL OR review_status <> 'verified')
      ORDER BY SUBSTR(transaction_date, 1, 10) ASC, completion_time ASC, row_index ASC, id ASC
    `, [fromMonth]);
    return rows.map(mapMpesaTransactionRow);
}
/** Get all matched incoming customer receipt transactions across all batches from a given month, skipping already-verified ones */
async function getMatchedIncomingTransactionsSince(fromMonth) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
        paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
        transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
        user_supplier, review_status, notes, ai_notes, candidates_json, raw_json, created_at, updated_at
      FROM mpesa_transactions
      WHERE matched_po_id IS NOT NULL
        AND (direction = 'in' OR COALESCE(paid_in, 0) > 0)
        AND transaction_type NOT IN ('mpesa_charge')
        AND SUBSTR(transaction_date, 1, 7) >= ?
        AND (review_status IS NULL OR review_status <> 'verified')
      ORDER BY SUBSTR(transaction_date, 1, 10) ASC, completion_time ASC, row_index ASC, id ASC
    `, [fromMonth]);
    return rows.map(mapMpesaTransactionRow);
}
async function refreshMpesaStatementBatchReviewState(batchId) {
    const summary = await (0, db_1.queryOne)(`
      SELECT
        COUNT(*) AS transaction_count,
        COALESCE(SUM(CASE WHEN matched_po_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS matched_count,
        COALESCE(SUM(CASE WHEN review_status <> 'new' THEN 1 ELSE 0 END), 0) AS reviewed_count
      FROM mpesa_transactions
      WHERE batch_id = ?
    `, [batchId]);
    const transactionCount = Number(summary?.transaction_count || 0);
    const matchedCount = Number(summary?.matched_count || 0);
    const reviewedCount = Number(summary?.reviewed_count || 0);
    const status = transactionCount > 0 && reviewedCount >= transactionCount ? 'parsed' : 'needs_review';
    await (0, db_1.execute)(`
      UPDATE mpesa_statement_batches
      SET
        status = ?,
        transaction_count = ?,
        matched_count = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [status, transactionCount, matchedCount, batchId]);
}
async function autoVerifyMpesaTransactionsByRule(batchId) {
    const autoVerifyCondition = `
    (
      direction = 'in'
      OR COALESCE(paid_in, 0) > 0
      OR transaction_type = 'customer_receipt'
      OR transaction_type = 'mpesa_charge'
      OR user_category = 'mpesa_charge'
      OR matched_po_name LIKE 'Invoice %'
    )
  `;
    const params = batchId ? [batchId] : [];
    const batchFilter = batchId ? 'AND batch_id = ?' : '';
    const affectedBatchRows = await (0, db_1.queryAll)(`
      SELECT DISTINCT batch_id
      FROM mpesa_transactions
      WHERE ${autoVerifyCondition}
        AND (review_status IS NULL OR review_status <> 'verified')
        ${batchFilter}
    `, params);
    if (!affectedBatchRows.length) {
        return 0;
    }
    const result = await (0, db_1.execute)(`
      UPDATE mpesa_transactions
      SET
        review_status = 'verified',
        updated_at = CURRENT_TIMESTAMP
      WHERE ${autoVerifyCondition}
        AND (review_status IS NULL OR review_status <> 'verified')
        ${batchFilter}
    `, params);
    for (const row of affectedBatchRows) {
        await refreshMpesaStatementBatchReviewState(row.batch_id);
    }
    return result.affectedRows;
}
async function updateMpesaTransactions(batchId, patches) {
    for (const patch of patches) {
        const shouldUpdateMatchConfidence = Object.prototype.hasOwnProperty.call(patch, 'matchConfidence');
        const shouldUpdateCandidates = Object.prototype.hasOwnProperty.call(patch, 'candidates');
        const shouldUpdateNotes = Object.prototype.hasOwnProperty.call(patch, 'notes') && patch.notes !== undefined;
        const shouldUpdateAiNotes = Object.prototype.hasOwnProperty.call(patch, 'aiNotes') && patch.aiNotes !== undefined;
        await (0, db_1.execute)(`
        UPDATE mpesa_transactions
        SET
          matched_po_id = ?,
          matched_po_name = ?,
          match_confidence = CASE WHEN ? = 1 THEN ? ELSE match_confidence END,
          candidates_json = CASE WHEN ? = 1 THEN ? ELSE candidates_json END,
          user_category = ?,
          user_supplier = ?,
          review_status = ?,
          notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
          ai_notes = CASE WHEN ? = 1 THEN ? ELSE ai_notes END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND batch_id = ?
      `, [
            patch.matchedPoId ?? null,
            patch.matchedPoName ?? null,
            shouldUpdateMatchConfidence ? 1 : 0,
            patch.matchConfidence ?? null,
            shouldUpdateCandidates ? 1 : 0,
            shouldUpdateCandidates ? JSON.stringify(patch.candidates || []) : null,
            patch.userCategory || null,
            patch.userSupplier || null,
            patch.reviewStatus || 'new',
            shouldUpdateNotes ? 1 : 0,
            patch.notes || null,
            shouldUpdateAiNotes ? 1 : 0,
            patch.aiNotes || null,
            patch.id,
            batchId,
        ]);
    }
    await refreshMpesaStatementBatchReviewState(batchId);
    return getMpesaStatementBatchById(batchId);
}
async function updateMpesaTransactionAdminReviewFields(patches) {
    const batchIds = new Set();
    for (const patch of patches) {
        if (!patch.id || !patch.batchId) {
            continue;
        }
        const shouldUpdateNotes = Object.prototype.hasOwnProperty.call(patch, 'notes') && patch.notes !== undefined;
        const shouldUpdateAiNotes = Object.prototype.hasOwnProperty.call(patch, 'aiNotes') && patch.aiNotes !== undefined;
        await (0, db_1.execute)(`
        UPDATE mpesa_transactions
        SET
          user_category = ?,
          review_status = ?,
          notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
          ai_notes = CASE WHEN ? = 1 THEN ? ELSE ai_notes END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND batch_id = ?
      `, [
            patch.userCategory || null,
            patch.reviewStatus || 'new',
            shouldUpdateNotes ? 1 : 0,
            patch.notes || null,
            shouldUpdateAiNotes ? 1 : 0,
            patch.aiNotes || null,
            patch.id,
            patch.batchId,
        ]);
        batchIds.add(patch.batchId);
    }
    for (const batchId of batchIds) {
        await refreshMpesaStatementBatchReviewState(batchId);
    }
    return batchIds.size;
}
async function insertLog(entry) {
    const id = (0, uuid_1.v4)();
    await (0, db_1.execute)(`
      INSERT INTO logs (id, history_id, level, message, context_json)
      VALUES (?, ?, ?, ?, ?)
    `, [id, entry.historyId || null, entry.level, entry.message, JSON.stringify(entry.context || {})]);
    return id;
}
async function getRecentLogs(limit = 50, historyId) {
    const rows = historyId
        ? await (0, db_1.queryAll)(`
          SELECT id, history_id, level, message, context_json, created_at
          FROM logs
          WHERE history_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `, [historyId, limit])
        : await (0, db_1.queryAll)(`
          SELECT id, history_id, level, message, context_json, created_at
          FROM logs
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `, [limit]);
    return rows.map((row) => ({
        id: row.id,
        historyId: row.history_id,
        level: row.level,
        message: row.message,
        context: (0, helpers_1.safeJsonParse)(row.context_json, {}),
        createdAt: row.created_at,
    }));
}
function mapHistoryRow(row) {
    return {
        id: row.id,
        orderId: Number(row.order_id),
        orderName: row.order_name,
        attachmentId: Number(row.attachment_id),
        attachmentName: row.attachment_name,
        status: row.status,
        summary: row.summary,
        errorMessage: row.error_message,
        extractedResultId: row.extracted_result_id,
        computedSignature: row.computed_signature,
        storedSignature: row.stored_signature,
        signatureComparison: row.signature_comparison,
        sendSkipped: Boolean(row.send_skipped),
        signatureWritten: Boolean(row.signature_written),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
async function insertHistory(entry) {
    const id = (0, uuid_1.v4)();
    await (0, db_1.execute)(`
      INSERT INTO history (
        id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
        computed_signature, stored_signature, signature_comparison, send_skipped, signature_written
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        entry.orderId,
        entry.orderName,
        entry.attachmentId,
        entry.attachmentName,
        entry.status,
        entry.summary || null,
        entry.errorMessage || null,
        entry.computedSignature || null,
        entry.storedSignature || null,
        entry.signatureComparison || null,
        entry.sendSkipped ? 1 : 0,
        entry.signatureWritten ? 1 : 0,
    ]);
    return getHistoryById(id);
}
async function updateHistory(id, patch) {
    const current = await getHistoryById(id);
    await (0, db_1.execute)(`
      UPDATE history
      SET
        status = ?,
        summary = ?,
        error_message = ?,
        extracted_result_id = ?,
        computed_signature = ?,
        stored_signature = ?,
        signature_comparison = ?,
        send_skipped = ?,
        signature_written = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
        patch.status ?? current.status,
        patch.summary ?? current.summary,
        patch.errorMessage ?? current.errorMessage,
        patch.extractedResultId ?? current.extractedResultId,
        patch.computedSignature ?? current.computedSignature,
        patch.storedSignature ?? current.storedSignature,
        patch.signatureComparison ?? current.signatureComparison,
        (patch.sendSkipped ?? current.sendSkipped) ? 1 : 0,
        (patch.signatureWritten ?? current.signatureWritten) ? 1 : 0,
        id,
    ]);
    return getHistoryById(id);
}
async function getHistoryById(id) {
    const row = await (0, db_1.queryOne)(`
      SELECT
        id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
        extracted_result_id, computed_signature, stored_signature, signature_comparison,
        send_skipped, signature_written, created_at, updated_at
      FROM history
      WHERE id = ?
    `, [id]);
    if (!row) {
        throw new Error(`History entry ${id} was not found.`);
    }
    return mapHistoryRow(row);
}
async function getRecentHistory(limit = 20, orderId) {
    const rows = orderId
        ? await (0, db_1.queryAll)(`
          SELECT
            id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
            extracted_result_id, computed_signature, stored_signature, signature_comparison,
            send_skipped, signature_written, created_at, updated_at
          FROM history
          WHERE order_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `, [orderId, limit])
        : await (0, db_1.queryAll)(`
          SELECT
            id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
            extracted_result_id, computed_signature, stored_signature, signature_comparison,
            send_skipped, signature_written, created_at, updated_at
          FROM history
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `, [limit]);
    return rows.map(mapHistoryRow);
}
function mapExtractedResult(row) {
    return {
        id: row.id,
        historyId: row.history_id,
        orderId: Number(row.order_id),
        orderName: row.order_name,
        attachmentId: Number(row.attachment_id),
        attachmentName: row.attachment_name,
        resultJson: (0, helpers_1.safeJsonParse)(row.result_json, {
            items: [],
            sectionFound: false,
            sectionText: '',
            rawText: '',
            logs: [],
        }),
        rawText: row.raw_text,
        pdfSignature: row.pdf_signature,
        createdAt: row.created_at,
    };
}
async function insertExtractedResult(entry) {
    const id = (0, uuid_1.v4)();
    await (0, db_1.execute)(`
      INSERT INTO extracted_results (
        id, history_id, order_id, order_name, attachment_id, attachment_name, result_json, raw_text, pdf_signature
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        id,
        entry.historyId,
        entry.orderId,
        entry.orderName,
        entry.attachmentId,
        entry.attachmentName,
        JSON.stringify(entry.resultJson),
        entry.rawText,
        entry.pdfSignature || null,
    ]);
    await updateHistory(entry.historyId, { extractedResultId: id });
    return getExtractedResultByHistoryId(entry.historyId);
}
async function getExtractedResultByHistoryId(historyId) {
    const row = await (0, db_1.queryOne)(`
      SELECT
        id, history_id, order_id, order_name, attachment_id, attachment_name,
        result_json, raw_text, pdf_signature, created_at
      FROM extracted_results
      WHERE history_id = ?
    `, [historyId]);
    return row ? mapExtractedResult(row) : null;
}
async function getLatestExtractedResultByOrderId(orderId) {
    const row = await (0, db_1.queryOne)(`
      SELECT
        er.id, er.history_id, er.order_id, er.order_name, er.attachment_id, er.attachment_name,
        er.result_json, er.raw_text, er.pdf_signature, er.created_at
      FROM extracted_results er
      INNER JOIN history h ON h.id = er.history_id
      WHERE er.order_id = ?
      ORDER BY h.updated_at DESC, h.id DESC
      LIMIT 1
    `, [orderId]);
    return row ? mapExtractedResult(row) : null;
}
async function getProcessedStockVariantIds(orderId, extractionSignature) {
    const rows = await (0, db_1.queryAll)(`
      SELECT spi.variant_id
      FROM stock_processed_items spi
      LEFT JOIN stock_reversed_items sri ON sri.processed_item_id = spi.id
      WHERE spi.order_id = ? AND spi.extraction_signature = ? AND sri.processed_item_id IS NULL
    `, [orderId, extractionSignature]);
    return rows.map((row) => Number(row.variant_id));
}
async function getUnreversedProcessedStockItemsForOrder(orderId) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        spi.id, spi.order_id, spi.extraction_signature, spi.variant_id,
        spi.normalized_color, spi.quantity_added_meters, spi.history_id, spi.created_at
      FROM stock_processed_items spi
      LEFT JOIN stock_reversed_items sri ON sri.processed_item_id = spi.id
      WHERE spi.order_id = ? AND sri.processed_item_id IS NULL
      ORDER BY spi.created_at DESC, spi.id DESC
    `, [orderId]);
    return rows.map((row) => ({
        id: row.id,
        orderId: Number(row.order_id),
        extractionSignature: row.extraction_signature,
        variantId: Number(row.variant_id),
        normalizedColor: row.normalized_color,
        quantityAddedMeters: Number(row.quantity_added_meters),
        historyId: row.history_id,
        createdAt: row.created_at,
    }));
}
async function insertProcessedStockItem(entry) {
    const id = (0, uuid_1.v4)();
    const dialect = (0, db_1.getDatabaseDialect)();
    const sql = dialect === 'mysql'
        ? `
          INSERT IGNORE INTO stock_processed_items (
            id, order_id, extraction_signature, variant_id, normalized_color, quantity_added_meters, history_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
        : `
          INSERT OR IGNORE INTO stock_processed_items (
            id, order_id, extraction_signature, variant_id, normalized_color, quantity_added_meters, history_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
    await (0, db_1.execute)(sql, [
        id,
        entry.orderId,
        entry.extractionSignature,
        entry.variantId,
        entry.normalizedColor,
        entry.quantityAddedMeters,
        entry.historyId || null,
    ]);
}
async function markProcessedStockItemReversed(processedItemId, orderId) {
    const dialect = (0, db_1.getDatabaseDialect)();
    const sql = dialect === 'mysql'
        ? `
          INSERT IGNORE INTO stock_reversed_items (processed_item_id, order_id)
          VALUES (?, ?)
        `
        : `
          INSERT OR IGNORE INTO stock_reversed_items (processed_item_id, order_id)
          VALUES (?, ?)
        `;
    await (0, db_1.execute)(sql, [processedItemId, orderId]);
}
function mapPoBillProcessedDocument(row) {
    return {
        attachmentId: Number(row.attachment_id),
        attachmentName: row.attachment_name,
        documentId: row.document_id === null ? null : Number(row.document_id),
        folderName: row.folder_name,
        companyName: row.company_name,
        purchaseOrderId: row.purchase_order_id === null ? null : Number(row.purchase_order_id),
        purchaseOrderName: row.purchase_order_name,
        vendorBillId: row.vendor_bill_id === null ? null : Number(row.vendor_bill_id),
        vendorBillName: row.vendor_bill_name,
        invoiceFingerprint: row.invoice_fingerprint,
        invoiceNumber: row.invoice_number,
        invoiceVendor: row.invoice_vendor,
        invoiceTotal: row.invoice_total === null ? null : Number(row.invoice_total),
        status: row.status,
        mode: row.mode,
        summary: row.summary,
        processedAt: row.processed_at,
        updatedAt: row.updated_at,
        attemptCount: row.attempt_count === null ? null : Number(row.attempt_count),
        lastSkippedAt: row.last_skipped_at,
    };
}
async function getPoBillProcessedDocumentsByAttachmentIds(attachmentIds) {
    const ids = [...new Set(attachmentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (ids.length === 0) {
        return {};
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await (0, db_1.queryAll)(`
      SELECT
        attachment_id,
        attachment_name,
        document_id,
        folder_name,
        company_name,
        purchase_order_id,
        purchase_order_name,
        vendor_bill_id,
        vendor_bill_name,
        invoice_fingerprint,
        invoice_number,
        invoice_vendor,
        invoice_total,
        status,
        mode,
        summary,
        processed_at,
        updated_at,
        attempt_count,
        last_skipped_at
      FROM po_bill_processed_documents
      WHERE attachment_id IN (${placeholders})
    `, ids);
    return rows.reduce((acc, row) => {
        const entry = mapPoBillProcessedDocument(row);
        acc[entry.attachmentId] = entry;
        return acc;
    }, {});
}
async function getPoBillProcessedDocumentsByInvoiceFingerprint(invoiceFingerprint) {
    const fingerprint = String(invoiceFingerprint || '').trim();
    if (!fingerprint) {
        return [];
    }
    const rows = await (0, db_1.queryAll)(`
      SELECT
        attachment_id,
        attachment_name,
        document_id,
        folder_name,
        company_name,
        purchase_order_id,
        purchase_order_name,
        vendor_bill_id,
        vendor_bill_name,
        invoice_fingerprint,
        invoice_number,
        invoice_vendor,
        invoice_total,
        status,
        mode,
        summary,
        processed_at,
        updated_at,
        attempt_count,
        last_skipped_at
      FROM po_bill_processed_documents
      WHERE invoice_fingerprint = ?
      ORDER BY processed_at DESC, updated_at DESC
    `, [fingerprint]);
    return rows.map(mapPoBillProcessedDocument);
}
async function getLatestPoBillProcessedDocumentsByPurchaseOrderIds(purchaseOrderIds) {
    const ids = [...new Set(purchaseOrderIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (ids.length === 0) {
        return {};
    }
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await (0, db_1.queryAll)(`
      SELECT
        attachment_id,
        attachment_name,
        document_id,
        folder_name,
        company_name,
        purchase_order_id,
        purchase_order_name,
        vendor_bill_id,
        vendor_bill_name,
        invoice_fingerprint,
        invoice_number,
        invoice_vendor,
        invoice_total,
        status,
        mode,
        summary,
        processed_at,
        updated_at,
        attempt_count,
        last_skipped_at
      FROM po_bill_processed_documents
      WHERE purchase_order_id IN (${placeholders})
      ORDER BY processed_at DESC, updated_at DESC
    `, ids);
    return rows.reduce((acc, row) => {
        const entry = mapPoBillProcessedDocument(row);
        if (entry.purchaseOrderId && !acc[entry.purchaseOrderId]) {
            acc[entry.purchaseOrderId] = entry;
        }
        return acc;
    }, {});
}
async function upsertPoBillProcessedDocument(entry) {
    const dialect = (0, db_1.getDatabaseDialect)();
    const values = [
        entry.attachmentId,
        entry.attachmentName || '',
        entry.documentId || null,
        entry.folderName || null,
        entry.companyName || null,
        entry.purchaseOrderId || null,
        entry.purchaseOrderName || null,
        entry.vendorBillId || null,
        entry.vendorBillName || null,
        entry.invoiceFingerprint || null,
        entry.invoiceNumber || null,
        entry.invoiceVendor || null,
        entry.invoiceTotal ?? null,
        entry.status,
        entry.mode || null,
        entry.summary || null,
    ];
    if (dialect === 'mysql') {
        await (0, db_1.execute)(`
        INSERT INTO po_bill_processed_documents (
          attachment_id,
          attachment_name,
          document_id,
          folder_name,
          company_name,
          purchase_order_id,
          purchase_order_name,
          vendor_bill_id,
          vendor_bill_name,
          invoice_fingerprint,
          invoice_number,
          invoice_vendor,
          invoice_total,
          status,
          mode,
          summary
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          attachment_name = VALUES(attachment_name),
          document_id = VALUES(document_id),
          folder_name = VALUES(folder_name),
          company_name = VALUES(company_name),
          purchase_order_id = VALUES(purchase_order_id),
          purchase_order_name = VALUES(purchase_order_name),
          vendor_bill_id = VALUES(vendor_bill_id),
          vendor_bill_name = VALUES(vendor_bill_name),
          invoice_fingerprint = VALUES(invoice_fingerprint),
          invoice_number = VALUES(invoice_number),
          invoice_vendor = VALUES(invoice_vendor),
          invoice_total = VALUES(invoice_total),
          status = VALUES(status),
          mode = VALUES(mode),
          summary = VALUES(summary),
          processed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          attempt_count = attempt_count + 1,
          last_skipped_at = IF(VALUES(status) IN ('skipped', 'failed'), CURRENT_TIMESTAMP, last_skipped_at)
      `, values);
        return;
    }
    await (0, db_1.execute)(`
      INSERT INTO po_bill_processed_documents (
        attachment_id,
        attachment_name,
        document_id,
        folder_name,
        company_name,
        purchase_order_id,
        purchase_order_name,
        vendor_bill_id,
        vendor_bill_name,
        invoice_fingerprint,
        invoice_number,
        invoice_vendor,
        invoice_total,
        status,
        mode,
        summary
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attachment_id) DO UPDATE SET
        attachment_name = excluded.attachment_name,
        document_id = excluded.document_id,
        folder_name = excluded.folder_name,
        company_name = excluded.company_name,
        purchase_order_id = excluded.purchase_order_id,
        purchase_order_name = excluded.purchase_order_name,
        vendor_bill_id = excluded.vendor_bill_id,
        vendor_bill_name = excluded.vendor_bill_name,
        invoice_fingerprint = excluded.invoice_fingerprint,
        invoice_number = excluded.invoice_number,
        invoice_vendor = excluded.invoice_vendor,
        invoice_total = excluded.invoice_total,
        status = excluded.status,
        mode = excluded.mode,
        summary = excluded.summary,
        processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP,
        attempt_count = attempt_count + 1,
        last_skipped_at = CASE WHEN excluded.status IN ('skipped', 'failed') THEN CURRENT_TIMESTAMP ELSE last_skipped_at END
    `, values);
}
async function acquirePoBillProcessingLock(attachmentId) {
    const safeAttachmentId = Number(attachmentId);
    if (!Number.isSafeInteger(safeAttachmentId) || safeAttachmentId <= 0) {
        return false;
    }
    if ((0, db_1.getDatabaseDialect)() === 'mysql') {
        await (0, db_1.execute)(`
        DELETE FROM po_bill_processing_locks
        WHERE acquired_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
      `);
    }
    else {
        await (0, db_1.execute)(`
        DELETE FROM po_bill_processing_locks
        WHERE datetime(acquired_at) < datetime('now', '-2 hours')
      `);
    }
    const sql = (0, db_1.getDatabaseDialect)() === 'mysql'
        ? `
          INSERT IGNORE INTO po_bill_processing_locks (attachment_id)
          VALUES (?)
        `
        : `
          INSERT OR IGNORE INTO po_bill_processing_locks (attachment_id)
          VALUES (?)
        `;
    const result = await (0, db_1.execute)(sql, [safeAttachmentId]);
    return result.affectedRows > 0;
}
async function releasePoBillProcessingLock(attachmentId) {
    await (0, db_1.execute)(`
      DELETE FROM po_bill_processing_locks
      WHERE attachment_id = ?
    `, [attachmentId]);
}
async function acquireStockProcessingLock(orderId, extractionSignature) {
    if ((0, db_1.getDatabaseDialect)() === 'mysql') {
        await (0, db_1.execute)(`
        DELETE FROM stock_processing_locks
        WHERE acquired_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
      `);
    }
    else {
        await (0, db_1.execute)(`
        DELETE FROM stock_processing_locks
        WHERE datetime(acquired_at) < datetime('now', '-2 hours')
      `);
    }
    const lockKey = `${orderId}:${extractionSignature}`;
    const sql = (0, db_1.getDatabaseDialect)() === 'mysql'
        ? `
          INSERT IGNORE INTO stock_processing_locks (lock_key, order_id, extraction_signature)
          VALUES (?, ?, ?)
        `
        : `
          INSERT OR IGNORE INTO stock_processing_locks (lock_key, order_id, extraction_signature)
          VALUES (?, ?, ?)
        `;
    const result = await (0, db_1.execute)(sql, [lockKey, orderId, extractionSignature]);
    return result.affectedRows > 0;
}
async function releaseStockProcessingLock(orderId, extractionSignature) {
    await (0, db_1.execute)(`
      DELETE FROM stock_processing_locks
      WHERE lock_key = ?
    `, [`${orderId}:${extractionSignature}`]);
}
async function isStockProcessingLocked(orderId, extractionSignature) {
    const row = await (0, db_1.queryOne)(`
      SELECT lock_key
      FROM stock_processing_locks
      WHERE lock_key = ?
    `, [`${orderId}:${extractionSignature}`]);
    return Boolean(row);
}
async function insertAuthLoginChallenge(entry) {
    const id = (0, uuid_1.v4)();
    await (0, db_1.execute)(`
      INSERT INTO auth_login_challenges (
        id, email, code_hash, redirect_path, expires_at, attempts_remaining, requested_ip
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, entry.email, entry.codeHash, entry.redirectPath, entry.expiresAt, entry.attemptsRemaining, entry.requestedIp || null]);
    return id;
}
async function getLatestActiveAuthLoginChallenge(email) {
    const otpTtlMinutes = Math.max(1, Number(env_1.env.AUTH_OTP_TTL_MINUTES || 10));
    const sql = (0, db_1.getDatabaseDialect)() === 'mysql'
        ? `
          SELECT
            id, email, code_hash, redirect_path, expires_at, attempts_remaining, consumed_at, requested_ip, created_at
          FROM auth_login_challenges
          WHERE email = ?
            AND consumed_at IS NULL
            AND (
              expires_at >= CURRENT_TIMESTAMP
              OR (expires_at < created_at AND DATE_ADD(created_at, INTERVAL ? MINUTE) >= CURRENT_TIMESTAMP)
            )
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `
        : `
          SELECT
            id, email, code_hash, redirect_path, expires_at, attempts_remaining, consumed_at, requested_ip, created_at
          FROM auth_login_challenges
          WHERE email = ?
            AND consumed_at IS NULL
            AND (
              datetime(expires_at) >= datetime('now')
              OR (datetime(expires_at) < datetime(created_at) AND datetime(created_at, '+' || ? || ' minutes') >= datetime('now'))
            )
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `;
    const row = await (0, db_1.queryOne)(sql, [email, otpTtlMinutes]);
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        email: row.email,
        codeHash: row.code_hash,
        redirectPath: row.redirect_path,
        expiresAt: row.expires_at,
        attemptsRemaining: Number(row.attempts_remaining),
        consumedAt: row.consumed_at,
        requestedIp: row.requested_ip,
        createdAt: row.created_at,
    };
}
async function updateAuthLoginChallenge(id, patch) {
    const current = await (0, db_1.queryOne)(`
      SELECT attempts_remaining, consumed_at
      FROM auth_login_challenges
      WHERE id = ?
    `, [id]);
    if (!current) {
        return;
    }
    await (0, db_1.execute)(`
      UPDATE auth_login_challenges
      SET
        attempts_remaining = ?,
        consumed_at = CASE
          WHEN ? = 1 THEN COALESCE(consumed_at, CURRENT_TIMESTAMP)
          ELSE consumed_at
        END
      WHERE id = ?
    `, [patch.attemptsRemaining ?? Number(current.attempts_remaining), patch.consumed ? 1 : 0, id]);
}
async function consumeAllAuthChallengesForEmail(email) {
    await (0, db_1.execute)(`
      UPDATE auth_login_challenges
      SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
      WHERE email = ? AND consumed_at IS NULL
    `, [email]);
}
async function insertAuthSession(entry) {
    const id = (0, uuid_1.v4)();
    await (0, db_1.execute)(`
      INSERT INTO auth_sessions (
        id, email, role, apps, csrf_token, user_agent_hash, ip_address, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, entry.email, entry.role || 'user', entry.apps ? JSON.stringify(entry.apps) : null, entry.csrfToken, entry.userAgentHash, entry.ipAddress || null, entry.expiresAt]);
    return id;
}
async function getAuthSession(id) {
    const row = await (0, db_1.queryOne)(`
      SELECT
        id, email, role, apps, csrf_token, user_agent_hash, ip_address, expires_at, revoked_at, created_at, last_seen_at
      FROM auth_sessions
      WHERE id = ?
    `, [id]);
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        user: {
            email: row.email,
            role: row.role || 'user',
            apps: row.apps ? JSON.parse(row.apps) : mapLegacyRoleToApps(row.role),
        },
        csrfToken: row.csrf_token,
        userAgentHash: row.user_agent_hash,
        ipAddress: row.ip_address,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
    };
}
async function touchAuthSession(id, expiresAt) {
    await (0, db_1.execute)(`
      UPDATE auth_sessions
      SET
        expires_at = ?,
        last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revoked_at IS NULL
    `, [expiresAt, id]);
}
async function revokeAuthSession(id) {
    await (0, db_1.execute)(`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `, [id]);
}
async function revokeExpiredAuthSessions() {
    const sql = (0, db_1.getDatabaseDialect)() === 'mysql'
        ? `
          UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
          WHERE revoked_at IS NULL AND expires_at < CURRENT_TIMESTAMP
        `
        : `
          UPDATE auth_sessions
          SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
          WHERE revoked_at IS NULL AND datetime(expires_at) < datetime('now')
        `;
    await (0, db_1.execute)(sql);
}
async function insertAuthAttempt(entry) {
    await (0, db_1.execute)(`
      INSERT INTO auth_attempts (id, scope, email, ip_address, success)
      VALUES (?, ?, ?, ?, ?)
    `, [(0, uuid_1.v4)(), entry.scope, entry.email || null, entry.ipAddress || null, entry.success ? 1 : 0]);
}
async function countRecentAuthAttempts(scope, windowMinutes, filters = {}) {
    const conditions = ['scope = ?'];
    const parameters = [scope];
    if ((0, db_1.getDatabaseDialect)() === 'mysql') {
        conditions.push('created_at >= ?');
        parameters.push(nowMinusMinutesIso(windowMinutes));
    }
    else {
        conditions.push(`datetime(created_at) >= datetime('now', ?)`);
        parameters.push(`-${Math.max(1, windowMinutes)} minutes`);
    }
    if (filters.email) {
        conditions.push('email = ?');
        parameters.push(filters.email);
    }
    if (filters.ipAddress) {
        conditions.push('ip_address = ?');
        parameters.push(filters.ipAddress);
    }
    if (filters.success !== undefined) {
        conditions.push('success = ?');
        parameters.push(filters.success ? 1 : 0);
    }
    const row = await (0, db_1.queryOne)(`
      SELECT COUNT(*) as attempt_count
      FROM auth_attempts
      WHERE ${conditions.join(' AND ')}
    `, parameters);
    return Number(row?.attempt_count || 0);
}
function mapAuthLoginEvent(row) {
    return {
        id: row.id,
        email: row.email,
        role: row.role ? row.role : null,
        eventType: row.event_type,
        authMethod: row.auth_method,
        success: Boolean(row.success),
        ipAddress: row.ip_address,
        locationLabel: row.location_label,
        locationSource: row.location_source,
        userAgent: row.user_agent,
        detail: row.detail,
        createdAt: row.created_at,
    };
}
async function insertAuthLoginEvent(entry) {
    await (0, db_1.execute)(`
      INSERT INTO auth_login_events (
        id, email, role, event_type, auth_method, success, ip_address,
        location_label, location_source, user_agent, detail
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        (0, uuid_1.v4)(),
        entry.email || null,
        entry.role || null,
        entry.eventType,
        entry.authMethod || null,
        entry.success ? 1 : 0,
        entry.ipAddress || null,
        entry.locationLabel || null,
        entry.locationSource || null,
        entry.userAgent || null,
        entry.detail || null,
    ]);
}
async function getRecentAuthLoginEvents(limit = 50) {
    const rows = await (0, db_1.queryAll)(`
      SELECT
        id, email, role, event_type, auth_method, success, ip_address,
        location_label, location_source, user_agent, detail, created_at
      FROM auth_login_events
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `, [limit]);
    return rows.map(mapAuthLoginEvent);
}
async function getAuthUserLastSeenByEmail() {
    const rows = await (0, db_1.queryAll)(`
      SELECT email, MAX(last_seen_at) AS last_seen_at
      FROM auth_sessions
      GROUP BY email
    `);
    return Object.fromEntries(rows.map((row) => [String(row.email || '').toLowerCase(), row.last_seen_at]));
}
function mapLegacyRoleToApps(role) {
    if (!role || role === 'admin' || role === 'user')
        return [];
    if (role === 'finance')
        return ['mpesa', 'po-automation', 'purchase-orders', 'invoice-parser', 'extractions'];
    if (role === 'operations')
        return ['sales-orders', 'purchase-orders', 'extractions', 'jobs'];
    if (role === 'operator')
        return ['shop-floor'];
    if (role === 'viewer')
        return [];
    return [];
}
async function upsertApprovedAuthUser(email, role = 'user', apps, active = true, passwordHash) {
    const dialect = (0, db_1.getDatabaseDialect)();
    const appsJson = apps ? JSON.stringify(apps) : null;
    if (dialect === 'mysql') {
        await (0, db_1.execute)(`
        INSERT INTO auth_approved_users (email, role, apps, active, password_hash)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          role = VALUES(role),
          apps = VALUES(apps),
          active = VALUES(active),
          password_hash = COALESCE(VALUES(password_hash), password_hash),
          updated_at = CURRENT_TIMESTAMP
      `, [email.toLowerCase(), role, appsJson, active ? 1 : 0, passwordHash || null]);
    }
    else {
        await (0, db_1.execute)(`
        INSERT INTO auth_approved_users (email, role, apps, active, password_hash)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          role = excluded.role,
          apps = excluded.apps,
          active = excluded.active,
          password_hash = COALESCE(excluded.password_hash, auth_approved_users.password_hash),
          updated_at = CURRENT_TIMESTAMP
      `, [email.toLowerCase(), role, appsJson, active ? 1 : 0, passwordHash || null]);
    }
}
async function getApprovedAuthUserByEmail(email) {
    const row = await (0, db_1.queryOne)(`
      SELECT email, role, apps, active, password_hash, created_at, updated_at
      FROM auth_approved_users
      WHERE email = ?
    `, [email.toLowerCase()]);
    if (!row) {
        return null;
    }
    return {
        email: row.email,
        role: row.role || 'user',
        apps: row.apps ? JSON.parse(row.apps) : mapLegacyRoleToApps(row.role),
        active: Boolean(row.active),
        passwordHash: row.password_hash || null,
        hasPassword: Boolean(row.password_hash),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
async function getApprovedAuthUsers() {
    const rows = await (0, db_1.queryAll)(`
      SELECT email, role, apps, active, password_hash, created_at, updated_at
      FROM auth_approved_users
      ORDER BY active DESC, email ASC
    `);
    return rows.map((row) => ({
        email: row.email,
        role: row.role || 'user',
        apps: row.apps ? JSON.parse(row.apps) : mapLegacyRoleToApps(row.role),
        active: Boolean(row.active),
        passwordHash: null,
        hasPassword: Boolean(row.password_hash),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));
}
async function countApprovedAuthUsers() {
    const row = await (0, db_1.queryOne)(`
      SELECT COUNT(*) AS total_count
      FROM auth_approved_users
    `);
    return Number(row?.total_count || 0);
}
async function getAppUserProfile(email) {
    const row = await (0, db_1.queryOne)('SELECT email, display_name, odoo_employee_id, synced_at FROM app_user_profiles WHERE email = ?', [email.trim().toLowerCase()]);
    return row ? { email: row.email, displayName: row.display_name, odooEmployeeId: row.odoo_employee_id, syncedAt: row.synced_at } : null;
}
async function saveAppUserProfile(input) {
    const params = [input.email.trim().toLowerCase(), input.displayName.trim(), input.odooEmployeeId || null];
    if ((0, db_1.getDatabaseDialect)() === 'mysql') {
        await (0, db_1.execute)(`INSERT INTO app_user_profiles (email, display_name, odoo_employee_id, synced_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), odoo_employee_id = VALUES(odoo_employee_id), synced_at = CURRENT_TIMESTAMP`, params);
    }
    else {
        await (0, db_1.execute)(`INSERT INTO app_user_profiles (email, display_name, odoo_employee_id, synced_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, odoo_employee_id = excluded.odoo_employee_id, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`, params);
    }
}
async function getStockProductMirror() {
    const rows = await (0, db_1.queryAll)(`SELECT product_id, product_name, available_qty, free_qty, forecast_qty,
    incoming_qty, outgoing_qty, warehouse_id, synced_at, sync_status, sync_error
    FROM stock_product_mirror ORDER BY product_name ASC`);
    return rows.map((row) => ({
        productId: Number(row.product_id), productName: String(row.product_name || ''),
        availableQty: Number(row.available_qty || 0), freeQty: Number(row.free_qty || 0),
        forecastQty: Number(row.forecast_qty || 0), incomingQty: Number(row.incoming_qty || 0),
        outgoingQty: Number(row.outgoing_qty || 0), warehouseId: row.warehouse_id == null ? null : Number(row.warehouse_id),
        // MySQL/MariaDB may deserialize legacy zero dates as Invalid Date objects.
        // Treat those as an absent sync timestamp so the stock mirror can refresh
        // instead of failing the whole Board Intake page with "Invalid time value".
        syncedAt: formatDbDateString(row.synced_at),
        syncStatus: String(row.sync_status || 'pending'),
        syncError: row.sync_error ? String(row.sync_error) : null,
    }));
}
async function upsertStockProductMirror(entries) {
    for (const entry of entries) {
        const params = [entry.productId, entry.productName, entry.availableQty, entry.freeQty, entry.forecastQty,
            entry.incomingQty, entry.outgoingQty, entry.warehouseId, entry.syncedAt, entry.syncStatus || 'current', entry.syncError || null];
        if ((0, db_1.getDatabaseDialect)() === 'mysql') {
            await (0, db_1.execute)(`INSERT INTO stock_product_mirror (product_id, product_name, available_qty, free_qty, forecast_qty, incoming_qty, outgoing_qty, warehouse_id, synced_at, sync_status, sync_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE product_name=VALUES(product_name), available_qty=VALUES(available_qty), free_qty=VALUES(free_qty), forecast_qty=VALUES(forecast_qty), incoming_qty=VALUES(incoming_qty), outgoing_qty=VALUES(outgoing_qty), warehouse_id=VALUES(warehouse_id), synced_at=VALUES(synced_at), sync_status=VALUES(sync_status), sync_error=VALUES(sync_error)`, params);
        }
        else {
            await (0, db_1.execute)(`INSERT INTO stock_product_mirror (product_id, product_name, available_qty, free_qty, forecast_qty, incoming_qty, outgoing_qty, warehouse_id, synced_at, sync_status, sync_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET product_name=excluded.product_name, available_qty=excluded.available_qty, free_qty=excluded.free_qty, forecast_qty=excluded.forecast_qty, incoming_qty=excluded.incoming_qty, outgoing_qty=excluded.outgoing_qty, warehouse_id=excluded.warehouse_id, synced_at=excluded.synced_at, sync_status=excluded.sync_status, sync_error=excluded.sync_error, updated_at=CURRENT_TIMESTAMP`, params);
        }
    }
}
async function removeStockProductsNotIn(productIds) {
    if (!productIds.length) {
        await (0, db_1.execute)(`DELETE FROM stock_product_mirror`);
        return;
    }
    const placeholders = productIds.map(() => '?').join(', ');
    await (0, db_1.execute)(`DELETE FROM stock_product_mirror WHERE product_id NOT IN (${placeholders})`, productIds);
}
async function updateStockProductMirrorQuantity(productId, availableQty, productName) {
    await (0, db_1.execute)(`UPDATE stock_product_mirror SET available_qty = ?, free_qty = ?, product_name = COALESCE(?, product_name), sync_status = 'current', sync_error = NULL, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?`, [availableQty, availableQty, productName || null, productId]);
}
async function markStockProductMirrorSyncFailed(message) {
    await (0, db_1.execute)(`UPDATE stock_product_mirror SET sync_status = 'failed', sync_error = ?, updated_at = CURRENT_TIMESTAMP`, [message.slice(0, 1000)]);
}
function mapStaffOnboardingApplication(row) {
    return {
        id: String(row.id), fullName: String(row.full_name), personalEmail: String(row.personal_email),
        mobilePhone: String(row.mobile_phone), payload: (0, helpers_1.safeJsonParse)(row.payload_json, {}),
        odooApplicantId: row.odoo_applicant_id == null ? null : Number(row.odoo_applicant_id),
        odooEmployeeId: row.odoo_employee_id == null ? null : Number(row.odoo_employee_id),
        status: row.status, errorMessage: row.error_message ? String(row.error_message) : null,
        submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : String(row.submitted_at),
        reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at ? String(row.reviewed_at) : null,
        reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    };
}
async function createStaffOnboardingApplication(input) {
    await (0, db_1.execute)(`INSERT INTO staff_onboarding_applications (id, full_name, personal_email, mobile_phone, payload_json, status)
    VALUES (?, ?, ?, ?, ?, 'syncing')`, [input.id, input.payload.fullName, input.payload.personalEmail, input.payload.mobilePhone, JSON.stringify(input.payload)]);
}
async function updateStaffOnboardingSync(id, odooApplicantId, errorMessage) {
    const normalizedApplicantId = Number(odooApplicantId);
    const validApplicantId = Number.isSafeInteger(normalizedApplicantId) && normalizedApplicantId > 0 ? normalizedApplicantId : null;
    await (0, db_1.execute)(`UPDATE staff_onboarding_applications SET odoo_applicant_id = ?, status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [validApplicantId, validApplicantId ? 'pending' : 'sync_failed', errorMessage || null, id]);
}
async function importStaffOnboardingApplication(input) {
    const params = [input.id, input.payload.fullName, input.payload.personalEmail, input.payload.mobilePhone, JSON.stringify(input.payload), input.odooApplicantId];
    if ((0, db_1.getDatabaseDialect)() === 'mysql') {
        await (0, db_1.execute)(`INSERT INTO staff_onboarding_applications (id, full_name, personal_email, mobile_phone, payload_json, odoo_applicant_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending') ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), personal_email=VALUES(personal_email), mobile_phone=VALUES(mobile_phone), payload_json=VALUES(payload_json), updated_at=CURRENT_TIMESTAMP`, params);
    }
    else {
        await (0, db_1.execute)(`INSERT INTO staff_onboarding_applications (id, full_name, personal_email, mobile_phone, payload_json, odoo_applicant_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT(odoo_applicant_id) DO UPDATE SET full_name=excluded.full_name, personal_email=excluded.personal_email, mobile_phone=excluded.mobile_phone, payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP`, params);
    }
}
async function getStaffOnboardingApplications() {
    const rows = await (0, db_1.queryAll)(`SELECT * FROM staff_onboarding_applications
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approval_failed' THEN 1 WHEN 'sync_failed' THEN 2 WHEN 'approving' THEN 3 ELSE 4 END, submitted_at DESC`);
    return rows.map(mapStaffOnboardingApplication);
}
async function getStaffOnboardingApplication(id) {
    const row = await (0, db_1.queryOne)('SELECT * FROM staff_onboarding_applications WHERE id = ?', [id]);
    return row ? mapStaffOnboardingApplication(row) : null;
}
async function beginStaffOnboardingApproval(id) {
    const result = await (0, db_1.execute)(`UPDATE staff_onboarding_applications SET status = 'approving', error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('pending', 'approval_failed')`, [id]);
    return result.affectedRows > 0;
}
async function finishStaffOnboardingApproval(id, input) {
    await (0, db_1.execute)(`UPDATE staff_onboarding_applications SET status = ?, odoo_employee_id = COALESCE(?, odoo_employee_id), error_message = ?, reviewed_at = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [input.employeeId ? 'approved' : 'approval_failed', input.employeeId || null, input.errorMessage || null, (0, dateTime_1.appDateTime)(), input.reviewedBy, id]);
}
async function createBoardIntakeQueueEntry(input) {
    await (0, db_1.execute)(`INSERT INTO board_intake_queue (id, product_id, product_name, partner_id, customer_name, quantity, actor_name, actor_email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, [input.id, input.productId, input.productName, input.partnerId, input.customerName, input.quantity, input.actorName, input.actorEmail || null]);
}
async function updateBoardIntakeQueueEntry(id, input) {
    const retryDelayMinutes = input.status === 'failed' ? 2 : 0;
    await (0, db_1.execute)(`UPDATE board_intake_queue SET status = ?, odoo_stock_quantity = COALESCE(?, odoo_stock_quantity), error_message = ?,
    synced_at = CASE WHEN ? = 'synced' THEN CURRENT_TIMESTAMP ELSE synced_at END,
    next_retry_at = CASE WHEN ? = 'failed' THEN ${(0, db_1.getDatabaseDialect)() === 'mysql' ? 'DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)' : "datetime(CURRENT_TIMESTAMP, '+' || ? || ' minutes')"} ELSE NULL END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [input.status, input.stockQuantity ?? null, input.errorMessage || null, input.status, input.status, retryDelayMinutes, id]);
}
async function getRecentBoardIntakeQueueEntries(limit = 12) {
    return (0, db_1.queryAll)(`SELECT id, product_name, customer_name, quantity, status, error_message, retry_count, last_attempt_at, next_retry_at, created_at, synced_at
    FROM board_intake_queue ORDER BY created_at DESC LIMIT ?`, [Math.max(1, Math.min(50, limit))]);
}
async function getBoardIntakeQueueEntry(id) {
    return (0, db_1.queryOne)('SELECT * FROM board_intake_queue WHERE id = ?', [id]);
}
async function claimBoardIntakeQueueEntry(id) {
    const result = await (0, db_1.execute)(`UPDATE board_intake_queue
    SET status = 'processing', retry_count = retry_count + 1, last_attempt_at = CURRENT_TIMESTAMP,
        next_retry_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('pending', 'failed')`, [id]);
    return result.affectedRows > 0;
}
async function getDueBoardIntakeQueueEntries(limit = 5) {
    return (0, db_1.queryAll)(`SELECT * FROM board_intake_queue
    WHERE (status = 'pending')
       OR (status = 'failed' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP))
       OR (status = 'processing' AND updated_at < ${(0, db_1.getDatabaseDialect)() === 'mysql' ? 'DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)' : "datetime(CURRENT_TIMESTAMP, '-10 minutes')"})
    ORDER BY created_at ASC LIMIT ?`, [Math.max(1, Math.min(20, limit))]);
}
async function releaseStaleBoardIntakeQueueEntry(id) {
    await (0, db_1.execute)(`UPDATE board_intake_queue SET status = 'failed', next_retry_at = CURRENT_TIMESTAMP,
    error_message = COALESCE(error_message, 'Previous synchronization attempt was interrupted.'), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'processing'`, [id]);
}
async function getBoardIntakeLoggingReport(startDate, endDate, reportingStartDate) {
    const effectiveStartDate = (0, shopFloorReporting_1.clampShopFloorReportingDate)(startDate, reportingStartDate);
    const effectiveEndDate = (0, shopFloorReporting_1.clampShopFloorReportingDate)(endDate, reportingStartDate);
    const rows = await (0, db_1.queryAll)(`SELECT actor_name, actor_email, quantity, status, created_at
      FROM board_intake_queue
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC`, [`${effectiveStartDate} 00:00:00`, `${effectiveEndDate} 23:59:59`]);
    const byOperator = new Map();
    rows.forEach((row) => {
        const email = String(row.actor_email || '').trim().toLowerCase();
        const name = String(row.actor_name || email || 'Unknown operator').trim();
        const key = email || name.toLowerCase();
        const item = byOperator.get(key) || { name, email, records: 0, boards: 0, synced: 0, failed: 0, pending: 0, lastLoggedAt: row.created_at };
        item.records += 1;
        item.boards += Number(row.quantity || 0);
        if (row.status === 'synced')
            item.synced += 1;
        else if (row.status === 'failed')
            item.failed += 1;
        else
            item.pending += 1;
        item.lastLoggedAt = row.created_at;
        byOperator.set(key, item);
    });
    return [...byOperator.values()].sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
}
// ─── Shop Floor: Incidents & Assigned Items ──────────────────────────
function ensureShopFloorTables() {
    const dialect = (0, db_1.getDatabaseDialect)();
    const createIncidentsTable = `CREATE TABLE IF NOT EXISTS shop_floor_incidents (
      id VARCHAR(36) PRIMARY KEY,
      machine_name VARCHAR(120) NOT NULL,
      description TEXT,
      reported_by VARCHAR(200),
      reported_at VARCHAR(30) NOT NULL,
      status VARCHAR(20) DEFAULT 'open',
      resolved_at VARCHAR(30)
    )`;
    const createAssignedItemsTable = `CREATE TABLE IF NOT EXISTS shop_floor_assigned_items (
      id VARCHAR(36) PRIMARY KEY,
      employee_email VARCHAR(200) NOT NULL,
      item_name VARCHAR(200) NOT NULL,
      assigned_date VARCHAR(30) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      notes TEXT
    )`;
    (0, db_1.execute)(createIncidentsTable).catch(() => { });
    (0, db_1.execute)(createAssignedItemsTable).catch(() => { });
    if (dialect === 'mysql') {
        (0, db_1.execute)(`ALTER TABLE shop_floor_assigned_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`).catch(() => { });
    }
    else {
        (0, db_1.execute)(`ALTER TABLE shop_floor_assigned_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`).catch(() => { });
    }
}
ensureShopFloorTables();
async function getShopFloorIncidents(limit = 50) {
    const rows = await (0, db_1.queryAll)('SELECT * FROM shop_floor_incidents ORDER BY reported_at DESC LIMIT ?', [limit]);
    return rows.map(r => ({
        id: r.id, machineName: r.machine_name, description: r.description,
        reportedBy: r.reported_by, reportedAt: r.reported_at,
        status: (r.status === 'resolved' ? 'resolved' : 'open'),
        resolvedAt: r.resolved_at,
    }));
}
async function createShopFloorIncident(input) {
    const id = (0, uuid_1.v4)();
    const now = (0, dateTime_1.appDateTime)();
    await (0, db_1.execute)(`INSERT INTO shop_floor_incidents (id, machine_name, description, reported_by, reported_at, status)
     VALUES (?, ?, ?, ?, ?, 'open')`, [id, input.machineName, input.description || null, input.reportedBy || null, now]);
    return id;
}
async function resolveShopFloorIncident(id) {
    await (0, db_1.execute)(`UPDATE shop_floor_incidents SET status = 'resolved', resolved_at = ? WHERE id = ?`, [(0, dateTime_1.appDateTime)(), id]);
}
async function getShopFloorAssignedItems(employeeEmail) {
    const emails = Array.isArray(employeeEmail) ? employeeEmail : [employeeEmail];
    const normalizedEmails = emails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean);
    if (!normalizedEmails.length) {
        return [];
    }
    const placeholders = normalizedEmails.map(() => '?').join(', ');
    const rows = await (0, db_1.queryAll)(`SELECT * FROM shop_floor_assigned_items WHERE LOWER(TRIM(employee_email)) IN (${placeholders}) ORDER BY assigned_date DESC`, normalizedEmails);
    return rows.map(r => ({
        id: r.id, employeeEmail: r.employee_email, itemName: r.item_name,
        assignedDate: r.assigned_date, quantity: Number(r.quantity || 1), notes: r.notes,
    }));
}
async function assignShopFloorItem(input) {
    const id = (0, uuid_1.v4)();
    const dateStr = input.assignedDate || (0, dateTime_1.appDateTime)().slice(0, 10);
    const quantity = Number.isFinite(input.quantity) && Number(input.quantity) > 0 ? Math.floor(Number(input.quantity)) : 1;
    const email = String(input.employeeEmail || '').trim().toLowerCase();
    await (0, db_1.execute)(`INSERT INTO shop_floor_assigned_items (id, employee_email, item_name, assigned_date, quantity, notes)
     VALUES (?, ?, ?, ?, ?, ?)`, [id, email, input.itemName, dateStr, quantity, input.notes || null]);
    return id;
}
const DEFAULT_SHOP_FLOOR_FEATURE_FLAGS = {
    'start-finish': true,
    'add-stock': true,
    receipts: true,
    deliveries: true,
    attendance: true,
    maintenance: true,
    payroll: true,
    'table-saw': true,
    'edge-banding': true,
    'panel-rack': true,
};
async function getShopFloorFeatureFlags() {
    const rows = await (0, db_1.queryAll)('SELECT feature_key, enabled FROM shop_floor_feature_flags');
    const flags = { ...DEFAULT_SHOP_FLOOR_FEATURE_FLAGS };
    rows.forEach((row) => {
        if (Object.prototype.hasOwnProperty.call(flags, row.feature_key)) {
            flags[row.feature_key] = Boolean(row.enabled);
        }
    });
    return flags;
}
async function saveShopFloorFeatureFlags(flags) {
    for (const [featureKey, enabled] of Object.entries(flags)) {
        const existing = await (0, db_1.queryOne)('SELECT feature_key FROM shop_floor_feature_flags WHERE feature_key = ?', [featureKey]);
        if (existing) {
            await (0, db_1.execute)('UPDATE shop_floor_feature_flags SET enabled = ?, updated_at = ? WHERE feature_key = ?', [enabled ? 1 : 0, (0, dateTime_1.appDateTime)(), featureKey]);
        }
        else {
            await (0, db_1.execute)('INSERT INTO shop_floor_feature_flags (feature_key, enabled, updated_at) VALUES (?, ?, ?)', [featureKey, enabled ? 1 : 0, (0, dateTime_1.appDateTime)()]);
        }
    }
}
