"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAppDateTime = formatAppDateTime;
exports.appDateTimeFromNow = appDateTimeFromNow;
exports.appDateTime = appDateTime;
const env_1 = require("./env");
function formatAppDateTime(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        hourCycle: 'h23',
    }).formatToParts(date);
    const value = (type) => parts.find((part) => part.type === type)?.value || '00';
    return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}:${value('second')}`;
}
function appDateTimeFromNow(offsetMs) {
    return formatAppDateTime(new Date(Date.now() + offsetMs));
}
function appDateTime() {
    return formatAppDateTime(new Date());
}
