export function normalizeMoney(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const cleaned = value
    .replace(/KES|KSH|KSh|,/g, '')
    .replace(/[^\d.-]/g, '')
    .trim();
  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nearlyEqualMoney(left: number | null, right: number | null, tolerance = 1) {
  if (left === null || right === null) {
    return false;
  }

  return Math.abs(left - right) <= tolerance;
}
