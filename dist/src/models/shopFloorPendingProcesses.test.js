"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const repositories_1 = require("./repositories");
const db_1 = require("./db");
(0, node_test_1.default)('shop_floor_pending_processes lifecycle: upsert, query, mark loaded, and preserve loaded status', async () => {
    const testMoId = 99901;
    const testPartnerId = 88801;
    const testProductId = 77701;
    // Clean up any existing test records
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    const testProcess = {
        id: `test_${testMoId}_${testProductId}`,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99901',
        origin: 'SO99901',
        partner_id: testPartnerId,
        partner_name: 'Test Client Ltd',
        product_id: testProductId,
        product_name: 'MDF 18mm Oak',
        qty_needed: 10,
        qty_reserved: 2,
        qty_missing: 8,
        status: 'pending',
        loaded_at: null,
        loaded_by: null,
        last_synced_at: new Date().toISOString(),
    };
    // 1. Insert/Upsert into MySQL
    await (0, repositories_1.upsertPendingShopFloorProcesses)([testProcess]);
    // 2. Query pending items
    const pendingBefore = await (0, repositories_1.getPendingShopFloorProcesses)({
        partnerId: testPartnerId,
        status: 'pending',
    });
    strict_1.default.equal(pendingBefore.length, 1);
    strict_1.default.equal(pendingBefore[0].mo_id, testMoId);
    strict_1.default.equal(pendingBefore[0].qty_missing, 8);
    strict_1.default.equal(pendingBefore[0].status, 'pending');
    // 3. Mark loaded (operator loads 8 boards)
    const updated = await (0, repositories_1.markPendingShopFloorProcessesLoaded)({
        partnerId: testPartnerId,
        productId: testProductId,
        loadedBy: 'operator@flowcode.co.ke',
        quantity: 8,
    });
    strict_1.default.equal(updated.length, 1);
    strict_1.default.equal(updated[0].status, 'loaded');
    strict_1.default.equal(updated[0].qty_missing, 0);
    strict_1.default.equal(updated[0].qty_reserved, 10);
    strict_1.default.equal(updated[0].loaded_by, 'operator@flowcode.co.ke');
    // 4. Verify item has DISAPPEARED from pending query
    const pendingAfter = await (0, repositories_1.getPendingShopFloorProcesses)({
        partnerId: testPartnerId,
        status: 'pending',
    });
    strict_1.default.equal(pendingAfter.length, 0, 'Item must disappear immediately from pending query once loaded');
    // 5. Verify that a background sync re-upsert DOES NOT revert it back to pending!
    await (0, repositories_1.upsertPendingShopFloorProcesses)([testProcess]);
    const pendingAfterSync = await (0, repositories_1.getPendingShopFloorProcesses)({
        partnerId: testPartnerId,
        status: 'pending',
    });
    strict_1.default.equal(pendingAfterSync.length, 0, 'Background sync must preserve loaded status and not revert to pending');
    // 6. Clean up
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
});
