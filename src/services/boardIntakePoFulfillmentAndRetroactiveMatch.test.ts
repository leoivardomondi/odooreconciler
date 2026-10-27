import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processBoardIntakePurchaseOrderFulfillment,
  processBoardIntakePurchaseOrderFulfillmentLegacy,
  cleanPreexistingMismatchChatter,
  reconcileRetroactiveBoardLogsForLinkedPos,
} from './boardIntakeSyncService';
import { matchRetroactiveBoardLogsForActiveMos } from './shopFloorPendingSyncService';
import { createBoardIntakeQueueEntry, getBoardIntakeQueueEntry, updateBoardIntakeQueueEntry } from '../models/repositories';
import { execute } from '../models/db';
import { OdooClient } from './odooClient';

test('processBoardIntakePurchaseOrderFulfillment strictly approves PO ONLY if waiting for approval (state: "to approve")', async () => {
  const approvedPoIds: number[] = [];
  const validatedPickingIds: number[] = [];
  const postedChatters: Array<{ model: string; id: number; msg: string }> = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string) => {
      if (model === 'purchase.order') {
        return [
          {
            id: 101,
            name: 'P01099',
            state: 'to approve', // waiting for approval!
            origin: 'S02500',
            order_line: [501],
            picking_ids: [901],
          },
        ];
      }
      if (model === 'purchase.order.line') {
        return [
          {
            id: 501,
            order_id: [101, 'P01099'],
            product_id: [205, 'WHITE MDF 18mm'],
            product_qty: 10,
          },
        ];
      }
      if (model === 'stock.picking') {
        return [
          {
            id: 901,
            name: 'WH/IN/00901',
            state: 'assigned',
            picking_type_code: 'incoming',
            move_ids_without_package: [701],
          },
        ];
      }
      if (model === 'stock.move') {
        return [
          {
            id: 701,
            product_id: [205, 'WHITE MDF 18mm'],
            product_uom_qty: 10,
            quantity: 0,
          },
        ];
      }
      if (model === 'sale.order') {
        return [{ id: 401, name: 'S02500', user_id: [8, 'Candy Sharon'] }];
      }
      if (model === 'mrp.production') {
        return [{ id: 301, name: 'WH/MO/05500', origin: 'S02500' }];
      }
      return [];
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (model === 'purchase.order' && method === 'button_approve') {
        approvedPoIds.push(...ids);
      }
      if (model === 'stock.picking' && method === 'button_validate') {
        validatedPickingIds.push(...ids);
      }
      return true;
    },
    readRecords: async (model: string, ids: number[]) => {
      if (model === 'purchase.order') {
        return [{ id: ids[0], state: 'purchase' }];
      }
      return [];
    },
    writeRecord: async () => true,
    populatePickingValidationMetadata: async () => true,
    postModelChatterMessage: async (model: string, id: number, msg: string) => {
      postedChatters.push({ model, id, msg });
      return 1;
    },
  } as unknown as OdooClient;

  const result = await processBoardIntakePurchaseOrderFulfillmentLegacy(
    mockClient,
    {
      partner_id: '42',
      customer_name: 'Test Client Ltd',
      product_id: '205',
      product_name: 'WHITE MDF 18mm',
      quantity: 10,
      actor_name: 'David Gate',
    },
  );

  assert.ok(result);
  assert.equal(result.fulfilledViaReceipt, true);
  assert.equal(result.autoApproved, true);
  assert.equal(result.poName, 'P01099');
  assert.equal(result.pickingName, 'WH/IN/00901');
  assert.deepEqual(approvedPoIds, [101]);
  assert.deepEqual(validatedPickingIds, [901]);
  assert.ok(postedChatters.some((c) => c.model === 'purchase.order' && c.msg.includes('Approved automatically from Waiting for Approval')));
  assert.ok(postedChatters.some((c) => c.model === 'stock.picking' && c.msg.includes('Received via Purchase Receipt')));
});

