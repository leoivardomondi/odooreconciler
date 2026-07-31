import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import {
  AppSettings,
  AttachmentInfo,
  AiExtractionConfig,
  FieldMappings,
  MailConfig,
  OdooModelField,
  ParsedJobSummaryResult,
  ParserConfig,
  PoBillSchedulerConfig,
  SchedulerConfig,
  StockConfig,
} from '../models/types';
import { env } from './env';
import { SHOP_FLOOR_REPORTING_START_DATE } from './shopFloorReporting';

dayjs.extend(utc);
dayjs.extend(timezone);

export const DEFAULT_FIELD_MAPPINGS: FieldMappings = {
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

export const DEFAULT_PARSER_CONFIG: ParserConfig = {
  filenameKeyword: 'job summary',
  sectionHeader: 'Edging Materials',
  stopHeadersCsv: '',
  productLinePattern: '^(.*?)(\\d+(?:\\.\\d+)?)\\s*mm$',
  thicknessLabel: 'Thickness',
  lengthLabel: 'Length',
  rollLengthLabel: 'Roll Length',
  postChatterOnSuccess: true,
  chatterTemplate:
    'Job Summary processed from {{attachmentName}} on {{processedAt}}. Extracted {{itemCount}} edging material item(s).',
};

export const DEFAULT_AI_EXTRACTION_CONFIG: AiExtractionConfig = {
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

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  intervalMinutes: 15,
  batchSize: 15,
  confirmedFromDate: '2026-04-08 00:00:00',
  cronToken: '',
  useInProcessInterval: false,
};

export const DEFAULT_PO_BILL_SCHEDULER_CONFIG: PoBillSchedulerConfig = {
  enabled: false,
  intervalMinutes: 15,
  batchSize: 1,
  fromDate: '2026-01-01 00:00:00',
  cronToken: '',
  useInProcessInterval: false,
  maxRetryAttempts: 10,
  transientRetryHours: 2,
  retryBackoffHours: [168, 168, 168, 168, 168, 168, 168, 168, 168, 168],
  stableSkipRetryDays: 14,
};

export const DEFAULT_STOCK_CONFIG: StockConfig = {
  locationId: '',
  locationName: '',
  warehouseId: '',
  pickingTypeId: '',
  missingSoAlertUserLogin: '',
  missingComponentAlertUserLogin: '',
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberedEnv(baseName: string, index: number) {
  return process.env[`${baseName}_${index}`] || '';
}

export function createDefaultMailConfig(): MailConfig {
  const accounts: MailConfig['accounts'] = [];
  const primaryUsername = env.SMTP_USERNAME.trim();

  if (primaryUsername || env.SMTP_PASSWORD || env.SMTP_FROM_EMAIL.trim()) {
    accounts.push({
      label: 'Primary',
      username: primaryUsername,
      password: env.SMTP_PASSWORD,
      fromEmail: env.SMTP_FROM_EMAIL.trim() || primaryUsername,
      fromName: env.SMTP_FROM_NAME.trim() || 'Urban Vibe Access',
      enabled: Boolean(primaryUsername && env.SMTP_PASSWORD),
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
      fromName: numberedEnv('SMTP_FROM_NAME', index).trim() || env.SMTP_FROM_NAME.trim() || 'Urban Vibe Access',
      enabled: Boolean(username && password),
    });
  }

  if (!accounts.length) {
    accounts.push({
      label: 'Primary',
      username: '',
      password: '',
      fromEmail: env.SMTP_FROM_EMAIL.trim(),
      fromName: env.SMTP_FROM_NAME.trim() || 'Urban Vibe Access',
      enabled: false,
    });
  }

  return {
    transport: 'smtp',
    fallbackTransport: 'none',
    host: env.SMTP_HOST.trim(),
    port: positiveInteger(env.SMTP_PORT, 587),
    secure: env.SMTP_SECURE === 'true',
    requireTls: env.SMTP_REQUIRE_TLS === 'true',
    ignoreTls: env.SMTP_IGNORE_TLS === 'true',
    tlsRejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
    connectionTimeoutMs: positiveInteger(env.SMTP_CONNECTION_TIMEOUT_MS, 30000),
    greetingTimeoutMs: positiveInteger(env.SMTP_GREETING_TIMEOUT_MS, 30000),
    socketTimeoutMs: positiveInteger(env.SMTP_SOCKET_TIMEOUT_MS, 45000),
    testRecipient: '',
    accounts,
    automations: [
      { id: 'shop-floor-reminders', name: 'Shop-floor task reminders', systemKey: 'shop-floor-reminders', enabled: true, frequency: 'hourly', interval: 1, dayOfWeek: 1, hour: 8, recipients: '', subject: '', body: '', lastSentAt: '' },
      { id: 'weekly-shop-floor-report', name: 'Weekly shop-floor accountability report', systemKey: 'weekly-shop-floor-report', enabled: true, frequency: 'weekly', interval: 1, dayOfWeek: 3, hour: 8, recipients: '', subject: 'Wednesday Shop Floor Accountability Report', body: '', lastSentAt: '' },
      { id: 'mpesa-review', name: 'M-Pesa review pending', systemKey: 'mpesa-review', enabled: true, frequency: 'daily', interval: 1, dayOfWeek: 1, hour: 9, recipients: 'charles@urbanvibeinteriordesign.co.ke', subject: '', body: '', lastSentAt: '' },
      { id: 'mo-overtime', name: 'Large MO overtime suggestion', systemKey: 'mo-overtime', enabled: true, frequency: 'daily', interval: 1, dayOfWeek: 1, hour: 8, recipients: '', subject: '', body: '', lastSentAt: '' },
    ],
    shopFloorReportingStartDate: SHOP_FLOOR_REPORTING_START_DATE,
  };
}

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function createEmptyFieldMappings(): FieldMappings {
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

export function resolveFieldMappings(
  configured: Partial<FieldMappings> | undefined,
  availableFields: OdooModelField[],
): FieldMappings {
  const availableNames = new Set(availableFields.map((field) => field.name));
  const merged = {
    ...createEmptyFieldMappings(),
    ...(configured || {}),
  };

  return (Object.keys(createEmptyFieldMappings()) as Array<keyof FieldMappings>).reduce(
    (accumulator, key) => {
      const configuredValue = merged[key].trim();

      if (configuredValue) {
        accumulator[key] = availableNames.has(configuredValue) ? configuredValue : '';
        return accumulator;
      }

      const defaultValue = DEFAULT_FIELD_MAPPINGS[key].trim();
      accumulator[key] = availableNames.has(defaultValue) ? defaultValue : '';
      return accumulator;
    },
    createEmptyFieldMappings(),
  );
}

export function getMissingFieldMappingLabels(mappings: FieldMappings): string[] {
  const labels: Record<keyof FieldMappings, string> = {
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

  return (Object.keys(labels) as Array<keyof FieldMappings>)
    .filter((key) => !mappings[key].trim())
    .map((key) => labels[key]);
}

export function resolveSignatureFieldMapping(mappings: FieldMappings): string {
  return mappings.signatureField.trim();
}

export function formatOdooDateTime(value: Date | string): string {
  return dayjs(value).utc().format('YYYY-MM-DD HH:mm:ss');
}

export function sanitizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function getPreferredAppBaseUrl(req: { protocol?: string; get(name: string): string | undefined }): string {
  const configured = sanitizeBaseUrl(env.APP_BASE_URL || '');
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

export function toBoolean(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return String(value).toLowerCase() === 'true';
}

export function hasOdooConfiguration(settings: AppSettings): boolean {
  return Boolean(
    settings.odoo.baseUrl.trim() && settings.odoo.username.trim() && settings.odoo.apiKey.trim(),
  );
}

export function isPdfAttachment(attachment: AttachmentInfo): boolean {
  return (
    attachment.name.toLowerCase().endsWith('.pdf') ||
    String(attachment.mimetype || '').toLowerCase() === 'application/pdf'
  );
}

export function isJobSummaryAttachment(
  attachment: AttachmentInfo,
  keyword: string,
): boolean {
  const normalizedKeyword = keyword.trim().toLowerCase();

  if (!isPdfAttachment(attachment)) {
    return false;
  }

  if (!normalizedKeyword) {
    return true;
  }

  return attachment.name.toLowerCase().includes(normalizedKeyword);
}

export function sortAttachmentsNewestFirst(a: AttachmentInfo, b: AttachmentInfo): number {
  const aDate = new Date(a.write_date || a.create_date || 0).getTime();
  const bDate = new Date(b.write_date || b.create_date || 0).getTime();

  if (aDate !== bDate) {
    return bDate - aDate;
  }

  return b.id - a.id;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const withoutTimezoneSuffix = String(value).replace(/\s+GMT[+-]\d{4}\s+\([^)]+\)$/i, '');
  if (withoutTimezoneSuffix !== value) {
    return withoutTimezoneSuffix;
  }

  const hasTimezoneMarker = /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  const date = hasTimezoneMarker
    ? dayjs(value).tz(env.APP_TIMEZONE)
    : dayjs.utc(value).tz(env.APP_TIMEZONE);
  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : value;
}

export function formatFileSize(value: number | null | undefined): string {
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

export function getRelationLabel(
  value: [number, string] | false | null | undefined,
): string {
  if (!value || !Array.isArray(value)) {
    return '—';
  }

  return value[1];
}

export function sanitizeForLog(input: unknown): Record<string, unknown> {
  const replacer = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(replacer);
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
        (accumulator, [key, nestedValue]) => {
          if (/(api.?key|authorization|token|password|datas|content)/i.test(key)) {
            accumulator[key] = '[REDACTED]';
          } else {
            accumulator[key] = replacer(nestedValue);
          }
          return accumulator;
        },
        {},
      );
    }

    if (typeof value === 'string') {
      return value.replace(/[\u0000-\u001f\u007f]/g, ' ');
    }

    return value;
  };

  const safeValue = replacer(input);

  return safeValue && typeof safeValue === 'object'
    ? (safeValue as Record<string, unknown>)
    : { value: safeValue };
}

export function truncate(value: string, length = 240): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length - 3)}...`;
}

export function renderTemplate(
  template: string,
  data: Record<string, string | number>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    return String(data[key] ?? '');
  });
}

export function buildProcessingLog(
  payload: ParsedJobSummaryResult,
  attachmentName: string,
  historyId: string,
): string {
  const timestamp = dayjs().tz(env.APP_TIMEZONE).format('YYYY-MM-DD HH:mm:ss');
  const lines = [
    `Processed at: ${timestamp}`,
    `Timezone: ${env.APP_TIMEZONE}`,
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

export function normalizeMultilineText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}
