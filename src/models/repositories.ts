import { v4 as uuidv4 } from 'uuid';
import {
  AppSettings,
  AuthApprovedUser,
  AuthLoginChallengeEntry,
  AuthLoginEventEntry,
  AuthSessionEntry,
  ConnectionStatus,
  GeminiOAuthConnectionStatus,
  AuthRole,
  AppFeature,
  ExtractedResultEntry,
  HistoryEntry,
  LogEntry,
  MailConfig,
  MpesaPurchaseOrderCandidate,
  MpesaStatementBatch,
  MpesaTransaction,
  MpesaTransactionExplorerFilters,
  MpesaTransactionExplorerOptions,
  MpesaTransactionExplorerRow,
  OutgoingMailAccount,
  EmailAutomation,
  OdooModelField,
  OdooModelFieldCache,
  PayrollBridgeConfig,
  PoBillProcessedDocumentEntry,
  ProcessedStockItemEntry,
  SchedulerRunEntry,
  SchedulerRuntimeState,
  SignatureComparisonResult,
  ShopFloorFeatureFlags,
  ShopFloorFeatureKey,
} from './types';
import { execute, getDatabaseDialect, queryAll, queryOne } from './db';
import { decryptSecret, encryptSecret } from '../utils/crypto';
import {
  createEmptyFieldMappings,
  createDefaultMailConfig,
  DEFAULT_AI_EXTRACTION_CONFIG,
  DEFAULT_PARSER_CONFIG,
  DEFAULT_PO_BILL_SCHEDULER_CONFIG,
  DEFAULT_SCHEDULER_CONFIG,
  DEFAULT_STOCK_CONFIG,
  safeJsonParse,
} from '../utils/helpers';
import { appDateTimeFromNow, appDateTime } from '../utils/dateTime';
import { env } from '../utils/env';
import { clampShopFloorReportingDate, normalizeShopFloorReportingStartDate } from '../utils/shopFloorReporting';

function nowMinusMinutesIso(windowMinutes: number): string {
  return appDateTimeFromNow(-Math.max(1, windowMinutes) * 60 * 1000);
}

function getSchedulerLockStaleMs() {
  const configuredMinutes = Number(env.SCHEDULER_LOCK_STALE_MINUTES || 10);
  const minutes = Number.isFinite(configuredMinutes) && configuredMinutes > 0 ? configuredMinutes : 10;
  return minutes * 60 * 1000;
}

type SettingsRow = {
  odoo_base_url: string;
  odoo_database: string;
  odoo_username: string;
  odoo_api_key_encrypted: string;
  odoo_shop_floor_password_encrypted: string;
  field_mapping_json: string;
  parser_config_json: string;
  ai_config_json: string;
  scheduler_config_json: string;
  stock_config_json: string;
  mail_config_json: string | null;
  payroll_bridge_config_json: string | null;
  connection_status: ConnectionStatus;
  connection_checked_at: string | null;
  connection_message: string | null;
  connection_version: string | null;
  updated_at: string | null;
};

export interface StoredGeminiOAuthCredentials {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  email: string;
  scopes: string[];
  connectedAt: string;
}

interface StoredGeminiOAuthClient {
  clientId: string;
  clientSecret: string;
}

