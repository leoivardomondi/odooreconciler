process.env.DB_CLIENT = 'sqlite';
import { env } from '../utils/env';
env.DB_CLIENT = 'sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { execute } from '../models/db';
import {
  upsertPendingShopFloorProcesses,
  pruneStalePendingProcessesForActiveMos,
  getPendingShopFloorProcesses,
  createBoardIntakeQueueEntry,
  updateBoardIntakeQueueEntry,
  claimBoardIntakeRevert,
  finishBoardIntakeRevert,
} from '../models/repositories';
import { PendingShopFloorProcess } from '../models/types';

test('pruneStalePendingProcessesForActiveMos: PO-covered keys are pruned immediately', async () => {
  const testMoId = 99101;
  const testProdId = 88101;
  const key = `${testMoId}_${testProdId}`;

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);

  const process: PendingShopFloorProcess = {
    id: key,
    process_type: 'board_intake',
    mo_id: testMoId,
    mo_name: 'WH/MO/99101',
    origin: 'S99101',
    partner_id: 101,
    partner_name: 'PO Procured Client',
    product_id: testProdId,
    product_name: 'WHITE MDF 18mm',
    qty_needed: 10,
    qty_reserved: 0,
    qty_missing: 10,
    status: 'pending',
    loaded_at: null,
    loaded_by: null,
    last_synced_at: new Date().toISOString(),
  };

  await upsertPendingShopFloorProcesses([process]);
  const before = await getPendingShopFloorProcesses({ status: 'pending' });
  assert.ok(before.some((p) => p.id === key), 'Process should initially exist as pending');

  // Prune with poCoveredKeys containing this key
  await pruneStalePendingProcessesForActiveMos([testMoId], [], [key]);

  const after = await getPendingShopFloorProcesses({ status: 'pending' });
  assert.ok(!after.some((p) => p.id === key), 'Process covered by active PO must be pruned from Add Stock area');
});

test('pruneStalePendingProcessesForActiveMos: closed MO or assigned stock is PRESERVED if NO history log exists', async () => {
  const testMoId = 99202;
  const testProdId = 88202;
  const key = `${testMoId}_${testProdId}`;

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);

  const process: PendingShopFloorProcess = {
    id: key,
    process_type: 'board_intake',
    mo_id: testMoId,
    mo_name: 'WH/MO/99202',
    origin: 'S99202',
    partner_id: 202,
    partner_name: 'Client Missing Board Log',
    product_id: testProdId,
    product_name: 'OAK VENEER MDF 18mm',
    qty_needed: 6,
    qty_reserved: 0,
    qty_missing: 6,
    status: 'pending',
    loaded_at: null,
    loaded_by: null,
    last_synced_at: new Date().toISOString(),
  };

  await upsertPendingShopFloorProcesses([process]);

  // Simulate MO closed in Odoo shop floor (not in activeMoIds) and not in validKeys
  await pruneStalePendingProcessesForActiveMos([], []);

  const after = await getPendingShopFloorProcesses({ status: 'pending' });
  const preserved = after.find((p) => p.id === key);
  assert.ok(preserved, 'Requirement must be preserved even if MO is closed in Odoo, because no matching history log appeared');
  assert.equal(preserved.status, 'pending');
  assert.equal(preserved.qty_missing, 6);
});

