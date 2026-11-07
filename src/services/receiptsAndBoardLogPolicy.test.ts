import test from 'node:test';
import assert from 'node:assert/strict';
import { OdooClient } from './odooClient';

test('getOpenBoardReceipts: strictly only returns non-board items and filters out pure board receipts', async () => {
  const client = new OdooClient({
    baseUrl: 'https://odoo.fake.local',
    database: 'fake-db',
    username: 'admin',
    apiKey: 'pwd',
  });

  const mockWarehouse = { id: 1, name: 'Main Warehouse', code: 'WH', companyId: 1 };
  (client as any).getVerifiedTargetWarehouse = async () => mockWarehouse;

  // Mock pickings:
  // Picking 101: only contains boards (should be excluded)
  // Picking 102: contains edge banding & hardware (should be included)
  // Picking 103: contains mixed boards and hardware (only hardware should remain in items)
  const mockPickings = [
    { id: 101, name: 'WH/IN/00101', partner_id: [50, 'Supplier A'], origin: 'PO001', state: 'assigned' },
    { id: 102, name: 'WH/IN/00102', partner_id: [51, 'Supplier B'], origin: 'PO002', state: 'assigned' },
    { id: 103, name: 'WH/IN/00103', partner_id: [52, 'Supplier C'], origin: 'PO003', state: 'assigned' },
  ];

  const mockMoves = [
    // Picking 101 moves (boards only)
    { picking_id: [101, 'WH/IN/00101'], product_id: [1, 'White MDF 18mm'], product_uom_qty: 10, quantity: 0 },
    { picking_id: [101, 'WH/IN/00101'], product_id: [2, 'Backer White MDF 3mm'], product_uom_qty: 5, quantity: 0 },

    // Picking 102 moves (non-boards: edging tape & hinges)
    { picking_id: [102, 'WH/IN/00102'], product_id: [3, 'Teak Edge Banding 22mm x 1mm'], product_uom_qty: 100, quantity: 0 },
    { picking_id: [102, 'WH/IN/00102'], product_id: [4, 'Soft Close Concealed Hinges'], product_uom_qty: 50, quantity: 0 },

    // Picking 103 moves (mixed: boards + hardware)
    { picking_id: [103, 'WH/IN/00103'], product_id: [5, 'Harbour Grey waterproof 18mm'], product_uom_qty: 8, quantity: 0 },
    { picking_id: [103, 'WH/IN/00103'], product_id: [6, 'Drawer Runners 450mm'], product_uom_qty: 12, quantity: 0 },
  ];

  (client as any).searchReadRecords = async (model: string) => {
    if (model === 'stock.picking') return mockPickings;
    if (model === 'stock.move') return mockMoves;
    return [];
  };

  const receipts = await client.getOpenBoardReceipts(1);

  // 1. Picking 101 (only boards) must be omitted
  const p101 = receipts.find((r) => r.id === 101);
  assert.equal(p101, undefined, 'Receipts only containing boards must be excluded');

  // 2. Picking 102 (non-boards) must be included with all items
  const p102 = receipts.find((r) => r.id === 102);
  assert.ok(p102, 'Receipt with non-board items must be included');
  assert.equal(p102.items.length, 2);
  assert.equal(p102.items[0].name, 'Teak Edge Banding 22mm x 1mm');
  assert.equal(p102.items[1].name, 'Soft Close Concealed Hinges');

  // 3. Picking 103 (mixed) must only include the Drawer Runners, NOT the Harbour Grey board
  const p103 = receipts.find((r) => r.id === 103);
  assert.ok(p103, 'Mixed receipt must be included');
  assert.equal(p103.items.length, 1, 'Only non-board items must appear in the receipt');
  assert.equal(p103.items[0].name, 'Drawer Runners 450mm');
});
