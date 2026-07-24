import { getApprovedAuthUsers, getSettings, hasMpesaStatementUploadedSince } from '../models/repositories';
import { AuthApprovedUser, AuthSessionUser } from '../models/types';
import { env } from '../utils/env';
import { hasOdooConfiguration } from '../utils/helpers';
import { sendMailWithConfig } from './mailTransport';
import { OdooClient } from './odooClient';
import { getPwaBadgeBreakdown } from './pwaBadgeService';
import { logEvent } from './logService';

export interface ShopFloorDueTask {
  id: string;
  title: string;
  detail: string;
  url: string;
}

const NEVER_SHOP_FLOOR_REMINDER_EMAILS = new Set([
  'raphael@urbanvibeinteriordesign.co.ke',
]);

function isNeverShopFloorReminderRecipient(email: string) {
  return NEVER_SHOP_FLOOR_REMINDER_EMAILS.has(String(email || '').trim().toLowerCase());
}

function nairobiHour() {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', hour: '2-digit', hour12: false,
  }).format(new Date()));
}

function reminderRecipientType(email: string): 'charles' | 'raphael' | 'standard' {
  const localPart = String(email || '').trim().toLowerCase().split('@')[0] || '';
  if (localPart.includes('charles')) return 'charles';
  if (localPart.includes('raphael')) return 'raphael';
  return 'standard';
}

function isNairobiWeekdayMorning() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || '0');
  return !['Sat', 'Sun'].includes(weekday) && hour >= 7 && hour < 12;
}

function nairobiDayStart() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} 00:00:00`;
}

export async function getShopFloorDueTasksForUser(user: AuthSessionUser, channel: 'app' | 'email' = 'app'): Promise<ShopFloorDueTask[]> {
  if (isNeverShopFloorReminderRecipient(user.email)) {
    if (reminderRecipientType(user.email) === 'charles') {
      return isNairobiWeekdayMorning()
        ? [{ id: 'upload-mpesa-statement', title: 'Upload M-Pesa statement', detail: 'Please upload today\'s M-Pesa statement.', url: '/mpesa-reconciliation' }]
        : [];
    }
    return [];
  }
  const recipientType = reminderRecipientType(user.email);
  if (recipientType === 'raphael') return [];
  if (recipientType === 'charles') {
    if (channel !== 'email' || !isNairobiWeekdayMorning()) return [];
    const uploadedToday = await hasMpesaStatementUploadedSince(nairobiDayStart());
    return uploadedToday ? [] : [{
      id: 'upload-mpesa-statement',
      title: 'M-Pesa statement not yet uploaded',
      detail: 'Today\'s M-Pesa statement has not yet been uploaded. Please upload it in M-Pesa Reconciliation.',
      url: '/mpesa-reconciliation',
    }];
  }
  if (!(user.apps || []).some((app) => app === 'shop-floor' || app === 'shop-floor-admin')) return [];
  const settings = await getSettings();
  if (!hasOdooConfiguration(settings)) return [];
  const client = new OdooClient(settings.odoo);
  const tasks: ShopFloorDueTask[] = [];
  const hour = nairobiHour();
  const employee = await client.findEmployeeByUserEmail(user.email)
    || await client.findEmployeeByWorkEmail(user.email);

  if (employee && hour >= 8 && hour <= 19) {
    const attendance = await client.getTodayAttendance(employee.id).catch(() => null);
    if (attendance && !attendance.todayRecord && hour >= 9) {
      tasks.push({ id: 'attendance-check-in', title: 'Check in is missing', detail: 'You have not checked in today.', url: '/shop-floor?refresh=true' });
    } else if (attendance?.checkedIn && hour >= 17) {
      tasks.push({ id: 'attendance-check-out', title: 'Check out is pending', detail: 'You checked in but have not checked out.', url: '/shop-floor?refresh=true' });
    }
  }

  const badge = await getPwaBadgeBreakdown(user).catch(() => null);
  if ((badge?.shopFloorCount || 0) > 0) {
    tasks.push({
      id: 'incoming-boards',
      title: 'Incoming boards need recording',
      detail: `${badge!.shopFloorCount} expected board item(s) still need to be counted and recorded.`,
      url: '/shop-floor/boards',
    });
  }

  if (user.role === 'admin' || (user.apps || []).includes('shop-floor-admin')) {
    const penalties = await client.getTeamPenalties(settings.stock).catch(() => null);
    if ((penalties?.undoneReceipts || 0) > 0) {
      tasks.push({ id: 'validate-receipts', title: 'Receipts need validation', detail: `${penalties!.undoneReceipts} incoming receipt(s) are still open.`, url: '/purchase-orders' });
    }
    if ((penalties?.unmarkedDeliveries || 0) > 0) {
      tasks.push({ id: 'unmarked-deliveries', title: 'Outgoing deliveries need validation', detail: `${penalties!.unmarkedDeliveries} delivery order(s) going out to clients are still open.`, url: '/shop-floor/deliveries' });
    }
  }

  return tasks;
}

function reminderHtml(user: AuthApprovedUser, tasks: ShopFloorDueTask[]) {
  const baseUrl = String(env.APP_BASE_URL || '').replace(/\/$/, '');
  const items = tasks.map((task) => `<li style="margin-bottom:12px"><strong>${task.title}</strong><br>${task.detail}<br><a href="${baseUrl}${task.url}">Open task</a></li>`).join('');
  const heading = reminderRecipientType(user.email) === 'charles' ? 'M-Pesa upload reminder' : 'Hourly shop-floor task reminder';
  return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto"><h2>${heading}</h2><p>Hello ${user.email}, these tasks are still pending:</p><ul>${items}</ul><p>This reminder stops automatically when the tasks are completed.</p></div>`;
}

