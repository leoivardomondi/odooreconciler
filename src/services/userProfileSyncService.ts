import { getApprovedAuthUsers, getSettings, saveAppUserProfile } from '../models/repositories';
import { hasOdooConfiguration } from '../utils/helpers';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';

let syncPromise: Promise<{ matched: number; unmatched: number; failed: number }> | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

export async function syncApprovedUserProfilesFromOdoo() {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const settings = await getSettings();
    if (!hasOdooConfiguration(settings)) throw new Error('Odoo is not configured.');
    const users = (await getApprovedAuthUsers()).filter((user) => user.active);
    const client = new OdooClient(settings.odoo);
    let matched = 0; let unmatched = 0; let failed = 0;

    for (const user of users) {
      try {
        const employee = await client.findEmployeeByUserEmail(user.email)
          || await client.findEmployeeByWorkEmail(user.email);
        if (!employee?.name) { unmatched += 1; continue; }
        await saveAppUserProfile({ email: user.email, displayName: employee.name, odooEmployeeId: employee.id });
        matched += 1;
      } catch (_error) {
        failed += 1;
      }
    }
    await logEvent('info', 'Approved user names synchronized from Odoo', { matched, unmatched, failed, total: users.length }).catch(() => undefined);
    return { matched, unmatched, failed };
  })().finally(() => { syncPromise = null; });
  return syncPromise;
}

export function startUserProfileSyncInterval() {
  if (intervalHandle) return;
  setTimeout(() => void syncApprovedUserProfilesFromOdoo().catch(() => undefined), 15_000).unref();
  intervalHandle = setInterval(() => void syncApprovedUserProfilesFromOdoo().catch(() => undefined), 24 * 60 * 60 * 1000);
  intervalHandle.unref();
}
