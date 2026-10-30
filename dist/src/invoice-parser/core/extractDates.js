"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDateNear = extractDateNear;
exports.extractIsoDateFromFilename = extractIsoDateFromFilename;
const MONTH_NAMES = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    january: '01', february: '02', march: '03', april: '04', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};
function parseMonth(monthStr) {
    if (/^\d{1,2}$/.test(monthStr)) {
        const num = Number(monthStr);
        return num >= 1 && num <= 12 ? monthStr.padStart(2, '0') : null;
    }
    const clean = monthStr.toLowerCase().slice(0, 3);
    return MONTH_NAMES[clean] || null;
}
function isPlausibleDate(day, month, year) {
    if (year < 2020 || year > 2035 || month < 1 || month > 12 || day < 1 || day > 31) {
        return false;
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function toIsoDate(day, month, year) {
    const fullYear = year.length === 2 ? `20${year}` : year;
    const dayNumber = Number(day);
    const monthString = parseMonth(month);
    if (!monthString) {
        return null;
    }
    const monthNumber = Number(monthString);
    const yearNumber = Number(fullYear);
    if (!isPlausibleDate(dayNumber, monthNumber, yearNumber)) {
        return null;
    }
    return `${fullYear}-${monthString}-${day.padStart(2, '0')}`;
}
function extractDateNear(text, labels) {
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = text.matchAll(new RegExp(`${escaped}\\s*:?\\s*(\\d{1,2})[/-]([A-Za-z]{3,9}|\\d{1,2})[/-](\\d{2,4})`, 'gi'));
        for (const match of matches) {
            const value = toIsoDate(match[1], match[2], match[3]);
            if (value) {
                return value;
            }
        }
    }
    // Generic alphanumeric dates e.g. 26-Oct-2026
    const alphaMatches = text.matchAll(/\b(\d{1,2})[/-]([A-Za-z]{3,9})[/-](\d{2,4})\b/g);
    for (const match of alphaMatches) {
        const value = toIsoDate(match[1], match[2], match[3]);
        if (value) {
            return value;
        }
    }
    // Generic spaced dates e.g. 26 Oct 2026
    const spaceMatches = text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})\b/g);
    for (const match of spaceMatches) {
        const value = toIsoDate(match[1], match[2], match[3]);
        if (value) {
            return value;
        }
    }
    const generic = text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/g);
    for (const match of generic) {
        const value = toIsoDate(match[1], match[2], match[3]);
        if (value) {
            return value;
        }
    }
    return null;
}
function extractIsoDateFromFilename(filename) {
    if (!filename) {
        return null;
    }
    const iso = filename.match(/(?:^|[^0-9])(20\d{2})-(\d{2})-(\d{2})(?:[^0-9]|$)/);
    if (iso) {
        return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }
    const compact = filename.match(/(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/);
    return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : null;
}