test('processBoardIntakePurchaseOrderFulfillment does NOT approve PO when state is "draft"', async () => {
  const approvedPoIds: number[] = [];
  const validatedPickingIds: number[] = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string) => {
      if (model === 'purchase.order') {
        return [
          {
            id: 102,
            name: 'P01100',
            state: 'draft', // Draft PO - MUST NOT BE APPROVED
            origin: 'S02501',
            order_line: [502],
          },
        ];
      }
      if (model === 'purchase.order.line') {
        return [
          {
            id: 502,
            order_id: [102, 'P01100'],
            product_id: [205, 'WHITE MDF 18mm'],
            product_qty: 10,
          },
        ];
      }
      return [];
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (method === 'button_approve') approvedPoIds.push(...ids);
      if (method === 'button_validate') validatedPickingIds.push(...ids);
      return true;
    },
    readRecords: async () => [],
  } as unknown as OdooClient;

  const result = await processBoardIntakePurchaseOrderFulfillment(
    mockClient,
    {
      partner_id: '42',
      customer_name: 'Test Client Ltd',
      product_id: '205',
      product_name: 'WHITE MDF 18mm',
      quantity: 10,
      actor_name: 'David Gate',
    },
  );

  // Must NOT fulfill via receipt and must not return result
  assert.equal(result, null);
  assert.equal(approvedPoIds.length, 0);
  assert.equal(validatedPickingIds.length, 0);
});

test('cleanPreexistingMismatchChatter finds and deletes matching error chatter messages', async () => {
  const unlinkedModelIds: Array<{ model: string; ids: number[] }> = [];

  const mockClient = {
    searchReadRecords: async (model: string) => {
      if (model === 'mail.message') {
        return [
          { id: 9001 },
          { id: 9002 },
        ];
      }
      return [];
    },
    unlinkRecords: async (model: string, ids: number[]) => {
      unlinkedModelIds.push({ model, ids });
      return true;
    },
  } as unknown as OdooClient;

  const result = await cleanPreexistingMismatchChatter(mockClient);
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(result.deletedIds, [9001, 9002]);
  assert.deepEqual(unlinkedModelIds, [{ model: 'mail.message', ids: [9001, 9002] }]);
});

test('matchRetroactiveBoardLogsForActiveMos finds prior board log history and triggers action_assign', async () => {
  const postedChatters: Array<{ model: string; id: number; msg: string }> = [];
  const assignedMoIds: number[] = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string) => {
      if (model === 'sale.order') return [{ id: 401 }];
      return [];
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (model === 'mrp.production' && method === 'action_assign') {
        assignedMoIds.push(...ids);
      }
      return true;
    },
    postModelChatterMessage: async (model: string, id: number, msg: string) => {
      postedChatters.push({ model, id, msg });
      return 1;
    },
  } as unknown as OdooClient;

  const activeMOs = [
    {
      id: 501,
      name: 'WH/MO/05490',
      state: 'confirmed',
      origin: 'S02400',
      create_date: '2026-10-25 10:00:00', // MO created at 10:00 AM
    },
  ];

  const boardMoves = [
    {
      id: 1001,
      raw_material_production_id: [501, 'WH/MO/05490'] as [number, string],
      product_id: [100, 'WHITE MDF 18mm'] as [number, string],
      product_uom_qty: 5,
      quantity: 0,
    },
  ];

  const soPartnerMap = new Map<string, { partnerId: number; partnerName: string }>();
  soPartnerMap.set('S02400', { partnerId: 88, partnerName: 'John Customer' });

  const originProductPOKeys = new Set<string>(); // No PO!

  const activeBoardLogs = [
    {
      id: 'log-001',
      actor_name: 'John Gate',
      actor_email: 'john@urbanvibe.co.ke',
      gate: 'Gate A',
      vehicle_registration: 'KDD 123X',
      arrival_date: '2026-10-25',
      arrival_time: '09:00:00',
      product_id: 100,
      product_name: 'WHITE MDF 18mm',
      partner_id: 88,
      customer_name: 'John Customer',
      quantity: 5,
      created_at: '2026-10-25 09:00:00', // Logged 1 hour before MO!
    },
  ];

  const matched = await matchRetroactiveBoardLogsForActiveMos(
    mockClient,
    activeMOs,
    boardMoves,
    soPartnerMap,
    originProductPOKeys,
    activeBoardLogs,
  );

  assert.equal(matched, 1);
  assert.deepEqual(assignedMoIds, [501]);
  assert.ok(postedChatters.some((c) => c.model === 'mrp.production' && c.id === 501 && c.msg.includes('Found Matching Prior Board Log History')));
  assert.ok(postedChatters.some((c) => c.model === 'sale.order' && c.msg.includes('Prior Gate Board Log Matched to Manufacturing Order')));
});

