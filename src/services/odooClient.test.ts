import assert from 'node:assert/strict';
import test from 'node:test';
import { OdooClient } from './odooClient';

test('attributes a board inventory adjustment move and lines to the operator name', async () => {
  const client = new OdooClient({
    baseUrl: 'https://odoo.example.test',
    database: 'test',
    username: 'test@example.test',
    apiKey: 'test',
  });
  const writes: Array<{ model: string; ids: number[]; values: Record<string, unknown> }> = [];
  const mockedClient = client as any;

  mockedClient.searchReadRecords = async (model: string, options: Record<string, unknown>): Promise<any[]> => {
    if (model === 'stock.move') return [{ id: 42, reference: 'INV/2026/0001', origin: 'Inventory adjustment' }];
    if (model === 'stock.move.line') return [{ id: 84 }];
    if (model === 'ir.model.fields') {
      const domain = options.domain as unknown[];
      const targetModel = Array.isArray(domain[0]) ? String(domain[0][2] || '') : '';
      return [{ name: targetModel === 'stock.move' ? 'x_studio_operator_online' : 'x_operator_online', field_description: 'Operator online' }];
    }
    return [];
  };
  mockedClient.writeRecord = async (model: string, ids: number[], values: Record<string, unknown>) => {
    writes.push({ model, ids, values });
    return true;
  };

  assert.equal(await client.populateInventoryAdjustmentOperator(123, 'Leovard Ongule'), true);
  assert.deepEqual(writes, [
    { model: 'stock.move', ids: [42], values: { x_studio_operator_online: 'Leovard Ongule' } },
    { model: 'stock.move.line', ids: [84], values: { x_operator_online: 'Leovard Ongule' } },
  ]);
});

test('enforces traffic pause when setOdooTrafficPaused(true) is active', async () => {
  const { isOdooTrafficPaused, setOdooTrafficPaused, enqueueOdooRequest } = await import('./odooClient');
  
  setOdooTrafficPaused(true);
  assert.equal(isOdooTrafficPaused(), true);

  await assert.rejects(
    async () => {
      await enqueueOdooRequest(async () => 'should not execute');
    },
    (err: any) => {
      return /paused by administrative setting/i.test(err.message);
    },
  );

  // Restore state
  setOdooTrafficPaused(false);
  assert.equal(isOdooTrafficPaused(), false);
});

test('enqueueOdooRequest serializes requests and enforces minimum delay', async () => {
  const { setOdooTrafficPaused, enqueueOdooRequest } = await import('./odooClient');
  setOdooTrafficPaused(false);

  const timestamps: number[] = [];
  const start = Date.now();

  const p1 = enqueueOdooRequest(async () => {
    timestamps.push(Date.now() - start);
    return 1;
  });

  const p2 = enqueueOdooRequest(async () => {
    timestamps.push(Date.now() - start);
    return 2;
  });

  const results = await Promise.all([p1, p2]);
  assert.deepEqual(results, [1, 2]);
  assert.equal(timestamps.length, 2);
  // The gap between second request and first request should be at least 900ms (accounting for timer granularity)
  assert.ok(timestamps[1] - timestamps[0] >= 900, `Expected gap >= 900ms, got ${timestamps[1] - timestamps[0]}ms`);
});
