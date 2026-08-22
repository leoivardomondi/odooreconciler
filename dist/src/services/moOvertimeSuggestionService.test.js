"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const moOvertimeSuggestionService_1 = require("./moOvertimeSuggestionService");
(0, node_test_1.default)('only confirmed purchase orders awaiting approval or approved qualify', () => {
    strict_1.default.equal((0, moOvertimeSuggestionService_1.isEligiblePurchaseOrderState)('to approve'), true);
    strict_1.default.equal((0, moOvertimeSuggestionService_1.isEligiblePurchaseOrderState)('purchase'), true);
    strict_1.default.equal((0, moOvertimeSuggestionService_1.isEligiblePurchaseOrderState)('draft'), false);
    strict_1.default.equal((0, moOvertimeSuggestionService_1.isEligiblePurchaseOrderState)('sent'), false);
    strict_1.default.equal((0, moOvertimeSuggestionService_1.isEligiblePurchaseOrderState)(null), false);
});
