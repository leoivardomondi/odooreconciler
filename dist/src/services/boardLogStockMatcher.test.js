"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const boardLogStockMatcher_1 = require("./boardLogStockMatcher");
(0, node_test_1.default)('boardLogStockMatcher: correctly matches board product names despite casing or minor spacing differences', () => {
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingBoardProduct)('Harbour Grey Waterproof 18mm', 'harbour grey waterproof 18mm'), true);
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingBoardProduct)('Harbour Grey Waterproof 18mm', 'Harbour Grey Waterproof'), true);
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingBoardProduct)('Dark Grey Particle 18mm', 'Dark Grey Particle 18mm', 39, 39), true);
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingBoardProduct)('Dark Grey Particle 18mm', 'White Particle 18mm', 39, 37), false);
});
(0, node_test_1.default)('boardLogStockMatcher: correctly matches client names case-insensitively and by substring or partnerId', () => {
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingClient)('JUSTUS OCHIENG', 'Justus Ochieng'), true);
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingClient)('JUSTUS OCHIENG', 'JUSTUS', 498, 498), true);
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingClient)('Sharon Araka', 'Sharon Araka'), true);
    strict_1.default.equal((0, boardLogStockMatcher_1.isMatchingClient)('JUSTUS OCHIENG', 'Different Customer', 498, 999), false);
});
(0, node_test_1.default)('boardLogStockMatcher: matches board requirement from loaded pending processes in shop_floor_pending_processes', () => {
    const match = (0, boardLogStockMatcher_1.findMatchingBoardLog)({
        moId: 6668,
        moName: 'WH/MO/06016',
        origin: 'S03823',
        partnerName: 'JUSTUS OCHIENG',
        partnerId: 498,
        productId: 752,
        productName: 'Harbour Grey Waterproof 18mm',
        loadedProcesses: [
            {
                id: '6668_752',
                mo_id: 6668,
                mo_name: 'WH/MO/06016',
                origin: 'S03823',
                partner_id: 498,
                partner_name: 'JUSTUS OCHIENG',
                product_id: 752,
                product_name: 'Harbour Grey Waterproof 18mm',
                status: 'loaded',
                qty_missing: 0,
                qty_needed: 9,
                qty_reserved: 9,
            },
        ],
    });
    strict_1.default.equal(match.hasMatch, true);
    strict_1.default.equal(match.source, 'shop_floor_pending_processes');
    strict_1.default.equal(match.matchedQuantity, 9);
});
(0, node_test_1.default)('boardLogStockMatcher: matches board requirement from active non-reverted board intake logs by client and product', () => {
    const match = (0, boardLogStockMatcher_1.findMatchingBoardLog)({
        moId: 6668,
        moName: 'WH/MO/06016',
        origin: 'S03823',
        partnerName: 'JUSTUS OCHIENG',
        partnerId: 498,
        productId: 752,
        productName: 'Harbour Grey Waterproof 18mm',
        activeLogs: [
            {
                id: 'log-101',
                partner_id: 498,
                customer_name: 'JUSTUS OCHIENG',
                product_id: 752,
                product_name: 'Harbour Grey Waterproof 18mm',
                quantity: 3,
            },
        ],
    });
    strict_1.default.equal(match.hasMatch, true);
    strict_1.default.equal(match.source, 'board_intake_queue');
    strict_1.default.equal(match.matchedQuantity, 3);
});
(0, node_test_1.default)('boardLogStockMatcher: matches company-purchased board intake log via PO reference', () => {
    const match = (0, boardLogStockMatcher_1.findMatchingBoardLog)({
        moId: 6668,
        moName: 'WH/MO/06016',
        origin: 'S03823',
        partnerName: 'Unknown Client',
        productId: 752,
        productName: 'Harbour Grey Waterproof 18mm',
        relatedPoNames: ['P01372', 'P01371'],
        activeLogs: [
            {
                id: 'log-po-101',
                partner_id: 44,
                customer_name: 'TIP TOP',
                product_id: 752,
                product_name: 'Harbour Grey Waterproof 18mm',
                quantity: 3,
                purchase_order_reference: 'P01372',
            },
        ],
    });
    strict_1.default.equal(match.hasMatch, true);
    strict_1.default.equal(match.source, 'board_intake_queue');
    strict_1.default.equal(match.matchedQuantity, 3);
});
(0, node_test_1.default)('boardLogStockMatcher: matches when PO line for this board has already been received in Odoo', () => {
    const match = (0, boardLogStockMatcher_1.findMatchingBoardLog)({
        moId: 6668,
        moName: 'WH/MO/06016',
        origin: 'S03823',
        partnerName: 'JUSTUS OCHIENG',
        productId: 752,
        productName: 'Harbour Grey Waterproof 18mm',
        poLines: [
            {
                orderName: 'P01372',
                productId: 752,
                productName: 'Harbour Grey Waterproof 18mm',
                productQty: 3,
                qtyReceived: 3,
            },
        ],
    });
    strict_1.default.equal(match.hasMatch, true);
    strict_1.default.equal(match.source, 'purchase_receipt');
    strict_1.default.equal(match.matchedQuantity, 3);
});
(0, node_test_1.default)('boardLogStockMatcher: returns hasMatch = false when board has not been logged and PO has not been received', () => {
    const match = (0, boardLogStockMatcher_1.findMatchingBoardLog)({
        moId: 6668,
        moName: 'WH/MO/06016',
        origin: 'S03823',
        partnerName: 'JUSTUS OCHIENG',
        productId: 752,
        productName: 'Harbour Grey Waterproof 18mm',
        activeLogs: [
            {
                id: 'log-diff',
                partner_id: 888,
                customer_name: 'Another Customer',
                product_id: 37,
                product_name: 'White Particle 18mm',
                quantity: 10,
            },
        ],
        poLines: [
            {
                orderName: 'P01372',
                productId: 752,
                productName: 'Harbour Grey Waterproof 18mm',
                productQty: 3,
                qtyReceived: 0,
            },
        ],
    });
    strict_1.default.equal(match.hasMatch, false);
    strict_1.default.equal(match.source, 'none');
    strict_1.default.equal(match.matchedQuantity, 0);
});
