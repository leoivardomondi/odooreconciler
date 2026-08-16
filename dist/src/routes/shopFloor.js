"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOperatorDashboard = buildOperatorDashboard;
const express_1 = require("express");
const crypto_1 = require("crypto");
const repositories_1 = require("../models/repositories");
const odooClient_1 = require("../services/odooClient");
const payrollBridgeService_1 = require("../services/payrollBridgeService");
const repositories_2 = require("../models/repositories");
const mailTransport_1 = require("../services/mailTransport");
const logService_1 = require("../services/logService");
const machineBreakdownCatalog_1 = require("../services/machineBreakdownCatalog");
const env_1 = require("../utils/env");
const weeklyShopFloorReportService_1 = require("../services/weeklyShopFloorReportService");
const moOverdueService_1 = require("../services/moOverdueService");
const boardProductClassifier_1 = require("../services/boardProductClassifier");
const stockMirrorService_1 = require("../services/stockMirrorService");
const boardIntakeSyncService_1 = require("../services/boardIntakeSyncService");
const shopFloorOperatorAccessSyncService_1 = require("../services/shopFloorOperatorAccessSyncService");
const repositories_3 = require("../models/repositories");
const router = (0, express_1.Router)();
// Department names to search for operators (case-insensitive match)
const OPERATOR_DEPARTMENT_NAMES = ['Operations', 'Production', 'Shop Floor', 'Manufacturing', 'Factory'];
const MANUFACTURING_AREAS = ['Table Saw Area', 'Edge Banding Area', 'Panel Rack Area'];
const SHOP_FLOOR_FEATURE_KEYS = [
    'start-finish', 'add-stock', 'receipts', 'deliveries', 'attendance', 'maintenance', 'payroll', 'table-saw', 'edge-banding', 'panel-rack',
];
const purchaseApprovalEmailCooldown = new Map();
const PURCHASE_APPROVAL_EMAIL_COOLDOWN_MS = 30 * 60 * 1000;
const manuallyPausedMoIds = new Set();
async function sendPurchaseApprovalRequest(input) {
    const pendingOrders = input.procurement.purchaseOrders.filter((po) => ['draft', 'sent', 'to approve'].includes(po.state));
    if (!pendingOrders.length)
        return { sent: false, throttled: false };
    const cooldownKey = pendingOrders.map((po) => po.id).sort((a, b) => a - b).join(',');
    const lastSentAt = purchaseApprovalEmailCooldown.get(cooldownKey) || 0;
    if (Date.now() - lastSentAt < PURCHASE_APPROVAL_EMAIL_COOLDOWN_MS) {
        return { sent: false, throttled: true };
    }
    const users = await (0, repositories_1.getApprovedAuthUsers)();
    const resolvedRecipients = users
        .filter((user) => user.active && ['dbadmin', 'charles'].some((name) => user.email.toLowerCase().includes(name)))
        .map((user) => user.email.trim().toLowerCase());
    const recipients = [...new Set([
            ...resolvedRecipients,
            env_1.env.AUTH_LOCAL_ADMIN_EMAIL.toLowerCase().includes('dbadmin') ? env_1.env.AUTH_LOCAL_ADMIN_EMAIL.trim().toLowerCase() : '',
            'dbadmin@urbanvibeinteriordesign.co.ke',
            'charles@urbanvibeinteriordesign.co.ke',
        ].filter(Boolean))];
    const poRows = pendingOrders.map((po) => `<li><strong>${escapeHtml(po.name)}</strong> — ${escapeHtml(po.state)}${po.supplier ? ` — ${escapeHtml(po.supplier)}` : ''}</li>`).join('');
    const boardRows = input.procurement.unavailableBoards.map((board) => `<li>${escapeHtml(board.name)} — required ${board.required}, available ${board.available}</li>`).join('');
    const appUrl = env_1.env.APP_BASE_URL.replace(/\/+$/, '');
    await (0, mailTransport_1.sendMailWithConfig)(input.settings.mail, {
        to: recipients.join(', '),
        subject: `Purchase approval required for ${input.procurement.moName}`,
        text: [
            `${input.operatorName} attempted to start ${input.procurement.moName}, but its required boards are waiting on an unapproved purchase order.`,
            `Sales order: ${input.procurement.origin || 'Not available'}`,
            `Purchase orders: ${pendingOrders.map((po) => `${po.name} (${po.state})`).join(', ')}`,
            `Open Purchase Orders: ${appUrl}/purchase-orders`,
        ].join('\n'),
        html: `<p><strong>${escapeHtml(input.operatorName)}</strong> (${escapeHtml(input.operatorEmail)}) attempted to start <strong>${escapeHtml(input.procurement.moName)}</strong>, but required boards are waiting on purchase approval.</p>
      <p>Sales order: <strong>${escapeHtml(input.procurement.origin || 'Not available')}</strong></p>
      <h3>Purchase orders requiring approval</h3><ul>${poRows}</ul>
      <h3>Required boards</h3><ul>${boardRows}</ul>
      <p><a href="${escapeHtml(`${appUrl}/purchase-orders`)}">Open Purchase Orders</a></p>`,
    });
    purchaseApprovalEmailCooldown.set(cooldownKey, Date.now());
    await (0, logService_1.logEvent)('info', 'Purchase approval email sent from Shop Floor start attempt', {
        moId: input.procurement.moId,
        moName: input.procurement.moName,
        purchaseOrders: pendingOrders.map((po) => ({ id: po.id, name: po.name, state: po.state })),
        recipients,
        operatorEmail: input.operatorEmail,
    });
    return { sent: true, throttled: false };
}
function canManageShopFloor(req) {
    return Boolean(req.authUser && (req.authUser.role === 'admin' || req.authUser.apps?.includes('shop-floor-admin')));
}
function getViewedUserEmail(req) {
    return String(req.viewingAsUser?.email || req.authUser?.email || '').trim();
}
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character));
}
function normalizeManufacturingArea(areaName) {
    const normalized = String(areaName || '').trim().toLowerCase();
    return MANUFACTURING_AREAS.find((area) => area.toLowerCase() === normalized) || null;
}
// Area categorization by product name keywords
function detectArea(productName) {
    const n = productName.toLowerCase();
    if (n.includes('edge banding') || n.includes('edgeband'))
        return 'Edge Banding Area';
    if (n.includes('optimised') || n.includes('optimized') || n.includes('panel'))
        return 'Panel Rack Area';
    return 'Table Saw Area';
}
function isBoardComponentName(productName) {
    return (0, boardProductClassifier_1.isBoardProductName)(productName);
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
            hourCycle: 'h23',
        }).formatToParts(parsedDate);
        const value = (type) => parts.find((part) => part.type === type)?.value || '00';
        return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
    }
    catch {
        return utcStr;
    }
}
function getOverdueDaysFromDateOrder(dateOrder) {
    if (!dateOrder)
        return 0;
    const timezone = env_1.env.APP_TIMEZONE || 'Africa/Nairobi';
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const todayParts = formatter.formatToParts(new Date());
    const today = `${todayParts.find((part) => part.type === 'year')?.value || '0000'}-${todayParts.find((part) => part.type === 'month')?.value || '01'}-${todayParts.find((part) => part.type === 'day')?.value || '01'}`;
    const confirmed = toEAT(dateOrder)?.slice(0, 10) || dateOrder.slice(0, 10);
    const confirmedDate = new Date(`${confirmed}T00:00:00Z`);
    const todayDate = new Date(`${today}T00:00:00Z`);
    if (Number.isNaN(confirmedDate.getTime()) || Number.isNaN(todayDate.getTime())) {
        return 0;
    }
    return Math.max(0, Math.floor((todayDate.getTime() - confirmedDate.getTime()) / (1000 * 60 * 60 * 24)));
}
class MemoryCache {
    cache = new Map();
    get(key) {
        const entry = this.cache.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return entry.value;
    }
    set(key, value, ttlMs) {
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + ttlMs,
        });
    }
    delete(key) {
        this.cache.delete(key);
    }
    clearPrefix(prefix) {
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }
    clear() {
        this.cache.clear();
    }
}
const shopFloorCache = new MemoryCache();
const optimisticBoardIntakes = [];
function activeOptimisticBoardIntakes() {
    const now = Date.now();
    for (let index = optimisticBoardIntakes.length - 1; index >= 0; index -= 1)
        if (optimisticBoardIntakes[index].expiresAt <= now)
            optimisticBoardIntakes.splice(index, 1);
    return optimisticBoardIntakes;
}
function applyOptimisticBoardIntakes(partnerId, requirements) {
    const remainingByProduct = new Map();
    activeOptimisticBoardIntakes().filter((entry) => entry.partnerId === partnerId).forEach((entry) => remainingByProduct.set(entry.productId, (remainingByProduct.get(entry.productId) || 0) + entry.quantity));
    return requirements.map((requirement) => {
        const remaining = remainingByProduct.get(requirement.productId) || 0;
        const applied = Math.min(remaining, requirement.qtyMissing);
        remainingByProduct.set(requirement.productId, remaining - applied);
        return { ...requirement, qtyReserved: requirement.qtyReserved + applied, qtyMissing: requirement.qtyMissing - applied };
    }).filter((requirement) => requirement.qtyMissing > 0);
}
function applyOptimisticStockAlerts(alerts) {
    const pending = activeOptimisticBoardIntakes().map((entry) => ({ ...entry, remaining: entry.quantity }));
    return alerts.map((alert) => {
        let qtyNeeded = alert.qtyNeeded;
        for (const entry of pending) {
            const sameClient = String(alert.client || '').trim().toLowerCase() === entry.customerName.trim().toLowerCase();
            const alertProduct = String(alert.component || '').toLowerCase();
            const intakeProduct = entry.productName.toLowerCase();
            if (!sameClient || (!alertProduct.includes(intakeProduct) && !intakeProduct.includes(alertProduct)) || entry.remaining <= 0)
                continue;
            const applied = Math.min(entry.remaining, qtyNeeded);
            qtyNeeded -= applied;
            entry.remaining -= applied;
        }
        return { ...alert, qtyNeeded };
    }).filter((alert) => alert.qtyNeeded > 0);
}
const dailyManufacturingAnalytics = new Map();
function manufacturingReportDay() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const value = (type) => parts.find((part) => part.type === type)?.value || '';
    const today = `${value('year')}-${value('month')}-${value('day')}`;
    if (Number(value('hour')) >= 18)
        return today;
    const previous = new Date(`${today}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    return previous.toISOString().slice(0, 10);
}
function isStockExemptEdgeBandingService(productName) {
    const normalized = String(productName || '').trim().toLowerCase();
    return normalized.includes('edge banding service') || normalized.includes('edging banding service');
}
function getDailyManufacturingAnalytics(key, loader) {
    const reportDay = manufacturingReportDay();
    const cached = dailyManufacturingAnalytics.get(key);
    if (cached?.reportDay === reportDay)
        return cached.value;
    const value = loader().catch((error) => {
        dailyManufacturingAnalytics.delete(key);
        throw error;
    });
    dailyManufacturingAnalytics.set(key, { reportDay, value });
    return value;
}
async function fetchSalaryAdvances(employeeName) {
    const salaryAdvances = [];
    try {
        const batches = await (0, repositories_2.getRecentMpesaStatementBatches)(20);
        const batchesTransactions = await Promise.all(batches.map(async (batch) => {
            try {
                return await (0, repositories_2.getMpesaTransactionsByBatchId)(batch.id);
            }
            catch {
                return [];
            }
        }));
        for (const txs of batchesTransactions) {
            const advances = (0, payrollBridgeService_1.buildPayrollAdvanceRecords)(txs).filter((a) => a.employee_name?.toLowerCase().includes(employeeName.toLowerCase()) ||
                employeeName.toLowerCase().includes(a.employee_name?.toLowerCase() || ''));
            for (const adv of advances) {
                salaryAdvances.push({
                    employeeName: adv.employee_name || '',
                    amount: typeof adv.amount === 'number' ? adv.amount : 0,
                    date: adv.transaction_date || '',
                    reference: adv.mpesa_receipt || '',
                });
            }
        }
    }
    catch {
        // Skip
    }
    return salaryAdvances;
}
async function buildOperatorDashboard(client, userEmail, req, stockScope) {
    const result = {
        employee: null,
        attendance: null,
        workOrders: [],
        payslips: [],
        salaryAdvances: [],
        stockAlerts: [],
        lateCount: 0,
        incidents: [],
        assignedItems: [],
        failedCheckouts: [],
        performanceRate: null,
        areaPerformanceRates: [],
        manufacturingTimingSummary: null,
        manufacturingTimelineData: null,
        boardRegistrationSummary: null,
        teamPenalties: null,
        isLimitedDashboard: false,
        machines: [],
        error: null,
        reservedBoardsCount: 0,
    };
    try {
        // 1. Find employee — operators may not have res.users, search by work email directly
        let employee = await client.findEmployeeByUserEmail(userEmail);
        if (!employee) {
            employee = await client.findEmployeeByWorkEmail(userEmail);
        }
        if (!employee) {
            result.employee = {
                id: 0,
                name: userEmail || 'Shop Floor User',
                jobTitle: 'Operator',
                department: null,
                workEmail: userEmail || null,
                mobilePhone: null,
                manager: null,
            };
            result.isLimitedDashboard = true;
            return result;
        }
        result.employee = {
            id: employee.id,
            name: employee.name,
            jobTitle: employee.job_title || null,
            department: Array.isArray(employee.department_id) ? employee.department_id[1] : null,
            workEmail: employee.work_email || null,
            mobilePhone: employee.mobile_phone || null,
            manager: Array.isArray(employee.parent_id) ? employee.parent_id[1] : null,
        };
        const limitedDashboardEmail = 'janetamollo01@gmail.com';
        const dashboardEmail = String(userEmail || employee.work_email || '').trim().toLowerCase();
        result.isLimitedDashboard = dashboardEmail === limitedDashboardEmail;
        const assignedItemEmails = Array.from(new Set([
            userEmail,
            employee.work_email || '',
        ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean)));
        // Run remaining independent sections concurrently!
        const [attendanceRes, lateCountRes, workOrdersRes, incidentsRes, assignedItemsRes, payslipsRes, advancesRes, failedCheckoutsRes, performanceRateRes, manufacturingTimingRes, manufacturingTimelineRes, boardRegistrationRes, teamPenaltiesRes, machinesRes,] = await Promise.allSettled([
            // 1. Attendance
            client.getTodayAttendance(employee.id),
            // 2. Late count this month
            client.getLateCountThisMonth(employee.id),
            // 3. Work orders and stock alerts
            (async () => {
                const [allOrdersRaw, performanceOrders] = await Promise.all([
                    client.getAllActiveWorkOrders(100),
                    client.getManufacturingPerformanceOrders(),
                ]);
                const allOrders = allOrdersRaw.filter(o => o.name.startsWith('WH/MO/'));
                const originsToFetch = [...new Set([...allOrders, ...performanceOrders].map(o => o.origin).filter(Boolean))];
                const moIds = allOrders.map(o => o.id);
                const [clientMap, saleOrderDateMap, allComponents, poStateMap, workOrderStateMap] = await Promise.all([
                    client.getBulkSaleOrderClients(originsToFetch).catch(() => new Map()),
                    client.getBulkSaleOrderConfirmationDates(originsToFetch).catch(() => new Map()),
                    client.getBulkManufacturingOrderComponents(moIds).catch(() => []),
                    client.getBulkRelatedPurchaseOrderStates(originsToFetch).catch(() => new Map()),
                    client.getBulkWorkOrderStates(moIds).catch(() => new Map()),
                ]);
                const componentsByMoId = new Map();
                for (const comp of allComponents) {
                    if (comp.raw_material_production_id) {
                        const moId = comp.raw_material_production_id[0];
                        if (!componentsByMoId.has(moId)) {
                            componentsByMoId.set(moId, []);
                        }
                        componentsByMoId.get(moId).push(comp);
                    }
                }
                const moIdsWithStockIssues = new Set();
                const localStockAlerts = [];
                const moStockStatus = new Map();
                let reservedBoardsCount = 0;
                for (const o of allOrders) {
                    const manufacturedProductName = Array.isArray(o.product_id) ? o.product_id[1] : String(o.product_id || '');
                    if (isStockExemptEdgeBandingService(manufacturedProductName)) {
                        moStockStatus.set(o.id, 'ready');
                        continue;
                    }
                    const components = componentsByMoId.get(o.id) || [];
                    for (const comp of components) {
                        const componentName = Array.isArray(comp.product_id) ? comp.product_id[1] : '';
                        if (isBoardComponentName(componentName)) {
                            reservedBoardsCount += (comp.quantity || 0);
                        }
                    }
                    if (o.state === 'done' || o.state === 'cancel') {
                        moStockStatus.set(o.id, 'ready');
                        continue;
                    }
                    const unavailable = components.filter((c) => {
                        if (c.state === 'done' || c.state === 'cancel' || c.state === 'draft' || c.state === 'assigned') {
                            return false;
                        }
                        if (['confirmed', 'waiting', 'partially_available'].includes(c.state)) {
                            return true;
                        }
                        return !c.forecast_availability || c.forecast_availability === 'unavailable';
                    });
                    if (unavailable.length > 0) {
                        const poState = o.origin ? poStateMap.get(o.origin) || null : null;
                        const needsAlert = !poState || ['draft', 'sent'].includes(poState);
                        if (needsAlert) {
                            moStockStatus.set(o.id, 'no_stock');
                            moIdsWithStockIssues.add(o.id);
                            const confirmedAt = o.origin ? saleOrderDateMap.get(o.origin) || null : null;
                            const overdueDays = getOverdueDaysFromDateOrder(confirmedAt);
                            for (const comp of unavailable) {
                                const componentName = Array.isArray(comp.product_id) ? comp.product_id[1] : '';
                                if (!isBoardComponentName(componentName)) {
                                    continue;
                                }
                                localStockAlerts.push({
                                    moName: o.name,
                                    product: Array.isArray(o.product_id) ? o.product_id[1] : '',
                                    component: componentName,
                                    qtyNeeded: comp.product_uom_qty - (comp.quantity || 0),
                                    client: clientMap.get(o.origin || '') || null,
                                    moId: o.id,
                                    confirmedAt,
                                    overdueDays,
                                });
                            }
                        }
                        else {
                            moStockStatus.set(o.id, 'incoming');
                        }
                    }
                    else {
                        moStockStatus.set(o.id, 'ready');
                    }
                }
                const confirmedQueueSchedule = (0, moOverdueService_1.getConfirmedMoQueueSchedule)(allOrders);
                const mappedWorkOrders = allOrders.map((o) => {
                    const baseTiming = (0, moOverdueService_1.getMoOverdueState)({ createDate: o.create_date, plannedStart: o.date_start, clientDeadline: o.date_deadline, quantity: o.product_qty, productName: Array.isArray(o.product_id) ? o.product_id[1] : String(o.product_id || '') });
                    const queueTiming = confirmedQueueSchedule.get(o.id);
                    const rawWoState = workOrderStateMap.get(o.id);
                    const isManuallyPaused = manuallyPausedMoIds.has(o.id);
                    const effectiveState = isManuallyPaused || rawWoState === 'pending'
                        ? 'paused'
                        : rawWoState === 'progress' || o.state === 'progress'
                            ? 'progress'
                            : o.state || 'draft';
                    return {
                        ...baseTiming,
                        ...queueTiming,
                        isOverdue: !baseTiming.createdToday && (baseTiming.overdueReason !== null || Boolean(queueTiming && new Date() > new Date(queueTiming.estimatedFinishAt))),
                        id: o.id,
                        name: o.name,
                        product: Array.isArray(o.product_id) ? o.product_id[1] : String(o.product_id),
                        qty: o.product_qty || 0,
                        produced: o.qty_produced || 0,
                        state: effectiveState,
                        plannedStart: o.date_start || null,
                        dateStarted: o.date_start || null,
                        dateFinished: o.date_finished || null,
                        dateDeadline: o.date_deadline || null,
                        createdAt: o.create_date || null,
                        progress: o.product_qty > 0 ? Math.round(((o.qty_produced || 0) / o.product_qty) * 100) : 0,
                        origin: o.origin || null,
                        client: o.origin ? clientMap.get(o.origin) || null : null,
                        assignedTo: Array.isArray(o.user_id) ? o.user_id[1] : null,
                        area: detectArea(Array.isArray(o.product_id) ? o.product_id[1] : ''),
                        hasStockIssue: moIdsWithStockIssues.has(o.id),
                        stockStatus: moStockStatus.get(o.id) || 'ready',
                    };
                }).sort((a, b) => {
                    if (a.state === 'progress' && b.state !== 'progress')
                        return -1;
                    if (a.state !== 'progress' && b.state === 'progress')
                        return 1;
                    if (a.state === 'paused' && b.state !== 'paused')
                        return -1;
                    if (a.state !== 'paused' && b.state === 'paused')
                        return 1;
                    if (a.stockStatus === 'ready' && b.stockStatus !== 'ready')
                        return -1;
                    if (a.stockStatus !== 'ready' && b.stockStatus === 'ready')
                        return 1;
                    return 0;
                });
                const completedAreaStats = new Map();
                for (const o of performanceOrders) {
                    const area = detectArea(Array.isArray(o.product_id) ? o.product_id[1] : '');
                    if (!completedAreaStats.has(area)) {
                        completedAreaStats.set(area, { totalOrders: 0, completedOrders: 0, onTimeOrders: 0, overdueQuickClose: 0, days: [] });
                    }
                    const stats = completedAreaStats.get(area);
                    stats.totalOrders += 1;
                    if (o.state !== 'done' || !o.origin || !o.date_finished) {
                        continue;
                    }
                    const confirmedAt = saleOrderDateMap.get(o.origin) || null;
                    if (!confirmedAt) {
                        continue;
                    }
                    const soConfirmed = new Date(confirmedAt.includes('T') ? confirmedAt : confirmedAt.replace(' ', 'T') + 'Z');
                    const startedAt = o.date_start ? new Date(o.date_start.includes('T') ? o.date_start : o.date_start.replace(' ', 'T') + 'Z') : null;
                    const finishedAt = new Date(o.date_finished.includes('T') ? o.date_finished : o.date_finished.replace(' ', 'T') + 'Z');
                    const minPerfDate = new Date('2026-08-05T00:00:00Z');
                    if (soConfirmed.getTime() < minPerfDate.getTime()) {
                        continue;
                    }
                    stats.completedOrders += 1;
                    const daysToComplete = (finishedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60 * 24);
                    const hoursToStart = startedAt ? (startedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60) : null;
                    const minutesFromStartToFinish = startedAt ? (finishedAt.getTime() - startedAt.getTime()) / (1000 * 60) : null;
                    const overdueQuickClose = hoursToStart !== null
                        && minutesFromStartToFinish !== null
                        && hoursToStart > 24
                        && minutesFromStartToFinish >= 0
                        && minutesFromStartToFinish <= 30;
                    if (daysToComplete >= 0) {
                        stats.days.push(daysToComplete);
                    }
                    if (daysToComplete >= 0 && daysToComplete <= 3 && !overdueQuickClose) {
                        stats.onTimeOrders += 1;
                    }
                    if (overdueQuickClose) {
                        stats.overdueQuickClose += 1;
                    }
                }
                const areaPerformanceRates = Array.from(completedAreaStats.entries())
                    .map(([area, stats]) => {
                    const percentage = stats.completedOrders > 0
                        ? Math.round((stats.onTimeOrders / stats.completedOrders) * 100)
                        : 0;
                    const avgDaysToComplete = stats.days.length > 0
                        ? Math.round((stats.days.reduce((sum, value) => sum + value, 0) / stats.days.length) * 10) / 10
                        : 0;
                    const color = percentage >= 75 ? 'green' : percentage >= 50 ? 'orange' : 'red';
                    return {
                        area,
                        percentage,
                        color,
                        totalOrders: stats.totalOrders,
                        completedOrders: stats.completedOrders,
                        onTimeOrders: stats.onTimeOrders,
                        overdueQuickClose: stats.overdueQuickClose,
                        avgDaysToComplete,
                    };
                })
                    .sort((a, b) => {
                    const order = MANUFACTURING_AREAS;
                    const aIndex = order.indexOf(a.area);
                    const bIndex = order.indexOf(b.area);
                    if (aIndex === -1 && bIndex === -1)
                        return a.area.localeCompare(b.area);
                    if (aIndex === -1)
                        return 1;
                    if (bIndex === -1)
                        return -1;
                    return aIndex - bIndex;
                });
                return { workOrders: mappedWorkOrders, stockAlerts: applyOptimisticStockAlerts(localStockAlerts), areaPerformanceRates, reservedBoardsCount };
            })(),
            // 4. Incidents (now from Odoo!)
            client.getMaintenanceRequests(20),
            // 5. Assigned items (now from Odoo!)
            client.getEmployeeAssignedEquipment(employee.id),
            // 6. Payslips
            client.getEmployeePayslips(employee.id, 6),
            // 7. Salary Advances
            fetchSalaryAdvances(employee.name),
            // 8. Failed Checkouts
            client.getFailedCheckouts(employee.id),
            // 9. Work Center Performance
            // Version the cache key whenever the performance baseline changes so a
            // running process cannot serve a pre-baseline result.
            getDailyManufacturingAnalytics('performance-rate-2026-08-05-v2', () => client.getWorkCenterPerformance(employee.id, employee.name)),
            // 10. Manufacturing timing summary
            getDailyManufacturingAnalytics('timing-summary-v2', () => client.getManufacturingTimingSummary(employee.id, employee.name)),
            // 11. Manufacturing timeline data for charting
            getDailyManufacturingAnalytics('timeline-data-v2', () => client.getManufacturingTimelineData(employee.id, employee.name)),
            // 12. Board registration summary from physical inventory
            // 12. Board registration summary from physical inventory
            client.getBoardRegistrationSummary(stockScope),
            // 13. Team Penalties
            client.getTeamPenalties(stockScope),
            // 14. Equipment list for breakdown reporting (now from Odoo!)
            client.getMaintenanceEquipment(),
        ]);
        // Handle Attendance Result
        if (attendanceRes.status === 'fulfilled' && attendanceRes.value) {
            const rawAttendance = attendanceRes.value;
            result.attendance = {
                checkedIn: rawAttendance.checkedIn,
                checkedOut: rawAttendance.checkedOut,
                todayRecord: rawAttendance.todayRecord ? {
                    check_in: toEAT(rawAttendance.todayRecord.check_in) || rawAttendance.todayRecord.check_in,
                    check_out: toEAT(rawAttendance.todayRecord.check_out) || rawAttendance.todayRecord.check_out,
                } : null,
                recentRecords: rawAttendance.recentRecords.map((r) => ({
                    check_in: toEAT(r.check_in) || r.check_in,
                    check_out: toEAT(r.check_out) || r.check_out,
                })),
                isLate: false,
            };
            if (rawAttendance.todayRecord?.check_in) {
                const checkInTime = toEAT(rawAttendance.todayRecord.check_in);
                if (checkInTime) {
                    const timePart = checkInTime.split(' ')[1] || checkInTime;
                    const [hh, mm] = timePart.split(':').map(Number);
                    if (hh > 8 || (hh === 8 && mm > 30)) {
                        result.attendance.isLate = true;
                    }
                }
            }
        }
        // Handle Late Count Result
        if (lateCountRes.status === 'fulfilled') {
            result.lateCount = lateCountRes.value;
        }
        // Handle Work Orders & Stock Alerts
        if (workOrdersRes.status === 'fulfilled' && workOrdersRes.value) {
            result.workOrders = workOrdersRes.value.workOrders;
            result.stockAlerts = workOrdersRes.value.stockAlerts;
            result.areaPerformanceRates = workOrdersRes.value.areaPerformanceRates || [];
            result.reservedBoardsCount = workOrdersRes.value.reservedBoardsCount || 0;
        }
        // Handle Incidents (mapped from Odoo maintenance requests)
        if (incidentsRes.status === 'fulfilled' && incidentsRes.value) {
            result.incidents = incidentsRes.value.map((r) => {
                let machineName = r.name || 'Unknown Machine';
                if (machineName.startsWith('Breakdown: ')) {
                    machineName = machineName.replace('Breakdown: ', '');
                }
                const isResolved = r.stage_id ? (r.stage_id[1] === 'Repaired' || r.stage_id[1] === 'Scrap') : false;
                return {
                    id: String(r.id),
                    machineName,
                    description: r.description || null,
                    reportedBy: r.employee_id ? r.employee_id[1] : null,
                    reportedAt: r.request_date || '',
                    status: isResolved ? 'resolved' : 'open',
                    resolvedAt: r.close_date || null,
                };
            });
        }
        // Handle Assigned Items (mapped from Odoo assigned maintenance equipments)
        if (assignedItemsRes.status === 'fulfilled' && assignedItemsRes.value) {
            result.assignedItems = assignedItemsRes.value.map((e) => ({
                id: String(e.id),
                itemName: e.name || '',
                assignedDate: e.assign_date || '',
                quantity: 1,
                notes: e.serial_no ? `Serial: ${e.serial_no}` : null,
            }));
        }
        // Handle Equipment/Machines List (from Odoo maintenance.equipment)
        if (machinesRes.status === 'fulfilled' && machinesRes.value) {
            result.machines = machinesRes.value;
        }
        // Handle Payslips
        if (payslipsRes.status === 'fulfilled' && payslipsRes.value) {
            result.payslips = payslipsRes.value.map((p) => ({
                id: p.id,
                name: p.name,
                dateFrom: p.date_from,
                dateTo: p.date_to,
                state: p.state || 'draft',
                structure: Array.isArray(p.struct_id) ? p.struct_id[1] : '',
            }));
        }
        // Handle Salary Advances
        if (advancesRes.status === 'fulfilled' && advancesRes.value) {
            result.salaryAdvances = advancesRes.value;
        }
        // Handle Failed Checkouts
        if (failedCheckoutsRes.status === 'fulfilled') {
            result.failedCheckouts = failedCheckoutsRes.value;
        }
        // Handle Performance Rate
        if (performanceRateRes.status === 'fulfilled') {
            result.performanceRate = performanceRateRes.value;
        }
        // Handle Manufacturing Timing Summary
        if (manufacturingTimingRes.status === 'fulfilled') {
            result.manufacturingTimingSummary = manufacturingTimingRes.value;
        }
        // Handle Manufacturing Timeline Data
        if (manufacturingTimelineRes.status === 'fulfilled' && manufacturingTimelineRes.value) {
            const timelineRecords = manufacturingTimelineRes.value.records.map((record) => ({
                ...record,
                area: normalizeManufacturingArea(record.area) || normalizeManufacturingArea(record.workCenter) || detectArea(record.product || ''),
            }));
            result.manufacturingTimelineData = {
                monthLabel: manufacturingTimelineRes.value.monthLabel,
                workCenters: manufacturingTimelineRes.value.workCenters,
                records: timelineRecords,
            };
            const origins = [...new Set(timelineRecords.map((record) => record.origin).filter(Boolean))];
            const saleOrderDateMap = await client.getBulkSaleOrderConfirmationDates(origins).catch(() => new Map());
            const statsByArea = new Map();
            for (const record of timelineRecords) {
                const area = normalizeManufacturingArea(record.area) || normalizeManufacturingArea(record.workCenter) || detectArea(record.product || '');
                if (!statsByArea.has(area)) {
                    statsByArea.set(area, { completedOrders: 0, onTimeOrders: 0, overdueQuickClose: 0, days: [] });
                }
                const stats = statsByArea.get(area);
                const confirmedAt = record.origin ? saleOrderDateMap.get(record.origin) || null : null;
                record.confirmedAt = confirmedAt ? (confirmedAt.includes('T') ? confirmedAt : confirmedAt.replace(' ', 'T') + 'Z') : null;
                if (!confirmedAt) {
                    continue;
                }
                const soConfirmed = new Date(confirmedAt.includes('T') ? confirmedAt : confirmedAt.replace(' ', 'T') + 'Z');
                const startedAt = new Date(record.startedAt);
                const finishedAt = new Date(record.finishedAt);
                if (Number.isNaN(soConfirmed.getTime()) || Number.isNaN(finishedAt.getTime())) {
                    continue;
                }
                const minPerfDate = new Date('2026-08-05T00:00:00Z');
                if (soConfirmed.getTime() < minPerfDate.getTime()) {
                    continue;
                }
                stats.completedOrders += 1;
                const daysToComplete = (finishedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60 * 24);
                const hoursToStart = (startedAt.getTime() - soConfirmed.getTime()) / (1000 * 60 * 60);
                const minutesFromStartToFinish = (finishedAt.getTime() - startedAt.getTime()) / (1000 * 60);
                const overdueQuickClose = hoursToStart > 24
                    && minutesFromStartToFinish >= 0
                    && minutesFromStartToFinish <= 30;
                if (daysToComplete >= 0) {
                    stats.days.push(daysToComplete);
                }
                if (daysToComplete >= 0 && daysToComplete <= 3 && !overdueQuickClose) {
                    stats.onTimeOrders += 1;
                }
                if (overdueQuickClose) {
                    stats.overdueQuickClose += 1;
                }
            }
            const areaOrder = MANUFACTURING_AREAS;
            result.areaPerformanceRates = Array.from(statsByArea.entries())
                .map(([area, stats]) => {
                const percentage = stats.completedOrders > 0
                    ? Math.round((stats.onTimeOrders / stats.completedOrders) * 100)
                    : 0;
                const avgDaysToComplete = stats.days.length > 0
                    ? Math.round((stats.days.reduce((sum, value) => sum + value, 0) / stats.days.length) * 10) / 10
                    : 0;
                const color = percentage >= 75 ? 'green' : percentage >= 50 ? 'orange' : 'red';
                return {
                    area,
                    percentage,
                    color,
                    totalOrders: stats.completedOrders,
                    completedOrders: stats.completedOrders,
                    onTimeOrders: stats.onTimeOrders,
                    overdueQuickClose: stats.overdueQuickClose,
                    avgDaysToComplete,
                };
            })
                .sort((a, b) => {
                const aIndex = areaOrder.indexOf(a.area);
                const bIndex = areaOrder.indexOf(b.area);
                if (aIndex === -1 && bIndex === -1)
                    return a.area.localeCompare(b.area);
                if (aIndex === -1)
                    return 1;
                if (bIndex === -1)
                    return -1;
                return aIndex - bIndex;
            });
        }
        // Handle board registration summary
        if (boardRegistrationRes.status === 'fulfilled') {
            result.boardRegistrationSummary = boardRegistrationRes.value;
        }
        // Handle Team Penalties
        if (teamPenaltiesRes && teamPenaltiesRes.status === 'fulfilled') {
            result.teamPenalties = teamPenaltiesRes.value;
        }
    }
    catch (err) {
        result.error = err instanceof Error ? err.message : 'Failed to load shop floor data.';
    }
    return result;
}
router.get('/shop-floor', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    const viewedEmail = getViewedUserEmail(req);
    const cacheKey = `shop-floor-dashboard:v3:${viewedEmail.toLowerCase()}`;
    if (req.query.refresh === 'true') {
        shopFloorCache.delete(cacheKey);
        dailyManufacturingAnalytics.clear();
    }
    try {
        let data = shopFloorCache.get(cacheKey);
        if (!data) {
            const settings = await (0, repositories_1.getSettings)();
            const client = new odooClient_1.OdooClient(settings.odoo);
            data = await buildOperatorDashboard(client, viewedEmail, req, settings.stock);
            // Cache dashboard for 60 seconds
            shopFloorCache.set(cacheKey, data, 60 * 1000);
        }
        const featureFlags = await (0, repositories_1.getShopFloorFeatureFlags)();
        res.render('shop-floor', {
            pageTitle: 'Shop Floor',
            appName: env_1.env.APP_NAME,
            data,
            breakdownCatalog: machineBreakdownCatalog_1.MACHINE_BREAKDOWN_CATALOG,
            authUser: req.authUser,
            featureFlags,
            canManageFeatures: canManageShopFloor(req),
            csrfToken: req.csrfToken || null,
            message: typeof req.query.message === 'string' ? req.query.message : null,
            error: typeof req.query.error === 'string' ? req.query.error : null,
        });
    }
    catch (err) {
        res.status(500).render('error', {
            pageTitle: 'Shop Floor Error',
            errorMessage: err instanceof Error ? err.message : 'Could not load shop floor.',
            details: [],
            csrfToken: req.csrfToken || null,
        });
    }
});
router.get('/shop-floor/stock-alerts/notifications', async (req, res) => {
    if (!req.authUser) {
        res.status(401).json({ ok: false, alerts: [] });
        return;
    }
    try {
        const viewedEmail = getViewedUserEmail(req);
        const cacheKey = `shop-floor-dashboard:v2:${viewedEmail.toLowerCase()}`;
        let data = shopFloorCache.get(cacheKey);
        if (!data) {
            const settings = await (0, repositories_1.getSettings)();
            const client = new odooClient_1.OdooClient(settings.odoo);
            data = await buildOperatorDashboard(client, viewedEmail, req, settings.stock);
            shopFloorCache.set(cacheKey, data, 60 * 1000);
        }
        const alerts = data.isLimitedDashboard
            ? []
            : data.stockAlerts.map((alert) => ({
                id: `${alert.moId}:${alert.component}`,
                moName: alert.moName,
                product: alert.product,
                component: alert.component,
                qtyNeeded: alert.qtyNeeded,
                client: alert.client,
                confirmedAt: alert.confirmedAt,
                overdueDays: alert.overdueDays,
                message: `${alert.component}: count first, then key in ${alert.qtyNeeded} incoming board(s).`,
            }));
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            ok: true,
            count: alerts.length,
            alerts,
        });
    }
    catch (err) {
        res.status(500).json({
            ok: false,
            alerts: [],
            error: err instanceof Error ? err.message : 'Could not load stock alerts.',
        });
    }
});
router.get('/shop-floor/payslip/:id/download', async (req, res) => {
    if (!req.authUser) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const payslipId = parseInt(req.params.id, 10);
        if (isNaN(payslipId)) {
            res.status(400).send('Invalid payslip ID');
            return;
        }
        const [pdf, displayName] = await Promise.all([
            client.getPayslipPdf(payslipId),
            client.getPayslipName(payslipId),
        ]);
        if (!pdf) {
            res.status(404).send('Payslip PDF not found or not yet generated.');
            return;
        }
        const safeFilename = displayName.replace(/[<>:"/\\|?*]/g, '').trim() + '.pdf';
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
        res.setHeader('Content-Length', pdf.data.length);
        res.send(pdf.data);
    }
    catch (err) {
        res.status(500).send(err instanceof Error ? err.message : 'Failed to download payslip.');
    }
});
/**
 * GET /shop-floor/operators — Admin view: list all operators from Odoo Operations/Production departments.
 */
router.get('/shop-floor/operators', async (req, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
    if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
        res.status(403).redirect('/dashboard');
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        // Find operator departments
        const allDepartments = [];
        for (const deptName of OPERATOR_DEPARTMENT_NAMES) {
            const found = await client.findDepartmentByName(deptName);
            allDepartments.push(...found);
        }
        // Deduplicate by ID
        const uniqueDepts = [...new Map(allDepartments.map((d) => [d.id, d])).values()];
        // Get employees from each department
        const allOperators = [];
        const seenIds = new Set();
        for (const dept of uniqueDepts) {
            const employees = await client.getEmployeesByDepartment(dept.id);
            for (const emp of employees) {
                if (seenIds.has(emp.id))
                    continue;
                seenIds.add(emp.id);
                allOperators.push({
                    id: emp.id,
                    name: emp.name,
                    jobTitle: emp.job_title || null,
                    department: Array.isArray(emp.department_id) ? emp.department_id[1] : dept.name,
                    workEmail: emp.work_email || null,
                    mobilePhone: emp.mobile_phone || null,
                    userId: Array.isArray(emp.user_id) ? emp.user_id[0] : null,
                    userName: Array.isArray(emp.user_id) ? emp.user_id[1] : null,
                    checkedIn: false,
                    checkedOut: false,
                    checkInTime: null,
                    assignedItems: [],
                });
            }
        }
        // Get today's attendance for all operators
        if (allOperators.length > 0) {
            try {
                const operatorIds = allOperators.map((op) => op.id);
                const attendanceRecords = await client.getBulkAttendance(operatorIds);
                for (const rec of attendanceRecords) {
                    const empId = Array.isArray(rec.employee_id) ? rec.employee_id[0] : rec.employee_id;
                    const op = allOperators.find((o) => o.id === empId);
                    if (op) {
                        op.checkedIn = Boolean(rec.check_in && !rec.check_out);
                        op.checkedOut = Boolean(rec.check_out);
                        op.checkInTime = toEAT(rec.check_in) || rec.check_in;
                    }
                }
            }
            catch (err) {
                console.warn('[shopFloor] Failed to fetch bulk attendance:', err);
            }
        }
        // Get assigned items for all operators in bulk from Odoo!
        try {
            const allEquipments = await client.getBulkAssignedEquipment();
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
            for (const op of allOperators) {
                const items = equipByEmployeeId.get(op.id) || [];
                op.assignedItems = items.map((i) => ({
                    id: String(i.id),
                    itemName: i.name || '',
                    assignedDate: i.assign_date || '',
                    quantity: 1,
                }));
            }
        }
        catch (err) {
            console.warn('[shopFloor] Failed to fetch bulk assigned equipment:', err);
            for (const op of allOperators) {
                op.assignedItems = [];
            }
        }
        res.render('shop-floor-operators', {
            pageTitle: 'Shop Floor Operators',
            appName: env_1.env.APP_NAME,
            operators: allOperators,
            departments: uniqueDepts.map((d) => d.name),
            total: allOperators.length,
            checkedInCount: allOperators.filter((o) => o.checkedIn).length,
            authUser: req.authUser,
            message: typeof req.query.message === 'string' ? req.query.message : null,
            error: typeof req.query.error === 'string' ? req.query.error : null,
        });
    }
    catch (err) {
        res.status(500).render('error', {
            pageTitle: 'Error',
            errorMessage: err instanceof Error ? err.message : 'Could not load operators.',
            details: [],
            csrfToken: req.csrfToken || null,
        });
    }
});
/**
 * Build welcome email HTML for an operator.
 */
function buildOperatorWelcomeEmail(op, appUrl) {
    const firstName = op.name.split(' ')[0];
    const loginUrl = `${appUrl}/login`;
    const subject = `${firstName}, set up your Urban Vibe Shop Floor account`;
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background: #f4f4f8; padding: 2rem; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 2rem 2rem 1.5rem; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 1.5rem; font-weight: 700;">Urban Vibe Interior Design</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 0.5rem 0 0; font-size: 0.95rem;">Shop Floor Portal</p>
    </div>
    
    <!-- Body -->
    <div style="padding: 2rem;">
      <h2 style="color: #1e3a5f; margin: 0 0 1rem; font-size: 1.2rem;">Welcome, ${firstName}! 👋</h2>
      
      <p style="color: #374151; line-height: 1.6; margin: 0 0 1.5rem;">
        Your Shop Floor account has been set up. You can now:
      </p>
      
      <ul style="color: #374151; line-height: 1.8; margin: 0 0 1.5rem; padding-left: 1.2rem;">
        <li>📋 View your work orders and progress</li>
        <li>🕐 Check your attendance status</li>
        <li>💰 Download your payslips</li>
        <li>💸 See any salary advances</li>
      </ul>
      
      <p style="color: #374151; line-height: 1.6; margin: 0 0 1.5rem;">
        <strong>Your login email:</strong> ${op.workEmail}<br>
        Use this email to sign in — you'll receive a one-time code.
      </p>
      
      <!-- Button -->
      <div style="text-align: center; margin: 2rem 0;">
        <a href="${loginUrl}" style="display: inline-block; padding: 0.85rem 2.5rem; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 1rem;">
          Go to Shop Floor Portal →
        </a>
      </div>
      
      <p style="color: #6b7280; font-size: 0.85rem; line-height: 1.5; margin: 0;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${loginUrl}" style="color: #2563eb; word-break: break-all;">${loginUrl}</a>
      </p>
    </div>
    
    <!-- Footer -->
    <div style="background: #f9fafb; padding: 1.2rem 2rem; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="color: #9ca3af; font-size: 0.78rem; margin: 0;">
        Urban Vibe Interior Design LTD · Shop Floor Portal<br>
        This is an automated message. Please do not reply directly.
      </p>
    </div>
  </div>
</body>
</html>`.trim();
    return { subject, html };
}
/**
 * POST /shop-floor/operators/send-invite
 * Sends welcome emails to selected operators with login instructions.
 */
