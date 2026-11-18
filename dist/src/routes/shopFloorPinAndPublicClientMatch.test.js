"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const repositories_1 = require("../models/repositories");
const operatorPinVerificationService_1 = require("../services/operatorPinVerificationService");
const boardIntakeSyncService_1 = require("../services/boardIntakeSyncService");
(0, node_test_1.default)('operator attendance PIN verification and client matching workflow', async () => {
    // 1. Setup mock operator with Odoo attendance PIN in database
    const testPin = '7391';
    const testOperator = {
        id: 9901,
        name: 'Onyango Test Operator',
        jobTitle: 'Table Saw Operator',
        department: 'Operations',
        workEmail: 'onyango.test@urbanvibe.co.ke',
        mobilePhone: '0712345678',
        userId: 8821,
        userName: 'Onyango Test Operator',
        photoUrl: null,
        checkedIn: true,
        checkedOut: false,
        checkInTime: '08:00 AM',
        assignedItems: [],
        priority: 1,
        active: true,
        pin: testPin,
    };
    await (0, repositories_1.upsertShopFloorOperators)([testOperator]);
    // 2. Test getShopFloorOperatorByPin
    const directFound = await (0, repositories_1.getShopFloorOperatorByPin)(testPin);
    strict_1.default.ok(directFound, 'Operator should be found by exact PIN');
    strict_1.default.equal(directFound?.name, 'Onyango Test Operator');
    strict_1.default.equal(directFound?.pin, testPin);
    // 3. Test verifyEmployeeAttendancePin with valid and invalid PIN
    const verifiedOp = await (0, operatorPinVerificationService_1.verifyEmployeeAttendancePin)(testPin);
    strict_1.default.ok(verifiedOp, 'verifyEmployeeAttendancePin must return operator for valid PIN');
    strict_1.default.equal(verifiedOp?.name, 'Onyango Test Operator');
    const invalidOp = await (0, operatorPinVerificationService_1.verifyEmployeeAttendancePin)('0000');
    strict_1.default.equal(invalidOp, null, 'verifyEmployeeAttendancePin must return null for non-existent PIN');
    const emptyOp = await (0, operatorPinVerificationService_1.verifyEmployeeAttendancePin)('');
    strict_1.default.equal(emptyOp, null, 'verifyEmployeeAttendancePin must return null for empty PIN');
    // 4. Create a gate board intake entry logged as Pending Client Matching
    const pendingIntakeId = `test_intake_pin_${Date.now()}`;
    await (0, repositories_1.createBoardIntakeQueueEntry)({
        id: pendingIntakeId,
        productId: 55,
        productName: '2700 * 1800 Particle 18mm',
        quantity: 5,
        partnerId: 0,
        customerName: 'Pending Client Matching',
        actorEmail: 'gate.operator@example.com',
        actorName: 'Gate Operator',
        gate: 'Gate B',
        vehicleRegistration: 'KDC 999Z',
        arrivalDate: '2026-11-18',
        arrivalTime: '23:08',
    });
    const initialEntry = await (0, repositories_1.getBoardIntakeQueueEntry)(pendingIntakeId);
    strict_1.default.ok(initialEntry, 'Intake must be in queue');
    strict_1.default.equal(initialEntry?.status, 'pending', 'Intake should remain in pending status while awaiting client match');
    strict_1.default.equal(Number(initialEntry?.partner_id), 0, 'Partner ID should be 0 before matching');
    // Verify that syncBoardIntakeEntry bypasses unassigned pending intakes to prevent sync to Odoo
    const earlySyncResult = await (0, boardIntakeSyncService_1.syncBoardIntakeEntry)(pendingIntakeId);
    strict_1.default.equal(earlySyncResult.pendingMatch, true, 'syncBoardIntakeEntry must return pendingMatch: true when partner is not yet matched');
    // Verify that background retries exclude unmatched pending logs
    const dueEntries = await (0, repositories_1.getDueBoardIntakeQueueEntries)(50);
    const foundInDue = dueEntries.find((e) => e.id === pendingIntakeId);
    strict_1.default.equal(foundInDue, undefined, 'Unmatched pending intake must be excluded from due background queue');
    // 5. Match the client using operator identified by PIN
    const matchResult = await (0, boardIntakeSyncService_1.matchBoardIntakeToClient)({
        id: pendingIntakeId,
        partnerId: 456,
        customerName: 'Enos Otieno',
        matchedBy: verifiedOp.name,
    });
    strict_1.default.equal(matchResult.customerName, 'Enos Otieno');
    const finalEntry = await (0, repositories_1.getBoardIntakeQueueEntry)(pendingIntakeId);
    strict_1.default.ok(finalEntry);
    strict_1.default.equal(Number(finalEntry?.partner_id), 456, 'Partner ID must be updated to 456');
    strict_1.default.equal(finalEntry?.customer_name, 'Enos Otieno', 'Customer name must be updated');
    strict_1.default.equal(finalEntry?.matched_by, 'Onyango Test Operator', 'Matched by must record operator from PIN');
    strict_1.default.ok(finalEntry?.matched_at, 'matched_at must be populated');
});
