"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailDisplayName = emailDisplayName;
exports.resolveUserDisplayName = resolveUserDisplayName;
exports.resolveLocalUserDisplayName = resolveLocalUserDisplayName;
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("./odooClient");
const failureCache = new Map();
function emailDisplayName(email) {
    const local = String(email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
    return local.split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || email;
}
async function resolveUserDisplayName(settings, email, forceRefresh = false) {
    const key = String(email || '').trim().toLowerCase();
    if (!key)
        return '';
    if (!forceRefresh) {
        const localProfile = await (0, repositories_1.getAppUserProfile)(key);
        if (localProfile?.displayName)
            return localProfile.displayName;
    }
    let name = emailDisplayName(key);
    if ((failureCache.get(key) || 0) > Date.now())
        return name;
    try {
        const client = new odooClient_1.OdooClient(settings.odoo);
        const employee = await client.findEmployeeByUserEmail(key) || await client.findEmployeeByWorkEmail(key);
        if (employee?.name) {
            name = employee.name;
            await (0, repositories_1.saveAppUserProfile)({ email: key, displayName: name, odooEmployeeId: employee.id });
        }
        else {
            await (0, repositories_1.saveAppUserProfile)({ email: key, displayName: name });
        }
    }
    catch {
        failureCache.set(key, Date.now() + 5 * 60 * 1000);
        await (0, repositories_1.saveAppUserProfile)({ email: key, displayName: name }).catch(() => undefined);
    }
    return name;
}
async function resolveLocalUserDisplayName(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key)
        return '';
    const localProfile = await (0, repositories_1.getAppUserProfile)(key);
    if (localProfile?.displayName)
        return localProfile.displayName;
    const name = emailDisplayName(key);
    await (0, repositories_1.saveAppUserProfile)({ email: key, displayName: name }).catch(() => undefined);
    return name;
}