router.post('/shop-floor/operators/send-invite', async (req, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
    if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
        res.status(403).json({ ok: false, error: 'Access denied.' });
        return;
    }
    const ids = Array.isArray(req.body.ids) ? req.body.ids : (req.body.ids ? [String(req.body.ids)] : []);
    if (ids.length === 0) {
        res.redirect('/shop-floor/operators?error=' + encodeURIComponent('Select at least one operator.'));
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        // Fetch operator details
        const operatorIds = ids.map(Number).filter((n) => !isNaN(n));
        const allOperators = [];
        for (const deptName of OPERATOR_DEPARTMENT_NAMES) {
            const depts = await client.findDepartmentByName(deptName);
            for (const dept of depts) {
                const emps = await client.getEmployeesByDepartment(dept.id);
                for (const emp of emps) {
                    if (operatorIds.includes(emp.id) && emp.work_email) {
                        allOperators.push({ id: emp.id, name: emp.name, workEmail: emp.work_email });
                    }
                }
            }
        }
        const appUrl = env_1.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
        let sent = 0;
        const errors = [];
        for (const op of allOperators) {
            if (!op.workEmail) {
                errors.push(`${op.name}: no work email`);
                continue;
            }
            try {
                const { subject, html } = buildOperatorWelcomeEmail({ name: op.name, workEmail: op.workEmail }, appUrl);
                void (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
                    to: op.workEmail,
                    subject,
                    html,
                });
                sent++;
            }
            catch (err) {
                errors.push(`${op.name}: ${err instanceof Error ? err.message : 'send failed'}`);
            }
        }
        const msg = `Sent ${sent} welcome email(s)${errors.length ? '. Errors: ' + errors.join('; ') : ''}`;
        res.redirect(`/shop-floor/operators?message=${encodeURIComponent(msg)}`);
    }
    catch (err) {
        res.redirect(`/shop-floor/operators?error=${encodeURIComponent(err instanceof Error ? err.message : 'Failed to send invites.')}`);
    }
});
/**
 * POST /shop-floor/operators/send-invite
 * Sends welcome emails to selected operators with login instructions.
 */
