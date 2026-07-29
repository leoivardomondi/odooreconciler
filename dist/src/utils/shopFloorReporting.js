"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHOP_FLOOR_REPORTING_START_DATE = void 0;
exports.normalizeShopFloorReportingStartDate = normalizeShopFloorReportingStartDate;
exports.clampShopFloorReportingDate = clampShopFloorReportingDate;
exports.SHOP_FLOOR_REPORTING_START_DATE = '2026-07-25';
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
