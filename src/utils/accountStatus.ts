export function isAccountDeactivated(active: boolean | null | undefined, isConfiguredLocalAdmin = false): boolean {
  return active === false && !isConfiguredLocalAdmin;
}