router.post('/shop-floor/operators/send-invite', async (req, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
    if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
        res.status(403).json({ ok: false, error: 'Access denied.' });
        return;
    }
    const ids = Array.isArray(req.body.ids) ? req.body.ids : (req.body.ids ? [String(req.body.ids)] : []);
    if (ids.length === 0) {
        res.redirect('/shop-floor/operators?error=' + encodeURIComponent('Select at least one operator.'));
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        // Fetch operator details
        const operatorIds = ids.map(Number).filter((n) => !isNaN(n));
        const allOperators = [];
        for (const deptName of OPERATOR_DEPARTMENT_NAMES) {
            const depts = await client.findDepartmentByName(deptName);
            for (const dept of depts) {
                const emps = await client.getEmployeesByDepartment(dept.id);
                for (const emp of emps) {
                    if (operatorIds.includes(emp.id) && emp.work_email) {
                        allOperators.push({ id: emp.id, name: emp.name, workEmail: emp.work_email });
                    }
                }
            }
        }
        const appUrl = env_1.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
        let sent = 0;
        const errors = [];
        for (const op of allOperators) {
            if (!op.workEmail) {
                errors.push(`${op.name}: no work email`);
                continue;
            }
            try {
                const { subject, html } = buildOperatorWelcomeEmail({ name: op.name, workEmail: op.workEmail }, appUrl);
                await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
                    to: op.workEmail,
                    subject,
                    html,
                });
                sent++;
            }
            catch (err) {
                errors.push(`${op.name}: ${err instanceof Error ? err.message : 'send failed'}`);
            }
        }
        const msg = `Sent ${sent} welcome email(s)${errors.length ? '. Errors: ' + errors.join('; ') : ''}`;
        res.redirect(`/shop-floor/operators?message=${encodeURIComponent(msg)}`);
    }
    catch (err) {
        res.redirect(`/shop-floor/operators?error=${encodeURIComponent(err instanceof Error ? err.message : 'Failed to send invites.')}`);
    }
});
/**
 * POST /shop-floor/operators/sync-access — Sync operators to Access Control approved users.
 */
