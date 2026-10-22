export function isAccountDeactivated(active: unknown, isConfiguredLocalAdmin = false): boolean {
  if (isConfiguredLocalAdmin) return false;
  if (active === false || active === 0 || active === '0') return true;
  if (typeof active === 'string' && active.trim().toLowerCase() === 'false') return true;
  return false;
}
