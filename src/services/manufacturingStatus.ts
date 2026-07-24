export interface ManufacturingOrderStatusInfo {
  state?: string | null;
  date_start?: string | null;
  date_finished?: string | null;
  write_date?: string | null;
  create_date?: string | null;
}

export function normalizeManufacturingState(state: string | null | undefined) {
  return String(state || '').trim().toLowerCase();
}

export function isManufacturingOrderReady(state: string | null | undefined): boolean {
  return ['progress', 'in_progress', 'done'].includes(normalizeManufacturingState(state));
}

function parseOdooDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function getManufacturingReadyAt(order: ManufacturingOrderStatusInfo): Date | null {
  if (!isManufacturingOrderReady(order.state)) {
    return null;
  }

  return (
    parseOdooDate(order.date_start) ||
    parseOdooDate(order.date_finished) ||
    parseOdooDate(order.write_date) ||
    parseOdooDate(order.create_date)
  );
}
