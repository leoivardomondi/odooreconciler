export function normalizeIpAddress(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
}

export function isAllowedAttendanceIp(ipAddress: string | null | undefined, allowedIps: string) {
  const ip = normalizeIpAddress(ipAddress);
  return allowedIps
    .split(',')
    .map(normalizeIpAddress)
    .filter(Boolean)
    .includes(ip);
}
