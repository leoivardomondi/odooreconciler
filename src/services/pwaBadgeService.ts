import { getMpesaStatementBatchesWithOpenReviewCounts, getPendingShopFloorProcessesCount, getShopFloorDashboardSnapshot } from '../models/repositories';
import { AuthSessionUser } from '../models/types';
import { canAccessPath } from './authService';

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

async function countShopFloorDueTasks(userEmail: string): Promise<number> {
  if (!userEmail) {
    return 0;
  }
  try {
    const localPendingCount = await getPendingShopFloorProcessesCount('pending');
    if (localPendingCount > 0) {
      return localPendingCount;
    }
    const snapshot = await getShopFloorDashboardSnapshot<{ stockAlerts?: unknown[] }>(userEmail);
    if (snapshot?.data?.stockAlerts && Array.isArray(snapshot.data.stockAlerts)) {
      return snapshot.data.stockAlerts.length;
    }
  } catch (_e) {
    // ignore
  }
  return 0;
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

  const mpesaCount = authUser && canAccessPath(authUser, 'GET', '/mpesa-reconciliation')
    ? (await getMpesaStatementBatchesWithOpenReviewCounts()).length
    : 0;

  const shopFloorCount = authUser && canAccessPath(authUser, 'GET', '/shop-floor')
    ? await countShopFloorDueTasks(authUser.email)
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
