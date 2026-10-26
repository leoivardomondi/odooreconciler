"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const boardIntakeSyncService_1 = require("./boardIntakeSyncService");
const shopFloorPendingSyncService_1 = require("./shopFloorPendingSyncService");
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
