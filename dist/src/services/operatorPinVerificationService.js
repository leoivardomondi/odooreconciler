"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyEmployeeAttendancePin = verifyEmployeeAttendancePin;
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("./odooClient");
const shopFloorReporting_1 = require("../utils/shopFloorReporting");
/**
 * Verify an operator or employee attendance PIN against MySQL shop_floor_operators,
 * with a fallback check to live Odoo hr.employee kiosk attendance PIN.
 */
async function verifyEmployeeAttendancePin(pin) {
    const cleanPin = String(pin || '').trim();
    if (!cleanPin)
        return null;
    // 1. Check local MySQL / SQLite database (<2ms)
    const localOp = await (0, repositories_1.getShopFloorOperatorByPin)(cleanPin);
    if (localOp)
        return localOp;
    // 2. Fallback check live Odoo hr.employee
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const targetCompanyId = await client.getTargetCompanyIdValue();
        const employees = await client.searchReadRecords('hr.employee', {
            domain: [
                ['company_id', '=', targetCompanyId],
                ['active', '=', true],
                ['pin', '=', cleanPin],
            ],
            fields: ['id', 'name', 'work_email', 'mobile_phone', 'job_title', 'user_id', 'pin'],
            limit: 1,
        });
        if (employees.length && String(employees[0].pin || '').trim() === cleanPin) {
            const emp = employees[0];
            const opEntry = {
                id: emp.id,
                name: String(emp.name || '').trim(),
                jobTitle: emp.job_title ? String(emp.job_title).trim() : null,
                department: null,
                workEmail: emp.work_email ? String(emp.work_email).trim().toLowerCase() : null,
                mobilePhone: emp.mobile_phone ? String(emp.mobile_phone).trim() : null,
                userId: Array.isArray(emp.user_id) ? emp.user_id[0] : null,
                userName: Array.isArray(emp.user_id) ? emp.user_id[1] : emp.name,
                photoUrl: null,
                checkedIn: false,
                checkedOut: false,
                checkInTime: null,
                assignedItems: [],
                priority: 2,
                active: true,
                pin: cleanPin,
            };
            // Cache operator into MySQL / SQLite (unless excluded from shop floor operators)
            if (!(0, shopFloorReporting_1.isExcludedFromOperators)({ name: opEntry.name, workEmail: opEntry.workEmail })) {
                await (0, repositories_1.upsertShopFloorOperators)([opEntry]).catch(() => { });
            }
            return opEntry;
        }
    }
    catch (err) {
        console.warn('[verifyEmployeeAttendancePin] Odoo PIN verification fallback error:', err);
    }
    return null;
}
