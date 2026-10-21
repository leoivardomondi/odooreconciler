"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
process.env.DB_CLIENT = 'sqlite';
const env_1 = require("../utils/env");
env_1.env.DB_CLIENT = 'sqlite';
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const crypto_1 = require("crypto");
const db_1 = require("../models/db");
const repositories_1 = require("../models/repositories");
(0, node_test_1.default)('pruneStalePendingProcessesForActiveMos: PO-covered keys are pruned immediately', async () => {
    const testMoId = 99101;
    const testProdId = 88101;
    const key = `${testMoId}_${testProdId}`;
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    const process = {
        id: key,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99101',
        origin: 'S99101',
        partner_id: 101,
        partner_name: 'PO Procured Client',
        product_id: testProdId,
        product_name: 'WHITE MDF 18mm',
        qty_needed: 10,
        qty_reserved: 0,
        qty_missing: 10,
        status: 'pending',
        loaded_at: null,
        loaded_by: null,
        last_synced_at: new Date().toISOString(),
    };
    await (0, repositories_1.upsertPendingShopFloorProcesses)([process]);
    const before = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    strict_1.default.ok(before.some((p) => p.id === key), 'Process should initially exist as pending');
    // Prune with poCoveredKeys containing this key
    await (0, repositories_1.pruneStalePendingProcessesForActiveMos)([testMoId], [], [key]);
    const after = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    strict_1.default.ok(!after.some((p) => p.id === key), 'Process covered by active PO must be pruned from Add Stock area');
});
(0, node_test_1.default)('pruneStalePendingProcessesForActiveMos: closed MO or assigned stock is PRESERVED if NO history log exists', async () => {
    const testMoId = 99202;
    const testProdId = 88202;
    const key = `${testMoId}_${testProdId}`;
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    const process = {
        id: key,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99202',
        origin: 'S99202',
        partner_id: 202,
        partner_name: 'Client Missing Board Log',
        product_id: testProdId,
        product_name: 'OAK VENEER MDF 18mm',
        qty_needed: 6,
        qty_reserved: 0,
        qty_missing: 6,
        status: 'pending',
        loaded_at: null,
        loaded_by: null,
        last_synced_at: new Date().toISOString(),
    };
    await (0, repositories_1.upsertPendingShopFloorProcesses)([process]);
    // Simulate MO closed in Odoo shop floor (not in activeMoIds) and not in validKeys
    await (0, repositories_1.pruneStalePendingProcessesForActiveMos)([], []);
    const after = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    const preserved = after.find((p) => p.id === key);
    strict_1.default.ok(preserved, 'Requirement must be preserved even if MO is closed in Odoo, because no matching history log appeared');
    strict_1.default.equal(preserved.status, 'pending');
    strict_1.default.equal(preserved.qty_missing, 6);
});
(0, node_test_1.default)('pruneStalePendingProcessesForActiveMos: requirement is fulfilled and marked loaded when matching history log appears', async () => {
    const testMoId = 99303;
    const testProdId = 88303;
    const key = `${testMoId}_${testProdId}`;
    const clientName = 'History Log Test Client 303';
    const prodName = 'BLACK MDF 18mm';
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    await (0, db_1.execute)('DELETE FROM board_intake_queue WHERE partner_id = ?', [303]);
    const process = {
        id: key,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99303',
        origin: 'S99303',
        partner_id: 303,
        partner_name: clientName,
        product_id: testProdId,
        product_name: prodName,
        qty_needed: 4,
        qty_reserved: 0,
        qty_missing: 4,
        status: 'pending',
        loaded_at: null,
        loaded_by: null,
        last_synced_at: new Date().toISOString(),
    };
    await (0, repositories_1.upsertPendingShopFloorProcesses)([process]);
    // Create matching history log in board_intake_queue and mark synced
    const entryId = (0, crypto_1.randomUUID)();
    await (0, repositories_1.createBoardIntakeQueueEntry)({
        id: entryId,
        customerName: clientName,
        partnerId: 303,
        productName: prodName,
        productId: testProdId,
        quantity: 4,
        actorEmail: 'operator@factory.co.ke',
        actorName: 'Operator One',
    });
    await (0, repositories_1.updateBoardIntakeQueueEntry)(entryId, { status: 'synced', stockQuantity: 4 });
    // Prune with MO closed or fulfilled
    await (0, repositories_1.pruneStalePendingProcessesForActiveMos)([], []);
    const pendingList = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    strict_1.default.ok(!pendingList.some((p) => p.id === key), 'Process must disappear from pending list once matching history log fulfills requirement');
    const loadedList = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'loaded' });
    const loaded = loadedList.find((p) => p.id === key);
    strict_1.default.ok(loaded, 'Process must be marked as loaded');
});
(0, node_test_1.default)('Reverting a board intake log restores the pending process in Add Stock area', async () => {
    const testMoId = 99404;
    const testProdId = 88404;
    const key = `${testMoId}_${testProdId}`;
    const clientName = 'Revert Test Client 404';
    const prodName = 'WALNUT MDF 18mm';
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    await (0, db_1.execute)('DELETE FROM board_intake_queue WHERE partner_id = ?', [404]);
    // Seed process as loaded
    const process = {
        id: key,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99404',
        origin: 'S99404',
        partner_id: 404,
        partner_name: clientName,
        product_id: testProdId,
        product_name: prodName,
        qty_needed: 5,
        qty_reserved: 5,
        qty_missing: 0,
        status: 'loaded',
        loaded_at: new Date().toISOString(),
        loaded_by: 'Operator Revert',
        last_synced_at: new Date().toISOString(),
    };
    await (0, repositories_1.upsertPendingShopFloorProcesses)([process]);
    // Create intake queue entry and mark synced
    const entryId = (0, crypto_1.randomUUID)();
    await (0, repositories_1.createBoardIntakeQueueEntry)({
        id: entryId,
        customerName: clientName,
        partnerId: 404,
        productName: prodName,
        productId: testProdId,
        quantity: 5,
        actorEmail: 'operator@factory.co.ke',
        actorName: 'Operator Revert',
    });
    await (0, repositories_1.updateBoardIntakeQueueEntry)(entryId, { status: 'synced', stockQuantity: 5 });
    // Revert the intake entry
    const claimed = await (0, repositories_1.claimBoardIntakeRevert)(entryId);
    strict_1.default.equal(claimed, true, 'Should successfully claim revert');
    await (0, repositories_1.finishBoardIntakeRevert)(entryId, 'admin@urbanvibe.co.ke', 0);
    // Verify process was restored to pending
    const pendingList = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    const restored = pendingList.find((p) => p.id === key);
    strict_1.default.ok(restored, 'Process must be restored to pending after intake revert');
    strict_1.default.equal(restored.status, 'pending');
    strict_1.default.equal(restored.qty_missing, 5);
});
