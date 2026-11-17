"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const repositories_1 = require("../models/repositories");
(0, node_test_1.default)('pending client matching workflow: enqueue unknown owner and match later', async () => {
    // 1. Operator logs boards at gate when client/owner is unknown
    const pendingId = `test_pending_${Date.now()}`;
    await (0, repositories_1.createBoardIntakeQueueEntry)({
        id: pendingId,
        productId: 55,
        productName: '18mm White Melamine MDF',
        quantity: 10,
        partnerId: 0,
        customerName: 'Pending Client Matching',
        actorEmail: 'gate.operator@example.com',
        actorName: 'Gate Operator',
        gate: 'Gate A',
        vehicleRegistration: 'KDA 123X',
        arrivalDate: '2026-11-17',
        arrivalTime: '08:30',
    });
    const entry = await (0, repositories_1.getBoardIntakeQueueEntry)(pendingId);
    strict_1.default.ok(entry, 'Pending entry must be created in database');
    strict_1.default.equal(Number(entry?.partner_id), 0, 'Partner ID must be 0 for pending client');
    strict_1.default.equal(entry?.customer_name, 'Pending Client Matching', 'Customer name must be Pending Client Matching');
    strict_1.default.equal(entry?.quantity, 10);
    strict_1.default.ok(!entry?.matched_by, 'Matched by must initially be falsy');
    // 2. Client is identified later and any operator/staff matches the log
    await (0, repositories_1.matchBoardIntakeQueueEntryClient)({
        id: pendingId,
        partnerId: 888,
        customerName: 'Acme Furniture Ltd',
        matchedBy: 'John Workshop Supervisor',
    });
    const updatedEntry = await (0, repositories_1.getBoardIntakeQueueEntry)(pendingId);
    strict_1.default.ok(updatedEntry, 'Updated entry must exist');
    strict_1.default.equal(Number(updatedEntry?.partner_id), 888, 'Partner ID must be updated to 888');
    strict_1.default.equal(updatedEntry?.customer_name, 'Acme Furniture Ltd', 'Customer name must be updated to Acme Furniture Ltd');
    strict_1.default.equal(updatedEntry?.matched_by, 'John Workshop Supervisor', 'Matched by must be recorded');
    strict_1.default.ok(updatedEntry?.matched_at, 'Matched at timestamp must be populated');
});
