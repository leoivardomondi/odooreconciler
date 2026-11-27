export const SHOP_FLOOR_REPORTING_START_DATE = '2026-07-25';

const BOARD_LOG_EXCLUDED_EMAILS = new Set([
  'janetamollo01@gmail.com',
]);

export function isExcludedFromBoardLogs(
  input: { name?: string | null; email?: string | null } | string | null | undefined,
): boolean {
  if (!input) return false;
  const rawName = typeof input === 'string' ? input : String(input.name || '');
  const rawEmail = typeof input === 'string' ? input : String(input.email || '');
  const normEmail = rawEmail.trim().toLowerCase();
  if (normEmail && (BOARD_LOG_EXCLUDED_EMAILS.has(normEmail) || normEmail.startsWith('janetamollo'))) {
    return true;
  }
  const normName = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normName) return false;
  return (
    normName === 'janet awino amollo'
    || normName === 'janet amollo'
    || (normName.includes('janet') && normName.includes('amollo'))
  );
}

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