router.post('/shop-floor/operators/sync-access', async (req, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
    if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
        res.status(403).redirect('/dashboard');
        return;
    }
    try {
        const result = await (0, shopFloorOperatorAccessSyncService_1.syncShopFloorOperatorAccess)();
        res.redirect(`/shop-floor/operators?message=${encodeURIComponent(`Synced ${result.operators} operator(s): ${result.added} added and ${result.updated} updated with Shop Floor access.`)}`);
    }
    catch (err) {
        res.redirect(`/shop-floor/operators?error=${encodeURIComponent(err instanceof Error ? err.message : 'Failed to sync operators.')}`);
    }
});
/**
 * POST /shop-floor/incident — Report a machine breakdown.
 */
router.post('/shop-floor/incident', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const viewedEmail = getViewedUserEmail(req);
        // Find the employee ID
        let employee = await client.findEmployeeByUserEmail(viewedEmail);
        if (!employee) {
            employee = await client.findEmployeeByWorkEmail(viewedEmail);
        }
        const employeeId = employee ? employee.id : null;
        const machineInput = String(req.body.machine || '');
        const component = String(req.body.component || '').trim();
        let equipmentId = null;
        let machineName = '';
        if (machineInput === '__custom__') {
            machineName = String(req.body.machineCustom || '').trim();
        }
        else {
            const eqId = Number(machineInput);
            if (Number.isFinite(eqId) && eqId > 0) {
                equipmentId = eqId;
                const equipment = await client.readRecords('maintenance.equipment', [eqId], ['name']);
                if (equipment && equipment.length > 0) {
                    machineName = equipment[0].name;
                }
                else {
                    machineName = `Equipment ID ${eqId}`;
                }
            }
            else {
                machineName = machineInput;
            }
        }
        if (!machineName) {
            throw new Error('Please specify a machine.');
        }
        if (!(0, machineBreakdownCatalog_1.isValidMachineComponent)(machineName, component)) {
            throw new Error('Select a valid component for the chosen machine.');
        }
        const severity = String(req.body._severity || 'medium');
        const priorityMap = {
            critical: '3',
            high: '2',
            medium: '1',
            low: '0',
        };
        const priority = priorityMap[severity] || '1';
        await client.createMaintenanceRequest({
            equipmentId,
            machineName,
            description: `Component: ${component}\n${String(req.body.description || '')}`,
            employeeId,
            priority,
        });
        // Invalidate cached operator dashboards because of the new incident
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        res.redirect('/shop-floor?message=' + encodeURIComponent('Incident reported.'));
    }
    catch (err) {
        res.redirect('/shop-floor?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed.'));
    }
});
/**
 * POST /shop-floor/incident/:id/resolve
 */
