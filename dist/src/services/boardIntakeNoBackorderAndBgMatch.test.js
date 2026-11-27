"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const repositories_1 = require("../models/repositories");
const db_1 = require("../models/db");
const boardIntakeSyncService_1 = require("./boardIntakeSyncService");
(0, node_test_1.default)('no-backorder closure marks pending shortfall loaded and survives Odoo sync re-upsert', async () => {
    const moId = 999123;
    const partnerId = 888123;
    const productId = 777123;
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);
    await (0, repositories_1.upsertPendingShopFloorProcesses)([
        {
            id: `test_noback_${moId}_${productId}`,
            process_type: 'board_intake',
            mo_id: moId,
            mo_name: 'WH/MO/999123',
            origin: 'S999123',
            partner_id: partnerId,
            partner_name: 'Short Receipt Client Ltd',
            product_id: productId,
            product_name: '18mm White MDF',
            qty_needed: 4,
            qty_reserved: 0,
            qty_missing: 4,
            status: 'pending',
            loaded_at: null,
            loaded_by: null,
            last_synced_at: new Date().toISOString(),
        },
    ]);
    // Operator logs 3 boards (down from 4) and chooses "No, not expecting more" (noBackorder: true)
    const closed = await (0, repositories_1.markPendingShopFloorProcessesLoaded)({
        partnerId,
        productId,
        loadedBy: 'operator@example.com',
        quantity: 3,
        moId,
        noBackorder: true,
    });
    strict_1.default.equal(closed.length, 1);
    strict_1.default.equal(closed[0].status, 'loaded');
    strict_1.default.equal(closed[0].qty_reserved, 3);
    strict_1.default.equal(closed[0].qty_missing, 0);
    strict_1.default.equal(closed[0].no_backorder_closed, true);
    // Subsequent Odoo sync reports qty_needed=4, qty_missing=1 -> must stay closed!
    await (0, repositories_1.upsertPendingShopFloorProcesses)([
        {
            id: `test_noback_${moId}_${productId}`,
            process_type: 'board_intake',
            mo_id: moId,
            mo_name: 'WH/MO/999123',
            origin: 'S999123',
            partner_id: partnerId,
            partner_name: 'Short Receipt Client Ltd',
            product_id: productId,
            product_name: '18mm White MDF',
            qty_needed: 4,
            qty_reserved: 3,
            qty_missing: 1,
            status: 'pending',
            loaded_at: null,
            loaded_by: null,
            last_synced_at: new Date().toISOString(),
        },
    ]);
    const pendingAfterSync = await (0, repositories_1.getPendingShopFloorProcesses)({ partnerId, status: 'pending' });
    strict_1.default.equal(pendingAfterSync.length, 0, 'Closed no-backorder row must not reopen on subsequent sync');
    const loadedAfterSync = await (0, repositories_1.getPendingShopFloorProcesses)({ partnerId, status: 'loaded' });
    strict_1.default.equal(loadedAfterSync.length, 1);
    strict_1.default.equal(loadedAfterSync[0].qty_missing, 0);
    strict_1.default.equal(loadedAfterSync[0].no_backorder_closed, true);
    // If Odoo MO qty genuinely increases later (4 -> 6), requirement reopens
    await (0, repositories_1.upsertPendingShopFloorProcesses)([
        {
            id: `test_noback_${moId}_${productId}`,
            process_type: 'board_intake',
            mo_id: moId,
            mo_name: 'WH/MO/999123',
            origin: 'S999123',
            partner_id: partnerId,
            partner_name: 'Short Receipt Client Ltd',
            product_id: productId,
            product_name: '18mm White MDF',
            qty_needed: 6,
            qty_reserved: 3,
            qty_missing: 3,
            status: 'pending',
            loaded_at: null,
            loaded_by: null,
            last_synced_at: new Date().toISOString(),
        },
    ]);
    const pendingAfterIncrease = await (0, repositories_1.getPendingShopFloorProcesses)({ partnerId, status: 'pending' });
    strict_1.default.equal(pendingAfterIncrease.length, 1);
    strict_1.default.equal(pendingAfterIncrease[0].qty_missing, 3);
    strict_1.default.equal(pendingAfterIncrease[0].no_backorder_closed, false);
    // Clean revert reset test
    await (0, repositories_1.markPendingShopFloorProcessesLoaded)({
        partnerId,
        productId,
        loadedBy: 'operator@example.com',
        quantity: 3,
        moId,
        noBackorder: true,
    });
    await (0, repositories_1.unmarkPendingShopFloorProcessesLoaded)({
        partnerId,
        productId,
        quantity: 3,
    });
    const pendingAfterRevert = await (0, repositories_1.getPendingShopFloorProcesses)({ partnerId, status: 'pending' });
    strict_1.default.equal(pendingAfterRevert.length, 1);
    strict_1.default.equal(pendingAfterRevert[0].no_backorder_closed, false);
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);
});
(0, node_test_1.default)('processBoardIntakePurchaseOrderFulfillment cancels backorder when no_backorder=1 on single-product PO', async () => {
    const wizardCalls = [];
    const mockClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model) => {
            if (model === 'purchase.order') {
                return [{ id: 10, name: 'P02001', state: 'purchase', origin: 'S04001', order_line: [50], picking_ids: [90] }];
            }
            if (model === 'purchase.order.line') {
                return [{ id: 50, order_id: [10, 'P02001'], product_id: [205, 'WHITE MDF 18mm'], product_qty: 4 }];
            }
            if (model === 'stock.picking') {
                return [{ id: 90, name: 'WH/IN/02001', state: 'assigned', picking_type_code: 'incoming' }];
            }
            if (model === 'stock.move') {
                return [{ id: 701, picking_id: [90, 'WH/IN/02001'], product_id: [205, 'WHITE MDF 18mm'], product_uom_qty: 4, quantity: 0, state: 'assigned' }];
            }
            if (model === 'stock.move.line')
                return [];
            if (model === 'sale.order')
                return [{ id: 401, name: 'S04001', user_id: false }];
            if (model === 'mrp.production')
                return [{ id: 301, name: 'WH/MO/05501', origin: 'S04001' }];
            return [];
        },
        callRecordMethod: async (model, method, ids) => {
            if (model === 'stock.picking' && method === 'button_validate') {
                return { res_model: 'stock.backorder.confirmation', res_id: 777, context: {} };
            }
            if (model === 'stock.backorder.confirmation') {
                wizardCalls.push({ model, method, id: ids[0] });
            }
            return true;
        },
        readRecords: async (model, ids) => {
            if (model === 'stock.picking')
                return [{ id: ids[0], state: 'done' }];
            return [];
        },
        writeRecord: async () => true,
        populatePickingValidationMetadata: async () => true,
        postModelChatterMessage: async () => 1,
    };
    const result = await (0, boardIntakeSyncService_1.processBoardIntakePurchaseOrderFulfillment)(mockClient, {
        partner_id: 42,
        customer_name: 'Client Single PO',
        product_id: 205,
        product_name: 'WHITE MDF 18mm',
        quantity: 3,
        actor_name: 'Operator',
        no_backorder: 1,
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result.qtyFulfilled, 3);
    strict_1.default.deepEqual(wizardCalls, [{ model: 'stock.backorder.confirmation', method: 'process_cancel_backorder', id: 777 }]);
});
(0, node_test_1.default)('processBoardIntakePurchaseOrderFulfillment preserves multi-product PO backorder by capping only target move', async () => {
    const wizardCalls = [];
    const moveWrites = [];
    const mockClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model) => {
            if (model === 'purchase.order') {
                return [{ id: 11, name: 'P02002', state: 'purchase', origin: 'S04002', order_line: [51], picking_ids: [91] }];
            }
            if (model === 'purchase.order.line') {
                return [{ id: 51, order_id: [11, 'P02002'], product_id: [205, 'WHITE MDF 18mm'], product_qty: 20 }];
            }
            if (model === 'stock.picking') {
                return [{ id: 91, name: 'WH/IN/02002', state: 'assigned', picking_type_code: 'incoming' }];
            }
            if (model === 'stock.move') {
                return [
                    { id: 701, picking_id: [91, 'WH/IN/02002'], product_id: [205, 'WHITE MDF 18mm'], product_uom_qty: 20, quantity: 0, state: 'assigned' },
                    { id: 702, picking_id: [91, 'WH/IN/02002'], product_id: [206, 'BLACK MDF 18mm'], product_uom_qty: 5, quantity: 0, state: 'assigned' },
                ];
            }
            if (model === 'stock.move.line')
                return [];
            if (model === 'sale.order')
                return [{ id: 402, name: 'S04002', user_id: false }];
            if (model === 'mrp.production')
                return [{ id: 302, name: 'WH/MO/05502', origin: 'S04002' }];
            return [];
        },
        callRecordMethod: async (model, method, ids) => {
            if (model === 'stock.picking' && method === 'button_validate') {
                return { res_model: 'stock.backorder.confirmation', res_id: 778, context: {} };
            }
            if (model === 'stock.backorder.confirmation') {
                wizardCalls.push({ model, method, id: ids[0] });
            }
            return true;
        },
        readRecords: async (model, ids) => {
            if (model === 'stock.picking')
                return [{ id: ids[0], state: 'done' }];
            return [];
        },
        writeRecord: async (model, ids, vals) => {
            if (model === 'stock.move') {
                moveWrites.push({ ids, vals });
            }
            return true;
        },
        populatePickingValidationMetadata: async () => true,
        postModelChatterMessage: async () => 1,
    };
    const result = await (0, boardIntakeSyncService_1.processBoardIntakePurchaseOrderFulfillment)(mockClient, {
        partner_id: 42,
        customer_name: 'Client Multi PO',
        product_id: 205,
        product_name: 'WHITE MDF 18mm',
        quantity: 10,
        actor_name: 'Operator',
        no_backorder: 1,
    });
    strict_1.default.ok(result);
    strict_1.default.deepEqual(moveWrites[0], { ids: [701], vals: { product_uom_qty: 10, quantity: 10 } });
    strict_1.default.deepEqual(moveWrites[1], { ids: [702], vals: { quantity: 0 } });
    strict_1.default.deepEqual(wizardCalls, [{ model: 'stock.backorder.confirmation', method: 'process', id: 778 }]);
});
(0, node_test_1.default)('buildBoardIntakeChatterHtml renders COMPLETE INTAKE (NO BACKORDER) when noBackorder=true', () => {
    const html = (0, boardIntakeSyncService_1.buildBoardIntakeChatterHtml)({
        customerName: 'Acme Designs',
        productName: '18mm White MDF',
        quantity: 10,
        qtyNeeded: 20,
        balanceRemaining: 10,
        noBackorder: true,
        moName: 'WH/MO/00100',
    });
    strict_1.default.match(html, /COMPLETE INTAKE \(NO BACKORDER\)/);
    strict_1.default.doesNotMatch(html, /PARTIAL INTAKE/);
});
(0, node_test_1.default)('matchBoardIntakeToClientImmediate updates DB immediately without Odoo wait and closes no-backorder pending process', async () => {
    const intakeId = `test_imm_match_${Date.now()}`;
    const moId = 999456;
    const partnerId = 888456;
    const productId = 777456;
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);
    await (0, repositories_1.upsertPendingShopFloorProcesses)([
        {
            id: `test_${moId}_${productId}`,
            process_type: 'board_intake',
            mo_id: moId,
            mo_name: 'WH/MO/999456',
            origin: 'S999456',
            partner_id: partnerId,
            partner_name: 'Matched Immediate Client',
            product_id: productId,
            product_name: '18mm Oak',
            qty_needed: 20,
            qty_reserved: 0,
            qty_missing: 20,
            status: 'pending',
            loaded_at: null,
            loaded_by: null,
            last_synced_at: new Date().toISOString(),
        },
    ]);
    await (0, repositories_1.createBoardIntakeQueueEntry)({
        id: intakeId,
        productId,
        productName: '18mm Oak',
        partnerId: 0,
        customerName: 'Pending Client Matching',
        quantity: 10,
        actorName: 'Gate Guard',
        noBackorder: true,
    });
    const prep = await (0, boardIntakeSyncService_1.matchBoardIntakeToClientImmediate)({
        id: intakeId,
        partnerId,
        customerName: 'Matched Immediate Client',
        matchedBy: 'Supervisor',
        moId,
    });
    strict_1.default.equal(prep.customerName, 'Matched Immediate Client');
    strict_1.default.equal(prep.loadedRequirements.length, 1);
    strict_1.default.equal(prep.loadedRequirements[0].qty_missing, 0);
    strict_1.default.equal(prep.loadedRequirements[0].no_backorder_closed, true);
    const saved = await (0, repositories_1.getBoardIntakeQueueEntry)(intakeId);
    strict_1.default.equal(Number(saved?.partner_id), partnerId);
    strict_1.default.equal(saved?.customer_name, 'Matched Immediate Client');
    strict_1.default.equal(Number(saved?.no_backorder), 1);
    await (0, db_1.execute)('DELETE FROM board_intake_queue WHERE id = ?', [intakeId]);
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);
});
(0, node_test_1.default)('views include instant expecting-more prompt, floating + FAB, and no duplicate match form', () => {
    const boardsView = fs_1.default.readFileSync(path_1.default.resolve(__dirname, '../views/shop-floor-boards.ejs'), 'utf8');
    strict_1.default.match(boardsView, /id="expectingMorePrompt"/);
    strict_1.default.match(boardsView, /id="btnExpectingMoreYes"/);
    strict_1.default.match(boardsView, /id="btnExpectingMoreNo"/);
    strict_1.default.match(boardsView, /id="intakeExpectedQty"/);
    strict_1.default.match(boardsView, /id="floatingBoardLogFab"/);
    const publicView = fs_1.default.readFileSync(path_1.default.resolve(__dirname, '../views/public-board-logs.ejs'), 'utf8');
    const formMatches = publicView.match(/id="publicMatchClientForm"/g) || [];
    strict_1.default.equal(formMatches.length, 1, 'public-board-logs.ejs must not have duplicate publicMatchClientForm tags');
});
