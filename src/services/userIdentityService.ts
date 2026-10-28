import { AppSettings } from '../models/types';
import { getAppUserProfile, saveAppUserProfile } from '../models/repositories';
import { OdooClient } from './odooClient';

const failureCache = new Map<string, number>();

export const KNOWN_OPERATOR_NAMES: Record<string, string> = {
  'joelochango22@gmail.com': 'Joel Ochango',
  'joelochango22': 'Joel Ochango',
  'joelochango': 'Joel Ochango',
  'onyangoakulo@gmail.com': 'Onyango Bitcher Akulo',
  'onyangoakulo': 'Onyango Bitcher Akulo',
  'masteredthomas@gmail.com': 'Thomas Ollinga',
  'masteredthomas': 'Thomas Ollinga',
  'okothmike578@gmail.com': 'Michael Ochieng Okoth',
  'okothmike578': 'Michael Ochieng Okoth',
  'okothmike': 'Michael Ochieng Okoth',
  'janetamollo01@gmail.com': 'Janet Amollo',
  'janetamollo01': 'Janet Amollo',
  'janetamollo': 'Janet Amollo',
  'dbadmin@urbanvibeinteriordesign.co.ke': 'Leoivard Ongule',
  'dbadmin': 'Leoivard Ongule',
  'operator@urbanvibeinteriordesign.co.ke': 'Operator',
};

export function emailDisplayName(email: string) {
  const normalized = String(email || '').trim().toLowerCase();
  const local = normalized.split('@')[0];
  if (KNOWN_OPERATOR_NAMES[normalized]) return KNOWN_OPERATOR_NAMES[normalized];
  if (KNOWN_OPERATOR_NAMES[local]) return KNOWN_OPERATOR_NAMES[local];

  const cleaned = local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
  const separated = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
  return separated.split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ') || email;
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
