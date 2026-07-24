import nodemailer, { SendMailOptions, Transporter } from 'nodemailer';
import { MailConfig, OutgoingMailAccount } from '../models/types';
import { createDefaultMailConfig } from '../utils/helpers';
import { env } from '../utils/env';

function positiveNumber(value: string | number | undefined, fallback: number) {
  const parsed = Number(value || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getSmtpAccounts(): OutgoingMailAccount[] {
  return createDefaultMailConfig().accounts.filter((account) => account.username && account.password);
}

export function assertMailConfigured(_transport = env.SMTP_TRANSPORT) {
  if (!env.SMTP_HOST.trim() || getSmtpAccounts().length === 0) {
    throw new Error('SMTP settings are incomplete. Configure SMTP_HOST plus at least one SMTP_USERNAME and SMTP_PASSWORD.');
  }
}

function getEnabledSmtpAccounts(config: MailConfig) {
  return config.accounts.filter((account) => account.enabled && account.username.trim() && account.password);
}

export function assertMailConfigConfigured(config: MailConfig) {
  if (!config.host.trim() || getEnabledSmtpAccounts(config).length === 0) {
    throw new Error('Outgoing mail is incomplete. Configure SMTP host plus at least one enabled username and password.');
  }
}

function createSmtpTransport(account: OutgoingMailAccount): Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST.trim(),
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_REQUIRE_TLS === 'true',
    ignoreTLS: env.SMTP_IGNORE_TLS === 'true',
    tls: {
      rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
    },
    connectionTimeout: positiveNumber(env.SMTP_CONNECTION_TIMEOUT_MS, 30000),
    greetingTimeout: positiveNumber(env.SMTP_GREETING_TIMEOUT_MS, 30000),
    socketTimeout: positiveNumber(env.SMTP_SOCKET_TIMEOUT_MS, 45000),
    auth: {
      user: account.username,
      pass: account.password,
    },
  });
}

function createConfiguredSmtpTransport(config: MailConfig, account: OutgoingMailAccount): Transporter {
  return nodemailer.createTransport({
    host: config.host.trim(),
    port: positiveNumber(config.port, 587),
    secure: Boolean(config.secure),
    requireTLS: Boolean(config.requireTls),
    ignoreTLS: Boolean(config.ignoreTls),
    tls: {
      rejectUnauthorized: config.tlsRejectUnauthorized !== false,
    },
    connectionTimeout: positiveNumber(config.connectionTimeoutMs, 30000),
    greetingTimeout: positiveNumber(config.greetingTimeoutMs, 30000),
    socketTimeout: positiveNumber(config.socketTimeoutMs, 45000),
    auth: {
      user: account.username.trim(),
      pass: account.password,
    },
  });
}

export function createMailTransport(transport = env.SMTP_TRANSPORT, account = getSmtpAccounts()[0]): Transporter {
  assertMailConfigured(transport);

  if (!account) {
    throw new Error('SMTP settings are incomplete. Configure at least one SMTP username and password.');
  }

  return createSmtpTransport(account);
}

function mailErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || 'Unknown mail error');
}

export async function sendMailWithFallback(options: SendMailOptions) {
  assertMailConfigured('smtp');
  const errors: string[] = [];

  for (const account of getSmtpAccounts()) {
    try {
      const info = await createSmtpTransport(account).sendMail({
        ...options,
        from: {
          name: account.fromName,
          address: account.fromEmail,
        },
      });
      return { info, transport: 'smtp', username: account.username, fromEmail: account.fromEmail };
    } catch (error) {
      errors.push(`${account.username}: ${mailErrorMessage(error)}`);
    }
  }

  throw new Error(`Outgoing SMTP failed. ${errors.join(' | ')}`);
}

function defaultFromAccount(config: MailConfig) {
  return config.accounts.find((account) => account.fromEmail.trim()) || config.accounts[0] || null;
}

function buildFromAddress(account: OutgoingMailAccount | null) {
  if (!account) {
    return undefined;
  }

  return {
    name: account.fromName.trim() || 'Urban Vibe Access',
    address: account.fromEmail.trim() || account.username.trim(),
  };
}

export async function sendMailWithConfig(config: MailConfig, options: SendMailOptions) {
  assertMailConfigConfigured(config);
  const errors: string[] = [];

  for (const account of getEnabledSmtpAccounts(config)) {
    try {
      const info = await createConfiguredSmtpTransport(config, account).sendMail({
        ...options,
        from: buildFromAddress(account),
      });
      return {
        info,
        transport: 'smtp',
        username: account.username.trim(),
        fromEmail: account.fromEmail.trim() || account.username.trim(),
      };
    } catch (error) {
      errors.push(`${account.username}: ${mailErrorMessage(error)}`);
    }
  }

  throw new Error(`Outgoing SMTP failed. ${errors.join(' | ')}`);
}