function readStoredGeminiOAuthCredentials(payload: Record<string, unknown>): StoredGeminiOAuthCredentials | null {
  const encrypted = typeof payload.geminiOAuth === 'string' ? payload.geminiOAuth : '';
  if (!encrypted) return null;

  try {
    const parsed = JSON.parse(decryptSecret(encrypted)) as Partial<StoredGeminiOAuthCredentials>;
    if (!parsed.refreshToken) return null;
    return {
      refreshToken: String(parsed.refreshToken),
      accessToken: String(parsed.accessToken || ''),
      accessTokenExpiresAt: Number(parsed.accessTokenExpiresAt || 0),
      email: String(parsed.email || ''),
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes.map(String) : [],
      connectedAt: String(parsed.connectedAt || ''),
    };
  } catch (error) {
    console.warn(
      '[settings] Stored Gemini OAuth credentials could not be decrypted. Reconnect Google Gemini using the current APP_ENCRYPTION_KEY.',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function readStoredGeminiOAuthClient(payload: Record<string, unknown>): StoredGeminiOAuthClient | null {
  const encrypted = typeof payload.geminiOAuthClient === 'string' ? payload.geminiOAuthClient : '';
  if (!encrypted) return null;

  try {
    const parsed = JSON.parse(decryptSecret(encrypted)) as Partial<StoredGeminiOAuthClient>;
    if (!parsed.clientId && !parsed.clientSecret) return null;
    return {
      clientId: String(parsed.clientId || ''),
      clientSecret: String(parsed.clientSecret || ''),
    };
  } catch (error) {
    console.warn(
      '[settings] Stored Gemini OAuth client credentials could not be decrypted. Re-save them from AI settings using the current APP_ENCRYPTION_KEY.',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function buildGeminiOAuthStatus(
  rawAi: Record<string, unknown>,
  encryptedKeysPayload: Record<string, unknown>,
): GeminiOAuthConnectionStatus {
  const rawStatus = (rawAi.geminiOAuth || {}) as Partial<GeminiOAuthConnectionStatus>;
  const credentials = readStoredGeminiOAuthCredentials(encryptedKeysPayload);
  const client = readStoredGeminiOAuthClient(encryptedKeysPayload);
  const clientId = client?.clientId || String(rawStatus.clientId || '') || env.GOOGLE_GEMINI_OAUTH_CLIENT_ID.trim();
  const hasClientSecret = Boolean(client?.clientSecret || env.GOOGLE_GEMINI_OAUTH_CLIENT_SECRET.trim());
  return {
    connected: Boolean(credentials?.refreshToken),
    email: credentials?.email || String(rawStatus.email || ''),
    projectId: String(rawStatus.projectId || env.GOOGLE_GEMINI_PROJECT_ID || ''),
    connectedAt: credentials?.connectedAt || (rawStatus.connectedAt ? String(rawStatus.connectedAt) : null),
    clientId,
    hasClientSecret,
  };
}

async function getSettingsRow(): Promise<SettingsRow> {
  let row: SettingsRow | null = null;
  try {
    row = await queryOne<SettingsRow>(
      `
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
      `,
    );
  } catch (_error) {
    row = await queryOne<SettingsRow>(
      `
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
      `,
    );
    if (row) {
      row.odoo_shop_floor_password_encrypted = '';
    }
  }

  if (!row) {
    throw new Error('Application settings row is missing.');
  }

  return row;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value === 'true' || value === 'on' || value === '1';
  }

  return fallback;
}

function positiveNumberValue(value: unknown, fallback: number) {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumberValue(value: unknown, fallback: number) {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function decryptMailPassword(encrypted: string, accountLabel: string) {
  if (!encrypted) {
    return '';
  }

  try {
    return decryptSecret(encrypted);
  } catch (error) {
    console.warn(
      `[settings] Stored SMTP password for ${accountLabel || 'mail account'} could not be decrypted. Re-save Outgoing Mail settings using the current APP_ENCRYPTION_KEY.`,
      error instanceof Error ? error.message : error,
    );
    return '';
  }
}

function readMailConfig(mailConfigJson: string | null): MailConfig {
  const defaults = createDefaultMailConfig();
  const raw = safeJsonParse<Record<string, unknown>>(mailConfigJson, {});
  const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  const sourceAccounts = rawAccounts.length ? rawAccounts : defaults.accounts;
  const accounts = sourceAccounts.map((entry, index): OutgoingMailAccount => {
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

  const resolved: MailConfig = {
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
    automations: (Array.isArray(raw.automations) ? raw.automations : defaults.automations).map((entry, index): EmailAutomation => {
      const item = asRecord(entry);
      const fallback = defaults.automations[index];
      const systemKey = stringValue(item.systemKey, fallback?.systemKey || 'custom') as EmailAutomation['systemKey'];
      const frequency = stringValue(item.frequency, fallback?.frequency || 'daily') as EmailAutomation['frequency'];
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
    shopFloorReportingStartDate: normalizeShopFloorReportingStartDate(
      stringValue(raw.shopFloorReportingStartDate, defaults.shopFloorReportingStartDate),
    ),
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

function buildStoredMailConfig(mail: MailConfig) {
  return {
    ...mail,
    accounts: mail.accounts.map((account) => ({
      label: account.label,
      username: account.username,
      fromEmail: account.fromEmail,
      fromName: account.fromName,
      enabled: account.enabled,
      passwordEncrypted: account.password ? encryptSecret(account.password) : '',
    })),
  };
}

function defaultPayrollBridgeConfig(): PayrollBridgeConfig {
  return {
    url: env.PAYROLL_BRIDGE_URL || '',
    token: env.PAYROLL_BRIDGE_TOKEN || '',
    source: env.PAYROLL_ADVANCE_SOURCE || 'app.urbanvibeinteriordesign.co.ke',
    autoCreatePayRun: booleanValue(env.PAYROLL_AUTO_CREATE_PAYRUN, false),
    salaryStructure: env.PAYROLL_SALARY_STRUCTURE || 'All',
    payRunNameTemplate: env.PAYROLL_PAY_RUN_NAME_TEMPLATE || '{monthName} {year}',
  };
}

function decryptPayrollBridgeToken(encrypted: string) {
  if (!encrypted) {
    return '';
  }

  try {
    return decryptSecret(encrypted);
  } catch (error) {
    console.warn(
      '[settings] Stored payroll bridge token could not be decrypted. Re-save Payroll Bridge settings using the current APP_ENCRYPTION_KEY.',
      error instanceof Error ? error.message : error,
    );
    return '';
  }
}

function readPayrollBridgeConfig(payrollBridgeConfigJson: string | null): PayrollBridgeConfig {
  const defaults = defaultPayrollBridgeConfig();
  const raw = safeJsonParse<Record<string, unknown>>(payrollBridgeConfigJson, {});
  const encryptedToken = stringValue(raw.tokenEncrypted, '');
  const hasStoredToken =
    Object.prototype.hasOwnProperty.call(raw, 'tokenEncrypted') ||
    Object.prototype.hasOwnProperty.call(raw, 'token');
  const plainToken = hasStoredToken ? stringValue(raw.token, '') : defaults.token;

  return {
    url: stringValue(raw.url, defaults.url).trim(),
    token: encryptedToken ? decryptPayrollBridgeToken(encryptedToken) : plainToken,
    source: stringValue(raw.source, defaults.source).trim() || defaults.source,
    autoCreatePayRun: booleanValue(raw.autoCreatePayRun, defaults.autoCreatePayRun),
    salaryStructure: stringValue(raw.salaryStructure, defaults.salaryStructure).trim() || 'All',
    payRunNameTemplate:
      stringValue(raw.payRunNameTemplate, defaults.payRunNameTemplate).trim() ||
      '{monthName} {year}',
  };
}

function buildStoredPayrollBridgeConfig(payrollBridge: PayrollBridgeConfig) {
  return {
    url: payrollBridge.url,
    source: payrollBridge.source,
    autoCreatePayRun: payrollBridge.autoCreatePayRun,
    salaryStructure: payrollBridge.salaryStructure,
    payRunNameTemplate: payrollBridge.payRunNameTemplate,
    tokenEncrypted: payrollBridge.token ? encryptSecret(payrollBridge.token) : '',
  };
}

export async function getSettings(): Promise<AppSettings> {
  const row = await getSettingsRow();
  const rawFieldMappings = safeJsonParse<Record<string, string>>(row.field_mapping_json, {});
  const fieldMappings = {
    ...createEmptyFieldMappings(),
    ...rawFieldMappings,
    logField: rawFieldMappings.logField ?? rawFieldMappings.processingLogField ?? '',
    processedAtField: rawFieldMappings.processedAtField ?? rawFieldMappings.lastProcessedAtField ?? '',
    attachmentNameField: rawFieldMappings.attachmentNameField ?? rawFieldMappings.lastAttachmentNameField ?? '',
    signatureField: rawFieldMappings.signatureField ?? '',
  };
  const parser = {
    ...DEFAULT_PARSER_CONFIG,
    ...safeJsonParse(row.parser_config_json, {}),
  };
  const rawAi = safeJsonParse<Partial<typeof DEFAULT_AI_EXTRACTION_CONFIG>>(row.ai_config_json, {});
  const encryptedKeysPayload = safeJsonParse<Record<string, unknown>>(
    (rawAi as Record<string, unknown>).apiKeysEncryptedJson as string,
    {},
  );
  const encryptedApiKeys = (encryptedKeysPayload.providers || encryptedKeysPayload) as Record<string, string>;
  const encryptedNvidiaModelKeys = (encryptedKeysPayload.nvidiaModels || {}) as Record<string, string>;
  const geminiOAuth = buildGeminiOAuthStatus(rawAi as Record<string, unknown>, encryptedKeysPayload);
  const rawAiOcr = ((rawAi as Record<string, unknown>).ocr || {}) as Partial<typeof DEFAULT_AI_EXTRACTION_CONFIG.ocr> & {
    apiKeyEncrypted?: string;
  };
  const aiApiKeys = { ...DEFAULT_AI_EXTRACTION_CONFIG.apiKeys };

  (Object.keys(aiApiKeys) as Array<keyof typeof aiApiKeys>).forEach((key) => {
    const encrypted = encryptedApiKeys[key];
    if (!encrypted) {
      aiApiKeys[key] = '';
      return;
    }

    try {
      aiApiKeys[key] = decryptSecret(encrypted);
    } catch (error) {
      console.warn(
        `[settings] Stored ${key} AI API key could not be decrypted. Re-save AI settings using the current APP_ENCRYPTION_KEY.`,
        error instanceof Error ? error.message : error,
      );
      aiApiKeys[key] = '';
    }
  });
  const nvidiaModelKeys: Record<string, string> = {};
  for (const [model, encrypted] of Object.entries(encryptedNvidiaModelKeys)) {
    if (!encrypted) continue;
    try {
      nvidiaModelKeys[model] = decryptSecret(encrypted);
    } catch (error) {
      console.warn(
        `[settings] Stored NVIDIA model API key for ${model} could not be decrypted.`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  let aiOcrApiKey = '';
  if (rawAiOcr.apiKeyEncrypted) {
    try {
      aiOcrApiKey = decryptSecret(rawAiOcr.apiKeyEncrypted);
    } catch (error) {
      console.warn(
        '[settings] Stored NVIDIA OCR API key could not be decrypted. Re-save OCR settings using the current APP_ENCRYPTION_KEY.',
        error instanceof Error ? error.message : error,
      );
    }
  }
  const ai = {
    ...DEFAULT_AI_EXTRACTION_CONFIG,
    ...rawAi,
    enabled: Boolean(rawAi.enabled),
    provider: rawAi.provider || DEFAULT_AI_EXTRACTION_CONFIG.provider,
    confidenceThreshold: Number(rawAi.confidenceThreshold || DEFAULT_AI_EXTRACTION_CONFIG.confidenceThreshold),
    maxImages: Number(rawAi.maxImages || DEFAULT_AI_EXTRACTION_CONFIG.maxImages),
    apiKeys: aiApiKeys,
    nvidiaModelKeys,
    geminiOAuth,
    ocr: {
      ...DEFAULT_AI_EXTRACTION_CONFIG.ocr,
      ...rawAiOcr,
      enabled: Boolean(rawAiOcr.enabled),
      provider: rawAiOcr.provider || DEFAULT_AI_EXTRACTION_CONFIG.ocr.provider,
      model: String(rawAiOcr.model || DEFAULT_AI_EXTRACTION_CONFIG.ocr.model)
        .replace('nvidia/nemoretriever-ocr-v1', 'nvidia/nemotron-ocr-v2')
        .replace('nvidia/nemotron-ocr-v1', 'nvidia/nemotron-ocr-v2'),
      endpoint: String(rawAiOcr.endpoint || DEFAULT_AI_EXTRACTION_CONFIG.ocr.endpoint)
        .replace('nvidia/nemoretriever-ocr-v1', 'nvidia/nemotron-ocr-v2')
        .replace('nvidia/nemotron-ocr-v1', 'nvidia/nemotron-ocr-v2')
        .replace(/\/v1\/infer$/, ''),
      // The same NVIDIA API key can authorize both invoice AI and OCR.
      // Keep the dedicated OCR key as an override, but do not require users
      // to store an identical NVIDIA key twice.
      apiKey: aiOcrApiKey || aiApiKeys.nvidia,
    },
  };
  const rawScheduler = safeJsonParse<Record<string, unknown>>(row.scheduler_config_json, {});
  const scheduler = {
    ...DEFAULT_SCHEDULER_CONFIG,
    ...rawScheduler,
  };
  delete (scheduler as Record<string, unknown>).poBillScheduler;
  const poBillScheduler = {
    ...DEFAULT_PO_BILL_SCHEDULER_CONFIG,
    ...(rawScheduler.poBillScheduler as Record<string, unknown> | undefined),
  };
  const stock = {
    ...DEFAULT_STOCK_CONFIG,
    ...safeJsonParse(row.stock_config_json, {}),
  };
  const mail = readMailConfig(row.mail_config_json);
  const payrollBridge = readPayrollBridgeConfig(row.payroll_bridge_config_json);
  let odooApiKey = '';
  let odooShopFloorPassword = '';

  if (row.odoo_api_key_encrypted) {
    try {
      odooApiKey = decryptSecret(row.odoo_api_key_encrypted);
    } catch (error) {
      console.warn(
        '[settings] Stored Odoo API key could not be decrypted. Re-save the Odoo credentials in Settings using the current APP_ENCRYPTION_KEY.',
        error instanceof Error ? error.message : error,
      );
    }
  }
  if (row.odoo_shop_floor_password_encrypted) {
    try {
      odooShopFloorPassword = decryptSecret(row.odoo_shop_floor_password_encrypted);
    } catch (error) {
      console.warn(
        '[settings] Stored Odoo Shop Floor web password could not be decrypted. Re-save it in Settings using the current APP_ENCRYPTION_KEY.',
        error instanceof Error ? error.message : error,
      );
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
      intervalMinutes: Number(scheduler.intervalMinutes || DEFAULT_SCHEDULER_CONFIG.intervalMinutes),
      batchSize: Number(scheduler.batchSize || DEFAULT_SCHEDULER_CONFIG.batchSize),
    },
    poBillScheduler: {
      ...poBillScheduler,
      enabled: Boolean(poBillScheduler.enabled),
      useInProcessInterval: Boolean(poBillScheduler.useInProcessInterval),
      intervalMinutes: Number(
        poBillScheduler.intervalMinutes || DEFAULT_PO_BILL_SCHEDULER_CONFIG.intervalMinutes,
      ),
      batchSize: Number(poBillScheduler.batchSize || DEFAULT_PO_BILL_SCHEDULER_CONFIG.batchSize),
      fromDate: String(poBillScheduler.fromDate || DEFAULT_PO_BILL_SCHEDULER_CONFIG.fromDate) === '2026-01-01 00:00:00'
        ? DEFAULT_PO_BILL_SCHEDULER_CONFIG.fromDate
        : String(poBillScheduler.fromDate || DEFAULT_PO_BILL_SCHEDULER_CONFIG.fromDate),
      cronToken: String(poBillScheduler.cronToken || ''),
      maxRetryAttempts: positiveNumberValue(
        poBillScheduler.maxRetryAttempts,
        DEFAULT_PO_BILL_SCHEDULER_CONFIG.maxRetryAttempts,
      ),
      transientRetryHours: positiveNumberValue(
        poBillScheduler.transientRetryHours,
        DEFAULT_PO_BILL_SCHEDULER_CONFIG.transientRetryHours,
      ),
      retryBackoffHours: Array.isArray(poBillScheduler.retryBackoffHours)
        ? poBillScheduler.retryBackoffHours.map(Number).filter((value) => Number.isFinite(value) && value > 0)
        : DEFAULT_PO_BILL_SCHEDULER_CONFIG.retryBackoffHours,
      stableSkipRetryDays: Number(poBillScheduler.stableSkipRetryDays) === 14
        ? 0
        : nonNegativeNumberValue(
          poBillScheduler.stableSkipRetryDays,
          DEFAULT_PO_BILL_SCHEDULER_CONFIG.stableSkipRetryDays,
        ),
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

export async function saveSettings(input: {
  baseUrl: string;
  database: string;
  username: string;
  apiKey: string;
  keepExistingApiKey?: boolean;
  clearStoredApiKey?: boolean;
  shopFloorPassword?: string;
  keepExistingShopFloorPassword?: boolean;
  clearStoredShopFloorPassword?: boolean;
  fieldMappings?: Record<string, string>;
  parser?: Record<string, unknown>;
  ai?: Record<string, unknown>;
  scheduler?: Record<string, unknown>;
  poBillScheduler?: Record<string, unknown>;
  stock?: Record<string, unknown>;
  mail?: MailConfig;
  payrollBridge?: PayrollBridgeConfig;
  keepExistingPayrollBridgeToken?: boolean;
  clearPayrollBridgeToken?: boolean;
}) {
  const existing = await getSettings();
  const existingRow = await getSettingsRow();
  const existingRawAi = safeJsonParse<Record<string, unknown>>(existingRow.ai_config_json, {});
  const existingEncryptedKeysPayload = safeJsonParse<Record<string, unknown>>(
    String(existingRawAi.apiKeysEncryptedJson || ''),
    {},
  );
  const existingGeminiOAuthClient = readStoredGeminiOAuthClient(existingEncryptedKeysPayload);
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
    ...createEmptyFieldMappings(),
    ...existing.fieldMappings,
    ...input.fieldMappings,
  };
  const parser = {
    ...existing.parser,
    ...input.parser,
  };
  const submittedAi = input.ai || {};
  const submittedAiKeys = (submittedAi.apiKeys || {}) as Record<string, string>;
  const clearAiKeys = (submittedAi.clearApiKeys || {}) as Record<string, unknown>;
  const submittedNvidiaModelKeys = (submittedAi.nvidiaModelKeys || {}) as Record<string, string>;
  const clearNvidiaModelKeys = (submittedAi.clearNvidiaModelKeys || {}) as Record<string, unknown>;
  const aiApiKeys = { ...existing.ai.apiKeys };
  (Object.keys(aiApiKeys) as Array<keyof typeof aiApiKeys>).forEach((key) => {
    if (clearAiKeys[key]) {
      aiApiKeys[key] = '';
      return;
    }
    const submitted = submittedAiKeys[key]?.trim();
    if (submitted) {
      aiApiKeys[key] = submitted;
    }
  });
  const nvidiaModelKeys = { ...(existing.ai.nvidiaModelKeys || {}) };
  for (const model of new Set([...Object.keys(nvidiaModelKeys), ...Object.keys(submittedNvidiaModelKeys)])) {
    if (clearNvidiaModelKeys[model]) {
      delete nvidiaModelKeys[model];
      continue;
    }
    const submitted = submittedNvidiaModelKeys[model]?.trim();
    if (submitted) nvidiaModelKeys[model] = submitted;
  }
  const encryptedProviderKeys = (Object.keys(aiApiKeys) as Array<keyof typeof aiApiKeys>).reduce<Record<string, string>>(
    (accumulator, key) => {
      accumulator[key] = aiApiKeys[key] ? encryptSecret(aiApiKeys[key]) : '';
      return accumulator;
    },
    {},
  );
  const encryptedNvidiaModelKeys = Object.entries(nvidiaModelKeys).reduce<Record<string, string>>(
    (accumulator, [model, key]) => {
      if (key) accumulator[model] = encryptSecret(key);
      return accumulator;
    },
    {},
  );
  const encryptedAiPayload: Record<string, unknown> = {
    providers: encryptedProviderKeys,
    nvidiaModels: encryptedNvidiaModelKeys,
  };
  const submittedGeminiClientId = String(submittedAi.geminiOAuthClientId || '').trim();
  const submittedGeminiClientSecret = String(submittedAi.geminiOAuthClientSecret || '').trim();
  const nextGeminiClientId = submittedAi.clearGeminiOAuthClientId
    ? ''
    : submittedGeminiClientId || existingGeminiOAuthClient?.clientId || env.GOOGLE_GEMINI_OAUTH_CLIENT_ID.trim();
  const nextGeminiClientSecret = submittedAi.clearGeminiOAuthClientSecret
    ? ''
    : submittedGeminiClientSecret || existingGeminiOAuthClient?.clientSecret || env.GOOGLE_GEMINI_OAUTH_CLIENT_SECRET.trim();
  if (nextGeminiClientId || nextGeminiClientSecret) {
    encryptedAiPayload.geminiOAuthClient = encryptSecret(JSON.stringify({
      clientId: nextGeminiClientId,
      clientSecret: nextGeminiClientSecret,
    } satisfies StoredGeminiOAuthClient));
  } else if (
    !submittedAi.clearGeminiOAuthClientId &&
    !submittedAi.clearGeminiOAuthClientSecret &&
    typeof existingEncryptedKeysPayload.geminiOAuthClient === 'string' &&
    existingEncryptedKeysPayload.geminiOAuthClient
  ) {
    encryptedAiPayload.geminiOAuthClient = existingEncryptedKeysPayload.geminiOAuthClient;
  }
  if (typeof existingEncryptedKeysPayload.geminiOAuth === 'string' && existingEncryptedKeysPayload.geminiOAuth) {
    encryptedAiPayload.geminiOAuth = existingEncryptedKeysPayload.geminiOAuth;
  }
  const ai = {
    ...existing.ai,
    ...submittedAi,
    nvidiaModelKeys,
    ocr: {
      ...existing.ai.ocr,
      ...((submittedAi.ocr || {}) as Record<string, unknown>),
      apiKeyEncrypted: ((submittedAi.ocr || {}) as Record<string, unknown>).clearApiKey
        ? ''
        : ((submittedAi.ocr || {}) as Record<string, string>).apiKey?.trim()
          ? encryptSecret(((submittedAi.ocr || {}) as Record<string, string>).apiKey.trim())
          : existing.ai.ocr.apiKey
            ? encryptSecret(existing.ai.ocr.apiKey)
            : '',
    },
    apiKeysEncryptedJson: JSON.stringify(encryptedAiPayload),
  };
  delete (ai as Record<string, unknown>).apiKeys;
  delete (ai as Record<string, unknown>).clearApiKeys;
  delete (ai as Record<string, unknown>).geminiOAuthClientId;
  delete (ai as Record<string, unknown>).geminiOAuthClientSecret;
  delete (ai as Record<string, unknown>).clearGeminiOAuthClientId;
  delete (ai as Record<string, unknown>).clearGeminiOAuthClientSecret;
  delete (ai as Record<string, unknown>).nvidiaModelKeys;
  delete (ai as Record<string, unknown>).clearNvidiaModelKeys;
  delete ((ai as Record<string, unknown>).ocr as Record<string, unknown>).apiKey;
  delete ((ai as Record<string, unknown>).ocr as Record<string, unknown>).clearApiKey;
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
    await execute(
      `
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
      `,
      [
        input.baseUrl,
        input.database,
        input.username,
        encryptSecret(nextApiKey),
        nextShopFloorPassword ? encryptSecret(nextShopFloorPassword) : '',
        JSON.stringify(fieldMappings),
        JSON.stringify(parser),
        JSON.stringify(ai),
        JSON.stringify(scheduler),
        JSON.stringify(stock),
        JSON.stringify(buildStoredMailConfig(mail)),
        JSON.stringify(buildStoredPayrollBridgeConfig(payrollBridge)),
      ],
    );
  } catch (_err) {
    await execute(
      `
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
      `,
      [
        input.baseUrl,
        input.database,
        input.username,
        encryptSecret(nextApiKey),
        JSON.stringify(fieldMappings),
        JSON.stringify(parser),
        JSON.stringify(ai),
        JSON.stringify(scheduler),
        JSON.stringify(stock),
        JSON.stringify(buildStoredMailConfig(mail)),
        JSON.stringify(buildStoredPayrollBridgeConfig(payrollBridge)),
      ],
    );
  }

  return getSettings();
}

export async function getGeminiOAuthCredentials(): Promise<StoredGeminiOAuthCredentials | null> {
  const row = await getSettingsRow();
  const rawAi = safeJsonParse<Record<string, unknown>>(row.ai_config_json, {});
  const encryptedKeysPayload = safeJsonParse<Record<string, unknown>>(
    String(rawAi.apiKeysEncryptedJson || ''),
    {},
  );
  return readStoredGeminiOAuthCredentials(encryptedKeysPayload);
}

export async function getGeminiOAuthClientConfig(): Promise<{ clientId: string; clientSecret: string } | null> {
  const row = await getSettingsRow();
  const rawAi = safeJsonParse<Record<string, unknown>>(row.ai_config_json, {});
  const encryptedKeysPayload = safeJsonParse<Record<string, unknown>>(
    String(rawAi.apiKeysEncryptedJson || ''),
    {},
  );
  return readStoredGeminiOAuthClient(encryptedKeysPayload);
}

export async function saveGeminiOAuthCredentials(input: {
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  email: string;
  scopes: string[];
  projectId: string;
}): Promise<void> {
  const row = await getSettingsRow();
  const rawAi = safeJsonParse<Record<string, unknown>>(row.ai_config_json, {});
  const encryptedKeysPayload = safeJsonParse<Record<string, unknown>>(
    String(rawAi.apiKeysEncryptedJson || ''),
    {},
  );
  const credentials: StoredGeminiOAuthCredentials = {
    refreshToken: input.refreshToken,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    email: input.email,
    scopes: input.scopes,
    connectedAt: new Date().toISOString(),
  };
  encryptedKeysPayload.geminiOAuth = encryptSecret(JSON.stringify(credentials));
  rawAi.apiKeysEncryptedJson = JSON.stringify(encryptedKeysPayload);
  rawAi.geminiOAuth = {
    connected: true,
    email: input.email,
    projectId: input.projectId,
    connectedAt: credentials.connectedAt,
    clientId: readStoredGeminiOAuthClient(encryptedKeysPayload)?.clientId || '',
    hasClientSecret: Boolean(readStoredGeminiOAuthClient(encryptedKeysPayload)?.clientSecret),
  } satisfies GeminiOAuthConnectionStatus;

  await execute(
    'UPDATE settings SET ai_config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
    [JSON.stringify(rawAi)],
  );
}

export async function updateGeminiOAuthAccessToken(input: {
  accessToken: string;
  accessTokenExpiresAt: number;
}): Promise<void> {
  const credentials = await getGeminiOAuthCredentials();
  if (!credentials) {
    throw new Error('Google Gemini is not connected.');
  }

  const row = await getSettingsRow();
  const rawAi = safeJsonParse<Record<string, unknown>>(row.ai_config_json, {});
  const encryptedKeysPayload = safeJsonParse<Record<string, unknown>>(
    String(rawAi.apiKeysEncryptedJson || ''),
    {},
  );
  encryptedKeysPayload.geminiOAuth = encryptSecret(JSON.stringify({
    ...credentials,
    accessToken: input.accessToken,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
  } satisfies StoredGeminiOAuthCredentials));
  rawAi.apiKeysEncryptedJson = JSON.stringify(encryptedKeysPayload);
  await execute(
    'UPDATE settings SET ai_config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
    [JSON.stringify(rawAi)],
  );
}

export async function clearGeminiOAuthCredentials(): Promise<void> {
  const row = await getSettingsRow();
  const rawAi = safeJsonParse<Record<string, unknown>>(row.ai_config_json, {});
  const encryptedKeysPayload = safeJsonParse<Record<string, unknown>>(
    String(rawAi.apiKeysEncryptedJson || ''),
    {},
  );
  delete encryptedKeysPayload.geminiOAuth;
  rawAi.apiKeysEncryptedJson = JSON.stringify(encryptedKeysPayload);
  const currentStatus = (rawAi.geminiOAuth || {}) as Partial<GeminiOAuthConnectionStatus>;
  const client = readStoredGeminiOAuthClient(encryptedKeysPayload);
  rawAi.geminiOAuth = {
    connected: false,
    email: '',
    projectId: String(currentStatus.projectId || env.GOOGLE_GEMINI_PROJECT_ID || ''),
    connectedAt: null,
    clientId: client?.clientId || String(currentStatus.clientId || ''),
    hasClientSecret: Boolean(client?.clientSecret),
  } satisfies GeminiOAuthConnectionStatus;

  await execute(
    'UPDATE settings SET ai_config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1',
    [JSON.stringify(rawAi)],
  );
}

export async function getCachedModelFields(modelName: string): Promise<OdooModelFieldCache> {
  const row = await queryOne<{
    model_name: string;
    fields_json: string;
    fetched_at: string | null;
  }>(
    `
      SELECT model_name, fields_json, fetched_at
      FROM odoo_model_fields_cache
      WHERE model_name = ?
    `,
    [modelName],
  );

  if (!row) {
    return {
      modelName,
      fields: [],
      fetchedAt: null,
    };
  }

  return {
    modelName: row.model_name,
    fields: safeJsonParse(row.fields_json, []),
    fetchedAt: row.fetched_at,
  };
}

export async function saveCachedModelFields(modelName: string, fields: OdooModelField[]) {
  const dialect = getDatabaseDialect();
  if (dialect === 'mysql') {
    await execute(
      `
        INSERT INTO odoo_model_fields_cache (model_name, fields_json, fetched_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          fields_json = VALUES(fields_json),
          fetched_at = CURRENT_TIMESTAMP
      `,
      [modelName, JSON.stringify(fields)],
    );
  } else {
    await execute(
      `
        INSERT INTO odoo_model_fields_cache (model_name, fields_json, fetched_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(model_name) DO UPDATE SET
          fields_json = excluded.fields_json,
          fetched_at = CURRENT_TIMESTAMP
      `,
      [modelName, JSON.stringify(fields)],
    );
  }

  return getCachedModelFields(modelName);
}

export async function clearCachedModelFields(): Promise<number> {
  const result = await execute('DELETE FROM odoo_model_fields_cache');
  return result.affectedRows;
}

function mapSchedulerRun(row: {
  id: string;
  status: SchedulerRunEntry['status'];
  trigger_source: SchedulerRunEntry['trigger'];
  started_at: string;
  finished_at: string | null;
  scanned_count: number;
  processed_count: number;
  skipped_count: number;
  failed_count: number;
  summary: string | null;
  error_message: string | null;
  context_json: string;
}): SchedulerRunEntry {
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
    context: safeJsonParse(row.context_json, {}),
  };
}

export async function insertSchedulerRun(entry: Partial<SchedulerRunEntry> & { status: SchedulerRunEntry['status']; trigger: SchedulerRunEntry['trigger'] }) {
  const id = uuidv4();
  await execute(
    `
      INSERT INTO scheduler_runs (
        id, status, trigger_source, finished_at, scanned_count, processed_count, skipped_count, failed_count, summary, error_message, context_json
      )
      VALUES (?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
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
    ],
  );
  return getSchedulerRunById(id);
}

export async function updateSchedulerRun(id: string, patch: Partial<SchedulerRunEntry> & { finished?: boolean }) {
  const current = await getSchedulerRunById(id);
  await execute(
    `
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
    `,
    [
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
    ],
  );
  return getSchedulerRunById(id);
}

export async function getSchedulerRunById(id: string): Promise<SchedulerRunEntry> {
  const row = await queryOne<{
    id: string;
    status: SchedulerRunEntry['status'];
    trigger_source: SchedulerRunEntry['trigger'];
    started_at: string;
    finished_at: string | null;
    scanned_count: number;
    processed_count: number;
    skipped_count: number;
    failed_count: number;
    summary: string | null;
    error_message: string | null;
    context_json: string;
  }>(
    `
      SELECT
        id, status, trigger_source, started_at, finished_at,
        scanned_count, processed_count, skipped_count, failed_count,
        summary, error_message, context_json
      FROM scheduler_runs
      WHERE id = ?
    `,
    [id],
  );

  if (!row) {
    throw new Error(`Scheduler run ${id} was not found.`);
  }

  return mapSchedulerRun(row);
}

export async function getRecentSchedulerRuns(limit = 10): Promise<SchedulerRunEntry[]> {
  const rows = await queryAll<{
    id: string;
    status: SchedulerRunEntry['status'];
    trigger_source: SchedulerRunEntry['trigger'];
    started_at: string;
    finished_at: string | null;
    scanned_count: number;
    processed_count: number;
    skipped_count: number;
    failed_count: number;
    summary: string | null;
    error_message: string | null;
    context_json: string;
  }>(
    `
      SELECT
        id, status, trigger_source, started_at, finished_at,
        scanned_count, processed_count, skipped_count, failed_count,
        summary, error_message, context_json
      FROM scheduler_runs
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `,
    [limit],
  );
  return rows.map(mapSchedulerRun);
}

function formatDbDateString(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isFinite(val.getTime()) ? val.toISOString() : null;
  if (typeof val === 'string' && val.trim()) return val;
  return null;
}

function mapSchedulerRuntimeState(row: {
  lock_run_id: string | null;
  lock_acquired_at: unknown;
  stop_requested_at: unknown;
  last_successful_run_id: string | null;
  last_successful_finished_at: unknown;
  last_checkpoint_at: unknown;
  last_error_run_id: string | null;
  last_error_message: string | null;
  updated_at: unknown;
}): SchedulerRuntimeState {
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

export async function getSchedulerRuntimeState(): Promise<SchedulerRuntimeState> {
  const row = await queryOne<{
    lock_run_id: string | null;
    lock_acquired_at: string | null;
    stop_requested_at: string | null;
    last_successful_run_id: string | null;
    last_successful_finished_at: string | null;
    last_checkpoint_at: string | null;
    last_error_run_id: string | null;
    last_error_message: string | null;
    updated_at: string | null;
  }>(
    `
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
    `,
  );

  if (!row) {
    throw new Error('Scheduler runtime state row is missing.');
  }

  return mapSchedulerRuntimeState(row);
}

export async function acquireSchedulerRunLock(runId: string): Promise<boolean> {
  const current = await getSchedulerRuntimeState();
  const acquiredAt = current.lockAcquiredAt ? Date.parse(current.lockAcquiredAt) : 0;
  const isStale = !acquiredAt || acquiredAt < Date.now() - getSchedulerLockStaleMs();

  if (current.lockRunId && !isStale) {
    return false;
  }

  if (current.lockRunId && isStale) {
    await execute(
      `
        UPDATE scheduler_runtime_state
        SET
          lock_run_id = NULL,
          lock_acquired_at = NULL,
          stop_requested_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = 1
      `,
    );
  }

  const result = await execute(
    `
      UPDATE scheduler_runtime_state
      SET
        lock_run_id = ?,
        lock_acquired_at = CURRENT_TIMESTAMP,
        stop_requested_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
        AND (lock_run_id IS NULL OR lock_run_id = ? OR lock_acquired_at IS NULL)
    `,
    [runId, runId],
  );

  return result.affectedRows > 0;
}

export async function markOrphanedStartedRunsAsFailed() {
  const staleCutoff = appDateTimeFromNow(-getSchedulerLockStaleMs());
  await execute(
    `
      UPDATE scheduler_runs
      SET
        status = 'failed',
        summary = 'Scheduler run timed out or was interrupted (lock expired after 10 minutes).',
        error_message = 'Scheduler lock expired while run was in started state.',
        finished_at = CURRENT_TIMESTAMP
      WHERE status = 'started' AND started_at <= ?
    `,
    [staleCutoff],
  );
}

export async function clearStaleSchedulerRunLock(): Promise<SchedulerRuntimeState | null> {
  const current = await getSchedulerRuntimeState();
  const acquiredAt = current.lockAcquiredAt ? Date.parse(current.lockAcquiredAt) : 0;
  const isStale = current.lockRunId && (!acquiredAt || acquiredAt < Date.now() - getSchedulerLockStaleMs());

  if (!current.lockRunId) {
    await markOrphanedStartedRunsAsFailed();
    return null;
  }

  const activeRun = await queryOne<{
    id: string;
    status: SchedulerRunEntry['status'];
    finished_at: string | null;
  }>(
    `
      SELECT id, status, finished_at
      FROM scheduler_runs
      WHERE id = ?
    `,
    [current.lockRunId],
  );

  const runIsNotActive = !activeRun || activeRun.status !== 'started' || Boolean(activeRun.finished_at);

  if (!isStale && !runIsNotActive) {
    await markOrphanedStartedRunsAsFailed();
    return null;
  }

  if (activeRun && activeRun.status === 'started') {
    await execute(
      `
        UPDATE scheduler_runs
        SET
          status = 'failed',
          summary = 'Scheduler run timed out or was interrupted (lock expired after 10 minutes).',
          error_message = 'Scheduler lock expired while run was in started state.',
          finished_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'started'
      `,
      [activeRun.id],
    );
  }

  await execute(
    `
      UPDATE scheduler_runtime_state
      SET
        lock_run_id = NULL,
        lock_acquired_at = NULL,
        stop_requested_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `,
    [current.lockRunId],
  );

  await markOrphanedStartedRunsAsFailed();

  return current;
}


export async function touchSchedulerRunLock(runId: string) {
  await execute(
    `
      UPDATE scheduler_runtime_state
      SET
        lock_acquired_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `,
    [runId],
  );
}

export async function releaseSchedulerRunLock(runId: string) {
  await execute(
    `
      UPDATE scheduler_runtime_state
      SET
        lock_run_id = NULL,
        lock_acquired_at = NULL,
        stop_requested_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `,
    [runId],
  );
}

export async function requestSchedulerStop(runId: string | null) {
  if (!runId) {
    return false;
  }

  const result = await execute(
    `
      UPDATE scheduler_runtime_state
      SET
        stop_requested_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1 AND lock_run_id = ?
    `,
    [runId],
  );

  return result.affectedRows > 0;
}

export async function markSchedulerRunSucceeded(runId: string, checkpointAt: string | null) {
  await execute(
    `
      UPDATE scheduler_runtime_state
      SET
        last_successful_run_id = ?,
        last_successful_finished_at = CURRENT_TIMESTAMP,
        last_checkpoint_at = COALESCE(?, last_checkpoint_at),
        last_error_run_id = NULL,
        last_error_message = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `,
    [runId, checkpointAt],
  );
}

export async function markSchedulerRunFailed(runId: string, message: string) {
  await execute(
    `
      UPDATE scheduler_runtime_state
      SET
        last_error_run_id = ?,
        last_error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `,
    [runId, message],
  );
}

export async function updateConnectionStatus(
  status: ConnectionStatus,
  message: string | null,
  version: string | null = null,
) {
  await execute(
    `
      UPDATE settings
      SET
        connection_status = ?,
        connection_checked_at = CURRENT_TIMESTAMP,
        connection_message = ?,
        connection_version = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `,
    [status, message, version],
  );
}

function mapMpesaBatchRow(row: {
  id: string;
  original_filename: string;
  stored_filename: string;
  status: MpesaStatementBatch['status'];
  transaction_count: number;
  matched_count: number;
  new_count?: number | string | null;
  needs_followup_count?: number | string | null;
  warning_count: number;
  warnings_json: string;
  raw_text_preview: string;
  created_at: string;
  updated_at: string;
}): MpesaStatementBatch {
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
    warnings: safeJsonParse(row.warnings_json, [] as string[]),
    rawTextPreview: row.raw_text_preview || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMpesaTransactionRow(row: {
  id: string;
  batch_id: string;
  row_index: number;
  transaction_date: string | null;
  completion_time: string | null;
  receipt_number: string | null;
  details: string;
  paid_in: number | string | null;
  withdrawn: number | string | null;
  balance: number | string | null;
  amount: number | string | null;
  direction: MpesaTransaction['direction'];
  counterparty: string | null;
  phone_number: string | null;
  transaction_type: string;
  matched_po_id: number | null;
  matched_po_name: string | null;
  match_confidence: number | string | null;
  user_category: string | null;
  user_supplier: string | null;
  review_status: MpesaTransaction['reviewStatus'];
  notes: string | null;
  ai_notes: string | null;
  candidates_json: string;
  raw_json: string;
  created_at: string;
  updated_at: string;
}): MpesaTransaction {
  const parseNullableNumber = (value: number | string | null) => {
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
    candidates: safeJsonParse(row.candidates_json, [] as MpesaPurchaseOrderCandidate[]),
    raw: safeJsonParse(row.raw_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMpesaTransactionExplorerRow(
  row: Parameters<typeof mapMpesaTransactionRow>[0] & {
    effective_category: string | null;
    batch_original_filename: string;
    batch_stored_filename: string;
    batch_created_at: string;
  },
): MpesaTransactionExplorerRow {
  const transaction = mapMpesaTransactionRow(row);

  return {
    ...transaction,
    effectiveCategory: row.effective_category || transaction.userCategory || transaction.transactionType || 'unknown',
    batchOriginalFilename: row.batch_original_filename,
    batchStoredFilename: row.batch_stored_filename,
    batchCreatedAt: row.batch_created_at,
  };
}

type MpesaTransactionDraft = Omit<MpesaTransaction, 'id' | 'batchId' | 'createdAt' | 'updatedAt'>;

function normalizeMpesaDateKey(value: string | null | undefined) {
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
    const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
      textDateMatch[1].toLowerCase(),
    );
    if (monthIndex >= 0) {
      return `${textDateMatch[3]}-${String(monthIndex + 1).padStart(2, '0')}-${textDateMatch[2].padStart(2, '0')}`;
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(
      parsed.getDate(),
    ).padStart(2, '0')}`;
  }

  return raw.toLowerCase();
}

function normalizeMpesaTimeKey(value: string | null | undefined) {
  const match = String(value || '').match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/);
  if (!match) {
    return '';
  }

  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}

function normalizeMpesaAmountKey(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '';
}

function mpesaRetryMergeKey(
  transaction: Pick<
    MpesaTransaction,
    'receiptNumber' | 'transactionDate' | 'completionTime' | 'paidIn' | 'withdrawn' | 'amount' | 'direction'
  >,
) {
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

function mergeMpesaRetriedTransactions(
  newTransactions: MpesaTransactionDraft[],
  existingTransactions: MpesaTransaction[],
): MpesaTransactionDraft[] {
  const existingByKey = new Map<string, MpesaTransaction[]>();

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
    const shouldPreserveMatch =
      existing.matchedPoId !== null &&
      existing.matchedPoId !== undefined &&
      (!isIncomingReceipt || existingReceivableMatch);

    return {
      ...transaction,
      matchedPoId: shouldPreserveMatch ? existing.matchedPoId : transaction.matchedPoId,
      matchedPoName: shouldPreserveMatch ? existing.matchedPoName : transaction.matchedPoName,
      matchConfidence: shouldPreserveMatch ? existing.matchConfidence : transaction.matchConfidence,
      userCategory:
        existingCategory && existingCategory !== existing.transactionType ? existingCategory : transaction.userCategory,
      userSupplier:
        existingSupplier && existingSupplier !== String(existing.counterparty || '').trim()
          ? existingSupplier
          : transaction.userSupplier,
      reviewStatus:
        existing.reviewStatus !== 'new' && (!isIncomingReceipt || existing.reviewStatus !== 'verified' || shouldPreserveMatch)
          ? existing.reviewStatus
          : transaction.reviewStatus,
      notes: existing.notes || transaction.notes,
    };
  });
}

export async function createMpesaStatementBatch(input: {
  originalFilename: string;
  storedFilename: string;
  status: MpesaStatementBatch['status'];
  warnings: string[];
  rawTextPreview: string;
  transactions: MpesaTransactionDraft[];
}): Promise<MpesaStatementBatch> {
  const id = uuidv4();
  const safeWarnings = Array.isArray(input.warnings) ? input.warnings : [];
  const safeRawTextPreview = String(input.rawTextPreview || '');
  const safeTransactions = Array.isArray(input.transactions) ? input.transactions : [];
  const matchedCount = safeTransactions.filter((transaction) => Boolean(transaction && transaction.matchedPoId)).length;

  await execute(
    `
      INSERT INTO mpesa_statement_batches (
        id, original_filename, stored_filename, status, transaction_count, matched_count,
        warning_count, warnings_json, raw_text_preview
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      input.originalFilename,
      input.storedFilename,
      input.status,
      safeTransactions.length,
      matchedCount,
      safeWarnings.length,
      JSON.stringify(safeWarnings),
      safeRawTextPreview,
    ],
  );

  for (const transaction of input.transactions) {
    await execute(
      `
        INSERT INTO mpesa_transactions (
          id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
          paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
          transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
          user_supplier, review_status, notes, ai_notes, candidates_json, raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuidv4(),
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
      ],
    );
  }

  return getMpesaStatementBatchById(id);
}

export async function replaceMpesaStatementBatchExtraction(
  id: string,
  input: {
    originalFilename?: string;
    storedFilename?: string;
    status: MpesaStatementBatch['status'];
    warnings: string[];
    rawTextPreview: string;
    transactions: MpesaTransactionDraft[];
  },
): Promise<MpesaStatementBatch> {
  await getMpesaStatementBatchById(id);
  const existingTransactions = await getMpesaTransactionsByBatchId(id);
  const mergedTransactions = mergeMpesaRetriedTransactions(input.transactions, existingTransactions);
  const matchedCount = mergedTransactions.filter((transaction) => Boolean(transaction.matchedPoId)).length;

  await execute(
    `
      DELETE FROM mpesa_transactions
      WHERE batch_id = ?
    `,
    [id],
  );

  await execute(
    `
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
    `,
    [
      input.status,
      mergedTransactions.length,
      matchedCount,
      input.warnings.length,
      JSON.stringify(input.warnings),
      input.rawTextPreview,
      input.originalFilename || null,
      input.storedFilename || null,
      id,
    ],
  );

  for (const transaction of mergedTransactions) {
    await execute(
      `
        INSERT INTO mpesa_transactions (
          id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
          paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
          transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
          user_supplier, review_status, notes, ai_notes, candidates_json, raw_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        uuidv4(),
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
      ],
    );
  }

  return getMpesaStatementBatchById(id);
}

export async function getRecentMpesaStatementBatches(limit = 12): Promise<MpesaStatementBatch[]> {
  const rows = await queryAll<Parameters<typeof mapMpesaBatchRow>[0]>(
    `
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
    `,
    [limit],
  );

  return rows.map(mapMpesaBatchRow);
}

export async function getMpesaStatementBatchesWithOpenReviewCounts(): Promise<MpesaStatementBatch[]> {
  const rows = await queryAll<Parameters<typeof mapMpesaBatchRow>[0]>(
    `
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
    `,
  );

  return rows.map(mapMpesaBatchRow);
}

export async function hasMpesaStatementUploadedSince(since: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM mpesa_statement_batches WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1`,
    [since],
  );
  return Boolean(row);
}

export async function hasMpesaReviewNotificationSince(since: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM logs
      WHERE message = 'M-Pesa review notification sent'
        AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [since],
  );

  return Boolean(row);
}

export async function getMpesaStatementBatchById(id: string): Promise<MpesaStatementBatch> {
  const row = await queryOne<Parameters<typeof mapMpesaBatchRow>[0]>(
    `
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
    `,
    [id],
  );

  if (!row) {
    throw new Error(`M-Pesa statement batch ${id} was not found.`);
  }

  return mapMpesaBatchRow(row);
}

export async function deleteMpesaStatementBatch(id: string): Promise<MpesaStatementBatch> {
  const batch = await getMpesaStatementBatchById(id);

  await execute(
    `
      DELETE FROM mpesa_transactions
      WHERE batch_id = ?
    `,
    [id],
  );

  await execute(
    `
      DELETE FROM mpesa_statement_batches
      WHERE id = ?
    `,
    [id],
  );

  return batch;
}

export async function getMpesaTransactionsByBatchId(batchId: string): Promise<MpesaTransaction[]> {
  const rows = await queryAll<Parameters<typeof mapMpesaTransactionRow>[0]>(
    `
      SELECT
        id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
        paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
        transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
        user_supplier, review_status, notes, ai_notes, candidates_json, raw_json, created_at, updated_at
      FROM mpesa_transactions
      WHERE batch_id = ?
      ORDER BY row_index ASC, id ASC
    `,
    [batchId],
  );

  return rows.map(mapMpesaTransactionRow);
}

export async function getMpesaTransactionsByIds(ids: string[]): Promise<MpesaTransaction[]> {
  const uniqueIds = [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = await queryAll<Parameters<typeof mapMpesaTransactionRow>[0]>(
    `
      SELECT
        id, batch_id, row_index, transaction_date, completion_time, receipt_number, details,
        paid_in, withdrawn, balance, amount, direction, counterparty, phone_number,
        transaction_type, matched_po_id, matched_po_name, match_confidence, user_category,
        user_supplier, review_status, notes, ai_notes, candidates_json, raw_json,
        created_at, updated_at
      FROM mpesa_transactions
      WHERE id IN (${placeholders})
    `,
    uniqueIds,
  );

  return rows.map(mapMpesaTransactionRow);
}

export async function getMpesaTransactionExplorerOptions(): Promise<MpesaTransactionExplorerOptions> {
  const [categoryRows, monthRows, statementRows] = await Promise.all([
    queryAll<{ category: string | null }>(
      `
        SELECT DISTINCT COALESCE(NULLIF(user_category, ''), transaction_type, 'unknown') AS category
        FROM mpesa_transactions
        ORDER BY category ASC
      `,
    ),
    queryAll<{ month: string | null }>(
      `
        SELECT DISTINCT SUBSTR(transaction_date, 1, 7) AS month
        FROM mpesa_transactions
        WHERE transaction_date IS NOT NULL AND transaction_date <> ''
        ORDER BY month DESC
      `,
    ),
    queryAll<{
      id: string;
      original_filename: string;
      created_at: string;
      transaction_count: number | string | null;
    }>(
      `
        SELECT id, original_filename, created_at, transaction_count
        FROM mpesa_statement_batches
        ORDER BY created_at DESC, id DESC
      `,
    ),
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

export async function getMpesaTransactionExplorerRows(
  filters: MpesaTransactionExplorerFilters,
): Promise<MpesaTransactionExplorerRow[]> {
  const dialect = getDatabaseDialect();
  const searchTextExpression =
    dialect === 'mysql'
      ? `LOWER(CONCAT_WS(' ', t.counterparty, t.user_supplier, t.details, t.phone_number, t.receipt_number, t.matched_po_name, t.notes, t.ai_notes, CAST(COALESCE(t.amount, 0) AS CHAR), CAST(COALESCE(t.balance, 0) AS CHAR), t.raw_json, b.original_filename))`
      : `LOWER(COALESCE(t.counterparty, '') || ' ' || COALESCE(t.user_supplier, '') || ' ' || COALESCE(t.details, '') || ' ' || COALESCE(t.phone_number, '') || ' ' || COALESCE(t.receipt_number, '') || ' ' || COALESCE(t.matched_po_name, '') || ' ' || COALESCE(t.notes, '') || ' ' || COALESCE(t.ai_notes, '') || ' ' || CAST(COALESCE(t.amount, 0) AS TEXT) || ' ' || CAST(COALESCE(t.balance, 0) AS TEXT) || ' ' || COALESCE(t.raw_json, '') || ' ' || COALESCE(b.original_filename, ''))`;
  const where: string[] = [];
  const params: Array<string | number> = [];
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
  } else if (filters.partyRole === 'receiver') {
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

  const rows = await queryAll<Parameters<typeof mapMpesaTransactionExplorerRow>[0]>(
    `
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
    `,
    params,
  );

  return rows.map(mapMpesaTransactionExplorerRow);
}

export async function getReviewedSalaryAdvanceTransactionsByPeriod(input: {
  periodStart: string;
  periodEnd: string;
}): Promise<MpesaTransaction[]> {
  const rows = await queryAll<Parameters<typeof mapMpesaTransactionRow>[0]>(
    `
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
    `,
    [input.periodStart, input.periodEnd],
  );

  return rows.map(mapMpesaTransactionRow);
}

/** Get all matched transactions across all batches from a given month onwards, skipping already-verified ones */
export async function getMatchedOutgoingTransactionsSince(
  fromMonth: string,
): Promise<MpesaTransaction[]> {
  const rows = await queryAll<Parameters<typeof mapMpesaTransactionRow>[0]>(
    `
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
    `,
    [fromMonth],
  );

  return rows.map(mapMpesaTransactionRow);
}

/** Get all matched incoming customer receipt transactions across all batches from a given month, skipping already-verified ones */
export async function getMatchedIncomingTransactionsSince(
  fromMonth: string,
): Promise<MpesaTransaction[]> {
  const rows = await queryAll<Parameters<typeof mapMpesaTransactionRow>[0]>(
    `
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
    `,
    [fromMonth],
  );

  return rows.map(mapMpesaTransactionRow);
}

async function refreshMpesaStatementBatchReviewState(batchId: string) {
  const summary = await queryOne<{
    transaction_count: number | string | null;
    matched_count: number | string | null;
    reviewed_count: number | string | null;
  }>(
    `
      SELECT
        COUNT(*) AS transaction_count,
        COALESCE(SUM(CASE WHEN matched_po_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS matched_count,
        COALESCE(SUM(CASE WHEN review_status <> 'new' THEN 1 ELSE 0 END), 0) AS reviewed_count
      FROM mpesa_transactions
      WHERE batch_id = ?
    `,
    [batchId],
  );
  const transactionCount = Number(summary?.transaction_count || 0);
  const matchedCount = Number(summary?.matched_count || 0);
  const reviewedCount = Number(summary?.reviewed_count || 0);
  const status: MpesaStatementBatch['status'] =
    transactionCount > 0 && reviewedCount >= transactionCount ? 'parsed' : 'needs_review';

  await execute(
    `
      UPDATE mpesa_statement_batches
      SET
        status = ?,
        transaction_count = ?,
        matched_count = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [status, transactionCount, matchedCount, batchId],
  );
}

export async function autoVerifyMpesaTransactionsByRule(batchId?: string): Promise<number> {
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
  const affectedBatchRows = await queryAll<{ batch_id: string }>(
    `
      SELECT DISTINCT batch_id
      FROM mpesa_transactions
      WHERE ${autoVerifyCondition}
        AND (review_status IS NULL OR review_status <> 'verified')
        ${batchFilter}
    `,
    params,
  );

  if (!affectedBatchRows.length) {
    return 0;
  }

  const result = await execute(
    `
      UPDATE mpesa_transactions
      SET
        review_status = 'verified',
        updated_at = CURRENT_TIMESTAMP
      WHERE ${autoVerifyCondition}
        AND (review_status IS NULL OR review_status <> 'verified')
        ${batchFilter}
    `,
    params,
  );

  for (const row of affectedBatchRows) {
    await refreshMpesaStatementBatchReviewState(row.batch_id);
  }

  return result.affectedRows;
}

export async function updateMpesaTransactions(
  batchId: string,
  patches: Array<{
    id: string;
    matchedPoId?: number | null;
    matchedPoName?: string | null;
    matchConfidence?: number | null;
    candidates?: MpesaPurchaseOrderCandidate[];
    userCategory?: string | null;
    userSupplier?: string | null;
    reviewStatus?: MpesaTransaction['reviewStatus'];
    notes?: string | null;
    aiNotes?: string | null;
  }>,
) {
  for (const patch of patches) {
    const shouldUpdateMatchConfidence = Object.prototype.hasOwnProperty.call(patch, 'matchConfidence');
    const shouldUpdateCandidates = Object.prototype.hasOwnProperty.call(patch, 'candidates');
    const shouldUpdateNotes = Object.prototype.hasOwnProperty.call(patch, 'notes') && patch.notes !== undefined;
    const shouldUpdateAiNotes = Object.prototype.hasOwnProperty.call(patch, 'aiNotes') && patch.aiNotes !== undefined;
    await execute(
      `
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
      `,
      [
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
      ],
    );
  }

  await refreshMpesaStatementBatchReviewState(batchId);

  return getMpesaStatementBatchById(batchId);
}

export async function updateMpesaTransactionAdminReviewFields(
  patches: Array<{
    id: string;
    batchId: string;
    userCategory?: string | null;
    reviewStatus?: MpesaTransaction['reviewStatus'];
    notes?: string | null;
    aiNotes?: string | null;
  }>,
) {
  const batchIds = new Set<string>();

  for (const patch of patches) {
    if (!patch.id || !patch.batchId) {
      continue;
    }

    const shouldUpdateNotes = Object.prototype.hasOwnProperty.call(patch, 'notes') && patch.notes !== undefined;
    const shouldUpdateAiNotes = Object.prototype.hasOwnProperty.call(patch, 'aiNotes') && patch.aiNotes !== undefined;

    await execute(
      `
        UPDATE mpesa_transactions
        SET
          user_category = ?,
          review_status = ?,
          notes = CASE WHEN ? = 1 THEN ? ELSE notes END,
          ai_notes = CASE WHEN ? = 1 THEN ? ELSE ai_notes END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND batch_id = ?
      `,
      [
        patch.userCategory || null,
        patch.reviewStatus || 'new',
        shouldUpdateNotes ? 1 : 0,
        patch.notes || null,
        shouldUpdateAiNotes ? 1 : 0,
        patch.aiNotes || null,
        patch.id,
        patch.batchId,
      ],
    );
    batchIds.add(patch.batchId);
  }

  for (const batchId of batchIds) {
    await refreshMpesaStatementBatchReviewState(batchId);
  }

  return batchIds.size;
}

export async function insertLog(entry: {
  historyId?: string | null;
  level: LogEntry['level'];
  message: string;
  context?: Record<string, unknown>;
}) {
  const id = uuidv4();
  await execute(
    `
      INSERT INTO logs (id, history_id, level, message, context_json)
      VALUES (?, ?, ?, ?, ?)
    `,
    [id, entry.historyId || null, entry.level, entry.message, JSON.stringify(entry.context || {})],
  );
  return id;
}

export async function getRecentLogs(limit = 50, historyId?: string): Promise<LogEntry[]> {
  const rows = historyId
    ? await queryAll<{
        id: string;
        history_id: string | null;
        level: LogEntry['level'];
        message: string;
        context_json: string;
        created_at: string;
      }>(
        `
          SELECT id, history_id, level, message, context_json, created_at
          FROM logs
          WHERE history_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
        [historyId, limit],
      )
    : await queryAll<{
        id: string;
        history_id: string | null;
        level: LogEntry['level'];
        message: string;
        context_json: string;
        created_at: string;
      }>(
        `
          SELECT id, history_id, level, message, context_json, created_at
          FROM logs
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
        [limit],
      );

  return rows.map((row) => ({
    id: row.id,
    historyId: row.history_id,
    level: row.level,
    message: row.message,
    context: safeJsonParse(row.context_json, {}),
    createdAt: row.created_at,
  }));
}

function mapHistoryRow(row: {
  id: string;
  order_id: number;
  order_name: string;
  attachment_id: number;
  attachment_name: string;
  status: string;
  summary: string | null;
  error_message: string | null;
  extracted_result_id: string | null;
  computed_signature: string | null;
  stored_signature: string | null;
  signature_comparison: SignatureComparisonResult | null;
  send_skipped: number | boolean;
  signature_written: number | boolean;
  created_at: string;
  updated_at: string;
}): HistoryEntry {
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

export async function insertHistory(entry: {
  orderId: number;
  orderName: string;
  attachmentId: number;
  attachmentName: string;
  status: string;
  summary?: string | null;
  errorMessage?: string | null;
  computedSignature?: string | null;
  storedSignature?: string | null;
  signatureComparison?: SignatureComparisonResult | null;
  sendSkipped?: boolean;
  signatureWritten?: boolean;
}) {
  const id = uuidv4();
  await execute(
    `
      INSERT INTO history (
        id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
        computed_signature, stored_signature, signature_comparison, send_skipped, signature_written
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
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
    ],
  );
  return getHistoryById(id);
}

export async function updateHistory(
  id: string,
  patch: Partial<HistoryEntry> & {
    extractedResultId?: string | null;
    errorMessage?: string | null;
    computedSignature?: string | null;
    storedSignature?: string | null;
    signatureComparison?: SignatureComparisonResult | null;
    sendSkipped?: boolean;
    signatureWritten?: boolean;
  },
) {
  const current = await getHistoryById(id);
  await execute(
    `
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
    `,
    [
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
    ],
  );
  return getHistoryById(id);
}

export async function getHistoryById(id: string): Promise<HistoryEntry> {
  const row = await queryOne<{
    id: string;
    order_id: number;
    order_name: string;
    attachment_id: number;
    attachment_name: string;
    status: string;
    summary: string | null;
    error_message: string | null;
    extracted_result_id: string | null;
    computed_signature: string | null;
    stored_signature: string | null;
    signature_comparison: SignatureComparisonResult | null;
    send_skipped: number | boolean;
    signature_written: number | boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
        extracted_result_id, computed_signature, stored_signature, signature_comparison,
        send_skipped, signature_written, created_at, updated_at
      FROM history
      WHERE id = ?
    `,
    [id],
  );

  if (!row) {
    throw new Error(`History entry ${id} was not found.`);
  }

  return mapHistoryRow(row);
}

export async function getRecentHistory(limit = 20, orderId?: number): Promise<HistoryEntry[]> {
  const rows = orderId
    ? await queryAll<{
        id: string;
        order_id: number;
        order_name: string;
        attachment_id: number;
        attachment_name: string;
        status: string;
        summary: string | null;
        error_message: string | null;
        extracted_result_id: string | null;
        computed_signature: string | null;
        stored_signature: string | null;
        signature_comparison: SignatureComparisonResult | null;
        send_skipped: number | boolean;
        signature_written: number | boolean;
        created_at: string;
        updated_at: string;
      }>(
        `
          SELECT
            id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
            extracted_result_id, computed_signature, stored_signature, signature_comparison,
            send_skipped, signature_written, created_at, updated_at
          FROM history
          WHERE order_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
        [orderId, limit],
      )
    : await queryAll<{
        id: string;
        order_id: number;
        order_name: string;
        attachment_id: number;
        attachment_name: string;
        status: string;
        summary: string | null;
        error_message: string | null;
        extracted_result_id: string | null;
        computed_signature: string | null;
        stored_signature: string | null;
        signature_comparison: SignatureComparisonResult | null;
        send_skipped: number | boolean;
        signature_written: number | boolean;
        created_at: string;
        updated_at: string;
      }>(
        `
          SELECT
            id, order_id, order_name, attachment_id, attachment_name, status, summary, error_message,
            extracted_result_id, computed_signature, stored_signature, signature_comparison,
            send_skipped, signature_written, created_at, updated_at
          FROM history
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
        [limit],
      );

  return rows.map(mapHistoryRow);
}

function mapExtractedResult(row: {
  id: string;
  history_id: string;
  order_id: number;
  order_name: string;
  attachment_id: number;
  attachment_name: string;
  result_json: string;
  raw_text: string;
  pdf_signature: string | null;
  created_at: string;
}): ExtractedResultEntry {
  return {
    id: row.id,
    historyId: row.history_id,
    orderId: Number(row.order_id),
    orderName: row.order_name,
    attachmentId: Number(row.attachment_id),
    attachmentName: row.attachment_name,
    resultJson: safeJsonParse(row.result_json, {
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

export async function insertExtractedResult(entry: {
  historyId: string;
  orderId: number;
  orderName: string;
  attachmentId: number;
  attachmentName: string;
  resultJson: unknown;
  rawText: string;
  pdfSignature?: string | null;
}) {
  const id = uuidv4();
  await execute(
    `
      INSERT INTO extracted_results (
        id, history_id, order_id, order_name, attachment_id, attachment_name, result_json, raw_text, pdf_signature
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id,
      entry.historyId,
      entry.orderId,
      entry.orderName,
      entry.attachmentId,
      entry.attachmentName,
      JSON.stringify(entry.resultJson),
      entry.rawText,
      entry.pdfSignature || null,
    ],
  );
  await updateHistory(entry.historyId, { extractedResultId: id });
  return getExtractedResultByHistoryId(entry.historyId);
}

export async function getExtractedResultByHistoryId(historyId: string): Promise<ExtractedResultEntry | null> {
  const row = await queryOne<{
    id: string;
    history_id: string;
    order_id: number;
    order_name: string;
    attachment_id: number;
    attachment_name: string;
    result_json: string;
    raw_text: string;
    pdf_signature: string | null;
    created_at: string;
  }>(
    `
      SELECT
        id, history_id, order_id, order_name, attachment_id, attachment_name,
        result_json, raw_text, pdf_signature, created_at
      FROM extracted_results
      WHERE history_id = ?
    `,
    [historyId],
  );

  return row ? mapExtractedResult(row) : null;
}

export async function getLatestExtractedResultByOrderId(orderId: number): Promise<ExtractedResultEntry | null> {
  const row = await queryOne<{
    id: string;
    history_id: string;
    order_id: number;
    order_name: string;
    attachment_id: number;
    attachment_name: string;
    result_json: string;
    raw_text: string;
    pdf_signature: string | null;
    created_at: string;
  }>(
    `
      SELECT
        er.id, er.history_id, er.order_id, er.order_name, er.attachment_id, er.attachment_name,
        er.result_json, er.raw_text, er.pdf_signature, er.created_at
      FROM extracted_results er
      INNER JOIN history h ON h.id = er.history_id
      WHERE er.order_id = ?
      ORDER BY h.updated_at DESC, h.id DESC
      LIMIT 1
    `,
    [orderId],
  );

  return row ? mapExtractedResult(row) : null;
}

export async function getProcessedStockVariantIds(orderId: number, extractionSignature: string): Promise<number[]> {
  const rows = await queryAll<{ variant_id: number }>(
    `
      SELECT spi.variant_id
      FROM stock_processed_items spi
      LEFT JOIN stock_reversed_items sri ON sri.processed_item_id = spi.id
      WHERE spi.order_id = ? AND spi.extraction_signature = ? AND sri.processed_item_id IS NULL
    `,
    [orderId, extractionSignature],
  );
  return rows.map((row) => Number(row.variant_id));
}

export async function getUnreversedProcessedStockItemsForOrder(orderId: number): Promise<ProcessedStockItemEntry[]> {
  const rows = await queryAll<{
    id: string;
    order_id: number;
    extraction_signature: string;
    variant_id: number;
    normalized_color: string;
    quantity_added_meters: number;
    history_id: string | null;
    created_at: string;
  }>(
    `
      SELECT
        spi.id, spi.order_id, spi.extraction_signature, spi.variant_id,
        spi.normalized_color, spi.quantity_added_meters, spi.history_id, spi.created_at
      FROM stock_processed_items spi
      LEFT JOIN stock_reversed_items sri ON sri.processed_item_id = spi.id
      WHERE spi.order_id = ? AND sri.processed_item_id IS NULL
      ORDER BY spi.created_at DESC, spi.id DESC
    `,
    [orderId],
  );

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

export async function insertProcessedStockItem(entry: Omit<ProcessedStockItemEntry, 'id' | 'createdAt'>) {
  const id = uuidv4();
  const dialect = getDatabaseDialect();
  const sql =
    dialect === 'mysql'
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

  await execute(sql, [
    id,
    entry.orderId,
    entry.extractionSignature,
    entry.variantId,
    entry.normalizedColor,
    entry.quantityAddedMeters,
    entry.historyId || null,
  ]);
}

export async function markProcessedStockItemReversed(processedItemId: string, orderId: number) {
  const dialect = getDatabaseDialect();
  const sql =
    dialect === 'mysql'
      ? `
          INSERT IGNORE INTO stock_reversed_items (processed_item_id, order_id)
          VALUES (?, ?)
        `
      : `
          INSERT OR IGNORE INTO stock_reversed_items (processed_item_id, order_id)
          VALUES (?, ?)
        `;

  await execute(sql, [processedItemId, orderId]);
}

export async function hasPoBillUnreadableNotification(attachmentId: number) {
  const rows = await queryAll<{ attachment_id: number }>(
    `
      SELECT attachment_id
      FROM po_bill_unreadable_notifications
      WHERE attachment_id = ?
      LIMIT 1
    `,
    [attachmentId],
  );
  return rows.length > 0;
}

export async function recordPoBillUnreadableNotification(
  attachmentId: number,
  attachmentName: string,
) {
  const sql = getDatabaseDialect() === 'mysql'
    ? `
        INSERT INTO po_bill_unreadable_notifications (attachment_id, attachment_name)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE
          attachment_name = VALUES(attachment_name)
      `
    : `
        INSERT INTO po_bill_unreadable_notifications (attachment_id, attachment_name)
        VALUES (?, ?)
        ON CONFLICT(attachment_id) DO UPDATE SET
          attachment_name = excluded.attachment_name
      `;
  await execute(sql, [attachmentId, attachmentName || '']);
}

export async function hasAiCredentialFailureNotification(
  attachmentId: number,
  failureSignature: string,
) {
  const rows = await queryAll<{ attachment_id: number }>(
    `
      SELECT attachment_id
      FROM ai_credential_failure_notifications
      WHERE attachment_id = ? AND failure_signature = ?
      LIMIT 1
    `,
    [attachmentId, failureSignature],
  );
  return rows.length > 0;
}

export async function recordAiCredentialFailureNotification(input: {
  attachmentId: number;
  failureSignature: string;
  provider: string;
  model: string;
}) {
  const sql = getDatabaseDialect() === 'mysql'
    ? `
        INSERT INTO ai_credential_failure_notifications (
          attachment_id, failure_signature, provider, model
        ) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          provider = VALUES(provider),
          model = VALUES(model)
      `
    : `
        INSERT INTO ai_credential_failure_notifications (
          attachment_id, failure_signature, provider, model
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(attachment_id, failure_signature) DO UPDATE SET
          provider = excluded.provider,
          model = excluded.model
      `;
  await execute(sql, [
    input.attachmentId,
    input.failureSignature,
    input.provider || '',
    input.model || '',
  ]);
}

function mapPoBillProcessedDocument(row: {
  attachment_id: number;
  attachment_name: string;
  document_id: number | null;
  folder_name: string | null;
  company_name: string | null;
  purchase_order_id: number | null;
  purchase_order_name: string | null;
  vendor_bill_id: number | null;
  vendor_bill_name: string | null;
  invoice_fingerprint: string | null;
  invoice_number: string | null;
  invoice_vendor: string | null;
  invoice_total: number | null;
  status: PoBillProcessedDocumentEntry['status'];
  mode: string | null;
  summary: string | null;
  processed_at: string | null;
  updated_at: string | null;
  attempt_count: number | null;
  last_skipped_at: string | null;
}): PoBillProcessedDocumentEntry {
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

export async function getPoBillProcessedDocumentsByAttachmentIds(
  attachmentIds: number[],
): Promise<Record<number, PoBillProcessedDocumentEntry>> {
  const ids = [...new Set(attachmentIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) {
    return {};
  }

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await queryAll<Parameters<typeof mapPoBillProcessedDocument>[0]>(
    `
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
    `,
    ids,
  );

  return rows.reduce<Record<number, PoBillProcessedDocumentEntry>>((acc, row) => {
    const entry = mapPoBillProcessedDocument(row);
    acc[entry.attachmentId] = entry;
    return acc;
  }, {});
}

export async function getPoBillProcessedDocumentsByInvoiceFingerprint(
  invoiceFingerprint: string | null | undefined,
): Promise<PoBillProcessedDocumentEntry[]> {
  const fingerprint = String(invoiceFingerprint || '').trim();
  if (!fingerprint) {
    return [];
  }

  const rows = await queryAll<Parameters<typeof mapPoBillProcessedDocument>[0]>(
    `
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
    `,
    [fingerprint],
  );

  return rows.map(mapPoBillProcessedDocument);
}

export async function getLatestPoBillProcessedDocumentsByPurchaseOrderIds(
  purchaseOrderIds: number[],
): Promise<Record<number, PoBillProcessedDocumentEntry>> {
  const ids = [...new Set(purchaseOrderIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) {
    return {};
  }

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await queryAll<Parameters<typeof mapPoBillProcessedDocument>[0]>(
    `
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
    `,
    ids,
  );

  return rows.reduce<Record<number, PoBillProcessedDocumentEntry>>((acc, row) => {
    const entry = mapPoBillProcessedDocument(row);
    if (entry.purchaseOrderId && !acc[entry.purchaseOrderId]) {
      acc[entry.purchaseOrderId] = entry;
    }
    return acc;
  }, {});
}

export async function upsertPoBillProcessedDocument(entry: PoBillProcessedDocumentEntry) {
  const dialect = getDatabaseDialect();
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
    await execute(
      `
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
      `,
      values,
    );
    return;
  }

  await execute(
    `
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
    `,
    values,
  );
}

export async function acquirePoBillProcessingLock(attachmentId: number): Promise<boolean> {
  const safeAttachmentId = Number(attachmentId);
  if (!Number.isSafeInteger(safeAttachmentId) || safeAttachmentId <= 0) {
    return false;
  }

  if (getDatabaseDialect() === 'mysql') {
    await execute(
      `
        DELETE FROM po_bill_processing_locks
        WHERE acquired_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
      `,
    );
  } else {
    await execute(
      `
        DELETE FROM po_bill_processing_locks
        WHERE datetime(acquired_at) < datetime('now', '-2 hours')
      `,
    );
  }

  const sql =
    getDatabaseDialect() === 'mysql'
      ? `
          INSERT IGNORE INTO po_bill_processing_locks (attachment_id)
          VALUES (?)
        `
      : `
          INSERT OR IGNORE INTO po_bill_processing_locks (attachment_id)
          VALUES (?)
        `;
  const result = await execute(sql, [safeAttachmentId]);
  return result.affectedRows > 0;
}

export async function releasePoBillProcessingLock(attachmentId: number) {
  await execute(
    `
      DELETE FROM po_bill_processing_locks
      WHERE attachment_id = ?
    `,
    [attachmentId],
  );
}

export async function acquireStockProcessingLock(orderId: number, extractionSignature: string): Promise<boolean> {
  if (getDatabaseDialect() === 'mysql') {
    await execute(
      `
        DELETE FROM stock_processing_locks
        WHERE acquired_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 HOUR)
      `,
    );
  } else {
    await execute(
      `
        DELETE FROM stock_processing_locks
        WHERE datetime(acquired_at) < datetime('now', '-2 hours')
      `,
    );
  }

  const lockKey = `${orderId}:${extractionSignature}`;
  const sql =
    getDatabaseDialect() === 'mysql'
      ? `
          INSERT IGNORE INTO stock_processing_locks (lock_key, order_id, extraction_signature)
          VALUES (?, ?, ?)
        `
      : `
          INSERT OR IGNORE INTO stock_processing_locks (lock_key, order_id, extraction_signature)
          VALUES (?, ?, ?)
        `;
  const result = await execute(sql, [lockKey, orderId, extractionSignature]);
  return result.affectedRows > 0;
}

export async function releaseStockProcessingLock(orderId: number, extractionSignature: string) {
  await execute(
    `
      DELETE FROM stock_processing_locks
      WHERE lock_key = ?
    `,
    [`${orderId}:${extractionSignature}`],
  );
}

export async function isStockProcessingLocked(orderId: number, extractionSignature: string): Promise<boolean> {
  const row = await queryOne<{ lock_key: string }>(
    `
      SELECT lock_key
      FROM stock_processing_locks
      WHERE lock_key = ?
    `,
    [`${orderId}:${extractionSignature}`],
  );
  return Boolean(row);
}

export async function insertAuthLoginChallenge(entry: {
  email: string;
  codeHash: string;
  redirectPath: string;
  expiresAt: string;
  attemptsRemaining: number;
  requestedIp?: string;
}) {
  const id = uuidv4();
  await execute(
    `
      INSERT INTO auth_login_challenges (
        id, email, code_hash, redirect_path, expires_at, attempts_remaining, requested_ip
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [id, entry.email, entry.codeHash, entry.redirectPath, entry.expiresAt, entry.attemptsRemaining, entry.requestedIp || null],
  );
  return id;
}

export async function getLatestActiveAuthLoginChallenge(email: string): Promise<AuthLoginChallengeEntry | null> {
  const otpTtlMinutes = Math.max(1, Number(env.AUTH_OTP_TTL_MINUTES || 10));
  const sql =
    getDatabaseDialect() === 'mysql'
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
  const row = await queryOne<{
    id: string;
    email: string;
    code_hash: string;
    redirect_path: string;
    expires_at: string;
    attempts_remaining: number;
    consumed_at: string | null;
    requested_ip: string | null;
    created_at: string;
  }>(sql, [email, otpTtlMinutes]);

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

export async function updateAuthLoginChallenge(id: string, patch: { attemptsRemaining?: number; consumed?: boolean }) {
  const current = await queryOne<{ attempts_remaining: number; consumed_at: string | null }>(
    `
      SELECT attempts_remaining, consumed_at
      FROM auth_login_challenges
      WHERE id = ?
    `,
    [id],
  );

  if (!current) {
    return;
  }

  await execute(
    `
      UPDATE auth_login_challenges
      SET
        attempts_remaining = ?,
        consumed_at = CASE
          WHEN ? = 1 THEN COALESCE(consumed_at, CURRENT_TIMESTAMP)
          ELSE consumed_at
        END
      WHERE id = ?
    `,
    [patch.attemptsRemaining ?? Number(current.attempts_remaining), patch.consumed ? 1 : 0, id],
  );
}

export async function consumeAllAuthChallengesForEmail(email: string) {
  await execute(
    `
      UPDATE auth_login_challenges
      SET consumed_at = COALESCE(consumed_at, CURRENT_TIMESTAMP)
      WHERE email = ? AND consumed_at IS NULL
    `,
    [email],
  );
}

export async function insertAuthSession(entry: {
  email: string;
  role?: AuthRole;
  apps?: AppFeature[];
  csrfToken: string;
  userAgentHash: string;
  ipAddress?: string;
  expiresAt: string;
}) {
  const id = uuidv4();
  await execute(
    `
      INSERT INTO auth_sessions (
        id, email, role, apps, csrf_token, user_agent_hash, ip_address, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [id, entry.email, entry.role || 'user', entry.apps ? JSON.stringify(entry.apps) : null, entry.csrfToken, entry.userAgentHash, entry.ipAddress || null, entry.expiresAt],
  );
  return id;
}

export async function getAuthSession(id: string): Promise<AuthSessionEntry | null> {
  const row = await queryOne<{
    id: string;
    email: string;
    role: AuthRole;
    apps: string | null;
    csrf_token: string;
    user_agent_hash: string;
    ip_address: string | null;
    expires_at: string;
    revoked_at: string | null;
    created_at: string;
    last_seen_at: string;
  }>(
    `
      SELECT
        id, email, role, apps, csrf_token, user_agent_hash, ip_address, expires_at, revoked_at, created_at, last_seen_at
      FROM auth_sessions
      WHERE id = ?
    `,
    [id],
  );

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

export async function touchAuthSession(id: string, expiresAt: string) {
  await execute(
    `
      UPDATE auth_sessions
      SET
        expires_at = ?,
        last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revoked_at IS NULL
    `,
    [expiresAt, id],
  );
}

export async function revokeAuthSession(id: string) {
  await execute(
    `
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `,
    [id],
  );
}

export async function revokeExpiredAuthSessions() {
  const sql =
    getDatabaseDialect() === 'mysql'
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
  await execute(sql);
}

export async function insertAuthAttempt(entry: {
  scope: string;
  email?: string | null;
  ipAddress?: string | null;
  success: boolean;
}) {
  await execute(
    `
      INSERT INTO auth_attempts (id, scope, email, ip_address, success)
      VALUES (?, ?, ?, ?, ?)
    `,
    [uuidv4(), entry.scope, entry.email || null, entry.ipAddress || null, entry.success ? 1 : 0],
  );
}

export async function countRecentAuthAttempts(
  scope: string,
  windowMinutes: number,
  filters: { email?: string; ipAddress?: string; success?: boolean } = {},
) {
  const conditions = ['scope = ?'];
  const parameters: Array<string | number> = [scope];

  if (getDatabaseDialect() === 'mysql') {
    conditions.push('created_at >= ?');
    parameters.push(nowMinusMinutesIso(windowMinutes));
  } else {
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

  const row = await queryOne<{ attempt_count: number }>(
    `
      SELECT COUNT(*) as attempt_count
      FROM auth_attempts
      WHERE ${conditions.join(' AND ')}
    `,
    parameters,
  );
  return Number(row?.attempt_count || 0);
}

function mapAuthLoginEvent(row: {
  id: string;
  email: string | null;
  role: AuthRole | null;
  event_type: AuthLoginEventEntry['eventType'];
  auth_method: string | null;
  success: number | boolean;
  ip_address: string | null;
  location_label: string | null;
  location_source: string | null;
  user_agent: string | null;
  detail: string | null;
  created_at: string;
}): AuthLoginEventEntry {
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

export async function insertAuthLoginEvent(entry: {
  email?: string | null;
  role?: AuthRole | null;
  eventType: AuthLoginEventEntry['eventType'];
  authMethod?: string | null;
  success: boolean;
  ipAddress?: string | null;
  locationLabel?: string | null;
  locationSource?: string | null;
  userAgent?: string | null;
  detail?: string | null;
}) {
  await execute(
    `
      INSERT INTO auth_login_events (
        id, email, role, event_type, auth_method, success, ip_address,
        location_label, location_source, user_agent, detail
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      uuidv4(),
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
    ],
  );
}

export async function getRecentAuthLoginEvents(limit = 50): Promise<AuthLoginEventEntry[]> {
  const rows = await queryAll<Parameters<typeof mapAuthLoginEvent>[0]>(
    `
      SELECT
        id, email, role, event_type, auth_method, success, ip_address,
        location_label, location_source, user_agent, detail, created_at
      FROM auth_login_events
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [limit],
  );

  return rows.map(mapAuthLoginEvent);
}

export async function getAuthUserLastSeenByEmail(): Promise<Record<string, string>> {
  const rows = await queryAll<{ email: string; last_seen_at: string }>(
    `
      SELECT email, MAX(last_seen_at) AS last_seen_at
      FROM auth_sessions
      GROUP BY email
    `,
  );

  return Object.fromEntries(rows.map((row) => [String(row.email || '').toLowerCase(), row.last_seen_at]));
}

function mapLegacyRoleToApps(role: string | undefined): AppFeature[] {
  if (!role || role === 'admin' || role === 'user') return [];
  if (role === 'finance') return ['mpesa', 'po-automation', 'purchase-orders', 'invoice-parser', 'extractions'];
  if (role === 'operations') return ['sales-orders', 'purchase-orders', 'extractions', 'jobs'];
  if (role === 'operator') return ['shop-floor'];
  if (role === 'viewer') return [];
  return [];
}

export async function upsertApprovedAuthUser(
  email: string,
  role: AuthRole = 'user',
  apps?: AppFeature[],
  active = true,
  passwordHash?: string | null,
) {
  const dialect = getDatabaseDialect();
  const appsJson = apps ? JSON.stringify(apps) : null;
  if (dialect === 'mysql') {
    await execute(
      `
        INSERT INTO auth_approved_users (email, role, apps, active, password_hash)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          role = VALUES(role),
          apps = VALUES(apps),
          active = VALUES(active),
          password_hash = COALESCE(VALUES(password_hash), password_hash),
          updated_at = CURRENT_TIMESTAMP
      `,
      [email.toLowerCase(), role, appsJson, active ? 1 : 0, passwordHash || null],
    );
  } else {
    await execute(
      `
        INSERT INTO auth_approved_users (email, role, apps, active, password_hash)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET
          role = excluded.role,
          apps = excluded.apps,
          active = excluded.active,
          password_hash = COALESCE(excluded.password_hash, auth_approved_users.password_hash),
          updated_at = CURRENT_TIMESTAMP
      `,
      [email.toLowerCase(), role, appsJson, active ? 1 : 0, passwordHash || null],
    );
  }
}

export async function getApprovedAuthUserByEmail(email: string): Promise<AuthApprovedUser | null> {
  const row = await queryOne<{
    email: string;
    role: AuthRole;
    apps: string | null;
    active: number | boolean;
    password_hash: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT email, role, apps, active, password_hash, created_at, updated_at
      FROM auth_approved_users
      WHERE email = ?
    `,
    [email.toLowerCase()],
  );

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

export async function getApprovedAuthUsers(): Promise<AuthApprovedUser[]> {
  const rows = await queryAll<{
    email: string;
    role: AuthRole;
    apps: string | null;
    active: number | boolean;
    password_hash: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT email, role, apps, active, password_hash, created_at, updated_at
      FROM auth_approved_users
      ORDER BY active DESC, email ASC
    `,
  );

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

export async function countApprovedAuthUsers(): Promise<number> {
  const row = await queryOne<{ total_count: number }>(
    `
      SELECT COUNT(*) AS total_count
      FROM auth_approved_users
    `,
  );
  return Number(row?.total_count || 0);
}

export async function getAppUserProfile(email: string): Promise<{ email: string; displayName: string; odooEmployeeId: number | null; syncedAt: string } | null> {
  const row = await queryOne<{ email: string; display_name: string; odoo_employee_id: number | null; synced_at: string }>(
    'SELECT email, display_name, odoo_employee_id, synced_at FROM app_user_profiles WHERE email = ?',
    [email.trim().toLowerCase()],
  );
  return row ? { email: row.email, displayName: row.display_name, odooEmployeeId: row.odoo_employee_id, syncedAt: row.synced_at } : null;
}

export async function saveAppUserProfile(input: { email: string; displayName: string; odooEmployeeId?: number | null }) {
  const params = [input.email.trim().toLowerCase(), input.displayName.trim(), input.odooEmployeeId || null];
  if (getDatabaseDialect() === 'mysql') {
    await execute(`INSERT INTO app_user_profiles (email, display_name, odoo_employee_id, synced_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), odoo_employee_id = VALUES(odoo_employee_id), synced_at = CURRENT_TIMESTAMP`, params);
  } else {
    await execute(`INSERT INTO app_user_profiles (email, display_name, odoo_employee_id, synced_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, odoo_employee_id = excluded.odoo_employee_id, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`, params);
  }
}

export interface StockProductMirrorEntry {
  productId: number;
  productName: string;
  availableQty: number;
  freeQty: number;
  forecastQty: number;
  incomingQty: number;
  outgoingQty: number;
  warehouseId: number | null;
  syncedAt: string | null;
  syncStatus: string;
  syncError: string | null;
}

export async function getStockProductMirror(): Promise<StockProductMirrorEntry[]> {
  const rows = await queryAll<any>(`SELECT product_id, product_name, available_qty, free_qty, forecast_qty,
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

export async function upsertStockProductMirror(entries: Array<Omit<StockProductMirrorEntry, 'syncStatus' | 'syncError'> & { syncStatus?: string; syncError?: string | null }>) {
  for (const entry of entries) {
    const params = [entry.productId, entry.productName, entry.availableQty, entry.freeQty, entry.forecastQty,
      entry.incomingQty, entry.outgoingQty, entry.warehouseId, entry.syncedAt, entry.syncStatus || 'current', entry.syncError || null];
    if (getDatabaseDialect() === 'mysql') {
      await execute(`INSERT INTO stock_product_mirror (product_id, product_name, available_qty, free_qty, forecast_qty, incoming_qty, outgoing_qty, warehouse_id, synced_at, sync_status, sync_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE product_name=VALUES(product_name), available_qty=VALUES(available_qty), free_qty=VALUES(free_qty), forecast_qty=VALUES(forecast_qty), incoming_qty=VALUES(incoming_qty), outgoing_qty=VALUES(outgoing_qty), warehouse_id=VALUES(warehouse_id), synced_at=VALUES(synced_at), sync_status=VALUES(sync_status), sync_error=VALUES(sync_error)`, params);
    } else {
      await execute(`INSERT INTO stock_product_mirror (product_id, product_name, available_qty, free_qty, forecast_qty, incoming_qty, outgoing_qty, warehouse_id, synced_at, sync_status, sync_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET product_name=excluded.product_name, available_qty=excluded.available_qty, free_qty=excluded.free_qty, forecast_qty=excluded.forecast_qty, incoming_qty=excluded.incoming_qty, outgoing_qty=excluded.outgoing_qty, warehouse_id=excluded.warehouse_id, synced_at=excluded.synced_at, sync_status=excluded.sync_status, sync_error=excluded.sync_error, updated_at=CURRENT_TIMESTAMP`, params);
    }
  }
}

export async function removeStockProductsNotIn(productIds: number[]) {
  if (!productIds.length) {
    await execute(`DELETE FROM stock_product_mirror`);
    return;
  }
  const placeholders = productIds.map(() => '?').join(', ');
  await execute(`DELETE FROM stock_product_mirror WHERE product_id NOT IN (${placeholders})`, productIds);
}

export async function updateStockProductMirrorQuantity(productId: number, availableQty: number, productName?: string) {
  await execute(`UPDATE stock_product_mirror SET available_qty = ?, free_qty = ?, product_name = COALESCE(?, product_name), sync_status = 'current', sync_error = NULL, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE product_id = ?`,
    [availableQty, availableQty, productName || null, productId]);
}

export async function markStockProductMirrorSyncFailed(message: string) {
  await execute(`UPDATE stock_product_mirror SET sync_status = 'failed', sync_error = ?, updated_at = CURRENT_TIMESTAMP`, [message.slice(0, 1000)]);
}

export interface StaffOnboardingApplicationEntry {
  id: string;
  fullName: string;
  personalEmail: string;
  mobilePhone: string;
  payload: Record<string, string>;
  odooApplicantId: number | null;
  odooEmployeeId: number | null;
  status: 'syncing' | 'pending' | 'sync_failed' | 'approving' | 'approved' | 'approval_failed';
  errorMessage: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

function mapStaffOnboardingApplication(row: any): StaffOnboardingApplicationEntry {
  return {
    id: String(row.id), fullName: String(row.full_name), personalEmail: String(row.personal_email),
    mobilePhone: String(row.mobile_phone), payload: safeJsonParse(row.payload_json, {}),
    odooApplicantId: row.odoo_applicant_id == null ? null : Number(row.odoo_applicant_id),
    odooEmployeeId: row.odoo_employee_id == null ? null : Number(row.odoo_employee_id),
    status: row.status, errorMessage: row.error_message ? String(row.error_message) : null,
    submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : String(row.submitted_at),
    reviewedAt: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : row.reviewed_at ? String(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
  };
}

export async function createStaffOnboardingApplication(input: { id: string; payload: Record<string, string> }) {
  await execute(`INSERT INTO staff_onboarding_applications (id, full_name, personal_email, mobile_phone, payload_json, status)
    VALUES (?, ?, ?, ?, ?, 'syncing')`, [input.id, input.payload.fullName, input.payload.personalEmail, input.payload.mobilePhone, JSON.stringify(input.payload)]);
}

export async function updateStaffOnboardingSync(id: string, odooApplicantId: number | null, errorMessage?: string | null) {
  const normalizedApplicantId = Number(odooApplicantId);
  const validApplicantId = Number.isSafeInteger(normalizedApplicantId) && normalizedApplicantId > 0 ? normalizedApplicantId : null;
  await execute(`UPDATE staff_onboarding_applications SET odoo_applicant_id = ?, status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [validApplicantId, validApplicantId ? 'pending' : 'sync_failed', errorMessage || null, id]);
}

export async function importStaffOnboardingApplication(input: { id: string; payload: Record<string, string>; odooApplicantId: number }) {
  const params = [input.id, input.payload.fullName, input.payload.personalEmail, input.payload.mobilePhone, JSON.stringify(input.payload), input.odooApplicantId];
  if (getDatabaseDialect() === 'mysql') {
    await execute(`INSERT INTO staff_onboarding_applications (id, full_name, personal_email, mobile_phone, payload_json, odoo_applicant_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending') ON DUPLICATE KEY UPDATE full_name=VALUES(full_name), personal_email=VALUES(personal_email), mobile_phone=VALUES(mobile_phone), payload_json=VALUES(payload_json), updated_at=CURRENT_TIMESTAMP`, params);
  } else {
    await execute(`INSERT INTO staff_onboarding_applications (id, full_name, personal_email, mobile_phone, payload_json, odoo_applicant_id, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending') ON CONFLICT(odoo_applicant_id) DO UPDATE SET full_name=excluded.full_name, personal_email=excluded.personal_email, mobile_phone=excluded.mobile_phone, payload_json=excluded.payload_json, updated_at=CURRENT_TIMESTAMP`, params);
  }
}

export async function getStaffOnboardingApplications() {
  const rows = await queryAll<any>(`SELECT * FROM staff_onboarding_applications
    ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approval_failed' THEN 1 WHEN 'sync_failed' THEN 2 WHEN 'approving' THEN 3 ELSE 4 END, submitted_at DESC`);
  return rows.map(mapStaffOnboardingApplication);
}

export async function getStaffOnboardingApplication(id: string) {
  const row = await queryOne<any>('SELECT * FROM staff_onboarding_applications WHERE id = ?', [id]);
  return row ? mapStaffOnboardingApplication(row) : null;
}

export async function beginStaffOnboardingApproval(id: string) {
  const result = await execute(`UPDATE staff_onboarding_applications SET status = 'approving', error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('pending', 'approval_failed')`, [id]);
  return result.affectedRows > 0;
}

export async function finishStaffOnboardingApproval(id: string, input: { employeeId?: number; reviewedBy: string; errorMessage?: string }) {
  await execute(`UPDATE staff_onboarding_applications SET status = ?, odoo_employee_id = COALESCE(?, odoo_employee_id), error_message = ?, reviewed_at = ?, reviewed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [input.employeeId ? 'approved' : 'approval_failed', input.employeeId || null, input.errorMessage || null, appDateTime(), input.reviewedBy, id]);
}

export async function createBoardIntakeQueueEntry(input: {
  id: string; productId: number; productName: string; partnerId: number; customerName: string;
  quantity: number; actorName: string; actorEmail?: string;
}) {
  await execute(`INSERT INTO board_intake_queue (id, product_id, product_name, partner_id, customer_name, quantity, actor_name, actor_email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, [input.id, input.productId, input.productName, input.partnerId, input.customerName, input.quantity, input.actorName, input.actorEmail || null]);
}

export async function updateBoardIntakeQueueEntry(id: string, input: { status: 'processing' | 'synced' | 'failed'; stockQuantity?: number; errorMessage?: string }) {
  const retryDelayMinutes = input.status === 'failed' ? 2 : 0;
  await execute(`UPDATE board_intake_queue SET status = ?, odoo_stock_quantity = COALESCE(?, odoo_stock_quantity), error_message = ?,
    synced_at = CASE WHEN ? = 'synced' THEN CURRENT_TIMESTAMP ELSE synced_at END,
    next_retry_at = CASE WHEN ? = 'failed' THEN ${getDatabaseDialect() === 'mysql' ? 'DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? MINUTE)' : "datetime(CURRENT_TIMESTAMP, '+' || ? || ' minutes')"} ELSE NULL END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [input.status, input.stockQuantity ?? null, input.errorMessage || null, input.status, input.status, retryDelayMinutes, id]);
}

export async function getRecentBoardIntakeQueueEntries(limit = 12) {
  return queryAll<any>(`SELECT id, product_name, customer_name, quantity, status, error_message, retry_count, last_attempt_at, next_retry_at, created_at, synced_at
    FROM board_intake_queue ORDER BY created_at DESC LIMIT ?`, [Math.max(1, Math.min(50, limit))]);
}

export interface BoardIntakeQueueEntry {
  [key: string]: unknown;
  id: string;
  product_id: number;
  product_name: string;
  partner_id: number;
  customer_name: string;
  quantity: number;
  actor_name: string;
  actor_email: string | null;
  status: 'pending' | 'processing' | 'synced' | 'failed';
  odoo_stock_quantity: number | null;
  retry_count: number;
  error_message: string | null;
}

export async function getBoardIntakeQueueEntry(id: string) {
  return queryOne<BoardIntakeQueueEntry>('SELECT * FROM board_intake_queue WHERE id = ?', [id]);
}

export async function claimBoardIntakeQueueEntry(id: string) {
  const result = await execute(`UPDATE board_intake_queue
    SET status = 'processing', retry_count = retry_count + 1, last_attempt_at = CURRENT_TIMESTAMP,
        next_retry_at = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status IN ('pending', 'failed')`, [id]);
  return result.affectedRows > 0;
}

export async function getDueBoardIntakeQueueEntries(limit = 5) {
  return queryAll<BoardIntakeQueueEntry>(`SELECT * FROM board_intake_queue
    WHERE (status = 'pending')
       OR (status = 'failed' AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP))
       OR (status = 'processing' AND updated_at < ${getDatabaseDialect() === 'mysql' ? 'DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE)' : "datetime(CURRENT_TIMESTAMP, '-10 minutes')"})
    ORDER BY created_at ASC LIMIT ?`, [Math.max(1, Math.min(20, limit))]);
}

export async function releaseStaleBoardIntakeQueueEntry(id: string) {
  await execute(`UPDATE board_intake_queue SET status = 'failed', next_retry_at = CURRENT_TIMESTAMP,
    error_message = COALESCE(error_message, 'Previous synchronization attempt was interrupted.'), updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'processing'`, [id]);
}

export async function getBoardIntakeLoggingReport(startDate: string, endDate: string, reportingStartDate?: string) {
  const effectiveStartDate = clampShopFloorReportingDate(startDate, reportingStartDate);
  const effectiveEndDate = clampShopFloorReportingDate(endDate, reportingStartDate);
  const rows = await queryAll<{
    actor_name: string | null;
    actor_email: string | null;
    quantity: number;
    status: string;
    created_at: string;
  }>(`SELECT actor_name, actor_email, quantity, status, created_at
      FROM board_intake_queue
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC`, [`${effectiveStartDate} 00:00:00`, `${effectiveEndDate} 23:59:59`]);

  const byOperator = new Map<string, {
    name: string;
    email: string;
    records: number;
    boards: number;
    synced: number;
    failed: number;
    pending: number;
    lastLoggedAt: string;
  }>();
  rows.forEach((row) => {
    const email = String(row.actor_email || '').trim().toLowerCase();
    const name = String(row.actor_name || email || 'Unknown operator').trim();
    const key = email || name.toLowerCase();
    const item = byOperator.get(key) || { name, email, records: 0, boards: 0, synced: 0, failed: 0, pending: 0, lastLoggedAt: row.created_at };
    item.records += 1;
    item.boards += Number(row.quantity || 0);
    if (row.status === 'synced') item.synced += 1;
    else if (row.status === 'failed') item.failed += 1;
    else item.pending += 1;
    item.lastLoggedAt = row.created_at;
    byOperator.set(key, item);
  });
  return [...byOperator.values()].sort((a, b) => b.records - a.records || a.name.localeCompare(b.name));
}

// ─── Shop Floor: Incidents & Assigned Items ──────────────────────────

function ensureShopFloorTables() {
  const dialect = getDatabaseDialect();
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

  execute(createIncidentsTable).catch(() => {});
  execute(createAssignedItemsTable).catch(() => {});

  if (dialect === 'mysql') {
    execute(`ALTER TABLE shop_floor_assigned_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`).catch(() => {});
  } else {
    execute(`ALTER TABLE shop_floor_assigned_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1`).catch(() => {});
  }
}
ensureShopFloorTables();

export interface ShopFloorIncident {
  id: string;
  machineName: string;
  description: string | null;
  reportedBy: string | null;
  reportedAt: string;
  status: 'open' | 'resolved';
  resolvedAt: string | null;
}

export interface ShopFloorAssignedItem {
  id: string;
  employeeEmail: string;
  itemName: string;
  assignedDate: string;
  quantity: number;
  notes: string | null;
}

export async function getShopFloorIncidents(limit = 50): Promise<ShopFloorIncident[]> {
  const rows = await queryAll<{
    id: string; machine_name: string; description: string | null;
    reported_by: string | null; reported_at: string;
    status: string; resolved_at: string | null;
  }>('SELECT * FROM shop_floor_incidents ORDER BY reported_at DESC LIMIT ?', [limit]);

  return rows.map(r => ({
    id: r.id, machineName: r.machine_name, description: r.description,
    reportedBy: r.reported_by, reportedAt: r.reported_at,
    status: (r.status === 'resolved' ? 'resolved' : 'open') as 'open' | 'resolved',
    resolvedAt: r.resolved_at,
  }));
}

export async function createShopFloorIncident(input: {
  machineName: string; description?: string; reportedBy?: string;
}) {
  const id = uuidv4();
  const now = appDateTime();
  await execute(
    `INSERT INTO shop_floor_incidents (id, machine_name, description, reported_by, reported_at, status)
     VALUES (?, ?, ?, ?, ?, 'open')`,
    [id, input.machineName, input.description || null, input.reportedBy || null, now],
  );
  return id;
}

export async function resolveShopFloorIncident(id: string) {
  await execute(
    `UPDATE shop_floor_incidents SET status = 'resolved', resolved_at = ? WHERE id = ?`,
    [appDateTime(), id],
  );
}

export async function getShopFloorAssignedItems(employeeEmail: string | string[]): Promise<ShopFloorAssignedItem[]> {
  const emails = Array.isArray(employeeEmail) ? employeeEmail : [employeeEmail];
  const normalizedEmails = emails.map((email) => String(email || '').trim().toLowerCase()).filter(Boolean);
  if (!normalizedEmails.length) {
    return [];
  }

  const placeholders = normalizedEmails.map(() => '?').join(', ');
  const rows = await queryAll<{
    id: string; employee_email: string; item_name: string;
    assigned_date: string; quantity: number | string | null; notes: string | null;
  }>(`SELECT * FROM shop_floor_assigned_items WHERE LOWER(TRIM(employee_email)) IN (${placeholders}) ORDER BY assigned_date DESC`, normalizedEmails);
  return rows.map(r => ({
    id: r.id, employeeEmail: r.employee_email, itemName: r.item_name,
    assignedDate: r.assigned_date, quantity: Number(r.quantity || 1), notes: r.notes,
  }));
}

export async function assignShopFloorItem(input: {
  employeeEmail: string; itemName: string; assignedDate?: string; quantity?: number; notes?: string;
}) {
  const id = uuidv4();
  const dateStr = input.assignedDate || appDateTime().slice(0, 10);
  const quantity = Number.isFinite(input.quantity as number) && Number(input.quantity) > 0 ? Math.floor(Number(input.quantity)) : 1;
  const email = String(input.employeeEmail || '').trim().toLowerCase();
  await execute(
    `INSERT INTO shop_floor_assigned_items (id, employee_email, item_name, assigned_date, quantity, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, email, input.itemName, dateStr, quantity, input.notes || null],
  );
  return id;
}

const DEFAULT_SHOP_FLOOR_FEATURE_FLAGS: ShopFloorFeatureFlags = {
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

export async function getShopFloorFeatureFlags(): Promise<ShopFloorFeatureFlags> {
  const rows = await queryAll<{ feature_key: string; enabled: number | boolean }>(
    'SELECT feature_key, enabled FROM shop_floor_feature_flags',
  );
  const flags = { ...DEFAULT_SHOP_FLOOR_FEATURE_FLAGS };
  rows.forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(flags, row.feature_key)) {
      flags[row.feature_key as ShopFloorFeatureKey] = Boolean(row.enabled);
    }
  });
  return flags;
}

export async function saveShopFloorFeatureFlags(flags: ShopFloorFeatureFlags): Promise<void> {
  for (const [featureKey, enabled] of Object.entries(flags)) {
    const existing = await queryOne<{ feature_key: string }>(
      'SELECT feature_key FROM shop_floor_feature_flags WHERE feature_key = ?',
      [featureKey],
    );
    if (existing) {
      await execute('UPDATE shop_floor_feature_flags SET enabled = ?, updated_at = ? WHERE feature_key = ?', [enabled ? 1 : 0, appDateTime(), featureKey]);
    } else {
      await execute('INSERT INTO shop_floor_feature_flags (feature_key, enabled, updated_at) VALUES (?, ?, ?)', [featureKey, enabled ? 1 : 0, appDateTime()]);
    }
  }
}