test('reconcileRetroactiveBoardLogsForLinkedPos validates PO receipt for prior manual log when MO has linked PO', async () => {
  const testLogId = `retro-test-${Date.now()}`;
  await createBoardIntakeQueueEntry({
    id: testLogId,
    productId: 205,
    productName: 'WHITE MDF 18mm',
    partnerId: 42,
    customerName: 'Test Client Ltd',
    quantity: 8,
    actorName: 'Gate Operator',
    isPurchase: 0,
  });
  await updateBoardIntakeQueueEntry(testLogId, { status: 'synced', stockQuantity: 8 });

  const validatedPickingIds: number[] = [];
  const removedStockCalls: Array<{ productId: number; quantity: number }> = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string, options?: any) => {
      if (model === 'sale.order') {
        const partnerDomain = options?.domain?.find((d: any) => Array.isArray(d) && d[0] === 'partner_id');
        if (partnerDomain && partnerDomain[2] !== 42) return [];
        return [{ id: 401, name: 'S02500', partner_id: [42, 'Test Client Ltd'], user_id: [8, 'Candy Sharon'] }];
      }
      if (model === 'mrp.production') {
        return [{ id: 301, name: 'WH/MO/05500', origin: 'S02500' }];
      }
      if (model === 'purchase.order') {
        return [
          {
            id: 105,
            name: 'P01095',
            state: 'purchase', // Already approved PO
            origin: 'S02500',
            order_line: [505],
            picking_ids: [905],
          },
        ];
      }
      if (model === 'purchase.order.line') {
        const prodDomain = options?.domain?.find((d: any) => Array.isArray(d) && d[0] === 'product_id');
        if (prodDomain && prodDomain[2] !== 205) return [];
        return [
          {
            id: 505,
            order_id: [105, 'P01095'],
            product_id: [205, 'WHITE MDF 18mm'],
            product_qty: 8,
          },
        ];
      }
      if (model === 'stock.picking') {
        return [
          {
            id: 905,
            name: 'WH/IN/00905',
            state: 'assigned',
            picking_type_code: 'incoming',
            move_ids_without_package: [705],
          },
        ];
      }
      if (model === 'stock.move') {
        return [
          {
            id: 705,
            product_id: [205, 'WHITE MDF 18mm'],
            product_uom_qty: 8,
            quantity: 0,
          },
        ];
      }
      return [];
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (model === 'stock.picking' && method === 'button_validate') {
        validatedPickingIds.push(...ids);
      }
      return true;
    },
    writeRecord: async () => true,
    populatePickingValidationMetadata: async () => true,
    postModelChatterMessage: async () => 1,
    removeBoardsFromStock: async (arg: { productId: number; quantity: number }) => {
      removedStockCalls.push(arg);
      return { newQty: 0 };
    },
  } as unknown as OdooClient;

  try {
    const result = await reconcileRetroactiveBoardLogsForLinkedPos(mockClient);
    assert.equal(result.matchedCount >= 1, true);
    assert.equal(result.logsFulfilled.includes(testLogId), true);
    assert.deepEqual(validatedPickingIds, [905]);
    assert.deepEqual(removedStockCalls, [{ productId: 205, quantity: 8 }]);

    const updatedLog = await getBoardIntakeQueueEntry(testLogId);
    assert.ok(updatedLog);
    assert.equal(Boolean(updatedLog.is_purchase), true);
    assert.equal(updatedLog.purchase_order_reference, 'P01095');
  } finally {
    await execute('DELETE FROM board_intake_queue WHERE id = ?', [testLogId]);
  }
});

