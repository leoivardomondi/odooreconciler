import {
  getSettings,
  getMpesaStatementBatchesWithOpenReviewCounts,
  hasMpesaReviewNotificationSince,
  insertLog,
} from '../models/repositories';
import { env } from '../utils/env';
import { sendMailWithConfig } from './mailTransport';

const MPESA_REVIEW_NOTIFICATION_RECIPIENT = 'charles@urbanvibeinteriordesign.co.ke';

function getLocalDayStartTimestamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.APP_TIMEZONE || 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')} 00:00:00`;
}

export async function sendDailyMpesaReviewNotification() {
  const batches = await getMpesaStatementBatchesWithOpenReviewCounts();
  if (!batches.length) {
    return { sent: false, reason: 'no_open_statements', statementCount: 0 };
  }

  const dayStart = getLocalDayStartTimestamp();
  if (await hasMpesaReviewNotificationSince(dayStart)) {
    return {
      sent: false,
      reason: 'already_sent_today',
      statementCount: batches.length,
    };
  }

  const statementCount = batches.length;
  const lines = [
    'M-Pesa reconciliation still has statement(s) that need attention.',
    '',
    `Statements needing review: ${statementCount}`,
    '',
    'Open statements:',
    ...batches.map((batch) => `- ${batch.originalFilename}`),
    '',
    `${env.APP_BASE_URL.replace(/\/$/, '')}/mpesa-reconciliation`,
  ];

  const options = {
    to: MPESA_REVIEW_NOTIFICATION_RECIPIENT,
    subject: `M-Pesa review pending: ${statementCount} statement(s)`,
    text: lines.join('\n'),
  };
  const settings = await getSettings();
  const mailResult = await sendMailWithConfig(settings.mail, options);
  const info = mailResult.info;

  await insertLog({
    level: 'info',
    message: 'M-Pesa review notification sent',
    context: {
      recipient: MPESA_REVIEW_NOTIFICATION_RECIPIENT,
      statementCount,
      statements: batches.map((batch) => ({
        id: batch.id,
        filename: batch.originalFilename,
      })),
      dayStart,
      messageId: info && typeof info === 'object' && 'messageId' in info
        ? String((info as { messageId?: unknown }).messageId || '')
        : null,
      mailTransport: mailResult.transport,
      smtpUsername: mailResult.username,
      mailFromEmail: mailResult.fromEmail,
    },
  });

  return { sent: true, statementCount };
}
