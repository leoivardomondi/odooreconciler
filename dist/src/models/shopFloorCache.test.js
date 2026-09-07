"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const repositories_1 = require("./repositories");
(0, node_test_1.default)('saves, retrieves, and deletes shop floor dashboard snapshot by user email', async () => {
    const testEmail = 'Test.Operator@Example.com';
    const dummyData = {
        employee: { id: 99, name: 'Test Operator', workEmail: 'test.operator@example.com' },
        workOrders: [{ id: 101, name: 'WH/MO/00101', progress: 50 }],
    };
    await (0, repositories_1.saveShopFloorDashboardSnapshot)(testEmail, dummyData);
    // Retrieve using lowercase email
    const result = await (0, repositories_1.getShopFloorDashboardSnapshot)('test.operator@example.com');
    strict_1.default.ok(result, 'Snapshot should be found');
    strict_1.default.equal(result.data.employee.name, 'Test Operator');
    strict_1.default.equal(result.data.workOrders.length, 1);
    strict_1.default.equal(result.data.workOrders[0].name, 'WH/MO/00101');
    strict_1.default.ok(result.syncedAt, 'SyncedAt timestamp should be present');
    // Clean up
    await (0, repositories_1.deleteShopFloorDashboardSnapshot)(testEmail);
    const deletedResult = await (0, repositories_1.getShopFloorDashboardSnapshot)(testEmail);
    strict_1.default.equal(deletedResult, null, 'Snapshot should be deleted');
});
(0, node_test_1.default)('saves, retrieves, and deletes shop floor shared cache entries', async () => {
    const cacheKey = 'test:shared-orders:v1';
    const sharedData = {
        totalActiveOrders: 15,
        items: ['item1', 'item2'],
    };
    await (0, repositories_1.saveShopFloorSharedCache)(cacheKey, sharedData);
    const result = await (0, repositories_1.getShopFloorSharedCache)(cacheKey);
    strict_1.default.ok(result, 'Shared cache entry should be found');
    strict_1.default.equal(result.data.totalActiveOrders, 15);
    strict_1.default.deepEqual(result.data.items, ['item1', 'item2']);
    // Clean up
    await (0, repositories_1.deleteShopFloorSharedCache)(cacheKey);
    const deleted = await (0, repositories_1.getShopFloorSharedCache)(cacheKey);
    strict_1.default.equal(deleted, null, 'Shared cache entry should be deleted');
});
