"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const stockProcessingService_1 = require("./stockProcessingService");
const marbleItem = {
    extractedColor: 'Marble',
    normalizedColor: 'marble',
    componentColor: 'marble',
    componentType: '1mm',
    lengthMm: 305767,
    expectedSoProduct: 'Edge Banding Service Marble',
    serviceNameCandidates: ['Edge Banding Service Marble', 'Edge Band Service Marble'],
};
(0, node_test_1.default)('uses the linked Marble product even when its edited description says White Marble', () => {
    const line = {
        id: 1,
        product_id: [10, 'Edge banding service Marble'],
        name: 'Edge banding service White Marble',
        product_uom_qty: 490,
    };
    strict_1.default.equal((0, stockProcessingService_1.matchSoLine)(marbleItem, [line]), line);
});
(0, node_test_1.default)('matches Odoo product display names that include an internal reference', () => {
    const line = {
        id: 2,
        product_id: [11, '[EB-MARBLE] Edge Banding Service Marble'],
        name: 'White Marble is available on the floor',
        product_uom_qty: 490,
    };
    strict_1.default.equal((0, stockProcessingService_1.matchSoLine)(marbleItem, [line]), line);
});
(0, node_test_1.default)('matches a valid product description on one line of a multiline note', () => {
    const line = {
        id: 3,
        product_id: false,
        name: 'Edge Banding Service Marble\nUse White Marble on the floor',
        product_uom_qty: 490,
    };
    strict_1.default.equal((0, stockProcessingService_1.matchSoLine)(marbleItem, [line]), line);
});
(0, node_test_1.default)('does not treat White Marble alone as an exact Marble match', () => {
    const line = {
        id: 4,
        product_id: [12, 'Edge Banding Service White Marble'],
        name: 'Edge Banding Service White Marble',
        product_uom_qty: 490,
    };
    strict_1.default.equal((0, stockProcessingService_1.matchSoLine)(marbleItem, [line]), null);
});
(0, node_test_1.default)('uses a close color match when the remaining material and line counts agree', () => {
    const line = {
        id: 5,
        product_id: [13, 'Edge Banding Service White Marble'],
        name: 'Edge Banding Service White Marble',
        product_uom_qty: 490,
    };
    strict_1.default.equal((0, stockProcessingService_1.matchSoLines)([marbleItem], [line]).get(marbleItem), line);
});
(0, node_test_1.default)('does not use fuzzy matching when material and edging-line counts differ', () => {
    const white = {
        id: 6,
        product_id: [14, 'Edge Banding Service White Marble'],
        name: 'Edge Banding Service White Marble',
    };
    const black = {
        id: 7,
        product_id: [15, 'Edge Banding Service Black Marble'],
        name: 'Edge Banding Service Black Marble',
    };
    strict_1.default.equal((0, stockProcessingService_1.matchSoLines)([marbleItem], [white, black]).has(marbleItem), false);
});
(0, node_test_1.default)('leaves equally close colors unmatched instead of guessing', () => {
    const marbleA = { ...marbleItem };
    const marbleB = { ...marbleItem, extractedColor: 'Marble alt' };
    const white = {
        id: 8,
        product_id: [16, 'Edge Banding Service White Marble'],
        name: 'Edge Banding Service White Marble',
    };
    const black = {
        id: 9,
        product_id: [17, 'Edge Banding Service Black Marble'],
        name: 'Edge Banding Service Black Marble',
    };
    const result = (0, stockProcessingService_1.matchSoLines)([marbleA, marbleB], [white, black]);
    strict_1.default.equal(result.size, 0);
});
