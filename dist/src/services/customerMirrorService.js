"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshCustomerMirror = refreshCustomerMirror;
exports.searchCustomers = searchCustomers;
exports.getCustomersForPage = getCustomersForPage;
exports.startCustomerMirrorInterval = startCustomerMirrorInterval;
const repositories_1 = require("../models/repositories");
const env_1 = require("../utils/env");
const helpers_1 = require("../utils/helpers");
const dateTime_1 = require("../utils/dateTime");
const logService_1 = require("./logService");
const odooClient_1 = require("./odooClient");
const FRESH_MS = 15 * 60 * 1000; // 15 minutes fresh
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
let refreshPromise = null;
let intervalHandle = null;
function timestampMs(value) {
    if (!value)
        return 0;
    const normalized = value.includes('T') ? value : value.replace(' ', 'T') + '+03:00';
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}
function isOperatingTime() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date());
    const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    if (weekday === 'Sun')
        return false;
    return weekday === 'Sat' ? hour >= 8 && hour < 15 : hour >= 7 && hour < 19;
}
/**
 * Sync active customer partners from Odoo into the MySQL mirror table.
 */
async function refreshCustomerMirror() {
    if (refreshPromise)
        return refreshPromise;
    refreshPromise = (async () => {
        try {
            const settings = await (0, repositories_1.getSettings)();
            if (!(0, helpers_1.hasOdooConfiguration)(settings)) {
                return (0, repositories_1.getCustomerPartnerMirror)();
            }
            const client = new odooClient_1.OdooClient(settings.odoo);
            // Fetch all active partners from Odoo (broad domain covering clients/customers)
            const rawPartners = await client.searchReadRecords('res.partner', {
                domain: [['active', '=', true]],
                fields: ['id', 'name', 'email', 'phone', 'ref', 'active'],
                limit: 10000,
                order: 'name asc',
            });
            const syncedAt = (0, dateTime_1.appDateTime)();
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
            await (0, repositories_1.upsertCustomerPartnerMirror)(entries);
            await (0, logService_1.logEvent)('info', 'Customer mirror synced from Odoo', {
                count: entries.length,
            }).catch(() => undefined);
            return (0, repositories_1.getCustomerPartnerMirror)();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error('[customerMirror] Refresh failed:', message);
            await (0, logService_1.logEvent)('error', 'Customer mirror refresh failed', { error: message }).catch(() => undefined);
            return (0, repositories_1.getCustomerPartnerMirror)();
        }
        finally {
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
async function searchCustomers(searchTerm, limit = 40) {
    const count = await (0, repositories_1.getCustomerPartnerMirrorCount)();
    const lastSynced = await (0, repositories_1.getCustomerPartnerMirrorLastSyncedAt)();
    const ageMs = Date.now() - timestampMs(lastSynced);
    // If table is completely empty or older than 15 mins, trigger background sync
    if (count === 0 || ageMs > FRESH_MS) {
        void refreshCustomerMirror().catch((err) => {
            console.warn('[customerMirror] Background refresh error:', err);
        });
    }
    // If table has entries in MySQL, search MySQL directly
    if (count > 0) {
        const rows = await (0, repositories_1.searchCustomerPartnerMirror)(searchTerm, limit);
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
        const settings = await (0, repositories_1.getSettings)();
        if ((0, helpers_1.hasOdooConfiguration)(settings)) {
            const client = new odooClient_1.OdooClient(settings.odoo);
            return await client.searchPartners(searchTerm, limit);
        }
    }
    catch (err) {
        console.warn('[customerMirror] Cold-boot fallback to Odoo failed:', err);
    }
    return [];
}
/**
 * Get customers for initial page rendering (e.g. top active clients).
 */
async function getCustomersForPage(limit = 100) {
    const count = await (0, repositories_1.getCustomerPartnerMirrorCount)();
    if (count === 0) {
        void refreshCustomerMirror().catch(() => undefined);
        return [];
    }
    const rows = await (0, repositories_1.getCustomerPartnerMirror)(limit);
    return rows.map((r) => ({ id: r.partnerId, name: r.name }));
}
/**
 * Start recurring background customer mirror interval.
 */
function startCustomerMirrorInterval() {
    if (intervalHandle)
        return;
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
