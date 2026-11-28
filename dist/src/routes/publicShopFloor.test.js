"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const shopFloor_1 = require("./shopFloor");
const shopFloorReporting_1 = require("../utils/shopFloorReporting");
const shopFloorDeviceAuthService_1 = require("../services/shopFloorDeviceAuthService");
(0, node_test_1.default)('groupWorkOrdersByAreaAndClient groups work orders by operation area and then by client name', () => {
    const sampleWorkOrders = [
        {
            id: 101,
            name: 'WH/MO/0101',
            product: 'Cutting Dark Grey MDF 18mm',
            qty: 10,
            produced: 0,
            state: 'ready',
            client: 'ARTEC INTERIORS',
            area: 'Table Saw Area',
            stockStatus: 'ready',
            hasStockIssue: false,
        },
        {
            id: 102,
            name: 'WH/MO/0102',
            product: 'Cutting White MDF 18mm',
            qty: 5,
            produced: 2,
            state: 'progress',
            client: 'ARTEC INTERIORS',
            area: 'Table Saw Area',
            stockStatus: 'ready',
            hasStockIssue: false,
        },
        {
            id: 103,
            name: 'WH/MO/0103',
            product: 'Cutting Walnut MDF 18mm',
            qty: 8,
            produced: 0,
            state: 'ready',
            client: 'STEPHENE OILE',
            area: 'Table Saw Area',
            stockStatus: 'no_stock',
            hasStockIssue: true,
        },
        {
            id: 201,
            name: 'WH/MO/0201',
            product: 'Edging 2mm PVC',
            qty: 50,
            produced: 10,
            state: 'paused',
            client: 'ARTEC INTERIORS',
            area: 'Edge Banding Area',
            stockStatus: 'ready',
            hasStockIssue: false,
        },
        {
            id: 301,
            name: 'WH/MO/0301',
            product: 'Optimised Panels Racking',
            qty: 30,
            produced: 30,
            state: 'done',
            client: 'STEPHENE OILE',
            area: 'Panel Rack Area',
            stockStatus: 'ready',
            hasStockIssue: false,
        },
    ];
    const result = (0, shopFloor_1.groupWorkOrdersByAreaAndClient)(sampleWorkOrders);
    strict_1.default.ok(Array.isArray(result));
    strict_1.default.ok(result.length >= 3, 'Should include at least Table Saw, Edge Banding, and Panel Rack');
    const tableSaw = result.find((g) => g.areaName === 'Table Saw Area');
    strict_1.default.ok(tableSaw, 'Table Saw Area group must exist');
    strict_1.default.equal(tableSaw.totalOrders, 3);
    strict_1.default.equal(tableSaw.inProgressOrders, 1);
    strict_1.default.equal(tableSaw.readyOrders, 2);
    strict_1.default.equal(tableSaw.totalQuantity, 23);
    // Check client grouping within Table Saw Area
    strict_1.default.equal(tableSaw.clientGroups.length, 2);
    // Artec Interiors has an in-progress order, so it should be sorted first
    strict_1.default.equal(tableSaw.clientGroups[0].clientName, 'ARTEC INTERIORS');
    strict_1.default.equal(tableSaw.clientGroups[0].totalOrders, 2);
    strict_1.default.equal(tableSaw.clientGroups[0].inProgressOrders, 1);
    strict_1.default.equal(tableSaw.clientGroups[0].totalQuantity, 15);
    strict_1.default.equal(tableSaw.clientGroups[1].clientName, 'STEPHENE OILE');
    strict_1.default.equal(tableSaw.clientGroups[1].totalOrders, 1);
    strict_1.default.equal(tableSaw.clientGroups[1].readyOrders, 1);
    strict_1.default.equal(tableSaw.clientGroups[1].totalQuantity, 8);
    // Check Edge Banding Area
    const edgeBanding = result.find((g) => g.areaName === 'Edge Banding Area');
    strict_1.default.ok(edgeBanding, 'Edge Banding Area group must exist');
    strict_1.default.equal(edgeBanding.totalOrders, 1);
    strict_1.default.equal(edgeBanding.pausedOrders, 1);
    strict_1.default.equal(edgeBanding.clientGroups[0].clientName, 'ARTEC INTERIORS');
    // Check Panel Rack Area
    const panelRack = result.find((g) => g.areaName === 'Panel Rack Area');
    strict_1.default.ok(panelRack, 'Panel Rack Area group must exist');
    strict_1.default.equal(panelRack.totalOrders, 1);
    strict_1.default.equal(panelRack.doneOrders, 1);
    strict_1.default.equal(panelRack.clientGroups[0].clientName, 'STEPHENE OILE');
});
(0, node_test_1.default)('groupWorkOrdersByAreaAndClient handles empty lists gracefully', () => {
    const result = (0, shopFloor_1.groupWorkOrdersByAreaAndClient)([]);
    strict_1.default.ok(Array.isArray(result));
    strict_1.default.equal(result.length, 3);
    result.forEach((group) => {
        strict_1.default.equal(group.totalOrders, 0);
        strict_1.default.equal(group.clientGroups.length, 0);
    });
});
(0, node_test_1.default)('groupWorkOrdersByAreaAndClient normalizes fallback client names', () => {
    const sample = [
        {
            id: 501,
            name: 'WH/MO/0501',
            product: 'Cutting Test',
            qty: 2,
            state: 'ready',
            client: null,
            area: 'Table Saw Area',
            stockStatus: 'ready',
        },
    ];
    const result = (0, shopFloor_1.groupWorkOrdersByAreaAndClient)(sample);
    const ts = result.find((g) => g.areaName === 'Table Saw Area');
    strict_1.default.ok(ts);
    strict_1.default.equal(ts.clientGroups.length, 1);
    strict_1.default.equal(ts.clientGroups[0].clientName, 'Direct / Unassigned Client');
});
function createMockRes() {
    let statusCode = 200;
    let payload = null;
    const headers = {};
    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(body) {
            payload = body;
            return res;
        },
        send(body) {
            payload = body;
            return res;
        },
        setHeader(name, val) {
            headers[name.toLowerCase()] = val;
            return res;
        },
        end(body) {
            payload = body;
            return res;
        },
        pipe(dest) {
            return dest;
        },
    };
    return {
        res,
        getStatus: () => statusCode,
        getPayload: () => payload,
        getHeader: (name) => headers[name.toLowerCase()],
    };
}
(0, node_test_1.default)('handlePublicWorkOrderAction rejects start/pause/finish without an authorized operatorId', async () => {
    for (const action of ['start', 'pause', 'finish']) {
        const req = { params: { id: '7063' }, body: { action, operatorName: 'Factory Operator' } };
        const { res, getStatus, getPayload } = createMockRes();
        await (0, shopFloor_1.handlePublicWorkOrderAction)(req, res);
        strict_1.default.equal(getStatus(), 401);
        strict_1.default.equal(getPayload()?.ok, false);
        strict_1.default.equal(getPayload()?.code, 'operator_required');
    }
    // Non-factory-operator ID (e.g. director/admin) is also rejected on public kiosk
    const nonOp = createMockRes();
    await (0, shopFloor_1.handlePublicWorkOrderAction)({ params: { id: '7063' }, body: { action: 'start', operatorId: 1 } }, nonOp.res);
    strict_1.default.equal(nonOp.getStatus(), 401);
    strict_1.default.equal(nonOp.getPayload()?.code, 'operator_required');
});
(0, node_test_1.default)('handlePublicShopFloorVerifyPin validates 4-digit PIN format', async () => {
    const emptyPin = createMockRes();
    await (0, shopFloor_1.handlePublicShopFloorVerifyPin)({ body: { pin: '' } }, emptyPin.res);
    strict_1.default.equal(emptyPin.getStatus(), 400);
    strict_1.default.equal(emptyPin.getPayload()?.code, 'invalid_pin_format');
    const shortPin = createMockRes();
    await (0, shopFloor_1.handlePublicShopFloorVerifyPin)({ body: { pin: '12' } }, shortPin.res);
    strict_1.default.equal(shortPin.getStatus(), 400);
    strict_1.default.equal(shortPin.getPayload()?.code, 'invalid_pin_format');
});
(0, node_test_1.default)('handlePublicWorkOrderAction rejects invalid moId and unsupported actions', async () => {
    const badId = createMockRes();
    await (0, shopFloor_1.handlePublicWorkOrderAction)({ params: { id: '0' }, body: { action: 'start', operatorId: 4 } }, badId.res);
    strict_1.default.equal(badId.getStatus(), 400);
    strict_1.default.equal(badId.getPayload()?.ok, false);
    const badAction = createMockRes();
    await (0, shopFloor_1.handlePublicWorkOrderAction)({ params: { id: '7063' }, body: { action: 'delete', operatorId: 4 } }, badAction.res);
    strict_1.default.equal(badAction.getStatus(), 400);
    strict_1.default.equal(badAction.getPayload()?.ok, false);
});
(0, node_test_1.default)('filterPublicShopFloorOperators keeps only Bitcher, Joel, Thomas, and Michael', () => {
    const all = [
        { odoo_employee_id: 1, name: 'Charles Ogola', job_title: 'Managing Director' },
        { odoo_employee_id: 2, name: 'Raphael Onyango', job_title: 'Director' },
        { odoo_employee_id: 5, name: 'Joel Ochango', job_title: 'Junior Operator' },
        { odoo_employee_id: 4, name: 'Leoivard Ongule', job_title: 'Information Systems' },
        { odoo_employee_id: 23, name: 'Michael Ochieng Okoth', job_title: 'Helper' },
        { odoo_employee_id: 6, name: 'Onyango Bitcher Akulo', job_title: 'Senior Operator' },
        { odoo_employee_id: 7, name: 'Thomas Ollinga', job_title: 'Assistant Jr Operator' },
        { odoo_employee_id: 9, name: 'Janet Awino Amollo', job_title: 'Operations Assistant' },
    ];
    const filtered = (0, shopFloor_1.filterPublicShopFloorOperators)(all);
    strict_1.default.deepEqual(filtered.map((op) => op.name), ['Onyango Bitcher Akulo', 'Joel Ochango', 'Thomas Ollinga', 'Michael Ochieng Okoth']);
    // Leoivard Ongule is explicitly excluded from operators (and board logs)
    strict_1.default.equal((0, shopFloorReporting_1.isExcludedFromOperators)({ name: 'Leoivard Ongule' }), true);
    strict_1.default.equal((0, shopFloorReporting_1.isExcludedFromOperators)({ email: 'dbadmin@urbanvibeinteriordesign.co.ke' }), true);
    strict_1.default.equal((0, shopFloorReporting_1.isExcludedFromOperators)({ name: 'Joel Ochango' }), false);
    strict_1.default.equal((0, shopFloorReporting_1.isExcludedFromBoardLogs)({ name: 'Janet Awino Amollo' }), true);
    strict_1.default.equal((0, shopFloorReporting_1.isExcludedFromBoardLogs)({ email: 'janetamollo01@gmail.com' }), true);
    strict_1.default.equal((0, shopFloorReporting_1.isExcludedFromBoardLogs)({ name: 'Leoivard Ongule' }), true);
    strict_1.default.equal((0, shopFloorReporting_1.isExcludedFromBoardLogs)({ name: 'Joel Ochango' }), false);
});
(0, node_test_1.default)('handlePublicWorkOrderAction rejects with 409 and locked mode notification when action is already syncing in-flight', async () => {
    const moId = 98765;
    shopFloor_1.inFlightWorkOrderSyncs.set(moId, {
        moId,
        action: 'pause',
        targetState: 'paused',
        operatorId: 6,
        operatorName: 'Onyango Bitcher Akulo',
        startedAt: Date.now(),
    });
    const syncRes = createMockRes();
    await (0, shopFloor_1.handlePublicWorkOrderAction)({ params: { id: String(moId) }, body: { action: 'pause', operatorId: 6 } }, syncRes.res);
    strict_1.default.equal(syncRes.getStatus(), 409);
    strict_1.default.equal(syncRes.getPayload()?.code, 'sync_in_progress');
    strict_1.default.equal(syncRes.getPayload()?.syncLocked, true);
    strict_1.default.match(syncRes.getPayload()?.message, /locked mode/i);
    shopFloor_1.inFlightWorkOrderSyncs.delete(moId);
});
(0, node_test_1.default)('logOperatorMoChatterNote logs operator note on Manufacturing Order for start, pause, and close', async () => {
    const calls = [];
    const mockClient = {
        postModelChatterMessage: async (model, id, msg) => {
            calls.push({ model, id, msg });
            return 1;
        },
    };
    // 1. Started
    await (0, shopFloor_1.logOperatorMoChatterNote)(mockClient, 5501, 'start', 'Joel Ochango');
    strict_1.default.equal(calls[0].model, 'mrp.production');
    strict_1.default.equal(calls[0].id, 5501);
    strict_1.default.match(calls[0].msg, /Work Order Started/);
    strict_1.default.match(calls[0].msg, /Joel Ochango/);
    strict_1.default.match(calls[0].msg, /EAT/);
    // 2. Paused
    await (0, shopFloor_1.logOperatorMoChatterNote)(mockClient, 5501, 'pause', 'Onyango Bitcher Akulo');
    strict_1.default.equal(calls[1].model, 'mrp.production');
    strict_1.default.equal(calls[1].id, 5501);
    strict_1.default.match(calls[1].msg, /Work Order Paused/);
    strict_1.default.match(calls[1].msg, /Onyango Bitcher Akulo/);
    // 3. Closed / Completed
    await (0, shopFloor_1.logOperatorMoChatterNote)(mockClient, 5501, 'finish', 'Thomas Ollinga');
    strict_1.default.equal(calls[2].model, 'mrp.production');
    strict_1.default.equal(calls[2].id, 5501);
    strict_1.default.match(calls[2].msg, /Work Order Closed \/ Completed/);
    strict_1.default.match(calls[2].msg, /Thomas Ollinga/);
});
(0, node_test_1.default)('handlePublicShopFloorOperatorAvatar rejects invalid operator ID', async () => {
    const { res, getStatus, getPayload } = createMockRes();
    await (0, shopFloor_1.handlePublicShopFloorOperatorAvatar)({ params: { id: 'invalid' } }, res);
    strict_1.default.equal(getStatus(), 400);
    strict_1.default.match(getPayload(), /Invalid operator ID/);
});
(0, node_test_1.default)('handlePublicShopFloorOperatorAvatar serves cached operator avatar with proper headers', async () => {
    const { res, getStatus, getHeader } = createMockRes();
    // Joel Ochango (id: 5) is cached
    await (0, shopFloor_1.handlePublicShopFloorOperatorAvatar)({ params: { id: '5' } }, res);
    strict_1.default.equal(getStatus(), 200);
    strict_1.default.equal(getHeader('content-type'), 'image/png');
    strict_1.default.match(getHeader('cache-control') || '', /public/);
});
(0, node_test_1.default)('requireAuthorizedShopFloorDevice blocks new unrecognized devices, allows authorized device cookie, and blocks immediately after revocation', async () => {
    (0, shopFloorDeviceAuthService_1.clearShopFloorDeviceAuthCache)();
    (0, shopFloorDeviceAuthService_1.clearUnauthorizedAttemptAlertCooldowns)();
    (0, shopFloorDeviceAuthService_1.setDeviceSecurityAlertSenderForTests)(async () => undefined);
    try {
        // 1. Unrecognized device requesting JSON/API is blocked with 401 device_not_authorized
        const unauthApi = createMockRes();
        let apiNextCalled = false;
        await (0, shopFloorDeviceAuthService_1.requireAuthorizedShopFloorDevice)({
            path: '/public/shop-floor/data',
            headers: { accept: 'application/json' },
            query: {},
            get: (h) => (h.toLowerCase() === 'accept' ? 'application/json' : ''),
        }, unauthApi.res, () => { apiNextCalled = true; });
        strict_1.default.equal(apiNextCalled, false);
        strict_1.default.equal(unauthApi.getStatus(), 401);
        strict_1.default.equal(unauthApi.getPayload()?.code, 'device_not_authorized');
        // 2. Unrecognized device loading HTML page renders device authorization gate
        let renderedView = '';
        const htmlRes = {
            statusCode: 200,
            headers: {},
            setHeader(k, v) { this.headers[k] = v; },
            status(c) { this.statusCode = c; return this; },
            render(view) { renderedView = view; return this; },
        };
        let htmlNextCalled = false;
        await (0, shopFloorDeviceAuthService_1.requireAuthorizedShopFloorDevice)({
            path: '/public/shop-floor',
            headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' },
            query: {},
            ip: '41.90.10.20',
            get: (h) => (h.toLowerCase() === 'accept' ? 'text/html' : h.toLowerCase() === 'user-agent' ? 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' : ''),
        }, htmlRes, () => { htmlNextCalled = true; });
        strict_1.default.equal(htmlNextCalled, false);
        strict_1.default.equal(renderedView, 'public-shop-floor-device-auth');
        // 3. Authorizing a device produces a cookie that passes the guard
        const authorized = await (0, shopFloorDeviceAuthService_1.authorizeShopFloorDevice)({
            authorizedBy: 'dbadmin@urbanvibeinteriordesign.co.ke',
            deviceLabel: 'Test Workshop Tablet',
            ipAddress: '127.0.0.1',
            userAgent: 'TestAgent/1.0',
            isSiteNetwork: true,
        });
        strict_1.default.ok(authorized.cookieHeader.includes(`${shopFloorDeviceAuthService_1.SHOP_FLOOR_DEVICE_COOKIE_NAME}=`));
        let allowedNextCalled = false;
        const authReq = {
            path: '/public/shop-floor/data',
            headers: { cookie: `${shopFloorDeviceAuthService_1.SHOP_FLOOR_DEVICE_COOKIE_NAME}=${authorized.rawToken}`, accept: 'application/json' },
            query: {},
            ip: '127.0.0.1',
            get: () => 'application/json',
        };
        const allowedApi = createMockRes();
        await (0, shopFloorDeviceAuthService_1.requireAuthorizedShopFloorDevice)(authReq, allowedApi.res, () => { allowedNextCalled = true; });
        strict_1.default.equal(allowedNextCalled, true);
        strict_1.default.equal(authReq.shopFloorTrustedDevice?.id, authorized.device.id);
        // 4. Tampered token is rejected
        let tamperedNextCalled = false;
        const tamperedApi = createMockRes();
        await (0, shopFloorDeviceAuthService_1.requireAuthorizedShopFloorDevice)({
            path: '/public/shop-floor/data',
            headers: { cookie: `${shopFloorDeviceAuthService_1.SHOP_FLOOR_DEVICE_COOKIE_NAME}=${'f'.repeat(64)}`, accept: 'application/json' },
            query: {},
            get: () => 'application/json',
        }, tamperedApi.res, () => { tamperedNextCalled = true; });
        strict_1.default.equal(tamperedNextCalled, false);
        strict_1.default.equal(tamperedApi.getStatus(), 401);
        // 5. Revoking the device immediately locks it out
        await (0, shopFloorDeviceAuthService_1.revokeShopFloorTrustedDevice)(authorized.device.id, 'dbadmin@urbanvibeinteriordesign.co.ke');
        let revokedNextCalled = false;
        const revokedApi = createMockRes();
        await (0, shopFloorDeviceAuthService_1.requireAuthorizedShopFloorDevice)(authReq, revokedApi.res, () => { revokedNextCalled = true; });
        strict_1.default.equal(revokedNextCalled, false);
        strict_1.default.equal(revokedApi.getStatus(), 401);
        strict_1.default.equal(revokedApi.getPayload()?.code, 'device_not_authorized');
    }
    finally {
        (0, shopFloorDeviceAuthService_1.setDeviceSecurityAlertSenderForTests)(null);
    }
});
(0, node_test_1.default)('requireAuthorizedShopFloorDevice protects /public/board-logs and emails dbadmin + leoivardomondi@gmail.com on unauthorized attempts', async () => {
    (0, shopFloorDeviceAuthService_1.clearShopFloorDeviceAuthCache)();
    (0, shopFloorDeviceAuthService_1.clearUnauthorizedAttemptAlertCooldowns)();
    const sentAlerts = [];
    (0, shopFloorDeviceAuthService_1.setDeviceSecurityAlertSenderForTests)(async (recipients, subject, _html, text) => {
        sentAlerts.push({ recipients, subject, text });
    });
    try {
        let renderedView = '';
        let renderedLocals = null;
        const htmlRes = {
            statusCode: 200,
            headers: {},
            setHeader(k, v) { this.headers[k] = v; },
            status(c) { this.statusCode = c; return this; },
            render(view, locals) { renderedView = view; renderedLocals = locals; return this; },
        };
        let nextCalled = false;
        await (0, shopFloorDeviceAuthService_1.requireAuthorizedShopFloorDevice)({
            path: '/public/board-logs',
            originalUrl: '/public/board-logs?date=2026-11-28',
            headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 (iPhone) Safari/604.1' },
            query: { date: '2026-11-28' },
            ip: '102.215.32.10',
            get: (h) => (h.toLowerCase() === 'accept' ? 'text/html' : h.toLowerCase() === 'user-agent' ? 'Mozilla/5.0 (iPhone) Safari/604.1' : ''),
        }, htmlRes, () => { nextCalled = true; });
        // Wait a tick for fire-and-forget alert promise
        await new Promise((resolve) => setTimeout(resolve, 20));
        strict_1.default.equal(nextCalled, false);
        strict_1.default.equal(renderedView, 'public-shop-floor-device-auth');
        strict_1.default.equal(renderedLocals?.targetResourceLabel, 'Board Logs Full Records');
        strict_1.default.equal(renderedLocals?.returnTo, '/public/board-logs?date=2026-11-28');
        strict_1.default.equal(sentAlerts.length, 1);
        strict_1.default.ok(sentAlerts[0].recipients.includes('dbadmin@urbanvibeinteriordesign.co.ke'));
        strict_1.default.ok(sentAlerts[0].recipients.includes('leoivardomondi@gmail.com'));
        strict_1.default.match(sentAlerts[0].subject, /Board Logs Full Records/i);
        strict_1.default.match(sentAlerts[0].text, /102\.215\.32\.10/);
        // Unrecognized device calling /public/board-logs/status is rejected with 401 JSON
        const statusRes = createMockRes();
        let statusNext = false;
        await (0, shopFloorDeviceAuthService_1.requireAuthorizedShopFloorDevice)({
            path: '/public/board-logs/status',
            originalUrl: '/public/board-logs/status?ids=1,2',
            headers: { accept: 'application/json' },
            query: { ids: '1,2' },
            ip: '102.215.32.10',
            get: () => 'application/json',
        }, statusRes.res, () => { statusNext = true; });
        strict_1.default.equal(statusNext, false);
        strict_1.default.equal(statusRes.getStatus(), 401);
        strict_1.default.equal(statusRes.getPayload()?.code, 'device_not_authorized');
    }
    finally {
        (0, shopFloorDeviceAuthService_1.setDeviceSecurityAlertSenderForTests)(null);
    }
});
