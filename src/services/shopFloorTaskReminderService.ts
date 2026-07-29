import { getApprovedAuthUsers, getBoardIntakeLoggingReport, getSettings, hasMpesaStatementUploadedSince } from '../models/repositories';
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

function nairobiScheduleParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    hour: Number(get('hour')),
  };
}

function nairobiHour() {
  return nairobiScheduleParts().hour;
}

function isOperatorReminderHour() {
  const { weekday, hour } = nairobiScheduleParts();
  if (weekday === 'Sun') return false;
  if (weekday === 'Sat') return hour >= 8 && hour <= 15;
  return hour >= 8 && hour <= 17;
}

function previousWorkingDate() {
  const { date, weekday } = nairobiScheduleParts();
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - (weekday === 'Mon' ? 2 : 1));
  return value.toISOString().slice(0, 10);
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

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] || character);
}

async function getOperatorMorningSummary(user: AuthApprovedUser) {
  const settings = await getSettings();
  if (!hasOdooConfiguration(settings)) return null;
  const client = new OdooClient(settings.odoo);
  const employee = await client.findEmployeeByUserEmail(user.email)
    || await client.findEmployeeByWorkEmail(user.email);
  if (!employee) return null;

  const reportDate = previousWorkingDate();
  const [boardLogging, attendance] = await Promise.all([
    getBoardIntakeLoggingReport(reportDate, reportDate, settings.mail.shopFloorReportingStartDate),
    client.getBulkAttendance([employee.id], reportDate).catch(() => []),
  ]);
  const own = boardLogging.find((entry) => entry.email === user.email.toLowerCase())
    || boardLogging.find((entry) => entry.name.toLowerCase() === String(employee.name || '').toLowerCase());
  const teamBoards = boardLogging.reduce((total, entry) => total + entry.boards, 0);
  const activeOperators = boardLogging.filter((entry) => entry.boards > 0).length;
  const teamAverage = activeOperators ? teamBoards / activeOperators : 0;
  const boards = own?.boards || 0;
  const share = teamBoards ? Math.round((boards / teamBoards) * 100) : 0;
  const attendanceRecord = attendance[0];
  const attendanceStatus = attendanceRecord
    ? attendanceRecord.check_out ? 'Present — check-in and checkout recorded' : 'Present — checkout missing'
    : 'Absent — no attendance record';
  const boardAssessment = boards === 0
    ? 'No board intake was recorded under your account.'
    : boards >= teamAverage
      ? 'Your recorded board contribution was at or above the active-operator average.'
      : 'Your recorded board contribution was below the active-operator average.';

  return {
    reportDate,
    operatorName: employee.name || user.email,
    boards,
    records: own?.records || 0,
    synced: own?.synced || 0,
    failed: own?.failed || 0,
    pending: own?.pending || 0,
    teamBoards,
    share,
    attendanceStatus,
    boardAssessment,
  };
}

function morningSummaryHtml(summary: NonNullable<Awaited<ReturnType<typeof getOperatorMorningSummary>>>, tasks: ShopFloorDueTask[]) {
  const baseUrl = String(env.APP_BASE_URL || '').replace(/\/$/, '');
  const taskItems = tasks.length
    ? `<h3>Tasks requiring attention</h3><ul>${tasks.map((task) => `<li style="margin-bottom:10px"><strong>${escapeHtml(task.title)}</strong><br>${escapeHtml(task.detail)}<br><a href="${baseUrl}${task.url}">Open task</a></li>`).join('')}</ul>`
    : '<p><strong>Tasks requiring attention:</strong> None currently.</p>';
  return `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;color:#1e293b">
    <h2>Your ${escapeHtml(summary.reportDate)} performance summary</h2>
    <p>Hello ${escapeHtml(summary.operatorName)}, here is your previous working day summary.</p>
    <table style="border-collapse:collapse;width:100%;margin:18px 0">
      <tr><td style="padding:9px;border:1px solid #dbe2ea"><strong>Boards you recorded</strong></td><td style="padding:9px;border:1px solid #dbe2ea">${summary.boards}</td></tr>
      <tr><td style="padding:9px;border:1px solid #dbe2ea"><strong>Board entries</strong></td><td style="padding:9px;border:1px solid #dbe2ea">${summary.records}</td></tr>
      <tr><td style="padding:9px;border:1px solid #dbe2ea"><strong>Sync results</strong></td><td style="padding:9px;border:1px solid #dbe2ea">${summary.synced} synced, ${summary.failed} failed, ${summary.pending} pending</td></tr>
      <tr><td style="padding:9px;border:1px solid #dbe2ea"><strong>Team boards recorded</strong></td><td style="padding:9px;border:1px solid #dbe2ea">${summary.teamBoards} (${summary.share}% recorded by you)</td></tr>
      <tr><td style="padding:9px;border:1px solid #dbe2ea"><strong>Attendance</strong></td><td style="padding:9px;border:1px solid #dbe2ea">${escapeHtml(summary.attendanceStatus)}</td></tr>
    </table>
    <p><strong>Performance:</strong> ${escapeHtml(summary.boardAssessment)}</p>
    ${taskItems}
  </div>`;
}

let lastCompletedHour = '';

function isExcludedHourlyReminderRecipient(email: string) {
  return isNeverShopFloorReminderRecipient(email) || reminderRecipientType(email) === 'raphael';
}

export async function sendHourlyShopFloorTaskReminders(recipientOverride: string[] = []) {
  if (!isOperatorReminderHour()) {
    return { skipped: true, reason: 'outside_operator_working_hours', sent: 0, usersWithTasks: 0 };
  }
  const hourKey = new Date().toISOString().slice(0, 13);
  if (lastCompletedHour === hourKey) return { skipped: true, sent: 0, usersWithTasks: 0 };
  const settings = await getSettings();
  const approvedShopFloorUsers = (await getApprovedAuthUsers()).filter((user) => user.active && (
    reminderRecipientType(user.email) === 'charles'
    || (user.apps || []).some((app) => app === 'shop-floor' || app === 'shop-floor-admin')
  ));
  const allowedRecipients = new Set(recipientOverride.map((email) => email.trim().toLowerCase()).filter(Boolean));
  const users = approvedShopFloorUsers.filter((user) =>
    !isExcludedHourlyReminderRecipient(user.email)
    && (!allowedRecipients.size || allowedRecipients.has(user.email.toLowerCase())),
  );
  const excluded = approvedShopFloorUsers.filter((user) => isExcludedHourlyReminderRecipient(user.email)).map((user) => user.email);
  let sent = 0;
  let usersWithTasks = 0;
  const isMorningSummary = nairobiHour() === 8;

  for (const user of users) {
    // Final safety gate immediately before task calculation and email delivery.
    if (isExcludedHourlyReminderRecipient(user.email)) continue;
    const tasks = await getShopFloorDueTasksForUser(user, 'email').catch(() => []);
    if (tasks.length) usersWithTasks += 1;
    const summary = isMorningSummary
      ? await getOperatorMorningSummary(user).catch((error) => {
          console.error('[shopFloorReminders] Morning summary failed for', user.email, error);
          return null;
        })
      : null;
    if (!tasks.length && !summary) continue;
    await sendMailWithConfig(settings.mail, {
      to: user.email,
      subject: summary
        ? `${summary.reportDate} performance: ${summary.boards} boards recorded`
        : reminderRecipientType(user.email) === 'charles'
        ? 'M-Pesa statement not yet uploaded'
        : `${tasks.length} shop-floor task${tasks.length === 1 ? '' : 's'} still pending`,
      html: summary ? morningSummaryHtml(summary, tasks) : reminderHtml(user, tasks),
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
