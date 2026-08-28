"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractAiCredentialFailureSignals = extractAiCredentialFailureSignals;
exports.notifyAiCredentialFailures = notifyAiCredentialFailures;
const node_crypto_1 = require("node:crypto");
const repositories_1 = require("../models/repositories");
const env_1 = require("../utils/env");
const mailTransport_1 = require("./mailTransport");
function normalizeFailureMessage(value) {
    return value
        .replace(/page\s+\d+/gi, 'page')
        .replace(/\b\d{3}\b/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
}
function buildSignature(kind, provider, model, message) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(`${kind}|${provider}|${model}|${normalizeFailureMessage(message).toLowerCase()}`)
        .digest('hex');
}
function failureSignalFromLog(log) {
    const isRateLimitOrTemporaryError = /quota|rate\s*limit|limit:\s*\d+|resource_exhausted|\b429\b|too\s+many\s+requests|retry\s+in|high\s+demand|overloaded|service\s+unavailable|\b500\b|\b502\b|\b503\b|\b504\b/i.test(log);
    if (isRateLimitOrTemporaryError && !/unauthori[sz]ed|invalid\s+(?:api\s*)?key|\b401\b|\b403\b/i.test(log)) {
        return null;
    }
    const invalidApiKey = /api\s*key\s+(?:is\s+)?(?:not\s+valid|invalid)|invalid\s+(?:api\s*)?key|invalid\s+credential|unauthori[sz]ed|\bHTTP\s+(?:401|403)\b/i.test(log);
    const oauthFailure = /(?:oauth|refresh\s+token|access\s+token|gemini\s+oauth).*(?:failed|failure|error|invalid|expired|missing|not\s+connected|not\s+configured|unable|denied|reconnect|skipped)|(?:failed|failure|error|invalid|expired|missing|not\s+connected|not\s+configured|unable|denied|reconnect|skipped).*(?:oauth|refresh\s+token|access\s+token)|google\s+gemini\s+oauth\s+connection\s+failed/i.test(log);
    if (!invalidApiKey && !oauthFailure)
        return null;
    const providerMatch = log.match(/AI provider\s+"([^"]+)"\s*\(([^)]+)\)/i);
    const provider = providerMatch?.[1] || (/gemini|google/i.test(log) ? 'gemini' : 'unknown');
    const model = providerMatch?.[2] || '';
    const kind = invalidApiKey ? 'invalid_api_key' : 'oauth_connection';
    return { kind, provider, model, message: normalizeFailureMessage(log) };
}
function extractAiCredentialFailureSignals(logs) {
    const seen = new Set();
    const signals = [];
    for (const log of logs) {
        const signal = failureSignalFromLog(String(log || ''));
        if (!signal)
            continue;
        const signature = buildSignature(signal.kind, signal.provider, signal.model, signal.message);
        if (seen.has(signature))
            continue;
        seen.add(signature);
        signals.push({ ...signal, signature });
    }
    return signals;
}
function recipients() {
    return [...new Set(env_1.env.DBADMIN_EMAIL
            .split(/[,;\n]/)
            .map((email) => email.trim().toLowerCase())
            .filter((email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character] || character);
}
async function notifyAiCredentialFailures(input) {
    const signals = extractAiCredentialFailureSignals(input.logs);
    if (signals.length === 0)
        return { sent: false, skipped: false, signals: [] };
    const pending = [];
    for (const signal of signals) {
        if (!(await (0, repositories_1.hasAiCredentialFailureNotification)(input.attachmentId, signal.signature))) {
            pending.push(signal);
        }
    }
    if (pending.length === 0) {
        return { sent: false, skipped: true, signals };
    }
    const to = recipients();
    if (to.length === 0) {
        return { sent: false, skipped: true, signals: pending };
    }
    const settings = await (0, repositories_1.getSettings)();
    const subject = `[AI credential alert] ${input.attachmentName}`;
    const lines = [
        'The PO Bill Scheduler encountered an AI credential failure while reviewing a document.',
        '',
        `Document: ${input.attachmentName}`,
        `Attachment ID: ${input.attachmentId}`,
        '',
        ...pending.map((signal) => [
            `Failure type: ${signal.kind === 'oauth_connection' ? 'Gemini OAuth connection' : 'Invalid API key or authorization'}`,
            `Provider: ${signal.provider}`,
            `Model: ${signal.model || 'not specified'}`,
            `Details: ${signal.message}`,
            '',
        ].join('\n')),
        'Action: reconnect Google Gemini OAuth or replace/clear the invalid API key in Settings > AI Parser.',
    ];
    const text = lines.join('\n');
    const htmlSignals = pending.map((signal) => `<li><strong>${escapeHtml(signal.kind === 'oauth_connection' ? 'Gemini OAuth connection' : 'Invalid API key or authorization')}</strong> - ${escapeHtml(signal.provider)} ${escapeHtml(signal.model)}<br>${escapeHtml(signal.message)}</li>`).join('');
    const result = await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
        to: to.join(', '),
        subject,
        text,
        html: `<p>The PO Bill Scheduler encountered an AI credential failure while reviewing <strong>${escapeHtml(input.attachmentName)}</strong>.</p><ul>${htmlSignals}</ul><p>Reconnect Google Gemini OAuth or replace/clear the invalid API key in Settings &gt; AI Parser.</p>`,
    });
    for (const signal of pending) {
        await (0, repositories_1.recordAiCredentialFailureNotification)({
            attachmentId: input.attachmentId,
            failureSignature: signal.signature,
            provider: signal.provider,
            model: signal.model,
        });
    }
    await (0, repositories_1.insertLog)({
        level: 'warn',
        message: 'AI credential failure notification sent to DB admins',
        context: {
            attachmentId: input.attachmentId,
            attachmentName: input.attachmentName,
            recipients: to,
            failures: pending.map(({ kind, provider, model, message }) => ({ kind, provider, model, message })),
            mailTransport: result.transport,
            smtpUsername: result.username,
            mailFromEmail: result.fromEmail,
        },
    });
    return { sent: true, skipped: false, signals: pending, recipients: to };
}
