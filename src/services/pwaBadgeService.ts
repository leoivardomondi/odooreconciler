import { getMpesaStatementBatchesWithOpenReviewCounts, getSettings } from '../models/repositories';
import { AuthSessionUser } from '../models/types';
import { OdooClient } from './odooClient';
import { canAccessPath } from './authService';
import { hasOdooConfiguration } from '../utils/helpers';
import { isBoardProductName } from './boardProductClassifier';

type CacheEntry = {
  value: PwaBadgeBreakdown;
  expiresAt: number;
};

export interface PwaBadgeBreakdown {
  totalCount: number;
  mpesaCount: number;
  shopFloorCount: number;
  checkedAt: string;
}

const badgeCache = new Map<string, CacheEntry>();
const BADGE_CACHE_TTL_MS = 60 * 1000;

function specialReminderRecipient(email: string): 'charles' | 'raphael' | null {
  const localPart = String(email || '').trim().toLowerCase().split('@')[0] || '';
  if (localPart.includes('charles')) return 'charles';
  if (localPart.includes('raphael')) return 'raphael';
  return null;
}

function isBoardComponentName(productName: string | null | undefined): boolean {
  return isBoardProductName(productName);
}

async function countShopFloorDueTasks(settings: Awaited<ReturnType<typeof getSettings>>, userEmail: string): Promise<number> {
  if (!hasOdooConfiguration(settings) || !userEmail) {
    return 0;
  }

  const client = new OdooClient(settings.odoo);

  const employee =
    (await client.findEmployeeByUserEmail(userEmail)) ||
    (await client.findEmployeeByWorkEmail(userEmail));

  if (!employee) {
    return 0;
  }

  const allOrdersRaw = await client.getAllActiveWorkOrders(100);
  const allOrders = allOrdersRaw.filter((order) => order.name.startsWith('WH/MO/'));
  if (!allOrders.length) {
    return 0;
  }

  const originsToFetch = [...new Set(allOrders.map((order) => order.origin).filter(Boolean))] as string[];
  const moIds = allOrders.map((order) => order.id);

  const [allComponents, poStateMap] = await Promise.all([
    client.getBulkManufacturingOrderComponents(moIds).catch(() => []),
    client.getBulkRelatedPurchaseOrderStates(originsToFetch).catch(() => new Map<string, string>()),
  ]);

  const componentsByMoId = new Map<number, Array<Record<string, unknown>>>();
  for (const comp of allComponents as Array<Record<string, unknown>>) {
    const linkedMo = comp.raw_material_production_id;
    if (Array.isArray(linkedMo)) {
      const moId = Number(linkedMo[0] || 0);
      if (moId > 0) {
        if (!componentsByMoId.has(moId)) {
          componentsByMoId.set(moId, []);
        }
        componentsByMoId.get(moId)!.push(comp);
      }
    }
  }

  let dueCount = 0;

  for (const order of allOrders as Array<Record<string, unknown>>) {
    if (order.state === 'done' || order.state === 'cancel') {
      continue;
    }

    const components = componentsByMoId.get(Number(order.id || 0)) || [];
    const unavailable = components.filter((component) => {
      const state = String(component.state || '');
      if (state === 'done' || state === 'cancel' || state === 'draft' || state === 'assigned') {
        return false;
      }
      if (['confirmed', 'waiting', 'partially_available'].includes(state)) {
        return true;
      }
      return !component.forecast_availability || component.forecast_availability === 'unavailable';
    });

    if (!unavailable.length) {
      continue;
    }

    const origin = String(order.origin || '');
    const poState = origin ? String(poStateMap.get(origin) || '') : '';
    const needsAlert = !poState || ['draft', 'sent'].includes(poState);
    if (!needsAlert) {
      continue;
    }

    for (const component of unavailable) {
      const componentName = Array.isArray(component.product_id) ? String(component.product_id[1] || '') : '';
      if (isBoardComponentName(componentName)) {
        dueCount += 1;
      }
    }
  }

  return dueCount;
}

export async function getPwaBadgeBreakdown(authUser: AuthSessionUser | null | undefined): Promise<PwaBadgeBreakdown> {
  const cacheKey = `${authUser?.email || 'anonymous'}:${authUser?.role || 'none'}:${(authUser?.apps || []).join(',')}`;
  const cached = badgeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const specialRecipient = specialReminderRecipient(authUser?.email || '');
  if (specialRecipient) {
    const specialCount = 0;
    const value = { totalCount: specialCount, mpesaCount: specialCount, shopFloorCount: 0, checkedAt: new Date().toISOString() };
    badgeCache.set(cacheKey, { value, expiresAt: Date.now() + BADGE_CACHE_TTL_MS });
    return value;
  }

  const settings = await getSettings();
  const mpesaCount = authUser && canAccessPath(authUser, 'GET', '/mpesa-reconciliation')
    ? (await getMpesaStatementBatchesWithOpenReviewCounts()).length
    : 0;

  const shopFloorCount = authUser && canAccessPath(authUser, 'GET', '/shop-floor')
    ? await countShopFloorDueTasks(settings, authUser.email)
    : 0;

  const value: PwaBadgeBreakdown = {
    totalCount: mpesaCount + shopFloorCount,
    mpesaCount,
    shopFloorCount,
    checkedAt: new Date().toISOString(),
  };

  badgeCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + BADGE_CACHE_TTL_MS,
  });

  return value;
}
