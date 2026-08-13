import { getSettings, hasPoBillUnreadableNotification, insertLog, recordPoBillUnreadableNotification } from '../models/repositories';
import { env } from '../utils/env';
import { sendMailWithConfig } from './mailTransport';

export interface UnreadableDocumentCandidate {
  attachmentId: number;
  attachmentName: string;
  vendorName?: string | null;
  grandTotal?: number | null;
  itemCount?: number | null;
  rawText?: string | null;
  confidenceOverall?: number | null;
}

export function isUnreadableDocument(candidate: UnreadableDocumentCandidate) {
  const normalizedText = String(candidate.rawText || '').replace(/\s+/g, ' ').trim();
  const alphaNumericCount = (normalizedText.match(/[a-z0-9]/gi) || []).length;
  const missingCoreInvoiceFields =
    !String(candidate.vendorName || '').trim() &&
    candidate.grandTotal == null &&
    Number(candidate.itemCount || 0) === 0;
  const lowConfidence = Number(candidate.confidenceOverall ?? 1) < 0.5;
  const sparseText = normalizedText.length < 80 || alphaNumericCount < 20;

  return missingCoreInvoiceFields && (lowConfidence || sparseText);
}

export async function notifyUnreadableDocument(candidate: UnreadableDocumentCandidate) {
  if (await hasPoBillUnreadableNotification(candidate.attachmentId)) {
    return { sent: false, alreadyNotified: true, recipient: env.DBADMIN_EMAIL };
  }

  const settings = await getSettings();
  const recipient = env.DBADMIN_EMAIL.trim() || 'dbadmin@urbanvibeinteriordesign.co.ke';
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

  const result = await sendMailWithConfig(settings.mail, {
    to: recipient,
    subject,
    text,
    html: `<p>The PO Bill Scheduler found a document that could not be read reliably.</p><ul><li><strong>Document:</strong> ${escapeHtml(candidate.attachmentName)}</li><li><strong>Attachment ID:</strong> ${candidate.attachmentId}</li><li><strong>Extraction confidence:</strong> ${escapeHtml(confidence)}</li></ul><p>Please inspect the original document or upload a clearer scan before matching or billing.</p>`,
  });

  await recordPoBillUnreadableNotification(candidate.attachmentId, candidate.attachmentName);
  await insertLog({
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}
