"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanOdooDepartment = cleanOdooDepartment;
exports.cleanOdooJobTitle = cleanOdooJobTitle;
exports.syncShopFloorOperatorsData = syncShopFloorOperatorsData;
exports.syncShopFloorOperatorAccess = syncShopFloorOperatorAccess;
exports.startShopFloorOperatorAccessSyncInterval = startShopFloorOperatorAccessSyncInterval;
const repositories_1 = require("../models/repositories");
const env_1 = require("../utils/env");
const logService_1 = require("./logService");
const odooClient_1 = require("./odooClient");
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Run every 5 minutes
let inFlightSyncPromise = null;
let intervalHandle = null;
function isAccountDeactivated(active) {
    return active === 0 || active === false;
}
function toEAT(utcStr) {
    if (!utcStr)
        return null;
    try {
        const iso = utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T');
        const parsedDate = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
        if (isNaN(parsedDate.getTime()))
            return utcStr;
        const timezone = env_1.env.APP_TIMEZONE || 'Africa/Nairobi';
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        }).formatToParts(parsedDate);
        const year = parts.find((p) => p.type === 'year')?.value;
        const month = parts.find((p) => p.type === 'month')?.value;
        const day = parts.find((p) => p.type === 'day')?.value;
        const hour = parts.find((p) => p.type === 'hour')?.value;
        const minute = parts.find((p) => p.type === 'minute')?.value;
        const second = parts.find((p) => p.type === 'second')?.value;
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
    catch {
        return utcStr;
    }
}
function cleanOdooDepartment(emp) {
    if (Array.isArray(emp.department_id) && emp.department_id[1]) {
        const raw = String(emp.department_id[1]).trim();
        if (raw.includes('/')) {
            const leaf = raw.split('/').pop()?.trim();
            if (leaf)
                return leaf;
        }
        return raw;
    }
    if (typeof emp.department_id === 'string' && emp.department_id.trim()) {
        const raw = emp.department_id.trim();
        if (raw.includes('/')) {
            const leaf = raw.split('/').pop()?.trim();
            if (leaf)
                return leaf;
        }
        return raw;
    }
    const title = String(emp.job_title || '').trim().toLowerCase();
    const name = String(emp.name || '').trim().toLowerCase();
    if (title.includes('director') || title.includes('managing') || title.includes('executive') || name.includes('charles') || name.includes('raphael')) {
        return 'Management';
    }
    if (title.includes('information') || title.includes('system') || title.includes('tech') || title.includes('it') || name.includes('leoivard') || name.includes('dbadmin')) {
        return 'Information Technology';
    }
    if (title.includes('sales') || title.includes('optimizer') || name.includes('sharon') || name.includes('candy')) {
        return 'Sales';
    }
    return 'Operations';
}
function cleanOdooJobTitle(emp) {
    if (emp.job_title && typeof emp.job_title === 'string' && emp.job_title.trim()) {
        return emp.job_title.trim();
    }
    const name = String(emp.name || '').trim().toLowerCase();
    if (name.includes('charles'))
        return 'Managing Director';
    if (name.includes('raphael'))
        return 'Director';
    if (name.includes('leoivard'))
        return 'Information Systems';
    if (name.includes('janet'))
        return 'Operations Assistant';
    if (name.includes('joel'))
        return 'Junior Operator';
    if (name.includes('thomas'))
        return 'Assistant Jr Operator';
    if (name.includes('okoth') || name.includes('michael'))
        return 'Helper';
    if (name.includes('akulo') || name.includes('bitcher'))
        return 'Senior Operator';
    return 'Operator';
}
function isOperatingTime() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi',
        weekday: 'short',
        hour: '2-digit',
        hour12: false,
    }).formatToParts(new Date());
    const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    if (weekday === 'Sun')
        return false;
    return weekday === 'Sat' ? hour >= 7 && hour < 16 : hour >= 6 && hour < 20;
}
/**
 * Synchronize all operators from Odoo into MySQL table `shop_floor_operators`
 * and grant shop-floor access in `auth_approved_users`.
 */