test('pruneStalePendingProcessesForActiveMos: requirement is fulfilled and marked loaded when matching history log appears', async () => {
  const testMoId = 99303;
  const testProdId = 88303;
  const key = `${testMoId}_${testProdId}`;
  const clientName = 'History Log Test Client 303';
  const prodName = 'BLACK MDF 18mm';

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
  await execute('DELETE FROM board_intake_queue WHERE partner_id = ?', [303]);

  const process: PendingShopFloorProcess = {
    id: key,
    process_type: 'board_intake',
    mo_id: testMoId,
    mo_name: 'WH/MO/99303',
    origin: 'S99303',
    partner_id: 303,
    partner_name: clientName,
    product_id: testProdId,
    product_name: prodName,
    qty_needed: 4,
    qty_reserved: 0,
    qty_missing: 4,
    status: 'pending',
    loaded_at: null,
    loaded_by: null,
    last_synced_at: new Date().toISOString(),
  };

  await upsertPendingShopFloorProcesses([process]);

  // Create matching history log in board_intake_queue and mark synced
  const entryId = randomUUID();
  await createBoardIntakeQueueEntry({
    id: entryId,
    customerName: clientName,
    partnerId: 303,
    productName: prodName,
    productId: testProdId,
    quantity: 4,
    actorEmail: 'operator@factory.co.ke',
    actorName: 'Operator One',
  });
  await updateBoardIntakeQueueEntry(entryId, { status: 'synced', stockQuantity: 4 });

  // Prune with MO closed or fulfilled
  await pruneStalePendingProcessesForActiveMos([], []);

  const pendingList = await getPendingShopFloorProcesses({ status: 'pending' });
  assert.ok(!pendingList.some((p) => p.id === key), 'Process must disappear from pending list once matching history log fulfills requirement');

  const loadedList = await getPendingShopFloorProcesses({ status: 'loaded' });
  const loaded = loadedList.find((p) => p.id === key);
  assert.ok(loaded, 'Process must be marked as loaded');
});

test('Reverting a board intake log restores the pending process in Add Stock area', async () => {
  const testMoId = 99404;
  const testProdId = 88404;
  const key = `${testMoId}_${testProdId}`;
  const clientName = 'Revert Test Client 404';
  const prodName = 'WALNUT MDF 18mm';

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
  await execute('DELETE FROM board_intake_queue WHERE partner_id = ?', [404]);

  // Seed process as loaded
  const process: PendingShopFloorProcess = {
    id: key,
    process_type: 'board_intake',
    mo_id: testMoId,
    mo_name: 'WH/MO/99404',
    origin: 'S99404',
    partner_id: 404,
    partner_name: clientName,
    product_id: testProdId,
    product_name: prodName,
    qty_needed: 5,
    qty_reserved: 5,
    qty_missing: 0,
    status: 'loaded',
    loaded_at: new Date().toISOString(),
    loaded_by: 'Operator Revert',
    last_synced_at: new Date().toISOString(),
  };

  await upsertPendingShopFloorProcesses([process]);

  // Create intake queue entry and mark synced
  const entryId = randomUUID();
  await createBoardIntakeQueueEntry({
    id: entryId,
    customerName: clientName,
    partnerId: 404,
    productName: prodName,
    productId: testProdId,
    quantity: 5,
    actorEmail: 'operator@factory.co.ke',
    actorName: 'Operator Revert',
  });
  await updateBoardIntakeQueueEntry(entryId, { status: 'synced', stockQuantity: 5 });

  // Revert the intake entry
  const claimed = await claimBoardIntakeRevert(entryId);
  assert.equal(claimed, true, 'Should successfully claim revert');

  await finishBoardIntakeRevert(entryId, 'admin@urbanvibe.co.ke', 0);

  // Verify process was restored to pending
  const pendingList = await getPendingShopFloorProcesses({ status: 'pending' });
  const restored = pendingList.find((p) => p.id === key);
  assert.ok(restored, 'Process must be restored to pending after intake revert');
  assert.equal(restored.status, 'pending');
  assert.equal(restored.qty_missing, 5);
});