router.post('/shop-floor/incident/:id/resolve', async (req, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
    if (!req.authUser || (!isAdmin && !isShopFloorAdmin)) {
        res.redirect('/login');
        return;
    }
    try {
        const incidentId = Number(req.params.id);
        if (Number.isFinite(incidentId) && incidentId > 0) {
            const settings = await (0, repositories_1.getSettings)();
            const client = new odooClient_1.OdooClient(settings.odoo);
            await client.resolveMaintenanceRequest(incidentId);
        }
        else {
            await (0, repositories_3.resolveShopFloorIncident)(req.params.id);
        }
        // Invalidate cached operator dashboards as an incident was resolved
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        res.redirect('/shop-floor?message=' + encodeURIComponent('Incident resolved.'));
    }
    catch (err) {
        res.redirect('/shop-floor?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed.'));
    }
});
/**
 * POST /shop-floor/work-order/:id/plan-date
 * Stores the client-required completion date on the manufacturing order.
 */
router.post('/shop-floor/work-order/:id/plan-date', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    const moId = Number(req.params.id);
    const planDate = String(req.body.planDate || '').trim();
    const returnTo = String(req.body.returnTo || '/shop-floor');
    if (!Number.isFinite(moId) || moId <= 0) {
        res.redirect(`${returnTo}?error=${encodeURIComponent('Invalid manufacturing order.')}`);
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(planDate)) {
        res.redirect(`${returnTo}?error=${encodeURIComponent('Please choose a valid plan date.')}`);
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        await client.setManufacturingOrderPlanDate(moId, `${planDate} 23:59:59`);
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        res.redirect(`${returnTo}?message=${encodeURIComponent('Plan date saved.')}`);
    }
    catch (err) {
        res.redirect(`${returnTo}?error=${encodeURIComponent(err instanceof Error ? err.message : 'Failed to save plan date.')}`);
    }
});
/**
 * POST /shop-floor/assign-item â€” Admin assigns equipment to an operator.
 */
