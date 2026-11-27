"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHOP_FLOOR_REPORTING_START_DATE = void 0;
exports.isExcludedFromBoardLogs = isExcludedFromBoardLogs;
exports.normalizeShopFloorReportingStartDate = normalizeShopFloorReportingStartDate;
exports.clampShopFloorReportingDate = clampShopFloorReportingDate;
exports.SHOP_FLOOR_REPORTING_START_DATE = '2026-07-25';
const BOARD_LOG_EXCLUDED_EMAILS = new Set([
    'janetamollo01@gmail.com',
]);
function isExcludedFromBoardLogs(input) {
    if (!input)
        return false;
    const rawName = typeof input === 'string' ? input : String(input.name || '');
    const rawEmail = typeof input === 'string' ? input : String(input.email || '');
    const normEmail = rawEmail.trim().toLowerCase();
    if (normEmail && (BOARD_LOG_EXCLUDED_EMAILS.has(normEmail) || normEmail.startsWith('janetamollo'))) {
        return true;
    }
    const normName = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normName)
        return false;
    return (normName === 'janet awino amollo'
        || normName === 'janet amollo'
        || (normName.includes('janet') && normName.includes('amollo')));
}
function normalizeShopFloorReportingStartDate(date) {
    const normalized = String(date || '').trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
        ? normalized
        : exports.SHOP_FLOOR_REPORTING_START_DATE;
}
function clampShopFloorReportingDate(date, reportingStartDate = exports.SHOP_FLOOR_REPORTING_START_DATE) {
    const normalized = String(date || '').trim().slice(0, 10);
    const baseline = normalizeShopFloorReportingStartDate(reportingStartDate);
    return normalized && normalized > baseline
        ? normalized
        : baseline;
}