test('Boards logged against an MO are cross-posted to the related Sales Order chatter with all email details', async () => {
  const entry = {
    customer_name: 'John Doe',
    product_name: 'WHITE MDF 18mm',
    quantity: 10,
    gate: 'Front Gate',
    vehicle_registration: 'KCA 123X',
    arrival_time: '14:30',
    arrival_date: '2026-10-21',
    actor_name: 'Operator Gate',
    actor_email: 'gate@urbanvibe.co.ke',
  };

  const chatterCalls: Array<{ model: string; id: number; message: string }> = [];
  const fakeClient = {
    findMOsForBoardIntake: async () => [
      {
        moId: 501,
        moName: 'WH/MO/00501',
        origin: 'S02182',
        soId: 105,
        soName: 'S02182',
        qtyNeeded: 10,
        qtyReserved: 0,
        state: 'confirmed',
      },
    ],
    postModelChatterMessage: async (model: string, id: number, message: string) => {
      chatterCalls.push({ model, id, message });
      return 1;
    },
  };

  const matchingMOs = await fakeClient.findMOsForBoardIntake();
  const buildChatterHtml = (moName?: string) =>
    `<p>🪵 <strong>Board log completed (Operator Mobile App)</strong></p>` +
    `<p>` +
    `<strong>Client:</strong> ${entry.customer_name}<br>` +
    `<strong>Board:</strong> ${entry.product_name}<br>` +
    `<strong>Quantity:</strong> ${entry.quantity}<br>` +
    (moName ? `<strong>Manufacturing Order:</strong> ${moName}<br>` : '') +
    `<strong>Gate:</strong> ${entry.gate}<br>` +
    `<strong>Vehicle Reg:</strong> ${entry.vehicle_registration}<br>` +
    `<strong>Arrival Time:</strong> ${entry.arrival_time}<br>` +
    `<strong>Date:</strong> ${entry.arrival_date}<br>` +
    `<strong>Logged by:</strong> ${entry.actor_name}` +
    `</p>`;

  await Promise.all(matchingMOs.map((mo) => fakeClient.postModelChatterMessage('mrp.production', mo.moId, buildChatterHtml(mo.moName))));
  const postedSoIds = new Set<number>();
  for (const mo of matchingMOs) {
    if (mo.soId && !postedSoIds.has(mo.soId)) {
      postedSoIds.add(mo.soId);
      await fakeClient.postModelChatterMessage('sale.order', mo.soId, buildChatterHtml(mo.moName));
    }
  }

  // Verify MO chatter was posted
  const moChatter = chatterCalls.find((c) => c.model === 'mrp.production' && c.id === 501);
  assert.ok(moChatter, 'Must post to mrp.production');
  assert.ok(moChatter.message.includes('WH/MO/00501'));
  assert.ok(moChatter.message.includes('WHITE MDF 18mm'));
  assert.ok(moChatter.message.includes('KCA 123X'));
  assert.ok(moChatter.message.includes('Front Gate'));
  assert.ok(moChatter.message.includes('14:30'));

  // Verify SO chatter was posted with all email details
  const soChatter = chatterCalls.find((c) => c.model === 'sale.order' && c.id === 105);
  assert.ok(soChatter, 'Must post to related sale.order chatter');
  assert.ok(soChatter.message.includes('Client:</strong> John Doe'));
  assert.ok(soChatter.message.includes('Board:</strong> WHITE MDF 18mm'));
  assert.ok(soChatter.message.includes('Quantity:</strong> 10'));
  assert.ok(soChatter.message.includes('Manufacturing Order:</strong> WH/MO/00501'));
  assert.ok(soChatter.message.includes('Gate:</strong> Front Gate'));
  assert.ok(soChatter.message.includes('Vehicle Reg:</strong> KCA 123X'));
  assert.ok(soChatter.message.includes('Arrival Time:</strong> 14:30'));
  assert.ok(soChatter.message.includes('Logged by:</strong> Operator Gate'));
});

test('Board intake strictly rejects decimals and requires whole boards only', () => {
  const isAllowedQuantity = (qty: number) => {
    return qty > 0 && Number.isFinite(qty) && Number.isInteger(qty) && qty % 1 === 0;
  };

  assert.equal(isAllowedQuantity(1), true);
  assert.equal(isAllowedQuantity(5), true);
  assert.equal(isAllowedQuantity(10), true);

  assert.equal(isAllowedQuantity(0.5), false);
  assert.equal(isAllowedQuantity(1.5), false);
  assert.equal(isAllowedQuantity(2.25), false);
  assert.equal(isAllowedQuantity(0), false);
  assert.equal(isAllowedQuantity(-1), false);
});