let lastCompletedHour = '';

function isExcludedHourlyReminderRecipient(email: string) {
  return isNeverShopFloorReminderRecipient(email) || reminderRecipientType(email) === 'raphael';
}

export async function sendHourlyShopFloorTaskReminders() {
  const hourKey = new Date().toISOString().slice(0, 13);
  if (lastCompletedHour === hourKey) return { skipped: true, sent: 0, usersWithTasks: 0 };
  const settings = await getSettings();
  const approvedShopFloorUsers = (await getApprovedAuthUsers()).filter((user) => user.active && (
    reminderRecipientType(user.email) === 'charles'
    || (user.apps || []).some((app) => app === 'shop-floor' || app === 'shop-floor-admin')
  ));
  const users = approvedShopFloorUsers.filter((user) => !isExcludedHourlyReminderRecipient(user.email));
  const excluded = approvedShopFloorUsers.filter((user) => isExcludedHourlyReminderRecipient(user.email)).map((user) => user.email);
  let sent = 0;
  let usersWithTasks = 0;

  for (const user of users) {
    // Final safety gate immediately before task calculation and email delivery.
    if (isExcludedHourlyReminderRecipient(user.email)) continue;
    const tasks = await getShopFloorDueTasksForUser(user, 'email').catch(() => []);
    if (!tasks.length) continue;
    usersWithTasks += 1;
    await sendMailWithConfig(settings.mail, {
      to: user.email,
      subject: reminderRecipientType(user.email) === 'charles'
        ? 'M-Pesa statement not yet uploaded'
        : `${tasks.length} shop-floor task${tasks.length === 1 ? '' : 's'} still pending`,
      html: reminderHtml(user, tasks),
    });
    sent += 1;
  }

  lastCompletedHour = hourKey;
  await logEvent('info', 'Hourly shop-floor task reminders completed', { sent, usersWithTasks, approvedUsers: users.length, excluded });
  return { skipped: false, sent, usersWithTasks };
}

let reminderInterval: NodeJS.Timeout | null = null;
export function startShopFloorTaskReminderInterval() {
  if (reminderInterval) return;
  reminderInterval = setInterval(() => {
    void sendHourlyShopFloorTaskReminders().catch((error) => console.error('[shopFloorReminders]', error));
  }, 60 * 60 * 1000);
  reminderInterval.unref();
}