router.post('/shop-floor/assign-item', async (req, res) => {
    const isAdmin = req.authUser?.role === 'admin';
    const isShopFloorAdmin = req.authUser?.apps?.includes('shop-floor-admin');
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    const viewedEmail = getViewedUserEmail(req);
    const emailStr = isAdmin || isShopFloorAdmin
        ? String(req.body.email || viewedEmail || '')
        : String(viewedEmail || '');
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        await client.assignEquipmentToEmployee(emailStr, String(req.body.itemName || ''), String(req.body.assignedDate || new Date().toISOString().slice(0, 10)));
        // Invalidate the cache for this specific operator
        if (emailStr) {
            shopFloorCache.delete(`shop-floor-dashboard:v2:${emailStr.toLowerCase()}`);
        }
        res.redirect('/shop-floor/operators?message=' + encodeURIComponent('Item assigned.'));
    }
    catch (err) {
        res.redirect('/shop-floor/operators?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed.'));
    }
});
/**
 * GET /shop-floor/boards — Board Intake & Auto-Reserve dashboard.
 */
router.get('/shop-floor/boards', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    const featureFlags = await (0, repositories_1.getShopFloorFeatureFlags)();
    if (!featureFlags['add-stock'] && !canManageShopFloor(req)) {
        res.status(404).render('error', {
            pageTitle: 'Feature unavailable',
            errorMessage: 'Add Stock is currently disabled by an administrator.',
            details: [],
            csrfToken: req.csrfToken || null,
        });
        return;
    }
    try {
        const [settings, stockMirror, recentIntakes] = await Promise.all([
            (0, repositories_1.getSettings)(),
            (0, stockMirrorService_1.getStockMirrorForPage)(req.query.refresh === 'true'),
            (0, repositories_1.getRecentBoardIntakeQueueEntries)(),
        ]);
        const products = stockMirror.products;
        const viewedEmail = getViewedUserEmail(req);
        const dashboardCacheKey = `shop-floor-dashboard:v2:${viewedEmail.toLowerCase()}`;
        let dashboardData = shopFloorCache.get(dashboardCacheKey);
        if (!dashboardData) {
            const client = new odooClient_1.OdooClient(settings.odoo);
            dashboardData = await buildOperatorDashboard(client, viewedEmail, req, settings.stock);
            shopFloorCache.set(dashboardCacheKey, dashboardData, 60 * 1000);
        }
        res.render('shop-floor-boards', {
            pageTitle: 'Board Intake & Auto-Reserve',
            appName: env_1.env.APP_NAME,
            products,
            stockMirror,
            recentIntakes,
            stockAlerts: dashboardData.isLimitedDashboard ? [] : dashboardData.stockAlerts,
            customers: [],
            authUser: req.authUser,
            csrfToken: req.csrfToken || null,
            message: typeof req.query.message === 'string' ? req.query.message : null,
            error: typeof req.query.error === 'string' ? req.query.error : null,
            intakeResult: typeof req.query.intakeResult === 'string'
                ? (() => { try {
                    return JSON.parse(req.query.intakeResult);
                }
                catch {
                    return null;
                } })()
                : null,
        });
    }
    catch (err) {
        res.status(500).render('error', {
            pageTitle: 'Board Intake Error',
            errorMessage: err instanceof Error ? err.message : 'Could not load board intake page.',
            details: [],
            csrfToken: req.csrfToken || null,
        });
    }
});
/**
 * GET /shop-floor/boards/requirements — Fetch pending board component requirements for a customer's MOs.
 */
