"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPwaBadgeBreakdown = getPwaBadgeBreakdown;
const repositories_1 = require("../models/repositories");
const authService_1 = require("./authService");
const badgeCache = new Map();
const BADGE_CACHE_TTL_MS = 60 * 1000;
function specialReminderRecipient(email) {
    const localPart = String(email || '').trim().toLowerCase().split('@')[0] || '';
    if (localPart.includes('charles'))
        return 'charles';
    if (localPart.includes('raphael'))
        return 'raphael';
    return null;
}
async function countShopFloorDueTasks(userEmail) {
    if (!userEmail) {
        return 0;
    }
    try {
        const localPendingCount = await (0, repositories_1.getPendingShopFloorProcessesCount)('pending');
        if (localPendingCount > 0) {
            return localPendingCount;
        }
        const snapshot = await (0, repositories_1.getShopFloorDashboardSnapshot)(userEmail);
        if (snapshot?.data?.stockAlerts && Array.isArray(snapshot.data.stockAlerts)) {
            return snapshot.data.stockAlerts.length;
        }
    }
    catch (_e) {
        // ignore
    }
    return 0;
}
async function getPwaBadgeBreakdown(authUser) {
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
    const mpesaCount = authUser && (0, authService_1.canAccessPath)(authUser, 'GET', '/mpesa-reconciliation')
        ? (await (0, repositories_1.getMpesaStatementBatchesWithOpenReviewCounts)()).length
        : 0;
    const shopFloorCount = authUser && (0, authService_1.canAccessPath)(authUser, 'GET', '/shop-floor')
        ? await countShopFloorDueTasks(authUser.email)
        : 0;
    const value = {
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
