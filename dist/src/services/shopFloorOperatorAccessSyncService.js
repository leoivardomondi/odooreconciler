"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncShopFloorOperatorAccess = syncShopFloorOperatorAccess;
exports.startShopFloorOperatorAccessSyncInterval = startShopFloorOperatorAccessSyncInterval;
const repositories_1 = require("../models/repositories");
const logService_1 = require("./logService");
const odooClient_1 = require("./odooClient");
const OPERATOR_DEPARTMENT_NAMES = ['Operations', 'Production', 'Shop Floor', 'Manufacturing', 'Factory'];
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
let syncRunning = false;
async function syncShopFloorOperatorAccess() {
    if (syncRunning)
        return { operators: 0, added: 0, updated: 0, skipped: true };
    syncRunning = true;
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const targetCompanyId = await client.getTargetCompanyIdValue();
        // 1. Prioritize native Odoo Shop Floor operators assigned to mrp.workcenter in target company
        const workcenters = await client.searchReadRecords('mrp.workcenter', {
            domain: [['company_id', '=', targetCompanyId]],
            fields: ['id', 'employee_ids'],
        }).catch(() => []);
        const workcenterOperatorIds = new Set(workcenters.flatMap((w) => w.employee_ids || []));
        let employees = [];
        if (workcenterOperatorIds.size > 0) {
            employees = await client.searchReadRecords('hr.employee', {
                domain: [
                    ['id', 'in', Array.from(workcenterOperatorIds)],
                    ['company_id', '=', targetCompanyId],
                    ['active', '=', true],
                ],
                fields: ['id', 'name', 'active', 'job_title', 'work_email'],
            }).catch(() => []);
        }
        // 2. If work center allowed employees are empty, fallback to target company Production departments with operator job titles
        if (!employees.length) {
            const departmentResults = await Promise.all(OPERATOR_DEPARTMENT_NAMES.map((name) => client.searchReadRecords('hr.department', {
                domain: [['company_id', '=', targetCompanyId], ['name', 'ilike', name]],
                fields: ['id', 'name'],
            })));
            const departments = [...new Map(departmentResults.flat().map((department) => [department.id, department])).values()];
            const employeeResults = await Promise.all(departments.map((department) => client.getEmployeesByDepartment(department.id, targetCompanyId, false)));
            employees = [...new Map(employeeResults.flat().map((employee) => [employee.id, employee])).values()]
                .filter((employee) => {
                const title = String(employee.job_title || '').trim().toLowerCase();
                return title.includes('operator') || title.includes('carpenter') || title.includes('technician') || title.includes('machin');
            });
        }
        const validOperators = employees.filter((employee) => String(employee.work_email || '').trim() && employee.active !== false);
        let added = 0;
        let updated = 0;
        for (const employee of validOperators) {
            const email = String(employee.work_email).trim().toLowerCase();
            const existing = await (0, repositories_1.getApprovedAuthUserByEmail)(email);
            const apps = [...new Set([...(existing?.apps || []), 'shop-floor'])];
            if (!existing)
                added += 1;
            else if (!existing.active || !existing.apps?.includes('shop-floor') || employee.active === false)
                updated += 1;
            await (0, repositories_1.upsertApprovedAuthUser)(email, existing?.role || 'user', apps, employee.active !== false, null);
        }
        if (added || updated) {
            await (0, logService_1.logEvent)('info', 'Automatically synchronized Odoo operators to Shop Floor access', {
                operators: validOperators.length,
                added,
                updated,
            });
        }
        return { operators: validOperators.length, added, updated, skipped: false };
    }
    finally {
        syncRunning = false;
    }
}
function startShopFloorOperatorAccessSyncInterval() {
    const run = () => {
        void syncShopFloorOperatorAccess().catch((error) => {
            void (0, logService_1.logEvent)('error', 'Automatic Shop Floor operator access sync failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    };
    run();
    const timer = setInterval(run, SYNC_INTERVAL_MS);
    timer.unref?.();
    return timer;
}
