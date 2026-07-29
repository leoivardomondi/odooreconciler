"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDateNear = extractDateNear;
exports.extractIsoDateFromFilename = extractIsoDateFromFilename;
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
    const monthNumber = Number(month);
    const yearNumber = Number(fullYear);
    if (!isPlausibleDate(dayNumber, monthNumber, yearNumber)) {
        return null;
    }
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
function extractDateNear(text, labels) {
    for (const label of labels) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = text.matchAll(new RegExp(`${escaped}\\s*:?\\s*(\\d{1,2})[/-](\\d{1,2})[/-](\\d{2,4})`, 'gi'));
        for (const match of matches) {
            const value = toIsoDate(match[1], match[2], match[3]);
            if (value) {
                return value;
            }
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
