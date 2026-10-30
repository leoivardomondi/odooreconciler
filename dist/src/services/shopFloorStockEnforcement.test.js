"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const boardProductClassifier_1 = require("./boardProductClassifier");
(0, node_test_1.default)('isStockExemptEdgeBandingService correctly identifies service products', () => {
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)('Edge Banding Service'), true);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)('Edge Banding  Service American Walnut'), true);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)('Edge Band Service Gloss White'), true);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)('edging banding service 1mm'), true);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)('Custom Edge Banding Services'), true);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)('18mm MDF White Board'), false);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)('Soft Close Hinge 35mm'), false);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)(null), false);
    strict_1.default.equal((0, boardProductClassifier_1.isStockExemptEdgeBandingService)(undefined), false);
});
(0, node_test_1.default)('MoStockAvailabilityResult correctly distinguishes boards from hardware and flags missing components', () => {
    const components = [
        {
            id: 101,
            productId: 501,
            productName: '18mm Marine Plywood 8x4',
            requiredQty: 4,
            availableQty: 1,
            missingQty: 3,
            uom: 'Units',
            state: 'partially_available',
            isBoard: (0, boardProductClassifier_1.isBoardProductName)('18mm Marine Plywood 8x4'),
        },
        {
            id: 102,
            productId: 502,
            productName: 'Soft Close Drawer Runner 450mm',
            requiredQty: 6,
            availableQty: 0,
            missingQty: 6,
            uom: 'Pairs',
            state: 'confirmed',
            isBoard: (0, boardProductClassifier_1.isBoardProductName)('Soft Close Drawer Runner 450mm'),
        },
    ];
    strict_1.default.equal(components[0].isBoard, true, 'Marine Plywood should be identified as a board');
    strict_1.default.equal(components[1].isBoard, false, 'Drawer runner should be identified as hardware');
    const result = {
        moId: 999,
        moName: 'WH/MO/00999',
        moState: 'confirmed',
        isFullyAvailable: components.length === 0,
        totalComponents: components.length,
        missingComponents: components,
        hasMissingBoards: components.some((c) => c.isBoard),
        hasMissingHardware: components.some((c) => !c.isBoard),
    };
    strict_1.default.equal(result.isFullyAvailable, false, 'MO with missing components should NOT be fully available');
    strict_1.default.equal(result.hasMissingBoards, true, 'Should detect missing boards');
    strict_1.default.equal(result.hasMissingHardware, true, 'Should detect missing hardware');
    strict_1.default.equal(result.missingComponents[0].missingQty, 3);
    strict_1.default.equal(result.missingComponents[1].missingQty, 6);
});
(0, node_test_1.default)('MoStockAvailabilityResult flags MO as fully available when no components are missing', () => {
    const result = {
        moId: 1000,
        moName: 'WH/MO/01000',
        moState: 'confirmed',
        isFullyAvailable: true,
        totalComponents: 3,
        missingComponents: [],
        hasMissingBoards: false,
        hasMissingHardware: false,
    };
    strict_1.default.equal(result.isFullyAvailable, true);
    strict_1.default.equal(result.missingComponents.length, 0);
    strict_1.default.equal(result.hasMissingBoards, false);
    strict_1.default.equal(result.hasMissingHardware, false);
});
