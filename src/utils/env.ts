import dotenv from 'dotenv';
import { envFilePath, resolveProjectFile } from './paths';

dotenv.config({ path: envFilePath });

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  PORT: process.env.PORT || '3000',
  NODE_ENV: nodeEnv,
  APP_NAME: process.env.APP_NAME || 'Urban Vibe Reconcile',
  APP_BASE_URL: process.env.APP_BASE_URL || 'https://app.urbanvibeinteriordesign.co.ke',
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Africa/Nairobi',
  DB_CLIENT: process.env.DB_CLIENT || 'mysql',
  APP_RUNTIME_CONFIG_PATH: resolveProjectFile(
    process.env.APP_RUNTIME_CONFIG_PATH || './storage/runtime-config.json',
    'storage/runtime-config.json',
  ),
  ENABLE_DATABASE_INSTALLER: process.env.ENABLE_DATABASE_INSTALLER || 'false',
  SQLITE_PATH: resolveProjectFile(
    process.env.SQLITE_PATH || './storage/app.db',
    'storage/app.db',
  ),
  MYSQL_HOST: process.env.DB_HOST || process.env.MYSQL_HOST || '',
  MYSQL_PORT: process.env.DB_PORT || process.env.MYSQL_PORT || '3306',
  MYSQL_USER: process.env.DB_USER || process.env.MYSQL_USER || '',
  MYSQL_PASSWORD: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  MYSQL_DATABASE: process.env.DB_NAME || process.env.MYSQL_DATABASE || '',
  MYSQL_CONNECTION_LIMIT: process.env.MYSQL_CONNECTION_LIMIT || '10',
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY || '',
  REQUEST_TIMEOUT_MS: process.env.REQUEST_TIMEOUT_MS || '20000',
  STARTUP_STEP_TIMEOUT_MS: process.env.STARTUP_STEP_TIMEOUT_MS || '30000',
  STARTUP_DB_RETRY_MS: process.env.STARTUP_DB_RETRY_MS || '2000',
  DB_INIT_TIMEOUT_MS: process.env.DB_INIT_TIMEOUT_MS || process.env.STARTUP_STEP_TIMEOUT_MS || '30000',
  SALE_ORDER_READ_TIMEOUT_MS:
    process.env.SALE_ORDER_READ_TIMEOUT_MS || '60000',
  ATTACHMENT_DOWNLOAD_TIMEOUT_MS:
    process.env.ATTACHMENT_DOWNLOAD_TIMEOUT_MS || '60000',
  TRUST_PROXY: process.env.TRUST_PROXY || 'false',
  APP_SESSION_SECRET:
    process.env.APP_SESSION_SECRET || process.env.APP_ENCRYPTION_KEY || '',
  AUTH_ALLOWED_DOMAINS:
    process.env.AUTH_ALLOWED_DOMAINS || 'urbanvibeinteriordesign.co.ke,flowcode.co.ke',
  AUTH_OTP_TTL_MINUTES: process.env.AUTH_OTP_TTL_MINUTES || '10',
  AUTH_SESSION_TTL_HOURS: process.env.AUTH_SESSION_TTL_HOURS || '12',
  AUTH_REQUEST_LIMIT_WINDOW_MINUTES:
    process.env.AUTH_REQUEST_LIMIT_WINDOW_MINUTES || '15',
  AUTH_REQUEST_LIMIT_MAX: process.env.AUTH_REQUEST_LIMIT_MAX || '5',
  AUTH_VERIFY_LIMIT_WINDOW_MINUTES:
    process.env.AUTH_VERIFY_LIMIT_WINDOW_MINUTES || '15',
  AUTH_VERIFY_LIMIT_MAX: process.env.AUTH_VERIFY_LIMIT_MAX || '10',
  AUTH_LOCAL_ADMIN_EMAIL: process.env.AUTH_LOCAL_ADMIN_EMAIL || '',
  AUTH_LOCAL_ADMIN_PASSWORD: process.env.AUTH_LOCAL_ADMIN_PASSWORD || '',
  DBADMIN_EMAIL: process.env.DBADMIN_EMAIL || 'dbadmin@urbanvibeinteriordesign.co.ke',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: process.env.SMTP_PORT || '587',
  SMTP_SECURE: process.env.SMTP_SECURE || 'false',
  SMTP_REQUIRE_TLS: process.env.SMTP_REQUIRE_TLS || 'false',
  SMTP_IGNORE_TLS: process.env.SMTP_IGNORE_TLS || 'false',
  SMTP_TLS_REJECT_UNAUTHORIZED: process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true',
  SMTP_TRANSPORT: process.env.SMTP_TRANSPORT || 'smtp',
  SMTP_FALLBACK_TRANSPORT: process.env.SMTP_FALLBACK_TRANSPORT || 'sendmail',
  SMTP_CONNECTION_TIMEOUT_MS: process.env.SMTP_CONNECTION_TIMEOUT_MS || '30000',
  SMTP_GREETING_TIMEOUT_MS: process.env.SMTP_GREETING_TIMEOUT_MS || '30000',
  SMTP_SOCKET_TIMEOUT_MS: process.env.SMTP_SOCKET_TIMEOUT_MS || '45000',
  SENDMAIL_PATH: process.env.SENDMAIL_PATH || '/usr/sbin/sendmail',
  SMTP_USERNAME: process.env.SMTP_USERNAME || '',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || '',
  SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL || '',
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || 'Urban Vibe Access',
  SCHEDULER_USE_INTERVAL: process.env.SCHEDULER_USE_INTERVAL || 'false',
  SCHEDULER_LOCK_STALE_MINUTES: process.env.SCHEDULER_LOCK_STALE_MINUTES || '45',
  SCHEDULER_CRON_TOKEN: process.env.SCHEDULER_CRON_TOKEN || '',
  SO_SCHEDULER_ORDER_DELAY_MS: process.env.SO_SCHEDULER_ORDER_DELAY_MS || '1000',
  ODOO_RATE_LIMIT_RETRIES: process.env.ODOO_RATE_LIMIT_RETRIES || '3',
  ODOO_RATE_LIMIT_RETRY_BASE_MS: process.env.ODOO_RATE_LIMIT_RETRY_BASE_MS || '1500',
  ODOO_WEBHOOK_TOKEN: process.env.ODOO_WEBHOOK_TOKEN || '',
  OCR_ENGINE_DEFAULT: process.env.OCR_ENGINE_DEFAULT || 'auto',
  GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
  GOOGLE_GEMINI_PROJECT_ID: process.env.GOOGLE_GEMINI_PROJECT_ID || '',
  GOOGLE_GEMINI_OAUTH_CLIENT_ID: process.env.GOOGLE_GEMINI_OAUTH_CLIENT_ID || '',
  GOOGLE_GEMINI_OAUTH_CLIENT_SECRET: process.env.GOOGLE_GEMINI_OAUTH_CLIENT_SECRET || '',
  AI_INVOICE_EXTRACTION_ENABLED: process.env.AI_INVOICE_EXTRACTION_ENABLED || 'false',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  OPENAI_INVOICE_MODEL: process.env.OPENAI_INVOICE_MODEL || 'gpt-4.1',
  AI_INVOICE_CONFIDENCE_THRESHOLD: process.env.AI_INVOICE_CONFIDENCE_THRESHOLD || '0.75',
  AI_INVOICE_MAX_IMAGES: process.env.AI_INVOICE_MAX_IMAGES || '3',
  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  TEMP_DIR: process.env.TEMP_DIR || 'tmp',
  PAYROLL_BRIDGE_URL:
    process.env.PAYROLL_BRIDGE_URL || 'http://127.0.0.1:8010/odoo-payroll',
  PAYROLL_BRIDGE_PROXY_URL:
    process.env.PAYROLL_BRIDGE_PROXY_URL || 'http://127.0.0.1:8010/odoo-payroll',
  PAYROLL_BRIDGE_TOKEN: process.env.PAYROLL_BRIDGE_TOKEN || '',
  PAYROLL_ADVANCE_SOURCE:
    process.env.PAYROLL_ADVANCE_SOURCE || 'app.urbanvibeinteriordesign.co.ke',
  PAYROLL_AUTO_CREATE_PAYRUN: process.env.PAYROLL_AUTO_CREATE_PAYRUN || 'false',
  PAYROLL_SALARY_STRUCTURE: process.env.PAYROLL_SALARY_STRUCTURE || 'All',
  PAYROLL_PAY_RUN_NAME_TEMPLATE:
    process.env.PAYROLL_PAY_RUN_NAME_TEMPLATE || '{monthName} {year}',
  ODOO_TARGET_COMPANY_NAME:
    process.env.ODOO_TARGET_COMPANY_NAME || 'URBAN VIBE INTERIOR DESIGN COMPANY LTD',
};
