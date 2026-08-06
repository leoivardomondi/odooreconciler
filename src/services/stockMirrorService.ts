import { getSettings, getStockProductMirror, markStockProductMirrorSyncFailed, removeStockProductsNotIn, StockProductMirrorEntry, upsertStockProductMirror } from '../models/repositories';
import { env } from '../utils/env';
import { hasOdooConfiguration } from '../utils/helpers';
import { appDateTime } from '../utils/dateTime';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';

const FRESH_MS = 5 * 60 * 1000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_REFRESH_WAIT_MS = 10 * 1000;
let refreshPromise: Promise<StockProductMirrorEntry[]> | null = null;
let intervalHandle: NodeJS.Timeout | null = null;

function timestampMs(value: string | null) {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + '+03:00';
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOperatingTime() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: env.APP_TIMEZONE || 'Africa/Nairobi', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  if (weekday === 'Sun') return false;
  return weekday === 'Sat' ? hour >= 8 && hour < 14 : hour >= 8 && hour < 17;
}

export function stockMirrorAgeMs(entries: StockProductMirrorEntry[]) {
  return entries.length ? Math.max(0, Date.now() - Math.max(...entries.map((entry) => timestampMs(entry.syncedAt)))) : Number.POSITIVE_INFINITY;
}

export async function refreshStockMirror() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const settings = await getSettings();
      if (!hasOdooConfiguration(settings)) return getStockProductMirror();
      const warehouseId = Number(settings.stock.warehouseId || 0) || undefined;
      const products = await new OdooClient(settings.odoo).getBoardProducts(warehouseId);
      const syncedAt = appDateTime();
      await upsertStockProductMirror(products.map((product) => ({
        productId: product.id, productName: product.name, availableQty: product.qty_available,
        freeQty: product.free_qty, forecastQty: product.virtual_available,
        incomingQty: product.incoming_qty, outgoingQty: product.outgoing_qty,
        warehouseId: warehouseId || null, syncedAt,
        syncStatus: 'current', syncError: null,
      })));
      // Remove records left behind by the former broad name-based product
      // search so they cannot continue appearing in the cached picker.
      await removeStockProductsNotIn(products.map((product) => product.id));
      return getStockProductMirror();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markStockProductMirrorSyncFailed(message).catch(() => undefined);
      await logEvent('error', 'Stock mirror refresh failed', { error: message }).catch(() => undefined);
      return getStockProductMirror();
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function getStockMirrorForPage(forceRefresh = false) {
  let entries = await getStockProductMirror();
  const ageMs = stockMirrorAgeMs(entries);
  if (!entries.length) {
    entries = await refreshStockMirror();
  } else if (forceRefresh) {
    entries = await Promise.race([
      refreshStockMirror(),
      new Promise<StockProductMirrorEntry[]>((resolve) => {
        setTimeout(() => resolve(entries), PAGE_REFRESH_WAIT_MS);
      }),
    ]);
  } else if (ageMs > FRESH_MS) {
    void refreshStockMirror();
  }
  const finalAgeMs = stockMirrorAgeMs(entries);
  return {
    products: entries.map((entry) => ({
      id: entry.productId, name: entry.productName, qty_available: entry.availableQty,
      free_qty: entry.freeQty, virtual_available: entry.forecastQty,
      incoming_qty: entry.incomingQty, outgoing_qty: entry.outgoingQty,
      stock_sync_status: entry.syncStatus,
      stock_availability: entry.freeQty > 0 ? 'available' : entry.incomingQty > 0 ? 'incoming' : 'missing',
    })),
    syncedAt: entries.map((entry) => entry.syncedAt).filter(Boolean).sort().at(-1) || null,
    isFresh: finalAgeMs <= FRESH_MS && entries.every((entry) => entry.syncStatus !== 'failed'),
    isRefreshing: Boolean(refreshPromise),
  };
}

export async function recordExactStockQuantity(productId: number, productName: string, quantity: number, addedQuantity = 0) {
  const existing = (await getStockProductMirror()).find((entry) => entry.productId === productId);
  if (existing) {
    await upsertStockProductMirror([{
      ...existing, productName, availableQty: quantity,
      freeQty: Math.max(0, existing.freeQty + addedQuantity),
      forecastQty: existing.forecastQty + addedQuantity,
      syncedAt: appDateTime(), syncStatus: 'current', syncError: null,
    }]);
    return;
  }
  await upsertStockProductMirror([{
    productId, productName, availableQty: quantity, freeQty: quantity, forecastQty: quantity,
    incomingQty: 0, outgoingQty: 0, warehouseId: null, syncedAt: appDateTime(),
    syncStatus: 'current', syncError: null,
  }]);
}

export async function recordOptimisticStockAddition(productId: number, productName: string, quantity: number) {
  const existing = (await getStockProductMirror()).find((entry) => entry.productId === productId);
  await upsertStockProductMirror([{
    productId, productName,
    availableQty: (existing?.availableQty || 0) + quantity,
    freeQty: (existing?.freeQty || 0) + quantity,
    forecastQty: (existing?.forecastQty || 0) + quantity,
    incomingQty: existing?.incomingQty || 0,
    outgoingQty: existing?.outgoingQty || 0,
    warehouseId: existing?.warehouseId || null,
    syncedAt: existing?.syncedAt || appDateTime(),
    syncStatus: 'pending', syncError: null,
  }]);
}

export function startStockMirrorInterval() {
  if (intervalHandle) return;
  void refreshStockMirror();
  intervalHandle = setInterval(() => {
    if (isOperatingTime()) void refreshStockMirror();
  }, REFRESH_INTERVAL_MS);
  intervalHandle.unref();
}
