import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPendingShopFloorProcesses,
  upsertPendingShopFloorProcesses,
  markPendingShopFloorProcessesLoaded,
  deleteStaleCompletedProcesses,
} from './repositories';
import { PendingShopFloorProcess } from './types';
import { execute } from './db';

test('shop_floor_pending_processes lifecycle: upsert, query, mark loaded, and preserve loaded status', async () => {
  const testMoId = 99901;
  const testPartnerId = 88801;
  const testProductId = 77701;

  // Clean up any existing test records
  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);

  const testProcess: PendingShopFloorProcess = {
    id: `test_${testMoId}_${testProductId}`,
    process_type: 'board_intake',
    mo_id: testMoId,
    mo_name: 'WH/MO/99901',
    origin: 'SO99901',
    partner_id: testPartnerId,
    partner_name: 'Test Client Ltd',
    product_id: testProductId,
    product_name: 'MDF 18mm Oak',
    qty_needed: 10,
    qty_reserved: 2,
    qty_missing: 8,
    status: 'pending',
    loaded_at: null,
    loaded_by: null,
    last_synced_at: new Date().toISOString(),
  };

  // 1. Insert/Upsert into MySQL
  await upsertPendingShopFloorProcesses([testProcess]);

  // 2. Query pending items
  const pendingBefore = await getPendingShopFloorProcesses({
    partnerId: testPartnerId,
    status: 'pending',
  });
  assert.equal(pendingBefore.length, 1);
  assert.equal(pendingBefore[0].mo_id, testMoId);
  assert.equal(pendingBefore[0].qty_missing, 8);
  assert.equal(pendingBefore[0].status, 'pending');

  // 3. Mark loaded (operator loads 8 boards)
  const updated = await markPendingShopFloorProcessesLoaded({
    partnerId: testPartnerId,
    productId: testProductId,
    loadedBy: 'operator@flowcode.co.ke',
    quantity: 8,
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].status, 'loaded');
  assert.equal(updated[0].qty_missing, 0);
  assert.equal(updated[0].qty_reserved, 10);
  assert.equal(updated[0].loaded_by, 'operator@flowcode.co.ke');

  // 4. Verify item has DISAPPEARED from pending query
  const pendingAfter = await getPendingShopFloorProcesses({
    partnerId: testPartnerId,
    status: 'pending',
  });
  assert.equal(pendingAfter.length, 0, 'Item must disappear immediately from pending query once loaded');

  // 5. Verify that a background sync re-upsert DOES NOT revert it back to pending!
  await upsertPendingShopFloorProcesses([testProcess]);
  const pendingAfterSync = await getPendingShopFloorProcesses({
    partnerId: testPartnerId,
    status: 'pending',
  });
  assert.equal(pendingAfterSync.length, 0, 'Background sync must preserve loaded status and not revert to pending');

  // 6. Clean up
  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);
});
