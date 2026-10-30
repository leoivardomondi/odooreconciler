"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWN_OPERATOR_NAMES = void 0;
exports.emailDisplayName = emailDisplayName;
exports.resolveUserDisplayName = resolveUserDisplayName;
exports.resolveLocalUserDisplayName = resolveLocalUserDisplayName;
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("./odooClient");
const failureCache = new Map();
exports.KNOWN_OPERATOR_NAMES = {
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
function emailDisplayName(email) {
    const normalized = String(email || '').trim().toLowerCase();
    const local = normalized.split('@')[0];
    if (exports.KNOWN_OPERATOR_NAMES[normalized])
        return exports.KNOWN_OPERATOR_NAMES[normalized];
    if (exports.KNOWN_OPERATOR_NAMES[local])
        return exports.KNOWN_OPERATOR_NAMES[local];
    const cleaned = local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
    const separated = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');
    return separated.split(/\s+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join(' ') || email;
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
