"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nairobiNow = nairobiNow;
exports.isDue = isDue;
exports.runEmailAutomations = runEmailAutomations;
exports.startEmailAutomationInterval = startEmailAutomationInterval;
const repositories_1 = require("../models/repositories");
const logService_1 = require("./logService");
const mailTransport_1 = require("./mailTransport");
const mpesaReviewNotificationService_1 = require("./mpesaReviewNotificationService");
const moOvertimeSuggestionService_1 = require("./moOvertimeSuggestionService");
const shopFloorTaskReminderService_1 = require("./shopFloorTaskReminderService");
const weeklyShopFloorReportService_1 = require("./weeklyShopFloorReportService");
let timer = null;
let running = false;
let lastSentWeeklyReportDateKey = '';
function recipients(value) {
    return [...new Set(value.split(/[,\n;]/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
}
function nairobiNow(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return {
        dateKey: `${get('year')}-${get('month')}-${get('day')}`,
        hour: Number(get('hour')),
        minute: Number(get('minute')),
        dayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    };
}
function isDue(item, now = new Date()) {
    if (!item.enabled)
        return false;
    const local = nairobiNow(now);
    // EXCLUSIVITY RULE: On Wednesday at 7:00 AM Nairobi time, ONLY the weekly-shop-floor-report
    // is permitted to dispatch. All other emails (hourly reminders, daily notifications, custom emails)
    // are strictly suppressed at that exact time to avoid duplications.
    if (local.dayOfWeek === 3 && local.hour === 7 && item.systemKey !== 'weekly-shop-floor-report') {
        return false;
    }
    // GENERAL 7:00 AM GUARD: 7:00 AM is reserved exclusively for the Wednesday Shop Floor Report.
    // No other email automation is allowed to fire at 7:00 AM on any day.
    if (local.hour === 7 && item.systemKey !== 'weekly-shop-floor-report') {
        return false;
    }
    // DEDUPLICATION RULE FOR WEEKLY REPORT:
    // Strictly prevent sending more than once on Wednesday at 7:00 AM.
    if (item.systemKey === 'weekly-shop-floor-report') {
        if (local.dayOfWeek !== 3 || local.hour !== 7)
            return false;
        const lastKey = item.lastSentAt ? nairobiNow(new Date(item.lastSentAt)).dateKey : '';
        if (lastKey === local.dateKey || lastSentWeeklyReportDateKey === local.dateKey) {
            return false;
        }
        return true;
    }
    const last = item.lastSentAt ? new Date(item.lastSentAt) : null;
    const elapsedHours = last && Number.isFinite(last.getTime()) ? (now.getTime() - last.getTime()) / 3_600_000 : Infinity;
    if (item.frequency === 'hourly') {
        // Hourly reminders only run during operator shift hours (8:00 AM to 5:00 PM), never before 8:00 AM or on Sunday
        if (local.hour < 8 || local.hour > 17 || local.dayOfWeek === 0) {
            return false;
        }
        return elapsedHours >= Math.max(1, item.interval);
    }
    if (item.systemKey === 'mo-overtime') {
        return local.hour === 16 && local.minute >= 50 && local.minute < 60 && elapsedHours >= 23;
    }
    // Daily/weekly automations are intended to run during their configured
    // Nairobi hour. Do not send a missed run hours later when the next polling
    // cycle happens; that is what caused the overtime email to arrive late.
    if (local.hour !== item.hour)
        return false;
    if (item.frequency === 'daily')
        return elapsedHours >= 23 * Math.max(1, item.interval);
    return local.dayOfWeek === item.dayOfWeek && elapsedHours >= 24 * 6.5 * Math.max(1, item.interval);
}
async function dispatch(item) {
    const to = recipients(item.recipients);
    switch (item.systemKey) {
        case 'shop-floor-reminders':
            return (0, shopFloorTaskReminderService_1.sendHourlyShopFloorTaskReminders)(to);
        case 'weekly-shop-floor-report':
            return (0, weeklyShopFloorReportService_1.sendWeeklyShopFloorReport)(to, !to.length);
        case 'mpesa-review':
            return (0, mpesaReviewNotificationService_1.sendDailyMpesaReviewNotification)(to[0] || '');
        case 'mo-overtime':
            return (0, moOvertimeSuggestionService_1.sendMoOvertimeSuggestion)(to[0] || '');
        default: {
            if (!to.length)
                throw new Error(`Custom email "${item.name}" needs at least one recipient.`);
            if (!item.subject.trim() || !item.body.trim())
                throw new Error(`Custom email "${item.name}" needs a subject and message.`);
            const settings = await (0, repositories_1.getSettings)();
            return (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
                to: to.join(', '),
                subject: item.subject.trim(),
                text: item.body,
                html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${item.body.replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] || character)}</div>`,
            });
        }
    }
}
async function runEmailAutomations(now = new Date()) {
    if (running)
        return;
    running = true;
    try {
        let settings = await (0, repositories_1.getSettings)();
        const local = nairobiNow(now);
        const isWednesdayReportHour = local.dayOfWeek === 3 && local.hour === 7;
        for (const item of settings.mail.automations) {
            // Exclusivity rule: At 7:00 AM on Wednesday, ONLY the weekly-shop-floor-report
            // is permitted to dispatch. All other emails are suppressed at that exact time to avoid duplications.
            if (isWednesdayReportHour && item.systemKey !== 'weekly-shop-floor-report') {
                continue;
            }
            if (!isDue(item, now))
                continue;
            try {
                if (item.systemKey === 'weekly-shop-floor-report') {
                    lastSentWeeklyReportDateKey = local.dateKey;
                }
                const result = await dispatch(item);
                if (result && typeof result === 'object' && 'skipped' in result && result.skipped) {
                    continue;
                }
                settings = await (0, repositories_1.getSettings)();
                settings.mail.automations = settings.mail.automations.map((current) => current.id === item.id ? { ...current, lastSentAt: new Date().toISOString() } : current);
                await (0, repositories_1.saveSettings)({
                    baseUrl: settings.odoo.baseUrl,
                    database: settings.odoo.database,
                    username: settings.odoo.username,
                    apiKey: '',
                    keepExistingApiKey: true,
                    mail: settings.mail,
                });
                await (0, logService_1.logEvent)('info', 'Email automation completed', { id: item.id, name: item.name, frequency: item.frequency });
            }
            catch (error) {
                await (0, logService_1.logEvent)('error', 'Email automation failed', {
                    id: item.id,
                    name: item.name,
                    error: error instanceof Error ? error.message : String(error),
                }).catch(() => undefined);
            }
        }
    }
    finally {
        running = false;
    }
}
function startEmailAutomationInterval() {
    if (timer)
        return;
    void runEmailAutomations();
    timer = setInterval(() => void runEmailAutomations(), 5 * 60 * 1000);
    timer.unref();
}