router.get('/shop-floor/boards/requirements', async (req, res) => {
    if (!req.authUser) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const partnerId = Number(req.query.partner_id);
    if (!partnerId) {
        res.status(400).json({ error: 'Missing partner_id' });
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const requirements = await client.getCustomerBoardRequirements(partnerId);
        res.json(applyOptimisticBoardIntakes(partnerId, requirements));
    }
    catch (err) {
        console.error('[shopFloorRouter] Failed to fetch board requirements:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
/**
 * POST /shop-floor/board-intake — Log board intake and auto-reserve on matching MOs.
 *
 * Workflow:
 * 1. Add boards to stock (inventory adjustment)
 * 2. Find MOs needing this board for this client (no PO covering it)
 * 3. Call action_assign to reserve stock on those MOs
 * 4. Redirect with detailed result
 */
/**
 * GET /shop-floor/partners/search - Search partner/client records from Odoo.
 */
router.get('/shop-floor/partners/search', async (req, res) => {
    if (!req.authUser) {
        res.status(401).json({ ok: false, results: [] });
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const query = typeof req.query.q === 'string' ? req.query.q : '';
        const results = await client.searchPartners(query, 30);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            ok: true,
            query,
            results,
        });
    }
    catch (err) {
        console.error('[shopFloorRouter] Failed to search partner records:', err);
        res.status(500).json({ ok: false, results: [] });
    }
});
router.post('/shop-floor/work-order/:id/advance', async (req, res) => {
    const wantsJson = req.get('accept')?.includes('application/json');
    if (!req.authUser) {
        if (wantsJson) {
            res.status(401).json({
                ok: false,
                code: 'session_expired',
                message: 'Your session has expired. Sign in again, then retry this job.',
                loginUrl: '/login?next=%2Fshop-floor',
            });
            return;
        }
        res.redirect('/login');
        return;
    }
    const moId = Number(req.params.id);
    const action = req.body.action === 'finish' ? 'finish' : 'start';
    if (!Number.isFinite(moId) || moId <= 0) {
        if (wantsJson) {
            res.status(400).json({ ok: false, message: 'Invalid manufacturing order.' });
            return;
        }
        res.redirect('/shop-floor?error=' + encodeURIComponent('Invalid manufacturing order.') + '#manufacturing-orders');
        return;
    }
    try {
        const viewedEmail = getViewedUserEmail(req);
        const cacheKey = `shop-floor-dashboard:v2:${viewedEmail.toLowerCase()}`;
        const cachedDashboard = shopFloorCache.get(cacheKey);
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const employee = cachedDashboard?.employee?.id
            ? { id: cachedDashboard.employee.id, name: cachedDashboard.employee.name }
            : await client.findEmployeeForShopFloorEmail(viewedEmail);
        if (!employee) {
            throw new Error('Your signed-in account is not linked to an Odoo employee. Ask an administrator to match your email.');
        }
        if (action === 'start') {
            const procurement = await client.getManufacturingOrderBoardProcurement(moId);
            if (procurement.waitingForBoards) {
                const approvedPurchaseOrders = procurement.purchaseOrders.filter((po) => ['purchase', 'done'].includes(po.state));
                const pendingPurchaseOrders = procurement.purchaseOrders.filter((po) => ['draft', 'sent', 'to approve'].includes(po.state));
                if (approvedPurchaseOrders.length) {
                    const message = `${procurement.moName} is waiting for purchased boards. Validate their reception before starting the job.`;
                    const redirectTo = `/shop-floor/receipts?message=${encodeURIComponent(message)}`;
                    if (wantsJson) {
                        res.status(409).json({ ok: false, code: 'receipt_required', message, redirectTo });
                        return;
                    }
                    res.redirect(redirectTo);
                    return;
                }
                if (pendingPurchaseOrders.length) {
                    const notification = await sendPurchaseApprovalRequest({
                        settings,
                        operatorName: employee.name,
                        operatorEmail: viewedEmail,
                        procurement,
                    });
                    const poNames = pendingPurchaseOrders.map((po) => po.name).join(', ');
                    const message = notification.throttled
                        ? `${poNames} still requires approval. DB Admin and Charles were already notified recently.`
                        : `${poNames} requires approval. An email has been sent to DB Admin and Charles.`;
                    if (wantsJson) {
                        res.status(409).json({ ok: false, code: 'purchase_approval_required', message });
                        return;
                    }
                    res.redirect('/shop-floor?error=' + encodeURIComponent(message) + '#manufacturing-orders');
                    return;
                }
            }
        }
        const advanceResult = await client.advanceManufacturingOrder(moId, action, employee.id);
        manuallyPausedMoIds.delete(moId);
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        const message = action === 'finish'
            ? 'Current operation finished.'
            : `Manufacturing operation started for ${employee.name}.`;
        const operatorTrackingWarning = action === 'start'
            && advanceResult
            && typeof advanceResult === 'object'
            && 'operatorLinked' in advanceResult
            && !advanceResult.operatorLinked
            ? 'The job is In Progress in Odoo, but Odoo did not allow this app to update the employee tracking field.'
            : null;
        if (operatorTrackingWarning) {
            void (0, logService_1.logEvent)('warn', 'Odoo work order started without employee tracking attribution', {
                moId,
                employeeId: employee.id,
                employeeName: employee.name,
                operatorEmail: viewedEmail,
            });
        }
        if (wantsJson) {
            res.setHeader('Cache-Control', 'no-store');
            res.json({
                ok: true,
                state: action === 'finish' ? 'done' : 'progress',
                message,
                warning: operatorTrackingWarning,
                employeeName: employee.name,
            });
            return;
        }
        res.redirect('/shop-floor?message=' + encodeURIComponent(message) + '#manufacturing-orders');
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Could not update the manufacturing order.';
        void (0, logService_1.logEvent)('error', 'Shop Floor manufacturing-order action failed in Odoo', {
            moId,
            action,
            operatorEmail: getViewedUserEmail(req),
            error: message,
        });
        const permissionDenied = /access denied|access error|not allowed|permission|forbidden/i.test(message);
        if (wantsJson) {
            res.status(permissionDenied ? 403 : 500).json({
                ok: false,
                code: permissionDenied ? 'permission_denied' : 'odoo_error',
                message,
            });
            return;
        }
        res.redirect('/shop-floor?error=' + encodeURIComponent(message) + '#manufacturing-orders');
    }
});
router.get('/shop-floor/work-order/:id/pause', (req, res) => {
    res.redirect('/shop-floor#manufacturing-orders');
});
router.post('/shop-floor/work-order/:id/pause', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    const moId = Number(req.params.id);
    const createBackorder = String(req.body.createBackorder || 'true') === 'true';
    const qtyProduced = Number(req.body.qtyProduced || 0);
    try {
        const settings = await (0, repositories_1.getSettings)();
        const client = new odooClient_1.OdooClient(settings.odoo);
        const viewedEmail = getViewedUserEmail(req);
        const employee = await client.findEmployeeForShopFloorEmail(viewedEmail);
        if (!employee)
            throw new Error('Your account is not linked to an Odoo employee.');
        await client.pauseManufacturingOrder(moId, { createBackorder, qtyProduced }, employee.id);
        manuallyPausedMoIds.add(moId);
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        await (0, logService_1.logEvent)('info', 'Manufacturing order paused', { moId, actor: employee.name, createBackorder });
        res.redirect('/shop-floor?message=' + encodeURIComponent('Manufacturing order paused successfully.') + '#manufacturing-orders');
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Could not pause the manufacturing order.';
        res.redirect('/shop-floor?error=' + encodeURIComponent(message) + '#manufacturing-orders');
    }
});
router.get('/shop-floor/operators/weekly-report.pdf', async (req, res) => {
    if (!canManageShopFloor(req)) {
        res.status(403).send('Administrator access required.');
        return;
    }
    try {
        const fromDate = typeof req.query.fromDate === 'string' ? req.query.fromDate : undefined;
        const toDate = typeof req.query.toDate === 'string' ? req.query.toDate : undefined;
        const pdf = await (0, weeklyShopFloorReportService_1.renderWeeklyShopFloorReportPdf)(undefined, { fromDate, toDate });
        const filename = `shop-floor-weekly-${fromDate || 'report'}-to-${toDate || new Date().toISOString().slice(0, 10)}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdf);
    }
    catch (error) {
        res.status(500).send(error instanceof Error ? error.message : 'Could not generate report.');
    }
});
router.post('/shop-floor/operators/send-weekly-report', async (req, res) => {
    if (!canManageShopFloor(req)) {
        res.status(403).send('Administrator access required.');
        return;
    }
    try {
        const sendMode = String(req.body.sendMode || 'all');
        const recipientEmail = String(req.body.recipientEmail || '').trim().toLowerCase();
        if (sendMode === 'entered' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
            res.redirect(`/shop-floor/operators?error=${encodeURIComponent('Enter a valid recipient email address.')}`);
            return;
        }
        const recipients = sendMode === 'entered'
            ? await (0, weeklyShopFloorReportService_1.sendWeeklyShopFloorReport)([recipientEmail], false)
            : await (0, weeklyShopFloorReportService_1.sendWeeklyShopFloorReport)();
        res.redirect(`/shop-floor/operators?message=${encodeURIComponent(`Report sent to ${recipients.join(', ')}.`)}`);
    }
    catch (error) {
        res.redirect(`/shop-floor/operators?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not send report.')}`);
    }
});
router.post('/shop-floor/features', async (req, res) => {
    if (!canManageShopFloor(req)) {
        res.status(403).send('Only administrators can manage Shop Floor apps.');
        return;
    }
    const flags = SHOP_FLOOR_FEATURE_KEYS.reduce((result, key) => {
        result[key] = req.body[key] === 'on';
        return result;
    }, {});
    await (0, repositories_1.saveShopFloorFeatureFlags)(flags);
    shopFloorCache.clear();
    await (0, logService_1.logEvent)('info', 'Shop Floor app availability updated', { updatedBy: req.authUser?.email, flags }).catch(() => undefined);
    res.redirect('/shop-floor?message=' + encodeURIComponent('Shop Floor apps updated.'));
});
router.post('/shop-floor/board-intake', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    const { product_id, quantity, partner_id } = req.body;
    if (!product_id || !quantity || !partner_id) {
        res.redirect('/shop-floor/boards?error=' + encodeURIComponent('Missing required fields: board type, quantity, and client are all required.'));
        return;
    }
    const productId = Number(product_id);
    const qty = Number(quantity);
    const partnerId = Number(partner_id);
    if (qty <= 0 || !Number.isFinite(qty)) {
        res.redirect('/shop-floor/boards?error=' + encodeURIComponent('Quantity must be a positive number.'));
        return;
    }
    try {
        const productName = String(req.body.product_name || '').trim() || `Product #${productId}`;
        const customerName = String(req.body.partner_name || '').trim() || `Client #${partnerId}`;
        const actorName = req.authUser.displayName || req.authUser.email;
        const optimisticId = (0, crypto_1.randomUUID)();
        await (0, repositories_1.createBoardIntakeQueueEntry)({
            id: optimisticId, productId, productName, partnerId, customerName,
            quantity: qty, actorName, actorEmail: req.authUser.email,
        });
        await (0, stockMirrorService_1.recordOptimisticStockAddition)(productId, productName, qty);
        optimisticBoardIntakes.push({ id: optimisticId, partnerId, productId, productName, customerName, quantity: qty, expiresAt: Date.now() + 10 * 60 * 1000 });
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        res.redirect('/shop-floor/boards?message=' + encodeURIComponent(`Boards saved immediately: ${qty} x ${productName} for ${customerName}. Odoo synchronization and MO reservation are continuing automatically.`));
        void (async () => {
            try {
                const syncResult = await (0, boardIntakeSyncService_1.syncBoardIntakeEntry)(optimisticId);
                const settings = await (0, repositories_1.getSettings)();
                const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: env_1.env.APP_TIMEZONE || 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
                const safeCustomerName = escapeHtml(customerName);
                const safeProductName = escapeHtml(productName);
                const safeActorEmail = escapeHtml(actorName);
                const subjectCustomerName = customerName.replace(/[\r\n]+/g, ' ').trim();
                await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
                    to: 'sharon@urbanvibeinteriordesign.co.ke',
                    subject: `${subjectCustomerName} - Board Log - ${reportDate}`,
                    html: `<p><strong>Board log completed</strong></p><p>Client: ${safeCustomerName}<br>Board: ${safeProductName}<br>Quantity: ${qty}<br>Date: ${reportDate}<br>Logged by: ${safeActorEmail}</p>`,
                }).catch((mailError) => (0, logService_1.logEvent)('error', 'Board log email to Sharon failed', { customerName, productName, quantity: qty, actor: actorName, actorEmail: req.authUser?.email, error: mailError instanceof Error ? mailError.message : String(mailError) }));
                const optimisticIndex = optimisticBoardIntakes.findIndex((entry) => entry.id === optimisticId);
                if (optimisticIndex >= 0)
                    optimisticBoardIntakes.splice(optimisticIndex, 1);
                shopFloorCache.clearPrefix('shop-floor-dashboard:');
                await (0, logService_1.logEvent)('info', 'Board intake background MO reservation completed', {
                    productId, partnerId, quantity: qty,
                    matchingMoCount: syncResult.matchingMoCount || 0,
                });
            }
            catch (backgroundError) {
                const message = backgroundError instanceof Error ? backgroundError.message : String(backgroundError);
                await (0, logService_1.logEvent)('error', 'Board intake background MO reservation failed', {
                    productId, partnerId, quantity: qty,
                    error: message,
                });
            }
        })();
        return;
        /* Legacy synchronous reservation path removed.
        const [productRecords, customerRecord, matchingMOs] = await Promise.all([
          client.readRecords<{ name: string }>('product.product', [productId], ['name']),
          client.getPartnerById(partnerId),
          client.findMOsForBoardIntake({ productId, partnerId }),
        ]);
        const productName = productRecords[0]?.name || `Product #${productId}`;
        const customerName = customerRecord?.name || `Client #${partnerId}`;
    
        let reserveResult: { reserved: number[]; failed: number[] } = { reserved: [], failed: [] };
        let reservedMONames: string[] = [];
    
        if (matchingMOs.length > 0) {
          // Step 3: Reserve stock on matching MOs
          const moIds = matchingMOs.map(m => m.moId);
          reserveResult = await client.reserveStockOnMOs(moIds);
    
          // Get reserved MO names
          reservedMONames = matchingMOs
            .filter(m => reserveResult.reserved.includes(m.moId))
            .map(m => m.moName + (m.origin ? ` (${m.origin})` : ''));
        }
    
        // Build success message
        const parts: string[] = [];
        parts.push(`✓ ${qty} × ${productName} added to stock for ${customerName} (${stockResult.previousQty} → ${stockResult.newQty}).`);
    
        if (reservedMONames.length > 0) {
          parts.push(`✓ Auto-reserved on ${reservedMONames.length} MO(s): ${reservedMONames.join(', ')}.`);
        } else if (matchingMOs.length === 0) {
          parts.push('ℹ No pending manufacturing orders require this board for this client (or POs already cover it).');
        }
    
        if (reserveResult.failed.length > 0) {
          parts.push(`⚠ Failed to reserve on ${reserveResult.failed.length} MO(s).`);
        }
    
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        res.redirect('/shop-floor/boards?message=' + encodeURIComponent(parts.join(' ')));
        */
    }
    catch (err) {
        res.redirect('/shop-floor/boards?error=' + encodeURIComponent(err instanceof Error ? err.message : 'Failed to process board intake.'));
    }
});
router.get('/shop-floor/receipts', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const warehouseId = Number(settings.stock.warehouseId || 0);
        if (!warehouseId)
            throw new Error('The Urban Vibe warehouse ID is not configured.');
        const receipts = await new odooClient_1.OdooClient(settings.odoo).getOpenBoardReceipts(warehouseId);
        res.render('shop-floor-receipts', { pageTitle: 'Board Receipts', appName: env_1.env.APP_NAME, receipts, authUser: req.authUser, csrfToken: req.csrfToken || null, message: req.query.message || null, error: req.query.error || null });
    }
    catch (error) {
        res.status(500).render('error', { pageTitle: 'Board Receipts', errorMessage: error instanceof Error ? error.message : 'Could not load receipts.', details: [], csrfToken: req.csrfToken || null });
    }
});
router.post('/shop-floor/board-intake/:id/retry', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    try {
        await (0, boardIntakeSyncService_1.syncBoardIntakeEntry)(String(req.params.id || ''));
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        res.redirect('/shop-floor/boards?message=' + encodeURIComponent('Board log synchronized with Odoo successfully.'));
    }
    catch (error) {
        res.redirect('/shop-floor/boards?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Board log retry failed.'));
    }
});
router.post('/shop-floor/receipts/:id/validate', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const pickingId = Number(req.params.id);
        const warehouseId = Number(settings.stock.warehouseId || 0);
        if (!warehouseId)
            throw new Error('The Urban Vibe warehouse ID is not configured.');
        const actorName = req.authUser.displayName || req.authUser.email;
        await new odooClient_1.OdooClient(settings.odoo).validateBoardReceipt(pickingId, actorName, warehouseId);
        shopFloorCache.clearPrefix('shop-floor-dashboard:');
        void (0, stockMirrorService_1.refreshStockMirror)();
        await (0, logService_1.logEvent)('info', 'Odoo board receipt validated', { pickingId, actor: actorName, actorEmail: req.authUser.email });
        res.redirect('/shop-floor/receipts?message=' + encodeURIComponent('Receipt validated in Odoo. Manufacturing Order readiness updated immediately.'));
    }
    catch (error) {
        res.redirect('/shop-floor/receipts?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Receipt validation failed.'));
    }
});
router.get('/shop-floor/deliveries', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const warehouseId = Number(settings.stock.warehouseId || 0);
        if (!warehouseId)
            throw new Error('The Urban Vibe warehouse ID is not configured.');
        const deliveries = await new odooClient_1.OdooClient(settings.odoo).getOpenDeliveries(warehouseId);
        res.render('shop-floor-deliveries', { pageTitle: 'Deliveries', appName: env_1.env.APP_NAME, deliveries, authUser: req.authUser, csrfToken: req.csrfToken || null, message: req.query.message || null, error: req.query.error || null });
    }
    catch (error) {
        res.status(500).render('error', { pageTitle: 'Deliveries', errorMessage: error instanceof Error ? error.message : 'Could not load deliveries.', details: [], csrfToken: req.csrfToken || null });
    }
});
router.post('/shop-floor/deliveries/:id/validate', async (req, res) => {
    if (!req.authUser) {
        res.redirect('/login');
        return;
    }
    try {
        const settings = await (0, repositories_1.getSettings)();
        const pickingId = Number(req.params.id);
        if (!Number.isFinite(pickingId) || pickingId <= 0)
            throw new Error('Invalid delivery.');
        const warehouseId = Number(settings.stock.warehouseId || 0);
        if (!warehouseId)
            throw new Error('The Urban Vibe warehouse ID is not configured.');
        const actorName = req.authUser.displayName || req.authUser.email;
        await new odooClient_1.OdooClient(settings.odoo).validateDelivery(pickingId, actorName, warehouseId);
        void (0, stockMirrorService_1.refreshStockMirror)();
        await (0, logService_1.logEvent)('info', 'Odoo delivery validated', { pickingId, actor: actorName, actorEmail: req.authUser.email });
        res.redirect('/shop-floor/deliveries?message=' + encodeURIComponent('Delivery validated in Odoo.'));
    }
    catch (error) {
        res.redirect('/shop-floor/deliveries?error=' + encodeURIComponent(error instanceof Error ? error.message : 'Delivery validation failed.'));
    }
});
exports.default = router;
