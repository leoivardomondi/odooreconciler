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
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const cuttingBoMReconciliationService_1 = require("./cuttingBoMReconciliationService");
const repositories_1 = require("../models/repositories");
const db_1 = require("../models/db");
(0, node_test_1.default)('selectBestBoardComponent: selects single best component matching Job Summary sheet materials', () => {
    const moProductName = 'Cutting Backer White MDF 3mm';
    const boardMoves = [
        {
            id: 101,
            product_id: [501, 'Backer White MDF 3mm'],
            product_uom_qty: 4,
            quantity: 0,
        },
        {
            id: 102,
            product_id: [502, 'Royal Teak MDF 18mm'],
            product_uom_qty: 7,
            quantity: 0,
        },
    ];
    const sheetMaterials = [
        {
            name: 'Backer White MDF 3mm',
            thickness_mm: 3,
            sheets: 4,
            panels: 8,
            length_mm: 2440,
            width_mm: 1220,
        },
    ];
    const result = (0, cuttingBoMReconciliationService_1.selectBestBoardComponent)({
        moProductName,
        moQty: 4,
        boardMoves,
        sheetMaterials,
    });
    strict_1.default.equal(result.chosenMove.id, 101, 'Should select Backer White MDF 3mm move matching Job Summary');
    strict_1.default.equal(result.alignedQty, 4, 'Should align quantity to 4 sheets');
    strict_1.default.equal(result.matchedMaterialName, 'Backer White MDF 3mm');
});
(0, node_test_1.default)('selectBestBoardComponent: falls back to cutting MO product name when no Job Summary', () => {
    const moProductName = 'Cutting Harbour Grey waterproof 18mm';
    const boardMoves = [
        {
            id: 201,
            product_id: [601, 'White MDF 18mm'],
            product_uom_qty: 9,
            quantity: 0,
        },
        {
            id: 202,
            product_id: [602, 'Harbour Grey waterproof 18mm'],
            product_uom_qty: 9,
            quantity: 0,
        },
    ];
    const result = (0, cuttingBoMReconciliationService_1.selectBestBoardComponent)({
        moProductName,
        moQty: 9,
        boardMoves,
        sheetMaterials: [],
    });
    strict_1.default.equal(result.chosenMove.id, 202, 'Should select Harbour Grey waterproof 18mm matching cutting product');
    strict_1.default.equal(result.alignedQty, 9);
});
(0, node_test_1.default)('filterSingleBoardComponentForCuttingMo: returns only 1 component for cutting MO with 2 components and alerts Leoivard', async () => {
    (0, cuttingBoMReconciliationService_1.clearDuplicateBomNotifiedCache)();
    const mo = {
        id: 99991,
        name: 'WH/MO/99991',
        origin: 'SO-TEST-001',
        product_id: [701, 'Cutting Backer White MDF 3mm'],
        product_qty: 4,
    };
    const boardMoves = [
        {
            id: 301,
            product_id: [801, 'Backer White MDF 3mm'],
            product_uom_qty: 4,
            quantity: 0,
            state: 'confirmed',
        },
        {
            id: 302,
            product_id: [802, 'Royal Teak MDF 18mm'],
            product_uom_qty: 7,
            quantity: 0,
            state: 'confirmed',
        },
    ];
    const postedChatters = [];
    const mockClient = {
        postModelChatterMessage: async (model, id, message, partnerIds) => {
            postedChatters.push({ model, id, message, partnerIds });
            return true;
        },
        searchReadRecords: async (model) => {
            if (model === 'res.users') {
                return [{ id: 88, name: 'Leoivard Ongule', partner_id: [188, 'Leoivard Ongule'] }];
            }
            return [];
        },
    };
    const filtered = await (0, cuttingBoMReconciliationService_1.filterSingleBoardComponentForCuttingMo)({
        mo,
        boardMoves,
        client: mockClient,
        parsedJobSummary: {
            items: [],
            sectionFound: true,
            sectionText: '',
            rawText: '',
            logs: [],
            sheetMaterials: [
                {
                    name: 'Backer White MDF 3mm',
                    thickness_mm: 3,
                    sheets: 4,
                    panels: 8,
                    length_mm: 2440,
                    width_mm: 1220,
                },
            ],
        },
    });
    strict_1.default.equal(filtered.length, 1, 'Cutting BoM must strictly return exactly 1 board component move');
    strict_1.default.equal(filtered[0].id, 301, 'Must choose Backer White MDF 3mm');
    strict_1.default.equal(filtered[0].product_uom_qty, 4, 'Must align quantity with Job Summary');
    // Verify Leoivard was notified in chatter
    strict_1.default.equal(postedChatters.length, 1, 'Should post a chatter notification on MO');
    strict_1.default.equal(postedChatters[0].model, 'mrp.production');
    strict_1.default.equal(postedChatters[0].id, 99991);
    strict_1.default.ok(postedChatters[0].message.includes('Duplicate Board Component Detected'));
    strict_1.default.deepEqual(postedChatters[0].partnerIds, [188], 'Must cc Leoivard Ongule');
});
(0, node_test_1.default)('filterSingleBoardComponentForCuttingMo: leaves non-cutting products untouched', async () => {
    const mo = {
        id: 99992,
        name: 'WH/MO/99992',
        origin: 'SO-TEST-002',
        product_id: [702, 'Assembly Cabinet Unit'],
        product_qty: 1,
    };
    const boardMoves = [
        {
            id: 401,
            product_id: [801, 'Backer White MDF 3mm'],
            product_uom_qty: 2,
        },
        {
            id: 402,
            product_id: [802, 'White MDF 18mm'],
            product_uom_qty: 5,
        },
    ];
    const filtered = await (0, cuttingBoMReconciliationService_1.filterSingleBoardComponentForCuttingMo)({
        mo,
        boardMoves,
    });
    strict_1.default.equal(filtered.length, 2, 'Non-cutting MOs can legitimately use multiple board components');
});
(0, node_test_1.default)('filterSingleBoardComponentForCuttingMo: deduplicates Leoivard notifications within 24h', async () => {
    (0, cuttingBoMReconciliationService_1.clearDuplicateBomNotifiedCache)();
    const mo = {
        id: 99993,
        name: 'WH/MO/99993',
        origin: 'SO-TEST-003',
        product_id: [703, 'Cutting Backer White MDF 3mm'],
        product_qty: 5,
    };
    const boardMoves = [
        { id: 501, product_id: [801, 'Backer White MDF 3mm'], product_uom_qty: 5 },
        { id: 502, product_id: [802, 'White MDF 18mm'], product_uom_qty: 5 },
    ];
    let postCount = 0;
    const mockClient = {
        postModelChatterMessage: async () => {
            postCount++;
            return true;
        },
        searchReadRecords: async () => [{ id: 88, name: 'Leoivard Ongule', partner_id: [188, 'Leoivard Ongule'] }],
    };
    // First call -> triggers notification
    await (0, cuttingBoMReconciliationService_1.filterSingleBoardComponentForCuttingMo)({ mo, boardMoves, client: mockClient });
    strict_1.default.equal(postCount, 1, 'First call must trigger notification');
    // Second call immediately -> suppressed by 24h cooldown
    await (0, cuttingBoMReconciliationService_1.filterSingleBoardComponentForCuttingMo)({ mo, boardMoves, client: mockClient });
    strict_1.default.equal(postCount, 1, 'Second call must be suppressed by cooldown');
});
(0, node_test_1.default)('pruneStalePendingProcessesForActiveMos: immediately deletes cancelled MOs so they no longer need stock', async () => {
    const cancelledMoId = 88881;
    const cancelledRowId = `${cancelledMoId}_901`;
    // Insert a test pending process for a cancelled MO
    await (0, db_1.execute)(`INSERT INTO shop_floor_pending_processes (
      id, process_type, mo_id, mo_name, origin, partner_id, partner_name,
      product_id, product_name, qty_needed, qty_reserved, qty_missing,
      status, is_mo_closed, created_at, updated_at
    ) VALUES (?, 'board_intake', ?, 'WH/MO/88881', 'SO88881', 10, 'Test Customer',
      901, 'White MDF 18mm', 10, 0, 10, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`, [cancelledRowId, cancelledMoId]);
    // Check it was inserted
    const before = await (0, db_1.queryOne)(`SELECT id FROM shop_floor_pending_processes WHERE id = ?`, [cancelledRowId]);
    strict_1.default.ok(before, 'Pending process must exist before pruning');
    // Prune with cancelledMoIds containing cancelledMoId
    await (0, repositories_1.pruneStalePendingProcessesForActiveMos)([], // activeMoIds
    [], // validKeys
    [], // poCoveredKeys
    [cancelledMoId]);
    // Check it was completely purged
    const after = await (0, db_1.queryOne)(`SELECT id FROM shop_floor_pending_processes WHERE id = ?`, [cancelledRowId]);
    strict_1.default.equal(after, null, 'Cancelled MO must be deleted and not linger needing stock');
});
(0, node_test_1.default)('upsertPendingShopFloorProcesses: adjusts qty_needed and qty_missing when MO quantity is reduced from 10 to 5', async () => {
    const { upsertPendingShopFloorProcesses } = await Promise.resolve().then(() => __importStar(require('../models/repositories')));
    const moId = 88882;
    const rowId = `${moId}_902`;
    // Initially required 10 boards
    await upsertPendingShopFloorProcesses([
        {
            id: rowId,
            process_type: 'board_intake',
            mo_id: moId,
            mo_name: 'WH/MO/88882',
            origin: 'SO88882',
            partner_id: 11,
            partner_name: 'Customer A',
            product_id: 902,
            product_name: 'Dark Grey MDF 18mm',
            qty_needed: 10,
            qty_reserved: 0,
            qty_missing: 10,
            status: 'pending',
            loaded_at: null,
            loaded_by: null,
            is_mo_closed: false,
            last_synced_at: new Date().toISOString(),
        },
    ]);
    const initial = await (0, db_1.queryOne)(`SELECT qty_needed, qty_missing FROM shop_floor_pending_processes WHERE id = ?`, [rowId]);
    strict_1.default.equal(Number(initial?.qty_needed), 10);
    strict_1.default.equal(Number(initial?.qty_missing), 10);
    // Operator edits in Odoo and reduces quantity to 5
    await upsertPendingShopFloorProcesses([
        {
            id: rowId,
            process_type: 'board_intake',
            mo_id: moId,
            mo_name: 'WH/MO/88882',
            origin: 'SO88882',
            partner_id: 11,
            partner_name: 'Customer A',
            product_id: 902,
            product_name: 'Dark Grey MDF 18mm',
            qty_needed: 5,
            qty_reserved: 0,
            qty_missing: 5,
            status: 'pending',
            loaded_at: null,
            loaded_by: null,
            is_mo_closed: false,
            last_synced_at: new Date().toISOString(),
        },
    ]);
    const adjusted = await (0, db_1.queryOne)(`SELECT qty_needed, qty_missing FROM shop_floor_pending_processes WHERE id = ?`, [rowId]);
    strict_1.default.equal(Number(adjusted?.qty_needed), 5, 'Must recognize quantity reduction and adjust qty_needed to 5');
    strict_1.default.equal(Number(adjusted?.qty_missing), 5, 'Must recognize quantity reduction and adjust qty_missing to 5');
    // Clean up test row
    await (0, db_1.execute)(`DELETE FROM shop_floor_pending_processes WHERE id = ?`, [rowId]);
});
