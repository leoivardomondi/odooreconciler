"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSmtpAccounts = getSmtpAccounts;
exports.assertMailConfigured = assertMailConfigured;
exports.assertMailConfigConfigured = assertMailConfigConfigured;
exports.createMailTransport = createMailTransport;
exports.sendMailWithFallback = sendMailWithFallback;
exports.sendMailWithConfig = sendMailWithConfig;
const nodemailer_1 = __importDefault(require("nodemailer"));
const helpers_1 = require("../utils/helpers");
const env_1 = require("../utils/env");
function positiveNumber(value, fallback) {
    const parsed = Number(value || '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function getSmtpAccounts() {
    return (0, helpers_1.createDefaultMailConfig)().accounts.filter((account) => account.username && account.password);
}
function assertMailConfigured(_transport = env_1.env.SMTP_TRANSPORT) {
    if (!env_1.env.SMTP_HOST.trim() || getSmtpAccounts().length === 0) {
        throw new Error('SMTP settings are incomplete. Configure SMTP_HOST plus at least one SMTP_USERNAME and SMTP_PASSWORD.');
    }
}
function getEnabledSmtpAccounts(config) {
    return config.accounts.filter((account) => account.enabled && account.username.trim() && account.password);
}
function assertMailConfigConfigured(config) {
    if (!config.host.trim() || getEnabledSmtpAccounts(config).length === 0) {
        throw new Error('Outgoing mail is incomplete. Configure SMTP host plus at least one enabled username and password.');
    }
}
function createSmtpTransport(account) {
    return nodemailer_1.default.createTransport({
        host: env_1.env.SMTP_HOST.trim(),
        port: Number(env_1.env.SMTP_PORT || 587),
        secure: env_1.env.SMTP_SECURE === 'true',
        requireTLS: env_1.env.SMTP_REQUIRE_TLS === 'true',
        ignoreTLS: env_1.env.SMTP_IGNORE_TLS === 'true',
        tls: {
            rejectUnauthorized: env_1.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
        },
        connectionTimeout: positiveNumber(env_1.env.SMTP_CONNECTION_TIMEOUT_MS, 30000),
        greetingTimeout: positiveNumber(env_1.env.SMTP_GREETING_TIMEOUT_MS, 30000),
        socketTimeout: positiveNumber(env_1.env.SMTP_SOCKET_TIMEOUT_MS, 45000),
        auth: {
            user: account.username,
            pass: account.password,
        },
    });
}
function createConfiguredSmtpTransport(config, account) {
    return nodemailer_1.default.createTransport({
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
function createMailTransport(transport = env_1.env.SMTP_TRANSPORT, account = getSmtpAccounts()[0]) {
    assertMailConfigured(transport);
    if (!account) {
        throw new Error('SMTP settings are incomplete. Configure at least one SMTP username and password.');
    }
    return createSmtpTransport(account);
}
function mailErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error || 'Unknown mail error');
}
async function sendMailWithFallback(options) {
    assertMailConfigured('smtp');
    const errors = [];
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
        }
        catch (error) {
            errors.push(`${account.username}: ${mailErrorMessage(error)}`);
        }
    }
    throw new Error(`Outgoing SMTP failed. ${errors.join(' | ')}`);
}
function defaultFromAccount(config) {
    return config.accounts.find((account) => account.fromEmail.trim()) || config.accounts[0] || null;
}
function buildFromAddress(account) {
    if (!account) {
        return undefined;
    }
    return {
        name: account.fromName.trim() || 'Urban Vibe Access',
        address: account.fromEmail.trim() || account.username.trim(),
    };
}
async function sendMailWithConfig(config, options) {
    assertMailConfigConfigured(config);
    const errors = [];
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
        }
        catch (error) {
            errors.push(`${account.username}: ${mailErrorMessage(error)}`);
        }
    }
    throw new Error(`Outgoing SMTP failed. ${errors.join(' | ')}`);
}
