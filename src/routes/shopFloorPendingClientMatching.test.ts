import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBoardIntakeQueueEntry,
  matchBoardIntakeQueueEntryClient,
  getBoardIntakeQueueEntry,
} from '../models/repositories';

test('pending client matching workflow: enqueue unknown owner and match later', async () => {
  // 1. Operator logs boards at gate when client/owner is unknown
  const pendingId = `test_pending_${Date.now()}`;
  await createBoardIntakeQueueEntry({
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

  const entry = await getBoardIntakeQueueEntry(pendingId);
  assert.ok(entry, 'Pending entry must be created in database');
  assert.equal(Number(entry?.partner_id), 0, 'Partner ID must be 0 for pending client');
  assert.equal(entry?.customer_name, 'Pending Client Matching', 'Customer name must be Pending Client Matching');
  assert.equal(entry?.quantity, 10);
  assert.ok(!entry?.matched_by, 'Matched by must initially be falsy');

  // 2. Client is identified later and any operator/staff matches the log
  await matchBoardIntakeQueueEntryClient({
    id: pendingId,
    partnerId: 888,
    customerName: 'Acme Furniture Ltd',
    matchedBy: 'John Workshop Supervisor',
  });

  const updatedEntry = await getBoardIntakeQueueEntry(pendingId);
  assert.ok(updatedEntry, 'Updated entry must exist');
  assert.equal(Number(updatedEntry?.partner_id), 888, 'Partner ID must be updated to 888');
  assert.equal(updatedEntry?.customer_name, 'Acme Furniture Ltd', 'Customer name must be updated to Acme Furniture Ltd');
  assert.equal(updatedEntry?.matched_by, 'John Workshop Supervisor', 'Matched by must be recorded');
  assert.ok(updatedEntry?.matched_at, 'Matched at timestamp must be populated');
});
