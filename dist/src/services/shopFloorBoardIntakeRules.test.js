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
    strict_1.default.equal(preserved.is_mo_closed, true, 'is_mo_closed must be set to true when MO is closed without matching history log');
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
const boardIntakeSyncService_1 = require("./boardIntakeSyncService");
(0, node_test_1.default)('Boards logged against an MO are cross-posted to the related Sales Order chatter with tags, no emoji, and all details', async () => {
    const entry = {
        customer_name: 'John Doe',
        product_name: 'WHITE MDF 18mm',
        quantity: 10,
        gate: 'Front Gate',
        vehicle_registration: 'KCA 123X',
        arrival_time: '14:30',
        arrival_date: '2026-10-21',
        actor_name: 'Operator Gate',
        actor_email: 'gate@urbanvibe.co.ke',
    };
    const chatterCalls = [];
    const fakeClient = {
        findMOsForBoardIntake: async () => [
            {
                moId: 501,
                moName: 'WH/MO/00501',
                origin: 'S02182',
                soId: 105,
                soName: 'S02182',
                soUserId: 22,
                soUserName: 'Sharon',
                hasBoardPo: true,
                boardPoNames: ['P00123'],
                qtyNeeded: 10,
                qtyReserved: 0,
                state: 'confirmed',
            },
        ],
        readRecords: async (_model, _ids, _fields) => [
            { id: 22, name: 'Sharon', login: 'sharon@urbanvibe.co.ke', partner_id: [45, 'Sharon Partner'] },
        ],
        searchReadRecords: async () => [],
        postModelChatterMessage: async (model, id, message, partnerIds) => {
            chatterCalls.push({ model, id, message, partnerIds });
            return 1;
        },
    };
    const matchingMOs = await fakeClient.findMOsForBoardIntake();
    await Promise.all(matchingMOs.map(async (mo) => {
        const { mentionHtml, partnerIds } = await (0, boardIntakeSyncService_1.resolveBoardIntakeStakeholders)(fakeClient, mo.soUserId);
        const html = (0, boardIntakeSyncService_1.buildBoardIntakeChatterHtml)({
            customerName: entry.customer_name,
            productName: entry.product_name,
            quantity: entry.quantity,
            moName: mo.moName,
            gate: entry.gate,
            vehicleRegistration: entry.vehicle_registration,
            arrivalTime: entry.arrival_time,
            reportDate: entry.arrival_date,
            actorName: entry.actor_name,
            mentionHtml,
            hasBoardPo: mo.hasBoardPo,
            boardPoNames: mo.boardPoNames,
        });
        return fakeClient.postModelChatterMessage('mrp.production', mo.moId, html, partnerIds);
    }));
    const postedSoIds = new Set();
    for (const mo of matchingMOs) {
        if (mo.soId && !postedSoIds.has(mo.soId)) {
            postedSoIds.add(mo.soId);
            const { mentionHtml, partnerIds } = await (0, boardIntakeSyncService_1.resolveBoardIntakeStakeholders)(fakeClient, mo.soUserId);
            const html = (0, boardIntakeSyncService_1.buildBoardIntakeChatterHtml)({
                customerName: entry.customer_name,
                productName: entry.product_name,
                quantity: entry.quantity,
                moName: mo.moName,
                gate: entry.gate,
                vehicleRegistration: entry.vehicle_registration,
                arrivalTime: entry.arrival_time,
                reportDate: entry.arrival_date,
                actorName: entry.actor_name,
                mentionHtml,
                hasBoardPo: mo.hasBoardPo,
                boardPoNames: mo.boardPoNames,
            });
            await fakeClient.postModelChatterMessage('sale.order', mo.soId, html, partnerIds);
        }
    }
    // Verify MO chatter was posted
    const moChatter = chatterCalls.find((c) => c.model === 'mrp.production' && c.id === 501);
    strict_1.default.ok(moChatter, 'Must post to mrp.production');
    // Starts with tag of responsible salesperson
    strict_1.default.ok(moChatter.message.startsWith('<a href="#" data-oe-model="res.partner" data-oe-id="45">@Sharon</a>'));
    // Tree log emoji 🪵 is removed
    strict_1.default.ok(!moChatter.message.includes('🪵'));
    strict_1.default.ok(moChatter.message.includes('<strong>Board log completed (Operator Mobile App)</strong>'));
    strict_1.default.ok(moChatter.message.includes('WH/MO/00501'));
    strict_1.default.ok(moChatter.message.includes('WHITE MDF 18mm'));
    strict_1.default.ok(moChatter.message.includes('KCA 123X'));
    strict_1.default.ok(moChatter.message.includes('Front Gate'));
    strict_1.default.ok(moChatter.message.includes('14:30'));
    // Partner IDs notified
    strict_1.default.deepEqual(moChatter.partnerIds, [45]);
    // PO communication prompt is present
    strict_1.default.ok(moChatter.message.includes('Purchase Order Notice (P00123)'));
    strict_1.default.ok(moChatter.message.includes('communicate with the operators on whether this is a purchase or not'));
    // Verify SO chatter was posted with all details
    const soChatter = chatterCalls.find((c) => c.model === 'sale.order' && c.id === 105);
    strict_1.default.ok(soChatter, 'Must post to related sale.order chatter');
    strict_1.default.ok(soChatter.message.startsWith('<a href="#" data-oe-model="res.partner" data-oe-id="45">@Sharon</a>'));
    strict_1.default.ok(!soChatter.message.includes('🪵'));
    strict_1.default.ok(soChatter.message.includes('Client:</strong> John Doe'));
    strict_1.default.ok(soChatter.message.includes('Board:</strong> WHITE MDF 18mm'));
    strict_1.default.ok(soChatter.message.includes('Quantity:</strong> 10'));
    strict_1.default.ok(soChatter.message.includes('Manufacturing Order:</strong> WH/MO/00501'));
    strict_1.default.ok(soChatter.message.includes('Gate:</strong> Front Gate'));
    strict_1.default.ok(soChatter.message.includes('Vehicle Reg:</strong> KCA 123X'));
    strict_1.default.ok(soChatter.message.includes('Arrival Time:</strong> 14:30'));
    strict_1.default.ok(soChatter.message.includes('Logged by:</strong> Operator Gate'));
    strict_1.default.ok(soChatter.message.includes('communicate with the operators on whether this is a purchase or not'));
    strict_1.default.deepEqual(soChatter.partnerIds, [45]);
});
(0, node_test_1.default)('Board intake chatter tags both Candy and Sharon when SO has no salesperson', async () => {
    const fakeClient = {
        readRecords: async () => [],
        searchReadRecords: async (_model, options) => {
            const term = JSON.stringify(options.domain);
            if (term.includes('Candy')) {
                return [{ id: 11, name: 'Candy', login: 'candy@urbanvibe.co.ke', partner_id: [88, 'Candy Partner'] }];
            }
            if (term.includes('Sharon')) {
                return [{ id: 22, name: 'Sharon', login: 'sharon@urbanvibe.co.ke', partner_id: [45, 'Sharon Partner'] }];
            }
            return [];
        },
    };
    const { mentionHtml, partnerIds } = await (0, boardIntakeSyncService_1.resolveBoardIntakeStakeholders)(fakeClient, null);
    strict_1.default.ok(mentionHtml.includes('@Candy'));
    strict_1.default.ok(mentionHtml.includes('@Sharon'));
    strict_1.default.ok(mentionHtml.includes('data-oe-id="88"'));
    strict_1.default.ok(mentionHtml.includes('data-oe-id="45"'));
    strict_1.default.deepEqual(partnerIds, [88, 45]);
    const html = (0, boardIntakeSyncService_1.buildBoardIntakeChatterHtml)({
        customerName: 'GEORGE ODHIAMBO',
        productName: 'Versasca Particle 18mm',
        quantity: 5,
        moName: 'WH/MO/05471',
        mentionHtml,
        hasBoardPo: false,
    });
    strict_1.default.ok(html.startsWith('<a href="#" data-oe-model="res.partner" data-oe-id="88">@Candy</a> <a href="#" data-oe-model="res.partner" data-oe-id="45">@Sharon</a>'));
    strict_1.default.ok(!html.includes('🪵'));
    strict_1.default.ok(html.includes('<strong>Board log completed (Operator Mobile App)</strong>'));
    // No PO notice when hasBoardPo is false
    strict_1.default.ok(!html.includes('Purchase Order Notice'));
});
(0, node_test_1.default)('Board intake strictly rejects decimals and requires whole boards only', () => {
    const isAllowedQuantity = (qty) => {
        return qty > 0 && Number.isFinite(qty) && Number.isInteger(qty) && qty % 1 === 0;
    };
    strict_1.default.equal(isAllowedQuantity(1), true);
    strict_1.default.equal(isAllowedQuantity(5), true);
    strict_1.default.equal(isAllowedQuantity(10), true);
    strict_1.default.equal(isAllowedQuantity(0.5), false);
    strict_1.default.equal(isAllowedQuantity(1.5), false);
    strict_1.default.equal(isAllowedQuantity(2.25), false);
    strict_1.default.equal(isAllowedQuantity(0), false);
    strict_1.default.equal(isAllowedQuantity(-1), false);
});
(0, node_test_1.default)('checkAndWarnPurchaseOrdersForManualBoardIntake warns salesperson to communicate with operator when PO matches', async () => {
    const chatterCalls = [];
    const fakeClient = {
        getTargetCompanyIdValue: async () => 1,
        searchReadRecords: async (model, options) => {
            if (model === 'sale.order') {
                return [{ id: 105, name: 'S02182', partner_id: [201, 'GEORGE ODHIAMBO'], user_id: [22, 'Sharon'] }];
            }
            if (model === 'mrp.production') {
                return [{ id: 501, name: 'WH/MO/05471', origin: 'S02182' }];
            }
            if (model === 'purchase.order') {
                return [
                    {
                        id: 801,
                        name: 'P00450',
                        state: 'draft', // Yet to be approved
                        origin: 'S02182',
                        partner_id: [301, 'Timber Supplier Ltd'],
                    },
                ];
            }
            if (model === 'purchase.order.line') {
                return [
                    {
                        id: 901,
                        order_id: [801, 'P00450'],
                        product_id: [123, 'Versasca Particle 18mm'],
                        product_qty: 5,
                    },
                ];
            }
            if (model === 'res.users') {
                return [{ id: 22, name: 'Sharon', login: 'sharon@urbanvibe.co.ke', partner_id: [45, 'Sharon Partner'] }];
            }
            return [];
        },
        readRecords: async (_model, ids) => {
            if (ids.includes(22)) {
                return [{ id: 22, name: 'Sharon', login: 'sharon@urbanvibe.co.ke', partner_id: [45, 'Sharon Partner'] }];
            }
            return [];
        },
        postModelChatterMessage: async (model, id, message, partnerIds) => {
            chatterCalls.push({ model, id, message, partnerIds });
            return 1;
        },
    };
    const warnings = await (0, boardIntakeSyncService_1.checkAndWarnPurchaseOrdersForManualBoardIntake)(fakeClient, {
        partner_id: 201,
        product_id: 123,
        product_name: 'Versasca Particle 18mm',
        quantity: 5,
        customer_name: 'GEORGE ODHIAMBO',
        actor_name: 'Leoivard Ongule',
    });
    strict_1.default.equal(warnings.length, 1);
    strict_1.default.equal(warnings[0].poName, 'P00450');
    strict_1.default.equal(warnings[0].poStateLabel, 'Yet to be approved');
    strict_1.default.equal(warnings[0].actorName, 'Leoivard Ongule');
    // Verify chatter was posted to SO and PO
    const soPost = chatterCalls.find((c) => c.model === 'sale.order' && c.id === 105);
    const poPost = chatterCalls.find((c) => c.model === 'purchase.order' && c.id === 801);
    strict_1.default.ok(soPost, 'Must post warning to sale.order');
    strict_1.default.ok(poPost, 'Must post warning to purchase.order');
    // Must tag the salesperson
    strict_1.default.ok(soPost.message.includes('@Sharon'));
    strict_1.default.deepEqual(soPost.partnerIds, [45]);
    // Must state the responsible operator by name
    strict_1.default.ok(soPost.message.includes('Leoivard Ongule'));
    // Must instruct salesperson to communicate with the operator on whether boards were purchased
    strict_1.default.ok(soPost.message.includes('communicate with operator <strong>Leoivard Ongule</strong> to confirm whether these boards were purchased'));
    strict_1.default.ok(soPost.message.includes('Yet to be approved'));
    strict_1.default.ok(soPost.message.includes('P00450'));
});
(0, node_test_1.default)('Board Log Notifications: urbanvibeinteriordesign@gmail.com is hardcoded and cannot be deleted or omitted', async () => {
    const { HARDCODED_BOARD_LOG_NOTIFICATION_EMAIL, normalizeBoardLogRecipients, DEFAULT_STOCK_CONFIG, } = await Promise.resolve().then(() => __importStar(require('../utils/helpers')));
    strict_1.default.equal(HARDCODED_BOARD_LOG_NOTIFICATION_EMAIL, 'urbanvibeinteriordesign@gmail.com');
    // Verify DEFAULT_STOCK_CONFIG includes urbanvibeinteriordesign@gmail.com
    strict_1.default.ok(DEFAULT_STOCK_CONFIG.boardLogNotificationEmail?.includes('urbanvibeinteriordesign@gmail.com'));
    // When empty or undefined, hardcoded email is returned
    strict_1.default.equal(normalizeBoardLogRecipients(''), 'urbanvibeinteriordesign@gmail.com');
    strict_1.default.equal(normalizeBoardLogRecipients(undefined), 'urbanvibeinteriordesign@gmail.com');
    strict_1.default.equal(normalizeBoardLogRecipients(null), 'urbanvibeinteriordesign@gmail.com');
    // When only another email is configured, urbanvibeinteriordesign@gmail.com is automatically prepended
    const normalizedSharon = normalizeBoardLogRecipients('sharon@urbanvibeinteriordesign.co.ke');
    strict_1.default.ok(normalizedSharon.includes('urbanvibeinteriordesign@gmail.com'));
    strict_1.default.ok(normalizedSharon.includes('sharon@urbanvibeinteriordesign.co.ke'));
    // When someone tries to save a single custom recipient, urbanvibeinteriordesign@gmail.com is preserved
    const custom = normalizeBoardLogRecipients('admin@example.com');
    strict_1.default.equal(custom, 'urbanvibeinteriordesign@gmail.com, admin@example.com');
    // When urbanvibeinteriordesign@gmail.com is already present, no duplicate is added
    const withExisting = normalizeBoardLogRecipients('urbanvibeinteriordesign@gmail.com, admin@example.com');
    strict_1.default.equal(withExisting, 'urbanvibeinteriordesign@gmail.com, admin@example.com');
    // Case insensitivity & whitespace trimming
    const mixed = normalizeBoardLogRecipients('  URBANVIBEINTERIORDESIGN@GMAIL.COM ;  other@vibe.co.ke \n ');
    strict_1.default.equal(mixed, 'urbanvibeinteriordesign@gmail.com, other@vibe.co.ke');
});
(0, node_test_1.default)('When an MO needs 10 boards and operator logs 5: stock requirement of 5 is preserved, balance 5 is tracked, and chatter states 5 logged balance 5', async () => {
    const testMoId = 99505;
    const testProdId = 88505;
    const key = `${testMoId}_${testProdId}`;
    const clientName = 'Partial Intake Client 505';
    const prodName = 'WHITE MDF 18mm';
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    // Seed pending process: MO needs 10 boards, none received yet
    const process = {
        id: key,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99505',
        origin: 'S99505',
        partner_id: 505,
        partner_name: clientName,
        product_id: testProdId,
        product_name: prodName,
        qty_needed: 10,
        qty_reserved: 0,
        qty_missing: 10,
        status: 'pending',
        loaded_at: null,
        loaded_by: null,
        last_synced_at: new Date().toISOString(),
    };
    await (0, repositories_1.upsertPendingShopFloorProcesses)([process]);
    // Operator logs 5 boards out of 10 required
    const updatedReqs = await (0, repositories_1.markPendingShopFloorProcessesLoaded)({
        partnerId: 505,
        productId: testProdId,
        customerName: clientName,
        productName: prodName,
        loadedBy: 'Gate Operator',
        quantity: 5,
    });
    // Verify the updated requirement returned:
    strict_1.default.equal(updatedReqs.length, 1);
    const updated = updatedReqs[0];
    strict_1.default.equal(updated.qty_needed, 10, 'Total requirement must stay 10 boards');
    strict_1.default.equal(updated.qty_reserved, 5, '5 boards must be reserved in stock');
    strict_1.default.equal(updated.qty_missing, 5, 'Stock requirement balance of 5 boards must remain active');
    strict_1.default.equal(updated.status, 'pending', 'Process status must remain pending (not loaded/closed)');
    // Verify DB state: still in pending processes list with qty_missing = 5
    const pendingProcesses = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    const pendingMo = pendingProcesses.find((p) => p.id === key);
    strict_1.default.ok(pendingMo, 'Requirement must still be present in pending list');
    strict_1.default.equal(pendingMo.qty_missing, 5);
    strict_1.default.equal(pendingMo.status, 'pending');
    // Verify Chatter Note HTML generation:
    const chatterHtml = (0, boardIntakeSyncService_1.buildBoardIntakeChatterHtml)({
        customerName: clientName,
        productName: prodName,
        quantity: 5,
        qtyNeeded: 10,
        balanceRemaining: 5,
        moName: 'WH/MO/99505',
        gate: 'Gate 1',
        actorName: 'Gate Operator',
    });
    // 1. Must show logged quantity
    strict_1.default.ok(chatterHtml.includes('<strong>Quantity:</strong> 5 sheets'));
    // 2. Must show total required
    strict_1.default.ok(chatterHtml.includes('<strong>Total Required:</strong> 10 sheets'));
    // 3. Must show balance remaining
    strict_1.default.ok(chatterHtml.includes('<strong>Balance Remaining:</strong> <span style="color:#b91c1c;font-weight:bold;">5 sheets needed</span>'));
    // 4. Must include partial intake callout note with logged & balance
    strict_1.default.ok(chatterHtml.includes('PARTIAL INTAKE:</strong> 5 sheets logged, balance <strong>5 sheets</strong> still required for WH/MO/99505'));
    strict_1.default.ok(chatterHtml.includes('Stock requirement of 5 boards remains active before cutting/completion can start'));
    // When second batch of 5 boards arrives (completing the 10):
    const completeChatterHtml = (0, boardIntakeSyncService_1.buildBoardIntakeChatterHtml)({
        customerName: clientName,
        productName: prodName,
        quantity: 5,
        qtyNeeded: 10,
        balanceRemaining: 0,
        moName: 'WH/MO/99505',
    });
    strict_1.default.ok(completeChatterHtml.includes('<strong>Balance Remaining:</strong> <span style="color:#15803d;font-weight:bold;">0 sheets (Fully supplied)</span>'));
    strict_1.default.ok(completeChatterHtml.includes('COMPLETE INTAKE:</strong> All 10 sheets received and allocated in stock'));
});
(0, node_test_1.default)('When an MO needs 10 boards and 5 are logged: operator still sees the unlogged card for the balance of 5 with isSyncing=false', async () => {
    const testMoId = 99606;
    const testProdId = 88606;
    const key = `${testMoId}_${testProdId}`;
    const clientName = 'Card Balance Test Client 606';
    const prodName = 'BLACK MDF 18mm';
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    // Seed pending process: MO needs 10 boards
    const process = {
        id: key,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99606',
        origin: 'S99606',
        partner_id: 606,
        partner_name: clientName,
        product_id: testProdId,
        product_name: prodName,
        qty_needed: 10,
        qty_reserved: 0,
        qty_missing: 10,
        status: 'pending',
        loaded_at: null,
        loaded_by: null,
        last_synced_at: new Date().toISOString(),
    };
    await (0, repositories_1.upsertPendingShopFloorProcesses)([process]);
    // Operator logs 5 boards
    await (0, repositories_1.markPendingShopFloorProcessesLoaded)({
        partnerId: 606,
        productId: testProdId,
        customerName: clientName,
        productName: prodName,
        loadedBy: 'Gate Operator',
        quantity: 5,
    });
    // Query pending rows from MySQL (as done in GET /shop-floor/boards)
    const pendingRows = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    const row = pendingRows.find((p) => p.id === key);
    strict_1.default.ok(row, 'Row must still exist in pending processes');
    strict_1.default.equal(row.qty_needed, 10, 'Total needed is 10');
    strict_1.default.equal(row.qty_reserved, 5, 'Reserved is 5');
    strict_1.default.equal(row.qty_missing, 5, 'Unlogged balance is 5');
    // Verify stock alert card construction rules:
    // The unlogged balance of 5 boards is NOT syncing - it is an active unlogged card waiting to be logged!
    const hasUnloggedBalance = Number(row.qty_missing || 0) > 0;
    const isSyncing = !hasUnloggedBalance; // Must be false!
    strict_1.default.equal(isSyncing, false, 'Card must NOT be locked as syncing; it must be an active undone card');
    // Verify that an undone item filter counts this card
    const cardAlert = {
        moName: row.mo_name,
        product: row.product_name,
        component: row.product_name,
        qtyNeeded: row.qty_missing, // 5 boards
        totalNeeded: row.qty_needed, // 10 boards
        qtyReserved: row.qty_reserved, // 5 boards
        client: row.partner_name,
        isSyncing,
    };
    strict_1.default.equal(cardAlert.qtyNeeded, 5);
    strict_1.default.equal(cardAlert.isSyncing, false);
    // Operator sees undone item with 5 boards balance
    const isUndone = !cardAlert.isSyncing && cardAlert.qtyNeeded > 0;
    strict_1.default.equal(isUndone, true, 'Operator must see unlogged card of the balance');
});
(0, node_test_1.default)('Work order or MO closed without stock logged: flagged with is_mo_closed = true and prominent alert state', async () => {
    const testMoId = 99505;
    const testProdId = 88505;
    const key = `${testMoId}_${testProdId}`;
    await (0, db_1.execute)('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
    await (0, db_1.execute)('DELETE FROM board_intake_queue WHERE partner_id = ?', [505]);
    // 1. Initial pending process created when MO was confirmed in Odoo
    const process = {
        id: key,
        process_type: 'board_intake',
        mo_id: testMoId,
        mo_name: 'WH/MO/99505',
        origin: 'S99505',
        partner_id: 505,
        partner_name: 'Closed Job Client',
        product_id: testProdId,
        product_name: 'WHITE GLOSS MDF 18mm',
        qty_needed: 8,
        qty_reserved: 0,
        qty_missing: 8,
        status: 'pending',
        loaded_at: null,
        loaded_by: null,
        is_mo_closed: false,
        last_synced_at: new Date().toISOString(),
    };
    await (0, repositories_1.upsertPendingShopFloorProcesses)([process]);
    // 2. Someone in Odoo closes the work order / marks MO done without logging stock!
    // When sync/prune runs, activeMoIds does NOT contain 99505
    await (0, repositories_1.pruneStalePendingProcessesForActiveMos)([], []);
    // 3. Verify it is preserved in MySQL and is_mo_closed is updated to true
    const pendingRows = await (0, repositories_1.getPendingShopFloorProcesses)({ status: 'pending' });
    const row = pendingRows.find((p) => p.id === key);
    strict_1.default.ok(row, 'Process must be preserved in MySQL because boards were never logged');
    strict_1.default.equal(row.is_mo_closed, true, 'is_mo_closed must be true');
    strict_1.default.equal(row.qty_missing, 8, '8 boards are still missing');
    // 4. Construct the stock alert item for UI as done in /shop-floor/boards
    const alertItem = {
        moName: row.mo_name,
        product: row.product_name,
        component: row.product_name,
        qtyNeeded: row.qty_missing,
        totalNeeded: row.qty_needed,
        qtyReserved: row.qty_reserved,
        client: row.partner_name,
        moId: row.mo_id,
        isSyncing: false,
        isMoClosed: Boolean(row.is_mo_closed),
    };
    strict_1.default.equal(alertItem.isMoClosed, true, 'Card alert must carry isMoClosed = true');
    // Check the alert condition that triggers the prominent red banner
    const shouldShowClosedWarning = alertItem.isMoClosed === true;
    strict_1.default.equal(shouldShowClosedWarning, true, 'Alert must display: WORK ORDER CLOSED BUT STOCK NOT YET LOGGED');
});
