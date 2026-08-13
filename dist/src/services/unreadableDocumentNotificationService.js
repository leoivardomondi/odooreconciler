"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUnreadableDocument = isUnreadableDocument;
exports.notifyUnreadableDocument = notifyUnreadableDocument;
const repositories_1 = require("../models/repositories");
const env_1 = require("../utils/env");
const mailTransport_1 = require("./mailTransport");
function isUnreadableDocument(candidate) {
    const normalizedText = String(candidate.rawText || '').replace(/\s+/g, ' ').trim();
    const alphaNumericCount = (normalizedText.match(/[a-z0-9]/gi) || []).length;
    const missingCoreInvoiceFields = !String(candidate.vendorName || '').trim() &&
        candidate.grandTotal == null &&
        Number(candidate.itemCount || 0) === 0;
    const lowConfidence = Number(candidate.confidenceOverall ?? 1) < 0.5;
    const sparseText = normalizedText.length < 80 || alphaNumericCount < 20;
    return missingCoreInvoiceFields && (lowConfidence || sparseText);
}
async function notifyUnreadableDocument(candidate) {
    if (await (0, repositories_1.hasPoBillUnreadableNotification)(candidate.attachmentId)) {
        return { sent: false, alreadyNotified: true, recipient: env_1.env.DBADMIN_EMAIL };
    }
    const settings = await (0, repositories_1.getSettings)();
    const recipient = env_1.env.DBADMIN_EMAIL.trim() || 'dbadmin@urbanvibeinteriordesign.co.ke';
    const confidence = candidate.confidenceOverall == null
        ? 'unknown'
        : `${Math.round(candidate.confidenceOverall * 100)}%`;
    const preview = String(candidate.rawText || '').replace(/\s+/g, ' ').trim().slice(0, 500);
    const subject = `[PO Bill Scheduler] Unreadable document found: ${candidate.attachmentName}`;
    const text = [
        'The PO Bill Scheduler found a document that could not be read reliably.',
        '',
        `Document: ${candidate.attachmentName}`,
        `Attachment ID: ${candidate.attachmentId}`,
        `Extraction confidence: ${confidence}`,
        `OCR preview: ${preview || '(no readable OCR text)'}`,
        '',
        'Please inspect the original document or upload a clearer scan before matching or billing.',
    ].join('\n');
    const result = await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
        to: recipient,
        subject,
        text,
        html: `<p>The PO Bill Scheduler found a document that could not be read reliably.</p><ul><li><strong>Document:</strong> ${escapeHtml(candidate.attachmentName)}</li><li><strong>Attachment ID:</strong> ${candidate.attachmentId}</li><li><strong>Extraction confidence:</strong> ${escapeHtml(confidence)}</li></ul><p>Please inspect the original document or upload a clearer scan before matching or billing.</p>`,
    });
    await (0, repositories_1.recordPoBillUnreadableNotification)(candidate.attachmentId, candidate.attachmentName);
    await (0, repositories_1.insertLog)({
        level: 'warn',
        message: 'Unreadable PO bill document notification sent',
        context: {
            attachmentId: candidate.attachmentId,
            attachmentName: candidate.attachmentName,
            recipient,
            confidence: candidate.confidenceOverall ?? null,
            mailTransport: result.transport,
            smtpUsername: result.username,
            mailFromEmail: result.fromEmail,
        },
    });
    return { sent: true, alreadyNotified: false, recipient };
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
