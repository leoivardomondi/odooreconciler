"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncApprovedUserProfilesFromOdoo = syncApprovedUserProfilesFromOdoo;
exports.startUserProfileSyncInterval = startUserProfileSyncInterval;
const repositories_1 = require("../models/repositories");
const helpers_1 = require("../utils/helpers");
const logService_1 = require("./logService");
const odooClient_1 = require("./odooClient");
let syncPromise = null;
let intervalHandle = null;
async function syncApprovedUserProfilesFromOdoo() {
    if (syncPromise)
        return syncPromise;
    syncPromise = (async () => {
        const settings = await (0, repositories_1.getSettings)();
        if (!(0, helpers_1.hasOdooConfiguration)(settings))
            throw new Error('Odoo is not configured.');
        const users = (await (0, repositories_1.getApprovedAuthUsers)()).filter((user) => user.active);
        const client = new odooClient_1.OdooClient(settings.odoo);
        let matched = 0;
        let unmatched = 0;
        let failed = 0;
        for (const user of users) {
            try {
                const employee = await client.findEmployeeByUserEmail(user.email)
                    || await client.findEmployeeByWorkEmail(user.email);
                if (!employee?.name) {
                    unmatched += 1;
                    continue;
                }
                await (0, repositories_1.saveAppUserProfile)({ email: user.email, displayName: employee.name, odooEmployeeId: employee.id });
                matched += 1;
            }
            catch (_error) {
                failed += 1;
            }
        }
        await (0, logService_1.logEvent)('info', 'Approved user names synchronized from Odoo', { matched, unmatched, failed, total: users.length }).catch(() => undefined);
        return { matched, unmatched, failed };
    })().finally(() => { syncPromise = null; });
    return syncPromise;
}
function startUserProfileSyncInterval() {
    if (intervalHandle)
        return;
    setTimeout(() => void syncApprovedUserProfilesFromOdoo().catch(() => undefined), 15_000).unref();
    intervalHandle = setInterval(() => void syncApprovedUserProfilesFromOdoo().catch(() => undefined), 24 * 60 * 60 * 1000);
    intervalHandle.unref();
}
