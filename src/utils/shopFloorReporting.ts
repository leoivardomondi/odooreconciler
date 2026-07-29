export const SHOP_FLOOR_REPORTING_START_DATE = '2026-07-25';

export function normalizeShopFloorReportingStartDate(date: string | null | undefined) {
  const normalized = String(date || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? normalized
    : SHOP_FLOOR_REPORTING_START_DATE;
}

export function clampShopFloorReportingDate(
  date: string,
  reportingStartDate = SHOP_FLOOR_REPORTING_START_DATE,
) {
  const normalized = String(date || '').trim().slice(0, 10);
  const baseline = normalizeShopFloorReportingStartDate(reportingStartDate);
  return normalized && normalized > baseline
    ? normalized
    : baseline;
}
