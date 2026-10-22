"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const workOrderQuantityReconciliationService_1 = require("./workOrderQuantityReconciliationService");
(0, node_test_1.default)('isCuttingProductOrWorkOrder correctly identifies cutting products and operations', () => {
    // Positive cases (MO product names)
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Cutting White Mdf 18mm 6 panels'), true);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Cutting White MDF 18mm'), true);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Cutting - White MDF 18mm'), true);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('CUTTING WHITE MDF 18MM'), true);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Cutting Chipboard 16mm'), true);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Cut panels'), true);
    // Positive cases (Work order operations)
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)(undefined, 'Table Saw Cutting'), true);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)(undefined, 'Panel Saw Operation'), true);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)(undefined, 'Sawing and grooving'), true);
    // Negative cases
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Edge Banding Service White'), false);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Hinges and Screws'), false);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)('Transport Delivery'), false);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)(undefined, 'Edge Banding Area'), false);
});
(0, node_test_1.default)('extractThicknessMm extracts thickness reliably', () => {
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.extractThicknessMm)('Cutting White Mdf 18mm 6 panels'), 18);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.extractThicknessMm)('WHITE MDF 18 mm'), 18);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.extractThicknessMm)('Particle Board 16mm'), 16);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.extractThicknessMm)('Plywood 9mm'), 9);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.extractThicknessMm)('No thickness board'), null);
    strict_1.default.equal((0, workOrderQuantityReconciliationService_1.extractThicknessMm)(null), null);
});
(0, node_test_1.default)('findMatchingSheetMaterial matches MO product and components against Job Summary', () => {
    const sheetMaterials = [
        {
            name: 'WHITE MDF',
            thickness_mm: 18,
            sheets: 4,
            panels: 4,
            length_mm: 2440,
            width_mm: 1220,
        },
        {
            name: 'OAK VENEER',
            thickness_mm: 18,
            sheets: 2,
            panels: 2,
            length_mm: 2440,
            width_mm: 1220,
        },
    ];
    // Case 1: Match from MO product name ("Cutting White Mdf 18mm 6 panels")
    const match1 = (0, workOrderQuantityReconciliationService_1.findMatchingSheetMaterial)({
        moProductName: 'Cutting White Mdf 18mm 6 panels',
        sheetMaterials,
    });
    strict_1.default.ok(match1);
    strict_1.default.equal(match1.material.name, 'WHITE MDF');
    strict_1.default.equal(match1.material.sheets, 4);
    // Case 2: Match from raw material component move
    const match2 = (0, workOrderQuantityReconciliationService_1.findMatchingSheetMaterial)({
        moProductName: 'Cutting Operation',
        componentNames: ['OAK VENEER 18mm', 'Contact Adhesive'],
        sheetMaterials,
    });
    strict_1.default.ok(match2);
    strict_1.default.equal(match2.material.name, 'OAK VENEER');
    strict_1.default.equal(match2.material.sheets, 2);
    // Case 3: Single sheet material fallback
    const singleMaterial = [
        {
            name: 'GREY PARTICLE',
            thickness_mm: 16,
            sheets: 5,
            panels: 5,
            length_mm: 2440,
            width_mm: 1220,
        },
    ];
    const match3 = (0, workOrderQuantityReconciliationService_1.findMatchingSheetMaterial)({
        moProductName: 'Generic Cutting Job',
        sheetMaterials: singleMaterial,
    });
    strict_1.default.ok(match3);
    strict_1.default.equal(match3.material.name, 'GREY PARTICLE');
    strict_1.default.equal(match3.material.sheets, 5);
});
(0, node_test_1.default)('determineTargetCuttingQuantity derives required sheets/panels accurately', () => {
    const material = {
        name: 'WHITE MDF',
        thickness_mm: 18,
        sheets: 4,
        panels: 4,
        length_mm: 2440,
        width_mm: 1220,
    };
    const parsedJobSummary = {
        items: [],
        sectionFound: true,
        sectionText: '',
        rawText: '',
        logs: [],
        optimizedSheets: 4,
        totalPanels: 4,
        sheetMaterials: [material],
    };
    // Case 1: Primary from matched material sheets
    const qty1 = (0, workOrderQuantityReconciliationService_1.determineTargetCuttingQuantity)({
        matchedMaterial: material,
        parsedJobSummary,
    });
    strict_1.default.equal(qty1, 4);
    // Case 2: Approved PO quantity confirms 4
    const qty2 = (0, workOrderQuantityReconciliationService_1.determineTargetCuttingQuantity)({
        matchedMaterial: material,
        parsedJobSummary,
        approvedPoQuantity: 4,
    });
    strict_1.default.equal(qty2, 4);
    // Case 3: Fallback to optimizedSheets when material has no explicit sheet count
    const qty3 = (0, workOrderQuantityReconciliationService_1.determineTargetCuttingQuantity)({
        matchedMaterial: { ...material, sheets: null, panels: null },
        parsedJobSummary: { ...parsedJobSummary, optimizedSheets: 3 },
    });
    strict_1.default.equal(qty3, 3);
});
(0, node_test_1.default)('reconcileWorkOrderQuantitiesForMo updates MO, work order, and component stock moves when Sales Order has 6 but Job Summary has 4', async () => {
    const writtenRecords = [];
    const calledMethods = [];
    const chatterMessages = [];
    // Mock OdooClient
    const mockClient = {
        searchReadRecords: async (model, options) => {
            if (model === 'mrp.production') {
                return [
                    {
                        id: 501,
                        name: 'WH/MO/00501',
                        product_id: [1052, 'Cutting White Mdf 18mm 6 panels'],
                        product_qty: 6,
                        qty_producing: 6,
                        qty_produced: 0,
                        state: 'confirmed',
                        origin: 'S02182',
                        company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
                    },
                ];
            }
            if (model === 'stock.move') {
                return [
                    {
                        id: 881,
                        product_id: [843, 'WHITE MDF 18mm'],
                        product_uom_qty: 6,
                        state: 'confirmed',
                    },
                ];
            }
            if (model === 'mrp.workorder') {
                return [
                    {
                        id: 701,
                        name: 'Table Saw Cutting',
                        qty_production: 6,
                        qty_producing: 6,
                        state: 'ready',
                    },
                ];
            }
            if (model === 'sale.order') {
                return [{ id: 301, name: 'S02182' }];
            }
            if (model === 'purchase.order') {
                return [];
            }
            return [];
        },
        writeRecord: async (model, ids, values) => {
            writtenRecords.push({ model, ids, values });
            return true;
        },
        callRecordMethod: async (model, method, ids) => {
            calledMethods.push({ model, method, ids });
            return true;
        },
        postModelChatterMessage: async (model, recordId, message) => {
            chatterMessages.push({ model, recordId, message });
            return 1;
        },
    };
    const parsedJobSummary = {
        items: [],
        sectionFound: true,
        sectionText: '',
        rawText: '',
        logs: [],
        optimizedSheets: 4,
        totalPanels: 4,
        sheetMaterials: [
            {
                name: 'WHITE MDF',
                thickness_mm: 18,
                sheets: 4,
                panels: 4,
                length_mm: 2440,
                width_mm: 1220,
            },
        ],
    };
    const result = await (0, workOrderQuantityReconciliationService_1.reconcileWorkOrderQuantitiesForMo)(mockClient, 501, {
        parsedJobSummary,
        soId: 301,
        soName: 'S02182',
    });
    strict_1.default.ok(result);
    strict_1.default.equal(result.actionTaken, 'updated_quantities');
    strict_1.default.equal(result.previousQty, 6);
    strict_1.default.equal(result.updatedQty, 4);
    strict_1.default.equal(result.workordersUpdated, 1);
    strict_1.default.equal(result.componentsUpdated, 1);
    // Verify mrp.production was written with product_qty = 4 and qty_producing = 4
    const moWrite = writtenRecords.find((w) => w.model === 'mrp.production');
    strict_1.default.ok(moWrite);
    strict_1.default.deepEqual(moWrite.ids, [501]);
    strict_1.default.equal(moWrite.values.product_qty, 4);
    strict_1.default.equal(moWrite.values.qty_producing, 4);
    // Verify mrp.workorder was written with qty_production = 4 and qty_producing = 4
    const woWrite = writtenRecords.find((w) => w.model === 'mrp.workorder');
    strict_1.default.ok(woWrite);
    strict_1.default.deepEqual(woWrite.ids, [701]);
    strict_1.default.equal(woWrite.values.qty_production, 4);
    strict_1.default.equal(woWrite.values.qty_producing, 4);
    // Verify stock.move was written with product_uom_qty = 4
    const moveWrite = writtenRecords.find((w) => w.model === 'stock.move');
    strict_1.default.ok(moveWrite);
    strict_1.default.deepEqual(moveWrite.ids, [881]);
    strict_1.default.equal(moveWrite.values.product_uom_qty, 4);
    // Verify action_assign was called on mrp.production
    const assignCall = calledMethods.find((c) => c.model === 'mrp.production' && c.method === 'action_assign');
    strict_1.default.ok(assignCall);
    strict_1.default.deepEqual(assignCall.ids, [501]);
    // Verify chatter notes were posted on MO and SO
    strict_1.default.ok(chatterMessages.some((c) => c.model === 'mrp.production' && c.recordId === 501));
    strict_1.default.ok(chatterMessages.some((c) => c.model === 'sale.order' && c.recordId === 301));
});
(0, node_test_1.default)('reconcileWorkOrderQuantitiesForMo skips closed orders and excluded company', async () => {
    // Case 1: Closed MO
    const closedMoClient = {
        searchReadRecords: async (model) => {
            if (model === 'mrp.production') {
                return [
                    {
                        id: 502,
                        name: 'WH/MO/00502',
                        product_id: [1052, 'Cutting White Mdf 18mm'],
                        product_qty: 6,
                        state: 'done',
                        company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
                    },
                ];
            }
            return [];
        },
    };
    const resClosed = await (0, workOrderQuantityReconciliationService_1.reconcileWorkOrderQuantitiesForMo)(closedMoClient, 502);
    strict_1.default.ok(resClosed);
    strict_1.default.equal(resClosed.actionTaken, 'skipped_closed_order');
    // Case 2: Excluded Company (Company 3, URBAN VIBE 2)
    const excludedCompanyClient = {
        searchReadRecords: async (model) => {
            if (model === 'mrp.production') {
                return [
                    {
                        id: 503,
                        name: 'VA/WH/MO/00503',
                        product_id: [1052, 'Cutting White Mdf 18mm'],
                        product_qty: 6,
                        state: 'confirmed',
                        company_id: [3, 'URBAN VIBE 2'],
                    },
                ];
            }
            return [];
        },
    };
    const resExcluded = await (0, workOrderQuantityReconciliationService_1.reconcileWorkOrderQuantitiesForMo)(excludedCompanyClient, 503);
    strict_1.default.ok(resExcluded);
    strict_1.default.equal(resExcluded.actionTaken, 'skipped_excluded_company');
});
