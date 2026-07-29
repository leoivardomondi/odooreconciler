"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendDailyMpesaReviewNotification = sendDailyMpesaReviewNotification;
const repositories_1 = require("../models/repositories");
const env_1 = require("../utils/env");
const mailTransport_1 = require("./mailTransport");
const MPESA_REVIEW_NOTIFICATION_RECIPIENT = 'charles@urbanvibeinteriordesign.co.ke';
function getLocalDayStartTimestamp() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')} 00:00:00`;
}
async function sendDailyMpesaReviewNotification(recipientOverride = '') {
    const batches = await (0, repositories_1.getMpesaStatementBatchesWithOpenReviewCounts)();
    if (!batches.length) {
        return { sent: false, reason: 'no_open_statements', statementCount: 0 };
    }
    const dayStart = getLocalDayStartTimestamp();
    if (await (0, repositories_1.hasMpesaReviewNotificationSince)(dayStart)) {
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
        `${env_1.env.APP_BASE_URL.replace(/\/$/, '')}/mpesa-reconciliation`,
    ];
    const recipient = recipientOverride.trim() || MPESA_REVIEW_NOTIFICATION_RECIPIENT;
    const options = {
        to: recipient,
        subject: `M-Pesa review pending: ${statementCount} statement(s)`,
        text: lines.join('\n'),
    };
    const settings = await (0, repositories_1.getSettings)();
    const mailResult = await (0, mailTransport_1.sendMailWithConfig)(settings.mail, options);
    const info = mailResult.info;
    await (0, repositories_1.insertLog)({
        level: 'info',
        message: 'M-Pesa review notification sent',
        context: {
            recipient,
            statementCount,
            statements: batches.map((batch) => ({
                id: batch.id,
                filename: batch.originalFilename,
            })),
            dayStart,
            messageId: info && typeof info === 'object' && 'messageId' in info
                ? String(info.messageId || '')
                : null,
            mailTransport: mailResult.transport,
            smtpUsername: mailResult.username,
            mailFromEmail: mailResult.fromEmail,
        },
    });
    return { sent: true, statementCount };
}