test('processBoardIntakePurchaseOrderFulfillment isolates multi-product PO receipts and zeroes other items', async () => {
  const writtenMoveRecords: Array<{ ids: number[]; values: any }> = [];
  const writtenMoveLines: Array<{ ids: number[]; values: any }> = [];
  const processedWizards: Array<{ model: string; method: string; ids: number[] }> = [];
  const validatedPickingIds: number[] = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string, options?: any) => {
      if (model === 'sale.order') {
        return [
          {
            id: 488,
            name: 'S02888',
            partner_id: [99, 'Multi-Product Customer'],
            user_id: [12, 'Leoivard Ongule'],
          },
        ];
      }
      if (model === 'purchase.order') {
        return [
          {
            id: 888,
            name: 'P01888',
            state: 'purchase',
            origin: 'S02888',
            order_line: [901, 902, 903],
          },
        ];
      }
      if (model === 'purchase.order.line') {
        return [
          { id: 901, order_id: [888, 'P01888'], product_id: [205, 'WHITE MDF 18mm'], product_qty: 10 },
          { id: 902, order_id: [888, 'P01888'], product_id: [206, 'HARBOUR GREY 18mm'], product_qty: 5 },
          { id: 903, order_id: [888, 'P01888'], product_id: [207, 'BACKER WHITE 3mm'], product_qty: 8 },
        ];
      }
      if (model === 'stock.picking') {
        return [
          {
            id: 777,
            name: 'WH/IN/00777',
            state: 'assigned',
            picking_type_code: 'incoming',
            move_ids_without_package: [1001, 1002, 1003],
          },
        ];
      }
      if (model === 'stock.move') {
        // If domain filters by product_id = 205 (the target product)
        const prodDomain = options?.domain?.find((d: any) => Array.isArray(d) && d[0] === 'product_id');
        if (prodDomain && prodDomain[2] === 205) {
          return [
            {
              id: 1001,
              picking_id: [777, 'WH/IN/00777'],
              product_id: [205, 'WHITE MDF 18mm'],
              product_uom_qty: 10,
              quantity: 0,
              state: 'assigned',
            },
          ];
        }
        // If searching all moves for picking 777:
        return [
          {
            id: 1001,
            picking_id: [777, 'WH/IN/00777'],
            product_id: [205, 'WHITE MDF 18mm'],
            product_uom_qty: 10,
            quantity: 0,
            state: 'assigned',
          },
          {
            id: 1002,
            picking_id: [777, 'WH/IN/00777'],
            product_id: [206, 'HARBOUR GREY 18mm'],
            product_uom_qty: 5,
            quantity: 5, // Initially populated
            state: 'assigned',
          },
          {
            id: 1003,
            picking_id: [777, 'WH/IN/00777'],
            product_id: [207, 'BACKER WHITE 3mm'],
            product_uom_qty: 8,
            quantity: 8, // Initially populated
            state: 'assigned',
          },
        ];
      }
      if (model === 'stock.move.line') {
        return [
          { id: 2001, move_id: [1001, 'move1'], product_id: [205, 'prod1'], quantity: 10 },
          { id: 2002, move_id: [1002, 'move2'], product_id: [206, 'prod2'], quantity: 5 },
          { id: 2003, move_id: [1003, 'move3'], product_id: [207, 'prod3'], quantity: 8 },
        ];
      }
      return [];
    },
    writeRecord: async (model: string, ids: number[], values: any) => {
      if (model === 'stock.move') writtenMoveRecords.push({ ids, values });
      if (model === 'stock.move.line') writtenMoveLines.push({ ids, values });
      return true;
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (model === 'stock.picking' && method === 'button_validate') {
        validatedPickingIds.push(...ids);
        // Returns backorder wizard action
        return {
          res_model: 'stock.backorder.confirmation',
          res_id: 55,
        };
      }
      if (model === 'stock.backorder.confirmation' && method === 'process') {
        processedWizards.push({ model, method, ids });
        return true;
      }
      return true;
    },
    populatePickingValidationMetadata: async () => true,
    postModelChatterMessage: async () => 1,
  } as unknown as OdooClient;

  // Logging 6 sheets of WHITE MDF (partial, out of 10) on a PO with 3 products
  const result = await processBoardIntakePurchaseOrderFulfillment(mockClient, {
    partner_id: '99',
    customer_name: 'Multi-Product Customer',
    product_id: '205',
    product_name: 'WHITE MDF 18mm',
    quantity: 6,
    actor_name: 'Gate Operator',
  });

  assert.ok(result);
  assert.equal(result.fulfilledViaReceipt, true);
  assert.equal(result.qtyFulfilled, 6);
  assert.equal(result.surplusQty, 0);

  // Assert target move (1001) got quantity: 6
  const targetMoveWrite = writtenMoveRecords.find((r) => r.ids.includes(1001));
  assert.ok(targetMoveWrite, 'Target move 1001 should be written');
  assert.equal(targetMoveWrite.values.quantity, 6);

  // Assert non-target moves (1002, 1003) got quantity: 0
  const otherMoveWrites = writtenMoveRecords.filter((r) => r.ids.includes(1002) || r.ids.includes(1003));
  assert.equal(otherMoveWrites.length, 2);
  for (const w of otherMoveWrites) {
    assert.equal(w.values.quantity, 0, `Move ${w.ids} must be zeroed out`);
  }

  // Assert move lines: target move line (2001) got 6, non-target move lines (2002, 2003) got 0
  const targetLineWrite = writtenMoveLines.find((r) => r.ids.includes(2001));
  assert.ok(targetLineWrite);
  assert.equal(targetLineWrite.values.quantity, 6);

  const otherLineWrites = writtenMoveLines.filter((r) => r.ids.includes(2002) || r.ids.includes(2003));
  assert.equal(otherLineWrites.length, 2);
  for (const lw of otherLineWrites) {
    assert.equal(lw.values.quantity, 0, `Move line ${lw.ids} must be zeroed out`);
  }

  // Assert picking validated and backorder wizard processed
  assert.deepEqual(validatedPickingIds, [777]);
  assert.deepEqual(processedWizards, [{ model: 'stock.backorder.confirmation', method: 'process', ids: [55] }]);
});
