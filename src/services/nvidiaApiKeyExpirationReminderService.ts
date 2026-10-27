import { getSettings, getShopFloorSharedCache, saveShopFloorSharedCache } from '../models/repositories';
import { env } from '../utils/env';
import { sendMailWithConfig } from './mailTransport';
import { logEvent } from './logService';

export const NVIDIA_KEY_NAME = 'NVIDIABuild-Autogen-19';
// Expiration date from NVIDIA Build: April 28, 2027
export const NVIDIA_KEY_EXPIRATION_ISO = '2027-04-28T00:00:00+03:00';
export const CACHE_KEY_NVIDIA_EXPIRATION_REMINDERS = 'nvidia_api_key_expiration_reminders';

export type NvidiaReminderStage = '30d' | '7d' | '1d';

interface ReminderLogEntry {
  sentAt: string;
  recipient: string;
  daysRemaining: number;
}

interface NvidiaExpirationReminderState {
  stage_30d?: ReminderLogEntry;
  stage_7d?: ReminderLogEntry;
  stage_1d?: ReminderLogEntry;
  test_reminders?: Array<ReminderLogEntry & { stage: NvidiaReminderStage }>;
}

function getDbAdminRecipients(): string[] {
  const configured = env.DBADMIN_EMAIL || 'dbadmin@urbanvibeinteriordesign.co.ke';
  return [
    ...new Set(
      configured
        .split(/[,;\n]/)
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
    ),
  ];
}

