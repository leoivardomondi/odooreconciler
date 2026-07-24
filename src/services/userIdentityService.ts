import { AppSettings } from '../models/types';
import { getAppUserProfile, saveAppUserProfile } from '../models/repositories';
import { OdooClient } from './odooClient';

const failureCache = new Map<string, number>();

export function emailDisplayName(email: string) {
  const local = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
  return local.split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || email;
}

export async function resolveUserDisplayName(settings: AppSettings, email: string, forceRefresh = false) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return '';
  if (!forceRefresh) {
    const localProfile = await getAppUserProfile(key);
    if (localProfile?.displayName) return localProfile.displayName;
  }
  let name = emailDisplayName(key);
  if ((failureCache.get(key) || 0) > Date.now()) return name;
  try {
    const client = new OdooClient(settings.odoo);
    const employee = await client.findEmployeeByUserEmail(key) || await client.findEmployeeByWorkEmail(key);
    if (employee?.name) {
      name = employee.name;
      await saveAppUserProfile({ email: key, displayName: name, odooEmployeeId: employee.id });
    } else {
      await saveAppUserProfile({ email: key, displayName: name });
    }
  } catch {
    failureCache.set(key, Date.now() + 5 * 60 * 1000);
    await saveAppUserProfile({ email: key, displayName: name }).catch(() => undefined);
  }
  return name;
}

export async function resolveLocalUserDisplayName(email: string) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return '';
  const localProfile = await getAppUserProfile(key);
  if (localProfile?.displayName) return localProfile.displayName;
  const name = emailDisplayName(key);
  await saveAppUserProfile({ email: key, displayName: name }).catch(() => undefined);
  return name;
}
