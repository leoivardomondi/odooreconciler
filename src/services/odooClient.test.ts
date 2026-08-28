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