export function calculateDaysRemaining(targetDateIso = NVIDIA_KEY_EXPIRATION_ISO, now = new Date()): number {
  const target = new Date(targetDateIso).getTime();
  const current = now.getTime();
  const diffMs = target - current;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getStageSubject(stage: NvidiaReminderStage, daysRemaining: number): string {
  switch (stage) {
    case '30d':
      return `[REMINDER 1/3] NVIDIA API Key Expiration Notice — 30 Days Remaining (${NVIDIA_KEY_NAME})`;
    case '7d':
      return `[URGENT REMINDER 2/3] NVIDIA API Key Expires in ${daysRemaining} Days — Action Required (${NVIDIA_KEY_NAME})`;
    case '1d':
      return `[FINAL WARNING 3/3] NVIDIA API Key Expires Tomorrow — Immediate Renewal Required (${NVIDIA_KEY_NAME})`;
  }
}

function buildReminderEmailContent(stage: NvidiaReminderStage, daysRemaining: number, isTest = false) {
  const subject = `${isTest ? '[TEST] ' : ''}${getStageSubject(stage, daysRemaining)}`;

  const urgencyBadge =
    stage === '1d'
      ? '<span style="background-color: #fee2e2; color: #991b1b; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px;">CRITICAL: 1 DAY REMAINING</span>'
      : stage === '7d'
        ? '<span style="background-color: #fef3c7; color: #92400e; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px;">URGENT: 7 DAYS REMAINING</span>'
        : '<span style="background-color: #e0f2fe; color: #075985; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px;">30 DAYS ADVANCE NOTICE</span>';

  const plainText = [
    `${subject}`,
    '='.repeat(subject.length),
    '',
    `Key Name: ${NVIDIA_KEY_NAME}`,
    `Expiration Date: April 28, 2027 (2027-04-28)`,
    `Days Remaining: ~${daysRemaining} day(s)`,
    `Reminder Stage: ${stage} (Reminder ${stage === '30d' ? '1 of 3' : stage === '7d' ? '2 of 3' : '3 of 3'})`,
    '',
    'AFFECTED SERVICES:',
    '- PO Bill Automation & Vendor Invoice Extraction',
    '- MiniMax M3.1 Flash (minimaxai/minimax-m3.1-flash) Multimodal Reasoning',
    '- NVIDIA Nemotron OCR v2 (nvidia/nemotron-ocr-v2)',
    '',
    'REQUIRED ACTION:',
    '1. Log into NVIDIA Build Console: https://build.nvidia.com/',
    '2. Generate a new API key.',
    '3. Update the key in Urban Vibe Reconciler Settings:',
    '   https://app.urbanvibeinteriordesign.co.ke/settings',
    '',
    'Please renew before April 28, 2027 to prevent invoice processing disruptions.',
  ].join('\n');

  const html = `
    <!DOCTYPE html>
    <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 620px; margin: 0 auto; padding: 24px;">
        <div style="border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="background-color: #0f172a; padding: 20px 24px; color: #ffffff;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #ffffff; letter-spacing: -0.01em;">
                Urban Vibe System Alert
              </h2>
            </div>
            <p style="margin: 6px 0 0; color: #94a3b8; font-size: 13px;">
              Automated NVIDIA API Key Expiration Monitor
            </p>
          </div>

          <div style="padding: 24px; background-color: #ffffff;">
            <div style="margin-bottom: 18px;">
              ${urgencyBadge}
            </div>

            <h3 style="margin: 0 0 12px; font-size: 17px; font-weight: 600; color: #0f172a;">
              ${stage === '1d' ? 'Final Notice: NVIDIA Key Expires Tomorrow' : stage === '7d' ? 'Urgent Action: NVIDIA Key Expires in 7 Days' : 'Advance Notice: NVIDIA Key Expires in 30 Days'}
            </h3>

            <p style="margin: 0 0 16px; font-size: 14px; color: #475569;">
              The trial NVIDIA Build API key used for optical character recognition (OCR) and vendor bill AI parsing is nearing its 6-month validity expiration.
            </p>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13px;">
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Key Name</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right; font-family: monospace;">${NVIDIA_KEY_NAME}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Exact Expiration</td>
                <td style="padding: 8px 0; color: #dc2626; font-weight: 600; text-align: right;">April 28, 2027</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Days Remaining</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right;">${daysRemaining} day(s)</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Reminder Sequence</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600; text-align: right;">Reminder ${stage === '30d' ? '1 of 3' : stage === '7d' ? '2 of 3' : '3 of 3'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-weight: 500;">Impacted Services</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 500; text-align: right;">PO Bill Scheduler, MiniMax M3.1 Flash, Nemotron OCR</td>
              </tr>
            </table>

            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
              <h4 style="margin: 0 0 10px; font-size: 13px; font-weight: 600; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em;">
                Renewal Instructions (2 Minutes)
              </h4>
              <ol style="margin: 0; padding-left: 20px; font-size: 13px; color: #334155;">
                <li style="margin-bottom: 6px;">Open the <strong><a href="https://build.nvidia.com/" style="color: #2563eb; text-decoration: none;">NVIDIA Build Console</a></strong> and sign in.</li>
                <li style="margin-bottom: 6px;">Generate a new API key.</li>
                <li>Go to <strong><a href="https://app.urbanvibeinteriordesign.co.ke/settings" style="color: #2563eb; text-decoration: none;">Urban Vibe Settings &gt; AI Extraction</a></strong>, paste the new key into <em>NVIDIA reasoning API key</em>, and click Save.</li>
              </ol>
            </div>

            <div style="text-align: center; margin-bottom: 8px;">
              <a href="https://app.urbanvibeinteriordesign.co.ke/settings" style="background-color: #2563eb; color: #ffffff; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600; display: inline-block;">
                Update Key in Settings &rarr;
              </a>
            </div>
          </div>

          <div style="background-color: #f8fafc; padding: 14px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
            This automated reminder was dispatched to DB administrators (<code style="color: #0f172a;">${getDbAdminRecipients().join(', ')}</code>).
          </div>
        </div>
      </body>
    </html>
  `;

  return { subject, plainText, html };
}

export async function checkAndSendNvidiaApiKeyExpirationReminders(now = new Date()): Promise<{
  checked: boolean;
  stage?: NvidiaReminderStage;
  sent: boolean;
  daysRemaining: number;
  reason?: string;
}> {
  const daysRemaining = calculateDaysRemaining(NVIDIA_KEY_EXPIRATION_ISO, now);

  // Determine which stage is eligible
  let stage: NvidiaReminderStage | null = null;
  if (daysRemaining <= 1) {
    stage = '1d';
  } else if (daysRemaining <= 7) {
    stage = '7d';
  } else if (daysRemaining <= 30) {
    stage = '30d';
  }

  if (!stage) {
    return {
      checked: true,
      sent: false,
      daysRemaining,
      reason: `More than 30 days remaining (${daysRemaining} days). No reminder due yet.`,
    };
  }

  const cache = await getShopFloorSharedCache<NvidiaExpirationReminderState>(CACHE_KEY_NVIDIA_EXPIRATION_REMINDERS);
  const state: NvidiaExpirationReminderState = cache?.data || {};

  const stageKey = `stage_${stage}` as const;
  if (state[stageKey]?.sentAt) {
    return {
      checked: true,
      stage,
      sent: false,
      daysRemaining,
      reason: `Stage ${stage} reminder was already sent on ${state[stageKey]?.sentAt}.`,
    };
  }

  const recipients = getDbAdminRecipients();
  if (!recipients.length) {
    return {
      checked: true,
      stage,
      sent: false,
      daysRemaining,
      reason: 'No valid dbadmin recipient email configured.',
    };
  }

  const settings = await getSettings();
  const { subject, plainText, html } = buildReminderEmailContent(stage, daysRemaining, false);

  const result = await sendMailWithConfig(settings.mail, {
    to: recipients.join(', '),
    subject,
    text: plainText,
    html,
  });

  state[stageKey] = {
    sentAt: new Date().toISOString(),
    recipient: recipients.join(', '),
    daysRemaining,
  };

  await saveShopFloorSharedCache(CACHE_KEY_NVIDIA_EXPIRATION_REMINDERS, state);

  await logEvent('info', `Dispatched NVIDIA API key expiration reminder (${stage}) to dbadmin`, {
    stage,
    daysRemaining,
    recipients,
    transport: result.transport,
    fromEmail: result.fromEmail,
  });

  return {
    checked: true,
    stage,
    sent: true,
    daysRemaining,
  };
}

export async function sendTestNvidiaExpirationReminder(
  recipientOverride?: string,
  stageOverride: NvidiaReminderStage = '30d',
): Promise<{
  sent: boolean;
  recipient: string;
  stage: NvidiaReminderStage;
  transport?: string;
}> {
  const recipients = recipientOverride
    ? [recipientOverride.trim().toLowerCase()]
    : getDbAdminRecipients();

  if (!recipients.length || !recipients[0]) {
    throw new Error('No recipient specified for test NVIDIA reminder.');
  }

  const daysRemaining = calculateDaysRemaining(NVIDIA_KEY_EXPIRATION_ISO);
  const { subject, plainText, html } = buildReminderEmailContent(stageOverride, daysRemaining, true);
  const settings = await getSettings();

  const result = await sendMailWithConfig(settings.mail, {
    to: recipients.join(', '),
    subject,
    text: plainText,
    html,
  });

  await logEvent('info', `Sent test NVIDIA expiration reminder to ${recipients.join(', ')}`, {
    stage: stageOverride,
    recipients,
    transport: result.transport,
  });

  return {
    sent: true,
    recipient: recipients.join(', '),
    stage: stageOverride,
    transport: result.transport,
  };
}
