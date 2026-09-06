import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getShopFloorDashboardSnapshot,
  saveShopFloorDashboardSnapshot,
  deleteShopFloorDashboardSnapshot,
  getShopFloorSharedCache,
  saveShopFloorSharedCache,
  deleteShopFloorSharedCache,
} from './repositories';

test('saves, retrieves, and deletes shop floor dashboard snapshot by user email', async () => {
  const testEmail = 'Test.Operator@Example.com';
  const dummyData = {
    employee: { id: 99, name: 'Test Operator', workEmail: 'test.operator@example.com' },
    workOrders: [{ id: 101, name: 'WH/MO/00101', progress: 50 }],
  };

  await saveShopFloorDashboardSnapshot(testEmail, dummyData);

  // Retrieve using lowercase email
  const result = await getShopFloorDashboardSnapshot<typeof dummyData>('test.operator@example.com');
  assert.ok(result, 'Snapshot should be found');
  assert.equal(result.data.employee.name, 'Test Operator');
  assert.equal(result.data.workOrders.length, 1);
  assert.equal(result.data.workOrders[0].name, 'WH/MO/00101');
  assert.ok(result.syncedAt, 'SyncedAt timestamp should be present');

  // Clean up
  await deleteShopFloorDashboardSnapshot(testEmail);
  const deletedResult = await getShopFloorDashboardSnapshot(testEmail);
  assert.equal(deletedResult, null, 'Snapshot should be deleted');
});

test('saves, retrieves, and deletes shop floor shared cache entries', async () => {
  const cacheKey = 'test:shared-orders:v1';
  const sharedData = {
    totalActiveOrders: 15,
    items: ['item1', 'item2'],
  };

  await saveShopFloorSharedCache(cacheKey, sharedData);

  const result = await getShopFloorSharedCache<typeof sharedData>(cacheKey);
  assert.ok(result, 'Shared cache entry should be found');
  assert.equal(result.data.totalActiveOrders, 15);
  assert.deepEqual(result.data.items, ['item1', 'item2']);

  // Clean up
  await deleteShopFloorSharedCache(cacheKey);
  const deleted = await getShopFloorSharedCache(cacheKey);
  assert.equal(deleted, null, 'Shared cache entry should be deleted');
});
