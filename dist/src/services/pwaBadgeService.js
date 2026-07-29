"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPwaBadgeBreakdown = getPwaBadgeBreakdown;
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("./odooClient");
const authService_1 = require("./authService");
const helpers_1 = require("../utils/helpers");
const boardProductClassifier_1 = require("./boardProductClassifier");
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
function isBoardComponentName(productName) {
    return (0, boardProductClassifier_1.isBoardProductName)(productName);
}
async function countShopFloorDueTasks(settings, userEmail) {
    if (!(0, helpers_1.hasOdooConfiguration)(settings) || !userEmail) {
        return 0;
    }
    const client = new odooClient_1.OdooClient(settings.odoo);
    const employee = (await client.findEmployeeByUserEmail(userEmail)) ||
        (await client.findEmployeeByWorkEmail(userEmail));
    if (!employee) {
        return 0;
    }
    const allOrdersRaw = await client.getAllActiveWorkOrders(100);
    const allOrders = allOrdersRaw.filter((order) => order.name.startsWith('WH/MO/'));
    if (!allOrders.length) {
        return 0;
    }
    const originsToFetch = [...new Set(allOrders.map((order) => order.origin).filter(Boolean))];
    const moIds = allOrders.map((order) => order.id);
    const [allComponents, poStateMap] = await Promise.all([
        client.getBulkManufacturingOrderComponents(moIds).catch(() => []),
        client.getBulkRelatedPurchaseOrderStates(originsToFetch).catch(() => new Map()),
    ]);
    const componentsByMoId = new Map();
    for (const comp of allComponents) {
        const linkedMo = comp.raw_material_production_id;
        if (Array.isArray(linkedMo)) {
            const moId = Number(linkedMo[0] || 0);
            if (moId > 0) {
                if (!componentsByMoId.has(moId)) {
                    componentsByMoId.set(moId, []);
                }
                componentsByMoId.get(moId).push(comp);
            }
        }
    }
    let dueCount = 0;
    for (const order of allOrders) {
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
    const settings = await (0, repositories_1.getSettings)();
    const mpesaCount = authUser && (0, authService_1.canAccessPath)(authUser, 'GET', '/mpesa-reconciliation')
        ? (await (0, repositories_1.getMpesaStatementBatchesWithOpenReviewCounts)()).length
        : 0;
    const shopFloorCount = authUser && (0, authService_1.canAccessPath)(authUser, 'GET', '/shop-floor')
        ? await countShopFloorDueTasks(settings, authUser.email)
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
