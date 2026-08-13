"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const unreadableDocumentNotificationService_1 = require("./unreadableDocumentNotificationService");
(0, node_test_1.default)('recognizes a faint document with no readable invoice fields', () => {
    strict_1.default.equal((0, unreadableDocumentNotificationService_1.isUnreadableDocument)({
        attachmentId: 7,
        attachmentName: 'Scan_20260622.pdf',
        vendorName: null,
        grandTotal: null,
        itemCount: 0,
        rawText: '27 ONYANGO',
        confidenceOverall: 0.3,
    }), true);
});
(0, node_test_1.default)('does not notify for a readable invoice', () => {
    strict_1.default.equal((0, unreadableDocumentNotificationService_1.isUnreadableDocument)({
        attachmentId: 8,
        attachmentName: 'invoice.pdf',
        vendorName: 'Vendor Limited',
        grandTotal: 12000,
        itemCount: 1,
        rawText: 'Vendor Limited Invoice 123 Total 12000',
        confidenceOverall: 0.83,
    }), false);
});
