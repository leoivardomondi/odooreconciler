"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const boardIntakePoBatchReconciliationService_1 = require("./boardIntakePoBatchReconciliationService");
(0, node_test_1.describe)('boardIntakePoBatchReconciliationService', () => {
    (0, node_test_1.it)('correctly parses and deduplicates chatter board intake logs', () => {
        const sampleMessages = [
            {
                body: '• Board: Black Waterproof 18mm • Quantity Received: 4 sheets',
                date: '2026-11-16 14:28:54',
            },
            // Immediate duplicate within 2 minutes
            {
                body: '• Board: Black Waterproof 18mm • Quantity Received: 4 sheets',
                date: '2026-11-16 14:29:10',
            },
            {
                body: '• Board: White Waterproof panel 18mm • Quantity Received: 3 sheets',
                date: '2026-11-16 14:40:06',
            },
            {
                body: '• Board: Backer White MDF 3mm • Quantity Received: 2 sheets',
                date: '2026-11-16 14:52:54',
            },
        ];
        const result = (0, boardIntakePoBatchReconciliationService_1.parseLoggedQtysFromChatter)(sampleMessages);
        strict_1.default.equal(result['Black Waterproof 18mm'].max, 4);
        strict_1.default.equal(result['Black Waterproof 18mm'].sum, 4);
        strict_1.default.equal(result['White Waterproof panel 18mm'].max, 3);
        strict_1.default.equal(result['Backer White MDF 3mm'].max, 2);
    });
    (0, node_test_1.it)('correctly sums split offloading batches across different times', () => {
        const splitMessages = [
            {
                body: '• Board: White Particle 18mm • Quantity Received: 13 sheets',
                date: '2026-11-12 08:18:11',
            },
            {
                body: '• Board: White Particle 18mm • Quantity Received: 13 sheets',
                date: '2026-11-12 09:04:09',
            },
            {
                body: '• Board: White Particle 18mm • Quantity Received: 8 sheets',
                date: '2026-11-12 09:24:26',
            },
        ];
        const result = (0, boardIntakePoBatchReconciliationService_1.parseLoggedQtysFromChatter)(splitMessages);
        strict_1.default.equal(result['White Particle 18mm'].sum, 34);
        strict_1.default.equal(result['White Particle 18mm'].max, 13);
    });
    (0, node_test_1.it)('evaluates fully logged POs as validate_full in dry run mode', async () => {
        const mockClient = {
            getTargetCompanyIdValue: async () => 1,
            searchReadRecords: async (model) => {
                if (model === 'mail.message') {
                    return [
                        { res_id: 1431, body: '• Board: Black Waterproof 18mm • Quantity Received: 4 sheets' },
                        { res_id: 1431, body: '• Board: White Waterproof panel 18mm • Quantity Received: 3 sheets' },
                        { res_id: 1431, body: '• Board: Backer White MDF 3mm • Quantity Received: 2 sheets' },
                    ];
                }
                if (model === 'purchase.order') {
                    return [{
                            id: 1431,
                            name: 'P01432',
                            state: 'purchase',
                            partner_id: [10, 'TIP TOP'],
                            picking_ids: [4353],
                        }];
                }
                if (model === 'stock.picking') {
                    return [{
                            id: 4353,
                            name: 'WH/IN/00903',
                            state: 'assigned',
                        }];
                }
                if (model === 'purchase.order.line') {
                    return [
                        { id: 1, product_id: [269, 'Black Waterproof 18mm'], product_qty: 4, qty_received: 0 },
                        { id: 2, product_id: [38, 'White Waterproof panel 18mm'], product_qty: 3, qty_received: 0 },
                        { id: 3, product_id: [294, 'Backer White MDF 3mm'], product_qty: 2, qty_received: 0 },
                    ];
                }
                if (model === 'stock.move') {
                    return [
                        { id: 101, product_id: [269, 'Black Waterproof 18mm'], product_uom_qty: 4, quantity: 0, state: 'confirmed' },
                        { id: 102, product_id: [38, 'White Waterproof panel 18mm'], product_uom_qty: 3, quantity: 0, state: 'confirmed' },
                        { id: 103, product_id: [294, 'Backer White MDF 3mm'], product_uom_qty: 2, quantity: 2, state: 'confirmed' },
                    ];
                }
                return [];
            },
        };
        const report = await (0, boardIntakePoBatchReconciliationService_1.reconcileLoggedPurchaseOrderReceipts)(mockClient, { dryRun: true, specificPoIds: [1431] });
        strict_1.default.equal(report.dryRun, true);
        strict_1.default.equal(report.targets.length, 1);
        strict_1.default.equal(report.targets[0].poName, 'P01432');
        strict_1.default.equal(report.targets[0].action, 'validate_full');
    });
});
