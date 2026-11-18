import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoardIntakeQueueEntry,
  getBoardIntakeQueueEntry,
  updateBoardIntakeQueueEntry,
  getDueBoardIntakeQueueEntries,
  upsertShopFloorOperators,
  getShopFloorOperatorByPin,
} from '../models/repositories';
import { verifyEmployeeAttendancePin } from '../services/operatorPinVerificationService';
import { matchBoardIntakeToClient, syncBoardIntakeEntry } from '../services/boardIntakeSyncService';

test('operator attendance PIN verification and client matching workflow', async () => {
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
  await upsertShopFloorOperators([testOperator]);

  // 2. Test getShopFloorOperatorByPin
  const directFound = await getShopFloorOperatorByPin(testPin);
  assert.ok(directFound, 'Operator should be found by exact PIN');
  assert.equal(directFound?.name, 'Onyango Test Operator');
  assert.equal(directFound?.pin, testPin);

  // 3. Test verifyEmployeeAttendancePin with valid and invalid PIN
  const verifiedOp = await verifyEmployeeAttendancePin(testPin);
  assert.ok(verifiedOp, 'verifyEmployeeAttendancePin must return operator for valid PIN');
  assert.equal(verifiedOp?.name, 'Onyango Test Operator');

  const invalidOp = await verifyEmployeeAttendancePin('0000');
  assert.equal(invalidOp, null, 'verifyEmployeeAttendancePin must return null for non-existent PIN');

  const emptyOp = await verifyEmployeeAttendancePin('');
  assert.equal(emptyOp, null, 'verifyEmployeeAttendancePin must return null for empty PIN');

  // 4. Create a gate board intake entry logged as Pending Client Matching
  const pendingIntakeId = `test_intake_pin_${Date.now()}`;
  await createBoardIntakeQueueEntry({
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

  const initialEntry = await getBoardIntakeQueueEntry(pendingIntakeId);
  assert.ok(initialEntry, 'Intake must be in queue');
  assert.equal(initialEntry?.status, 'pending', 'Intake should remain in pending status while awaiting client match');
  assert.equal(Number(initialEntry?.partner_id), 0, 'Partner ID should be 0 before matching');

  // Verify that syncBoardIntakeEntry bypasses unassigned pending intakes to prevent sync to Odoo
  const earlySyncResult = await syncBoardIntakeEntry(pendingIntakeId);
  assert.equal(earlySyncResult.pendingMatch, true, 'syncBoardIntakeEntry must return pendingMatch: true when partner is not yet matched');

  // Verify that background retries exclude unmatched pending logs
  const dueEntries = await getDueBoardIntakeQueueEntries(50);
  const foundInDue = dueEntries.find((e) => e.id === pendingIntakeId);
  assert.equal(foundInDue, undefined, 'Unmatched pending intake must be excluded from due background queue');

  // 5. Match the client using operator identified by PIN
  const matchResult = await matchBoardIntakeToClient({
    id: pendingIntakeId,
    partnerId: 456,
    customerName: 'Enos Otieno',
    matchedBy: verifiedOp.name,
  });

  assert.equal(matchResult.customerName, 'Enos Otieno');

  const finalEntry = await getBoardIntakeQueueEntry(pendingIntakeId);
  assert.ok(finalEntry);
  assert.equal(Number(finalEntry?.partner_id), 456, 'Partner ID must be updated to 456');
  assert.equal(finalEntry?.customer_name, 'Enos Otieno', 'Customer name must be updated');
  assert.equal(finalEntry?.matched_by, 'Onyango Test Operator', 'Matched by must record operator from PIN');
  assert.ok(finalEntry?.matched_at, 'matched_at must be populated');
});