async function syncShopFloorOperatorsData(forceRefresh = false) {
    if (inFlightSyncPromise) {
        return inFlightSyncPromise;
    }
    inFlightSyncPromise = (async () => {
        try {
            const settings = await (0, repositories_1.getSettings)();
            const client = new odooClient_1.OdooClient(settings.odoo);
            const targetCompanyId = await client.getTargetCompanyIdValue();
            // 1. Fetch active approved accounts and user profiles from MySQL
            const [allApprovedUsers, profilesMap] = await Promise.all([
                (0, repositories_1.getApprovedAuthUsers)().catch(() => []),
                (0, repositories_1.getAllAppUserProfiles)().catch(() => new Map()),
            ]);
            const activeAccounts = (allApprovedUsers || []).filter((u) => {
                if (!u || !u.email)
                    return false;
                if (isAccountDeactivated(u.active))
                    return false;
                if (u.email.toLowerCase().includes('onyangoakulo22'))
                    return false;
                const apps = Array.isArray(u.apps) ? u.apps : [];
                return apps.includes('shop-floor') || u.role === 'admin';
            });
            // 2. Fetch active Odoo employees, work centers, and active users in target company
            const [workcenters, allOdooEmployees, allOdooUsers] = await Promise.all([
                client.searchReadRecords('mrp.workcenter', {
                    domain: [['company_id', '=', targetCompanyId]],
                    fields: ['id', 'employee_ids'],
                }).catch(() => []),
                client.searchReadRecords('hr.employee', {
                    domain: [
                        ['company_id', '=', targetCompanyId],
                        ['active', '=', true],
                    ],
                    fields: ['id', 'name', 'job_title', 'department_id', 'work_email', 'mobile_phone', 'user_id', 'active'],
                }).catch(() => []),
                client.searchReadRecords('res.users', {
                    domain: [
                        ['company_id', '=', targetCompanyId],
                        ['active', '=', true],
                    ],
                    fields: ['id', 'name', 'login', 'email', 'active'],
                }).catch(() => []),
            ]);
            const workcenterOperatorIds = new Set(workcenters.flatMap((w) => w.employee_ids || []));
            // 3. Match active accounts strictly to active Odoo employees
            const operators = [];
            const seenEmpIds = new Set();
            for (const account of activeAccounts) {
                const userEmail = String(account.email || '').trim().toLowerCase();
                if (!userEmail)
                    continue;
                const linkedEmp = allOdooEmployees.find((e) => {
                    if (e.active === false)
                        return false;
                    const empEmail = String(e.work_email || '').trim().toLowerCase();
                    if (empEmail && empEmail === userEmail)
                        return true;
                    if (Array.isArray(e.user_id) && e.user_id[0]) {
                        const u = allOdooUsers.find((user) => user.id === e.user_id[0]);
                        if (u) {
                            const uLogin = String(u.login || '').trim().toLowerCase();
                            const uEmail = String(u.email || '').trim().toLowerCase();
                            if (uLogin === userEmail || uEmail === userEmail)
                                return true;
                        }
                    }
                    const localPart = userEmail.split('@')[0].replace(/[._-]/g, ' ').trim().toLowerCase();
                    const eName = String(e.name || '').trim().toLowerCase();
                    if (localPart.length >= 3 && eName.includes(localPart)) {
                        return true;
                    }
                    return false;
                });
                if (!linkedEmp)
                    continue;
                if (seenEmpIds.has(linkedEmp.id))
                    continue;
                seenEmpIds.add(linkedEmp.id);
                const odooFullName = String(linkedEmp.name || '').trim();
                if (!odooFullName || odooFullName.toLowerCase() === userEmail.split('@')[0].toLowerCase()) {
                    continue;
                }
                const dept = cleanOdooDepartment(linkedEmp);
                const isWc = workcenterOperatorIds.has(linkedEmp.id);
                const priority = dept === 'Management' ? 0 : isWc ? 1 : 2;
                const profile = profilesMap.get(userEmail);
                operators.push({
                    id: linkedEmp.id,
                    name: profile?.displayName || odooFullName,
                    jobTitle: cleanOdooJobTitle(linkedEmp),
                    department: dept,
                    workEmail: account.email || linkedEmp.work_email,
                    mobilePhone: linkedEmp.mobile_phone || null,
                    userId: Array.isArray(linkedEmp.user_id) ? linkedEmp.user_id[0] : null,
                    userName: Array.isArray(linkedEmp.user_id) ? linkedEmp.user_id[1] : odooFullName,
                    photoUrl: profile?.photoUrl || null,
                    checkedIn: false,
                    checkedOut: false,
                    checkInTime: null,
                    assignedItems: [],
                    priority,
                    active: true,
                });
            }
            // Also include any active workcenter operators or operations / management employees from Odoo
            for (const emp of allOdooEmployees) {
                if (emp.active === false)
                    continue;
                if (seenEmpIds.has(emp.id))
                    continue;
                const isWc = workcenterOperatorIds.has(emp.id);
                const dept = cleanOdooDepartment(emp);
                if (!isWc && dept !== 'Operations' && dept !== 'Management')
                    continue;
                seenEmpIds.add(emp.id);
                const odooFullName = String(emp.name || '').trim();
                const email = String(emp.work_email || '').trim().toLowerCase();
                const validEmail = email && email !== 'false' ? email : null;
                const priority = dept === 'Management' ? 0 : isWc ? 1 : 2;
                const profile = validEmail ? profilesMap.get(validEmail) : null;
                operators.push({
                    id: emp.id,
                    name: profile?.displayName || odooFullName,
                    jobTitle: cleanOdooJobTitle(emp),
                    department: dept,
                    workEmail: validEmail,
                    mobilePhone: emp.mobile_phone || null,
                    userId: Array.isArray(emp.user_id) ? emp.user_id[0] : null,
                    userName: Array.isArray(emp.user_id) ? emp.user_id[1] : odooFullName,
                    photoUrl: profile?.photoUrl || null,
                    checkedIn: false,
                    checkedOut: false,
                    checkInTime: null,
                    assignedItems: [],
                    priority,
                    active: true,
                });
            }
            // Sort: Priority first (Management = 0, workcenter = 1, other = 2), then alphabetically
            operators.sort((a, b) => {
                if (a.priority !== b.priority)
                    return a.priority - b.priority;
                return a.name.localeCompare(b.name);
            });
            // Fetch today's attendance and assigned equipment in parallel
            if (operators.length > 0) {
                const operatorIds = operators.map((op) => op.id);
                const [attendanceRecords, allEquipments] = await Promise.all([
                    client.getBulkAttendance(operatorIds).catch((err) => {
                        console.warn('[shopFloorOperatorSync] Failed to fetch bulk attendance:', err);
                        return [];
                    }),
                    client.getBulkAssignedEquipment().catch((err) => {
                        console.warn('[shopFloorOperatorSync] Failed to fetch bulk assigned equipment:', err);
                        return [];
                    }),
                ]);
                for (const rec of attendanceRecords) {
                    const empId = Array.isArray(rec.employee_id) ? rec.employee_id[0] : rec.employee_id;
                    const op = operators.find((o) => o.id === empId);
                    if (op) {
                        op.checkedIn = Boolean(rec.check_in && !rec.check_out);
                        op.checkedOut = Boolean(rec.check_out);
                        op.checkInTime = toEAT(rec.check_in) || rec.check_in;
                    }
                }
                const equipByEmployeeId = new Map();
                for (const eq of allEquipments) {
                    if (eq.employee_id) {
                        const empId = eq.employee_id[0];
                        if (!equipByEmployeeId.has(empId)) {
                            equipByEmployeeId.set(empId, []);
                        }
                        equipByEmployeeId.get(empId).push(eq);
                    }
                }
                for (const op of operators) {
                    const items = equipByEmployeeId.get(op.id) || [];
                    op.assignedItems = items.map((i) => ({
                        id: String(i.id),
                        itemName: i.name || '',
                        assignedDate: i.assign_date || '',
                        quantity: 1,
                    }));
                }
            }
            // 4. Save directly into MySQL table `shop_floor_operators`
            if (operators.length > 0) {
                await (0, repositories_1.upsertShopFloorOperators)(operators);
                await (0, repositories_1.deactivateShopFloorOperatorsNotIn)(Array.from(seenEmpIds));
            }
            // 5. Also save into `shop_floor_shared_cache` for backwards compatibility
            const departmentsList = [...new Set(operators.map((op) => op.department).filter((d) => Boolean(d)))];
            const freshData = { allOperators: operators, departments: departmentsList };
            await (0, repositories_1.saveShopFloorSharedCache)('shop-floor:operators-list:v2', freshData).catch(() => { });
            // 6. Ensure active operators have 'shop-floor' permission in auth_approved_users
            for (const op of operators) {
                if (!op.workEmail)
                    continue;
                const email = op.workEmail.trim().toLowerCase();
                const existing = await (0, repositories_1.getApprovedAuthUserByEmail)(email);
                const apps = [...new Set([...(existing?.apps || []), 'shop-floor'])];
                await (0, repositories_1.upsertApprovedAuthUser)(email, existing?.role || 'user', apps, op.active !== false, null).catch(() => { });
            }
            // Deactivate obsolete / stale accounts
            for (const user of allApprovedUsers) {
                if (user.email.toLowerCase().includes('onyangoakulo22')) {
                    await (0, repositories_1.upsertApprovedAuthUser)(user.email, user.role, user.apps, false, null).catch(() => { });
                }
            }
            return freshData;
        }
        finally {
            inFlightSyncPromise = null;
        }
    })();
    return inFlightSyncPromise;
}
/**
 * Legacy entrypoint matching previous signature, runs full sync.
 */
async function syncShopFloorOperatorAccess() {
    const result = await syncShopFloorOperatorsData(true);
    return {
        operators: result.allOperators.length,
        added: 0,
        updated: 0,
        skipped: false,
    };
}
function startShopFloorOperatorAccessSyncInterval() {
    if (intervalHandle)
        return intervalHandle;
    const run = () => {
        void syncShopFloorOperatorsData(true).catch((error) => {
            void (0, logService_1.logEvent)('error', 'Automatic Shop Floor operator sync failed', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    };
    // Prime immediately on startup
    run();
    intervalHandle = setInterval(() => {
        if (isOperatingTime()) {
            run();
        }
    }, SYNC_INTERVAL_MS);
    intervalHandle.unref?.();
    return intervalHandle;
}
