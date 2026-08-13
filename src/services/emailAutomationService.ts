import { getSettings, saveSettings } from '../models/repositories';
import { EmailAutomation } from '../models/types';
import { logEvent } from './logService';
import { sendMailWithConfig } from './mailTransport';
import { sendDailyMpesaReviewNotification } from './mpesaReviewNotificationService';
import { sendMoOvertimeSuggestion } from './moOvertimeSuggestionService';
import { sendHourlyShopFloorTaskReminders } from './shopFloorTaskReminderService';
import { sendWeeklyShopFloorReport } from './weeklyShopFloorReportService';

let timer: NodeJS.Timeout | null = null;
let running = false;

function recipients(value: string) {
  return [...new Set(value.split(/[,\n;]/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

function nairobiNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
  };
}

function isDue(item: EmailAutomation, now = new Date()) {
  if (!item.enabled) return false;
  const local = nairobiNow();
  const last = item.lastSentAt ? new Date(item.lastSentAt) : null;
  const elapsedHours = last && Number.isFinite(last.getTime()) ? (now.getTime() - last.getTime()) / 3_600_000 : Infinity;
  if (item.frequency === 'hourly') return elapsedHours >= Math.max(1, item.interval);
  if (item.systemKey === 'mo-overtime') {
    return local.hour === 16 && local.minute >= 50 && local.minute < 60 && elapsedHours >= 23;
  }
  // Daily/weekly automations are intended to run during their configured
  // Nairobi hour. Do not send a missed run hours later when the next polling
  // cycle happens; that is what caused the overtime email to arrive late.
  if (local.hour !== item.hour) return false;
  if (item.frequency === 'daily') return elapsedHours >= 23 * Math.max(1, item.interval);
  return local.dayOfWeek === item.dayOfWeek && elapsedHours >= 24 * 6.5 * Math.max(1, item.interval);
}

async function dispatch(item: EmailAutomation) {
  const to = recipients(item.recipients);
  switch (item.systemKey) {
    case 'shop-floor-reminders':
      return sendHourlyShopFloorTaskReminders(to);
    case 'weekly-shop-floor-report':
      return sendWeeklyShopFloorReport(to, !to.length);
    case 'mpesa-review':
      return sendDailyMpesaReviewNotification(to[0] || '');
    case 'mo-overtime':
      return sendMoOvertimeSuggestion(to[0] || '');
    default: {
      if (!to.length) throw new Error(`Custom email "${item.name}" needs at least one recipient.`);
      if (!item.subject.trim() || !item.body.trim()) throw new Error(`Custom email "${item.name}" needs a subject and message.`);
      const settings = await getSettings();
      return sendMailWithConfig(settings.mail, {
        to: to.join(', '),
        subject: item.subject.trim(),
        text: item.body,
        html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${item.body.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] || character)}</div>`,
      });
    }
  }
}

export async function runEmailAutomations() {
  if (running) return;
  running = true;
  try {
    let settings = await getSettings();
    for (const item of settings.mail.automations) {
      if (!isDue(item)) continue;
      try {
        const result = await dispatch(item);
        if (result && typeof result === 'object' && 'skipped' in result && result.skipped) {
          continue;
        }
        settings = await getSettings();
        settings.mail.automations = settings.mail.automations.map((current) =>
          current.id === item.id ? { ...current, lastSentAt: new Date().toISOString() } : current,
        );
        await saveSettings({
          baseUrl: settings.odoo.baseUrl,
          database: settings.odoo.database,
          username: settings.odoo.username,
          apiKey: '',
          keepExistingApiKey: true,
          mail: settings.mail,
        });
        await logEvent('info', 'Email automation completed', { id: item.id, name: item.name, frequency: item.frequency });
      } catch (error) {
        await logEvent('error', 'Email automation failed', {
          id: item.id,
          name: item.name,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      }
    }
  } finally {
    running = false;
  }
}

export function startEmailAutomationInterval() {
  if (timer) return;
  void runEmailAutomations();
  timer = setInterval(() => void runEmailAutomations(), 5 * 60 * 1000);
  timer.unref();
}
