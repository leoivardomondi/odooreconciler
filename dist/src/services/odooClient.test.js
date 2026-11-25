"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const odooClient_1 = require("./odooClient");
(0, node_test_1.default)('attributes a board inventory adjustment move and lines to the operator name', async () => {
    const client = new odooClient_1.OdooClient({
        baseUrl: 'https://odoo.example.test',
        database: 'test',
        username: 'test@example.test',
        apiKey: 'test',
    });
    const writes = [];
    const mockedClient = client;
    mockedClient.searchReadRecords = async (model, options) => {
        if (model === 'stock.move')
            return [{ id: 42, reference: 'INV/2026/0001', origin: 'Inventory adjustment' }];
        if (model === 'stock.move.line')
            return [{ id: 84 }];
        if (model === 'ir.model.fields') {
            const domain = options.domain;
            const targetModel = Array.isArray(domain[0]) ? String(domain[0][2] || '') : '';
            return [{ name: targetModel === 'stock.move' ? 'x_studio_operator_online' : 'x_operator_online', field_description: 'Operator online' }];
        }
        return [];
    };
    mockedClient.writeRecord = async (model, ids, values) => {
        writes.push({ model, ids, values });
        return true;
    };
    strict_1.default.equal(await client.populateInventoryAdjustmentOperator(123, 'Leovard Ongule'), true);
    strict_1.default.deepEqual(writes, [
        { model: 'stock.move', ids: [42], values: { x_studio_operator_online: 'Leovard Ongule' } },
        { model: 'stock.move.line', ids: [84], values: { x_operator_online: 'Leovard Ongule' } },
    ]);
});
(0, node_test_1.default)('enforces traffic pause when setOdooTrafficPaused(true) is active', async () => {
    const { isOdooTrafficPaused, setOdooTrafficPaused, enqueueOdooRequest } = await Promise.resolve().then(() => __importStar(require('./odooClient')));
    setOdooTrafficPaused(true);
    strict_1.default.equal(isOdooTrafficPaused(), true);
    await strict_1.default.rejects(async () => {
        await enqueueOdooRequest(async () => 'should not execute');
    }, (err) => {
        return /paused by administrative setting/i.test(err.message);
    });
    // Restore state
    setOdooTrafficPaused(false);
    strict_1.default.equal(isOdooTrafficPaused(), false);
});
(0, node_test_1.default)('enqueueOdooRequest serializes requests and enforces minimum delay', async () => {
    const { setOdooTrafficPaused, enqueueOdooRequest } = await Promise.resolve().then(() => __importStar(require('./odooClient')));
    setOdooTrafficPaused(false);
    const timestamps = [];
    const start = Date.now();
    const p1 = enqueueOdooRequest(async () => {
        timestamps.push(Date.now() - start);
        return 1;
    });
    const p2 = enqueueOdooRequest(async () => {
        timestamps.push(Date.now() - start);
        return 2;
    });
    const results = await Promise.all([p1, p2]);
    strict_1.default.deepEqual(results, [1, 2]);
    strict_1.default.equal(timestamps.length, 2);
    // The gap between second request and first request should be at least 900ms (accounting for timer granularity)
    strict_1.default.ok(timestamps[1] - timestamps[0] >= 900, `Expected gap >= 900ms, got ${timestamps[1] - timestamps[0]}ms`);
});
(0, node_test_1.default)('enqueueOdooRequest skips aborted queued requests without executing fn', async () => {
    const { setOdooTrafficPaused, enqueueOdooRequest } = await Promise.resolve().then(() => __importStar(require('./odooClient')));
    setOdooTrafficPaused(false);
    const controller = new AbortController();
    let executed = false;
    // Enqueue a blocker, then queue an abortable read behind it and abort before it runs
    let releaseBlocker;
    const blockerGate = new Promise((resolve) => {
        releaseBlocker = resolve;
    });
    const blockerPromise = enqueueOdooRequest(async () => {
        await blockerGate;
        return 'done';
    });
    const cancelledPromise = enqueueOdooRequest(async () => {
        executed = true;
        return 'should-not-run';
    }, { signal: controller.signal });
    controller.abort();
    releaseBlocker();
    strict_1.default.equal(await blockerPromise, 'done');
    await strict_1.default.rejects(cancelledPromise, (err) => err?.statusCode === 499 && /cancelled/i.test(err?.message));
    strict_1.default.equal(executed, false);
});
(0, node_test_1.default)('getSaleOrderFields caches across OdooClient instances and supports forceRefresh / clear', async () => {
    odooClient_1.OdooClient.clearSaleOrderFieldsCache();
    let requestCalls = 0;
    const makeClient = () => {
        const client = new odooClient_1.OdooClient({
            baseUrl: 'https://cache-test.example.test',
            database: 'cache_db',
            username: 'user@example.test',
            apiKey: 'key',
        });
        client.request = async () => {
            requestCalls += 1;
            return {
                name: { string: 'Order Reference', type: 'char' },
                x_sig: { string: 'Signature', type: 'char' },
            };
        };
        return client;
    };
    const first = await makeClient().getSaleOrderFields();
    const second = await makeClient().getSaleOrderFields();
    strict_1.default.equal(requestCalls, 1);
    strict_1.default.equal(first.length, 2);
    strict_1.default.deepEqual(second, first);
    await makeClient().getSaleOrderFields({ forceRefresh: true });
    strict_1.default.equal(requestCalls, 2);
    odooClient_1.OdooClient.clearSaleOrderFieldsCache();
    await makeClient().getSaleOrderFields();
    strict_1.default.equal(requestCalls, 3);
    odooClient_1.OdooClient.clearSaleOrderFieldsCache();
});
(0, node_test_1.default)('isSchedulerRunActive tracks active scheduler run state', async () => {
    const { isSchedulerRunActive, setSchedulerRunActive } = await Promise.resolve().then(() => __importStar(require('./odooClient')));
    setSchedulerRunActive(false);
    strict_1.default.equal(isSchedulerRunActive(), false);
    setSchedulerRunActive(true);
    strict_1.default.equal(isSchedulerRunActive(), true);
    setSchedulerRunActive(false);
    strict_1.default.equal(isSchedulerRunActive(), false);
});
