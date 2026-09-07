import {
  CustomerPartnerMirrorEntry,
  getCustomerPartnerMirror,
  getCustomerPartnerMirrorCount,
  getCustomerPartnerMirrorLastSyncedAt,
  getSettings,
  searchCustomerPartnerMirror,
  upsertCustomerPartnerMirror,
} from '../models/repositories';
import { env } from '../utils/env';
import { hasOdooConfiguration } from '../utils/helpers';
import { appDateTime } from '../utils/dateTime';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';

const FRESH_MS = 15 * 60 * 1000; // 15 minutes fresh
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
let refreshPromise: Promise<CustomerPartnerMirrorEntry[]> | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + '+03:00';
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOperatingTime(): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: env.APP_TIMEZONE || 'Africa/Nairobi',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  if (weekday === 'Sun') return false;
  return weekday === 'Sat' ? hour >= 8 && hour < 15 : hour >= 7 && hour < 19;
}

/**
 * Sync active customer partners from Odoo into the MySQL mirror table.
 */
export async function refreshCustomerMirror(): Promise<CustomerPartnerMirrorEntry[]> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const settings = await getSettings();
      if (!hasOdooConfiguration(settings)) {
        return getCustomerPartnerMirror();
      }

      const client = new OdooClient(settings.odoo);
      // Fetch all active partners from Odoo (broad domain covering clients/customers)
      const rawPartners = await client.searchReadRecords<{
        id: number;
        name: string;
        email?: string | false | null;
        phone?: string | false | null;
        ref?: string | false | null;
        active?: boolean | null;
      }>('res.partner', {
        domain: [['active', '=', true]],
        fields: ['id', 'name', 'email', 'phone', 'ref', 'active'],
        limit: 10000,
        order: 'name asc',
      });

      const syncedAt = appDateTime();
      const entries = rawPartners
        .filter((p) => p && p.id && String(p.name || '').trim())
        .map((p) => ({
          partnerId: p.id,
          name: String(p.name || '').trim(),
          email: p.email && typeof p.email === 'string' ? p.email.trim() : null,
          phone: p.phone && typeof p.phone === 'string' ? p.phone.trim() : null,
          ref: p.ref && typeof p.ref === 'string' ? p.ref.trim() : null,
          active: p.active !== false,
          syncedAt,
        }));

      await upsertCustomerPartnerMirror(entries);
      await logEvent('info', 'Customer mirror synced from Odoo', {
        count: entries.length,
      }).catch(() => undefined);

      return getCustomerPartnerMirror();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[customerMirror] Refresh failed:', message);
      await logEvent('error', 'Customer mirror refresh failed', { error: message }).catch(() => undefined);
      return getCustomerPartnerMirror();
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Fast search directly from MySQL table (<5ms).
 * If the local MySQL table is empty on first boot, triggers a background refresh
 * and falls back to Odoo once.
 */
export async function searchCustomers(searchTerm: string, limit = 40): Promise<Array<{
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  ref?: string | null;
}>> {
  const count = await getCustomerPartnerMirrorCount();
  const lastSynced = await getCustomerPartnerMirrorLastSyncedAt();
  const ageMs = Date.now() - timestampMs(lastSynced);

  // If table is completely empty or older than 15 mins, trigger background sync
  if (count === 0 || ageMs > FRESH_MS) {
    void refreshCustomerMirror().catch((err) => {
      console.warn('[customerMirror] Background refresh error:', err);
    });
  }

  // If table has entries in MySQL, search MySQL directly
  if (count > 0) {
    const rows = await searchCustomerPartnerMirror(searchTerm, limit);
    return rows.map((r) => ({
      id: r.partnerId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      ref: r.ref,
    }));
  }

  // Cold-boot fallback: if MySQL has not been populated yet, fetch from Odoo while background sync runs
  try {
    const settings = await getSettings();
    if (hasOdooConfiguration(settings)) {
      const client = new OdooClient(settings.odoo);
      return await client.searchPartners(searchTerm, limit);
    }
  } catch (err) {
    console.warn('[customerMirror] Cold-boot fallback to Odoo failed:', err);
  }

  return [];
}

/**
 * Get customers for initial page rendering (e.g. top active clients).
 */
export async function getCustomersForPage(limit = 100): Promise<Array<{ id: number; name: string }>> {
  const count = await getCustomerPartnerMirrorCount();
  if (count === 0) {
    void refreshCustomerMirror().catch(() => undefined);
    return [];
  }
  const rows = await getCustomerPartnerMirror(limit);
  return rows.map((r) => ({ id: r.partnerId, name: r.name }));
}

/**
 * Start recurring background customer mirror interval.
 */
export function startCustomerMirrorInterval() {
  if (intervalHandle) return;
  // Trigger initial prime
  void refreshCustomerMirror().catch((err) => {
    console.warn('[customerMirror] Initial sync failed:', err);
  });
  intervalHandle = setInterval(() => {
    if (isOperatingTime()) {
      void refreshCustomerMirror().catch(() => undefined);
    }
  }, REFRESH_INTERVAL_MS);
  intervalHandle.unref();
}
