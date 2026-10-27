"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const boardIntakeSyncService_1 = require("./boardIntakeSyncService");
const shopFloorPendingSyncService_1 = require("./shopFloorPendingSyncService");
const repositories_1 = require("../models/repositories");
const db_1 = require("../models/db");
(0, node_test_1.default)('processBoardIntakePurchaseOrderFulfillment strictly approves PO ONLY if waiting for approval (state: "to approve")', async () => {
    const approvedPoIds = [];
    const validatedPickingIds = [];
    const postedChatters = [];
    const mockClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model) => {
            if (model === 'purchase.order') {
                return [
                    {
                        id: 101,
                        name: 'P01099',
                        state: 'to approve', // waiting for approval!
                        origin: 'S02500',
                        order_line: [501],
                        picking_ids: [901],
                    },
                ];
            }
            if (model === 'purchase.order.line') {
                return [
                    {
                        id: 501,
                        order_id: [101, 'P01099'],
                        product_id: [205, 'WHITE MDF 18mm'],
                        product_qty: 10,
                    },
                ];
            }
            if (model === 'stock.picking') {
                return [
                    {
                        id: 901,
                        name: 'WH/IN/00901',
                        state: 'assigned',
                        picking_type_code: 'incoming',
                        move_ids_without_package: [701],
                    },
                ];
            }
            if (model === 'stock.move') {
                return [
                    {
                        id: 701,
                        product_id: [205, 'WHITE MDF 18mm'],
                        product_uom_qty: 10,
                        quantity: 0,
                    },
                ];
            }
            if (model === 'sale.order') {
                return [{ id: 401, name: 'S02500', user_id: [8, 'Candy Sharon'] }];
            }
            if (model === 'mrp.production') {
                return [{ id: 301, name: 'WH/MO/05500', origin: 'S02500' }];
            }
            return [];
        },
        callRecordMethod: async (model, method, ids) => {
            if (model === 'purchase.order' && method === 'button_approve') {
                approvedPoIds.push(...ids);
            }
            if (model === 'stock.picking' && method === 'button_validate') {
                validatedPickingIds.push(...ids);
            }
            return true;
        },
        readRecords: async (model, ids) => {
            if (model === 'purchase.order') {
                return [{ id: ids[0], state: 'purchase' }];
            }
            return [];
        },
        writeRecord: async () => true,
        populatePickingValidationMetadata: async () => true,
        postModelChatterMessage: async (model, id, msg) => {
            postedChatters.push({ model, id, msg });
            return 1;
        },
    };
    const result = await (0, boardIntakeSyncService_1.processBoardIntakePurchaseOrderFulfillmentLegacy)(mockClient, {
        partner_id: '42',
        customer_name: 'Test Client Ltd',
        product_id: '205',
        product_name: 'WHITE MDF 18mm',
        quantity: 10,
        actor_name: 'David Gate',
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result.fulfilledViaReceipt, true);
    strict_1.default.equal(result.autoApproved, true);
    strict_1.default.equal(result.poName, 'P01099');
    strict_1.default.equal(result.pickingName, 'WH/IN/00901');
    strict_1.default.deepEqual(approvedPoIds, [101]);
    strict_1.default.deepEqual(validatedPickingIds, [901]);
    strict_1.default.ok(postedChatters.some((c) => c.model === 'purchase.order' && c.msg.includes('Approved automatically from Waiting for Approval')));
    strict_1.default.ok(postedChatters.some((c) => c.model === 'stock.picking' && c.msg.includes('Received via Purchase Receipt')));
});
(0, node_test_1.default)('processBoardIntakePurchaseOrderFulfillment does NOT approve PO when state is "draft"', async () => {
    const approvedPoIds = [];
    const validatedPickingIds = [];
    const mockClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model) => {
            if (model === 'purchase.order') {
                return [
                    {
                        id: 102,
                        name: 'P01100',
                        state: 'draft', // Draft PO - MUST NOT BE APPROVED
                        origin: 'S02501',
                        order_line: [502],
                    },
                ];
            }
            if (model === 'purchase.order.line') {
                return [
                    {
                        id: 502,
                        order_id: [102, 'P01100'],
                        product_id: [205, 'WHITE MDF 18mm'],
                        product_qty: 10,
                    },
                ];
            }
            return [];
        },
        callRecordMethod: async (model, method, ids) => {
            if (method === 'button_approve')
                approvedPoIds.push(...ids);
            if (method === 'button_validate')
                validatedPickingIds.push(...ids);
            return true;
        },
        readRecords: async () => [],
    };
    const result = await (0, boardIntakeSyncService_1.processBoardIntakePurchaseOrderFulfillment)(mockClient, {
        partner_id: '42',
        customer_name: 'Test Client Ltd',
        product_id: '205',
        product_name: 'WHITE MDF 18mm',
        quantity: 10,
        actor_name: 'David Gate',
    });
    // Must NOT fulfill via receipt and must not return result
    strict_1.default.equal(result, null);
    strict_1.default.equal(approvedPoIds.length, 0);
    strict_1.default.equal(validatedPickingIds.length, 0);
});
(0, node_test_1.default)('cleanPreexistingMismatchChatter finds and deletes matching error chatter messages', async () => {
    const unlinkedModelIds = [];
    const mockClient = {
        searchReadRecords: async (model) => {
            if (model === 'mail.message') {
                return [
                    { id: 9001 },
                    { id: 9002 },
                ];
            }
            return [];
        },
        unlinkRecords: async (model, ids) => {
            unlinkedModelIds.push({ model, ids });
            return true;
        },
    };
    const result = await (0, boardIntakeSyncService_1.cleanPreexistingMismatchChatter)(mockClient);
    strict_1.default.equal(result.deletedCount, 2);
    strict_1.default.deepEqual(result.deletedIds, [9001, 9002]);
    strict_1.default.deepEqual(unlinkedModelIds, [{ model: 'mail.message', ids: [9001, 9002] }]);
});
(0, node_test_1.default)('matchRetroactiveBoardLogsForActiveMos finds prior board log history and triggers action_assign', async () => {
    const postedChatters = [];
    const assignedMoIds = [];
    const mockClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model) => {
            if (model === 'sale.order')
                return [{ id: 401 }];
            return [];
        },
        callRecordMethod: async (model, method, ids) => {
            if (model === 'mrp.production' && method === 'action_assign') {
                assignedMoIds.push(...ids);
            }
            return true;
        },
        postModelChatterMessage: async (model, id, msg) => {
            postedChatters.push({ model, id, msg });
            return 1;
        },
    };
    const activeMOs = [
        {
            id: 501,
            name: 'WH/MO/05490',
            state: 'confirmed',
            origin: 'S02400',
            create_date: '2026-10-25 10:00:00', // MO created at 10:00 AM
        },
    ];
    const boardMoves = [
        {
            id: 1001,
            raw_material_production_id: [501, 'WH/MO/05490'],
            product_id: [100, 'WHITE MDF 18mm'],
            product_uom_qty: 5,
            quantity: 0,
        },
    ];
    const soPartnerMap = new Map();
    soPartnerMap.set('S02400', { partnerId: 88, partnerName: 'John Customer' });
    const originProductPOKeys = new Set(); // No PO!
    const activeBoardLogs = [
        {
            id: 'log-001',
            actor_name: 'John Gate',
            actor_email: 'john@urbanvibe.co.ke',
            gate: 'Gate A',
            vehicle_registration: 'KDD 123X',
            arrival_date: '2026-10-25',
            arrival_time: '09:00:00',
            product_id: 100,
            product_name: 'WHITE MDF 18mm',
            partner_id: 88,
            customer_name: 'John Customer',
            quantity: 5,
            created_at: '2026-10-25 09:00:00', // Logged 1 hour before MO!
        },
    ];
    const matched = await (0, shopFloorPendingSyncService_1.matchRetroactiveBoardLogsForActiveMos)(mockClient, activeMOs, boardMoves, soPartnerMap, originProductPOKeys, activeBoardLogs);
    strict_1.default.equal(matched, 1);
    strict_1.default.deepEqual(assignedMoIds, [501]);
    strict_1.default.ok(postedChatters.some((c) => c.model === 'mrp.production' && c.id === 501 && c.msg.includes('Found Matching Prior Board Log History')));
    strict_1.default.ok(postedChatters.some((c) => c.model === 'sale.order' && c.msg.includes('Prior Gate Board Log Matched to Manufacturing Order')));
});
(0, node_test_1.default)('reconcileRetroactiveBoardLogsForLinkedPos validates PO receipt for prior manual log when MO has linked PO', async () => {
    const testLogId = `retro-test-${Date.now()}`;
    await (0, repositories_1.createBoardIntakeQueueEntry)({
        id: testLogId,
        productId: 205,
        productName: 'WHITE MDF 18mm',
        partnerId: 42,
        customerName: 'Test Client Ltd',
        quantity: 8,
        actorName: 'Gate Operator',
        isPurchase: 0,
    });
    await (0, repositories_1.updateBoardIntakeQueueEntry)(testLogId, { status: 'synced', stockQuantity: 8 });
    const validatedPickingIds = [];
    const removedStockCalls = [];
    const mockClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model, options) => {
            if (model === 'sale.order') {
                const partnerDomain = options?.domain?.find((d) => Array.isArray(d) && d[0] === 'partner_id');
                if (partnerDomain && partnerDomain[2] !== 42)
                    return [];
                return [{ id: 401, name: 'S02500', partner_id: [42, 'Test Client Ltd'], user_id: [8, 'Candy Sharon'] }];
            }
            if (model === 'mrp.production') {
                return [{ id: 301, name: 'WH/MO/05500', origin: 'S02500' }];
            }
            if (model === 'purchase.order') {
                return [
                    {
                        id: 105,
                        name: 'P01095',
                        state: 'purchase', // Already approved PO
                        origin: 'S02500',
                        order_line: [505],
                        picking_ids: [905],
                    },
                ];
            }
            if (model === 'purchase.order.line') {
                const prodDomain = options?.domain?.find((d) => Array.isArray(d) && d[0] === 'product_id');
                if (prodDomain && prodDomain[2] !== 205)
                    return [];
                return [
                    {
                        id: 505,
                        order_id: [105, 'P01095'],
                        product_id: [205, 'WHITE MDF 18mm'],
                        product_qty: 8,
                    },
                ];
            }
            if (model === 'stock.picking') {
                return [
                    {
                        id: 905,
                        name: 'WH/IN/00905',
                        state: 'assigned',
                        picking_type_code: 'incoming',
                        move_ids_without_package: [705],
                    },
                ];
            }
            if (model === 'stock.move') {
                return [
                    {
                        id: 705,
                        product_id: [205, 'WHITE MDF 18mm'],
                        product_uom_qty: 8,
                        quantity: 0,
                    },
                ];
            }
            return [];
        },
        callRecordMethod: async (model, method, ids) => {
            if (model === 'stock.picking' && method === 'button_validate') {
                validatedPickingIds.push(...ids);
            }
            return true;
        },
        writeRecord: async () => true,
        populatePickingValidationMetadata: async () => true,
        postModelChatterMessage: async () => 1,
        removeBoardsFromStock: async (arg) => {
            removedStockCalls.push(arg);
            return { newQty: 0 };
        },
    };
    try {
        const result = await (0, boardIntakeSyncService_1.reconcileRetroactiveBoardLogsForLinkedPos)(mockClient);
        strict_1.default.equal(result.matchedCount >= 1, true);
        strict_1.default.equal(result.logsFulfilled.includes(testLogId), true);
        strict_1.default.deepEqual(validatedPickingIds, [905]);
        strict_1.default.deepEqual(removedStockCalls, [{ productId: 205, quantity: 8 }]);
        const updatedLog = await (0, repositories_1.getBoardIntakeQueueEntry)(testLogId);
        strict_1.default.ok(updatedLog);
        strict_1.default.equal(Boolean(updatedLog.is_purchase), true);
        strict_1.default.equal(updatedLog.purchase_order_reference, 'P01095');
    }
    finally {
        await (0, db_1.execute)('DELETE FROM board_intake_queue WHERE id = ?', [testLogId]);
    }
});
(0, node_test_1.default)('processBoardIntakePurchaseOrderFulfillment isolates multi-product PO receipts and zeroes other items', async () => {
    const writtenMoveRecords = [];
    const writtenMoveLines = [];
    const processedWizards = [];
    const validatedPickingIds = [];
    const mockClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model, options) => {
            if (model === 'sale.order') {
                return [
                    {
                        id: 488,
                        name: 'S02888',
                        partner_id: [99, 'Multi-Product Customer'],
                        user_id: [12, 'Leoivard Ongule'],
                    },
                ];
            }
            if (model === 'purchase.order') {
                return [
                    {
                        id: 888,
                        name: 'P01888',
                        state: 'purchase',
                        origin: 'S02888',
                        order_line: [901, 902, 903],
                    },
                ];
            }
            if (model === 'purchase.order.line') {
                return [
                    { id: 901, order_id: [888, 'P01888'], product_id: [205, 'WHITE MDF 18mm'], product_qty: 10 },
                    { id: 902, order_id: [888, 'P01888'], product_id: [206, 'HARBOUR GREY 18mm'], product_qty: 5 },
                    { id: 903, order_id: [888, 'P01888'], product_id: [207, 'BACKER WHITE 3mm'], product_qty: 8 },
                ];
            }
            if (model === 'stock.picking') {
                return [
                    {
                        id: 777,
                        name: 'WH/IN/00777',
                        state: 'assigned',
                        picking_type_code: 'incoming',
                        move_ids_without_package: [1001, 1002, 1003],
                    },
                ];
            }
            if (model === 'stock.move') {
                // If domain filters by product_id = 205 (the target product)
                const prodDomain = options?.domain?.find((d) => Array.isArray(d) && d[0] === 'product_id');
                if (prodDomain && prodDomain[2] === 205) {
                    return [
                        {
                            id: 1001,
                            picking_id: [777, 'WH/IN/00777'],
                            product_id: [205, 'WHITE MDF 18mm'],
                            product_uom_qty: 10,
                            quantity: 0,
                            state: 'assigned',
                        },
                    ];
                }
                // If searching all moves for picking 777:
                return [
                    {
                        id: 1001,
                        picking_id: [777, 'WH/IN/00777'],
                        product_id: [205, 'WHITE MDF 18mm'],
                        product_uom_qty: 10,
                        quantity: 0,
                        state: 'assigned',
                    },
                    {
                        id: 1002,
                        picking_id: [777, 'WH/IN/00777'],
                        product_id: [206, 'HARBOUR GREY 18mm'],
                        product_uom_qty: 5,
                        quantity: 5, // Initially populated
                        state: 'assigned',
                    },
                    {
                        id: 1003,
                        picking_id: [777, 'WH/IN/00777'],
                        product_id: [207, 'BACKER WHITE 3mm'],
                        product_uom_qty: 8,
                        quantity: 8, // Initially populated
                        state: 'assigned',
                    },
                ];
            }
            if (model === 'stock.move.line') {
                return [
                    { id: 2001, move_id: [1001, 'move1'], product_id: [205, 'prod1'], quantity: 10 },
                    { id: 2002, move_id: [1002, 'move2'], product_id: [206, 'prod2'], quantity: 5 },
                    { id: 2003, move_id: [1003, 'move3'], product_id: [207, 'prod3'], quantity: 8 },
                ];
            }
            return [];
        },
        writeRecord: async (model, ids, values) => {
            if (model === 'stock.move')
                writtenMoveRecords.push({ ids, values });
            if (model === 'stock.move.line')
                writtenMoveLines.push({ ids, values });
            return true;
        },
        callRecordMethod: async (model, method, ids) => {
            if (model === 'stock.picking' && method === 'button_validate') {
                validatedPickingIds.push(...ids);
                // Returns backorder wizard action
                return {
                    res_model: 'stock.backorder.confirmation',
                    res_id: 55,
                };
            }
            if (model === 'stock.backorder.confirmation' && method === 'process') {
                processedWizards.push({ model, method, ids });
                return true;
            }
            return true;
        },
        populatePickingValidationMetadata: async () => true,
        postModelChatterMessage: async () => 1,
    };
    // Logging 6 sheets of WHITE MDF (partial, out of 10) on a PO with 3 products
    const result = await (0, boardIntakeSyncService_1.processBoardIntakePurchaseOrderFulfillment)(mockClient, {
        partner_id: '99',
        customer_name: 'Multi-Product Customer',
        product_id: '205',
        product_name: 'WHITE MDF 18mm',
        quantity: 6,
        actor_name: 'Gate Operator',
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result.fulfilledViaReceipt, true);
    strict_1.default.equal(result.qtyFulfilled, 6);
    strict_1.default.equal(result.surplusQty, 0);
    // Assert target move (1001) got quantity: 6
    const targetMoveWrite = writtenMoveRecords.find((r) => r.ids.includes(1001));
    strict_1.default.ok(targetMoveWrite, 'Target move 1001 should be written');
    strict_1.default.equal(targetMoveWrite.values.quantity, 6);
    // Assert non-target moves (1002, 1003) got quantity: 0
    const otherMoveWrites = writtenMoveRecords.filter((r) => r.ids.includes(1002) || r.ids.includes(1003));
    strict_1.default.equal(otherMoveWrites.length, 2);
    for (const w of otherMoveWrites) {
        strict_1.default.equal(w.values.quantity, 0, `Move ${w.ids} must be zeroed out`);
    }
    // Assert move lines: target move line (2001) got 6, non-target move lines (2002, 2003) got 0
    const targetLineWrite = writtenMoveLines.find((r) => r.ids.includes(2001));
    strict_1.default.ok(targetLineWrite);
    strict_1.default.equal(targetLineWrite.values.quantity, 6);
    const otherLineWrites = writtenMoveLines.filter((r) => r.ids.includes(2002) || r.ids.includes(2003));
    strict_1.default.equal(otherLineWrites.length, 2);
    for (const lw of otherLineWrites) {
        strict_1.default.equal(lw.values.quantity, 0, `Move line ${lw.ids} must be zeroed out`);
    }
    // Assert picking validated and backorder wizard processed
    strict_1.default.deepEqual(validatedPickingIds, [777]);
    strict_1.default.deepEqual(processedWizards, [{ model: 'stock.backorder.confirmation', method: 'process', ids: [55] }]);
});
