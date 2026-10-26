import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processBoardIntakePurchaseOrderFulfillment,
  processBoardIntakePurchaseOrderFulfillmentLegacy,
  cleanPreexistingMismatchChatter,
} from './boardIntakeSyncService';
import { matchRetroactiveBoardLogsForActiveMos } from './shopFloorPendingSyncService';
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
