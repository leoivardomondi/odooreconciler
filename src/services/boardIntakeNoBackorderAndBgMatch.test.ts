import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  createBoardIntakeQueueEntry,
  getBoardIntakeQueueEntry,
  getPendingShopFloorProcesses,
  markPendingShopFloorProcessesLoaded,
  unmarkPendingShopFloorProcessesLoaded,
  upsertPendingShopFloorProcesses,
} from '../models/repositories';
import { execute } from '../models/db';
import {
  buildBoardIntakeChatterHtml,
  matchBoardIntakeToClientImmediate,
  processBoardIntakePurchaseOrderFulfillment,
} from './boardIntakeSyncService';
import type { OdooClient } from './odooClient';

test('no-backorder closure marks pending shortfall loaded and survives Odoo sync re-upsert', async () => {
  const moId = 999123;
  const partnerId = 888123;
  const productId = 777123;

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);

  await upsertPendingShopFloorProcesses([
    {
      id: `test_noback_${moId}_${productId}`,
      process_type: 'board_intake',
      mo_id: moId,
      mo_name: 'WH/MO/999123',
      origin: 'S999123',
      partner_id: partnerId,
      partner_name: 'Short Receipt Client Ltd',
      product_id: productId,
      product_name: '18mm White MDF',
      qty_needed: 4,
      qty_reserved: 0,
      qty_missing: 4,
      status: 'pending',
      loaded_at: null,
      loaded_by: null,
      last_synced_at: new Date().toISOString(),
    },
  ]);

  // Operator logs 3 boards (down from 4) and chooses "No, not expecting more" (noBackorder: true)
  const closed = await markPendingShopFloorProcessesLoaded({
    partnerId,
    productId,
    loadedBy: 'operator@example.com',
    quantity: 3,
    moId,
    noBackorder: true,
  });

  assert.equal(closed.length, 1);
  assert.equal(closed[0].status, 'loaded');
  assert.equal(closed[0].qty_reserved, 3);
  assert.equal(closed[0].qty_missing, 0);
  assert.equal(closed[0].no_backorder_closed, true);

  // Subsequent Odoo sync reports qty_needed=4, qty_missing=1 -> must stay closed!
  await upsertPendingShopFloorProcesses([
    {
      id: `test_noback_${moId}_${productId}`,
      process_type: 'board_intake',
      mo_id: moId,
      mo_name: 'WH/MO/999123',
      origin: 'S999123',
      partner_id: partnerId,
      partner_name: 'Short Receipt Client Ltd',
      product_id: productId,
      product_name: '18mm White MDF',
      qty_needed: 4,
      qty_reserved: 3,
      qty_missing: 1,
      status: 'pending',
      loaded_at: null,
      loaded_by: null,
      last_synced_at: new Date().toISOString(),
    },
  ]);

  const pendingAfterSync = await getPendingShopFloorProcesses({ partnerId, status: 'pending' });
  assert.equal(pendingAfterSync.length, 0, 'Closed no-backorder row must not reopen on subsequent sync');

  const loadedAfterSync = await getPendingShopFloorProcesses({ partnerId, status: 'loaded' });
  assert.equal(loadedAfterSync.length, 1);
  assert.equal(loadedAfterSync[0].qty_missing, 0);
  assert.equal(loadedAfterSync[0].no_backorder_closed, true);

  // If Odoo MO qty genuinely increases later (4 -> 6), requirement reopens
  await upsertPendingShopFloorProcesses([
    {
      id: `test_noback_${moId}_${productId}`,
      process_type: 'board_intake',
      mo_id: moId,
      mo_name: 'WH/MO/999123',
      origin: 'S999123',
      partner_id: partnerId,
      partner_name: 'Short Receipt Client Ltd',
      product_id: productId,
      product_name: '18mm White MDF',
      qty_needed: 6,
      qty_reserved: 3,
      qty_missing: 3,
      status: 'pending',
      loaded_at: null,
      loaded_by: null,
      last_synced_at: new Date().toISOString(),
    },
  ]);

  const pendingAfterIncrease = await getPendingShopFloorProcesses({ partnerId, status: 'pending' });
  assert.equal(pendingAfterIncrease.length, 1);
  assert.equal(pendingAfterIncrease[0].qty_missing, 3);
  assert.equal(pendingAfterIncrease[0].no_backorder_closed, false);

  // Clean revert reset test
  await markPendingShopFloorProcessesLoaded({
    partnerId,
    productId,
    loadedBy: 'operator@example.com',
    quantity: 3,
    moId,
    noBackorder: true,
  });
  await unmarkPendingShopFloorProcessesLoaded({
    partnerId,
    productId,
    quantity: 3,
  });
  const pendingAfterRevert = await getPendingShopFloorProcesses({ partnerId, status: 'pending' });
  assert.equal(pendingAfterRevert.length, 1);
  assert.equal(pendingAfterRevert[0].no_backorder_closed, false);

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);
});

test('processBoardIntakePurchaseOrderFulfillment cancels backorder when no_backorder=1 on single-product PO', async () => {
  const wizardCalls: Array<{ model: string; method: string; id: number }> = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string) => {
      if (model === 'purchase.order') {
        return [{ id: 10, name: 'P02001', state: 'purchase', origin: 'S04001', order_line: [50], picking_ids: [90] }];
      }
      if (model === 'purchase.order.line') {
        return [{ id: 50, order_id: [10, 'P02001'], product_id: [205, 'WHITE MDF 18mm'], product_qty: 4 }];
      }
      if (model === 'stock.picking') {
        return [{ id: 90, name: 'WH/IN/02001', state: 'assigned', picking_type_code: 'incoming' }];
      }
      if (model === 'stock.move') {
        return [{ id: 701, picking_id: [90, 'WH/IN/02001'], product_id: [205, 'WHITE MDF 18mm'], product_uom_qty: 4, quantity: 0, state: 'assigned' }];
      }
      if (model === 'stock.move.line') return [];
      if (model === 'sale.order') return [{ id: 401, name: 'S04001', user_id: false }];
      if (model === 'mrp.production') return [{ id: 301, name: 'WH/MO/05501', origin: 'S04001' }];
      return [];
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (model === 'stock.picking' && method === 'button_validate') {
        return { res_model: 'stock.backorder.confirmation', res_id: 777, context: {} };
      }
      if (model === 'stock.backorder.confirmation') {
        wizardCalls.push({ model, method, id: ids[0] });
      }
      return true;
    },
    readRecords: async (model: string, ids: number[]) => {
      if (model === 'stock.picking') return [{ id: ids[0], state: 'done' }];
      return [];
    },
    writeRecord: async () => true,
    populatePickingValidationMetadata: async () => true,
    postModelChatterMessage: async () => 1,
  } as unknown as OdooClient;

  const result = await processBoardIntakePurchaseOrderFulfillment(mockClient, {
    partner_id: 42,
    customer_name: 'Client Single PO',
    product_id: 205,
    product_name: 'WHITE MDF 18mm',
    quantity: 3,
    actor_name: 'Operator',
    no_backorder: 1,
  });

  assert.ok(result);
  assert.equal(result.qtyFulfilled, 3);
  assert.deepEqual(wizardCalls, [{ model: 'stock.backorder.confirmation', method: 'process_cancel_backorder', id: 777 }]);
});

test('processBoardIntakePurchaseOrderFulfillment preserves multi-product PO backorder by capping only target move', async () => {
  const wizardCalls: Array<{ model: string; method: string; id: number }> = [];
  const moveWrites: Array<{ ids: number[]; vals: Record<string, unknown> }> = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string) => {
      if (model === 'purchase.order') {
        return [{ id: 11, name: 'P02002', state: 'purchase', origin: 'S04002', order_line: [51], picking_ids: [91] }];
      }
      if (model === 'purchase.order.line') {
        return [{ id: 51, order_id: [11, 'P02002'], product_id: [205, 'WHITE MDF 18mm'], product_qty: 20 }];
      }
      if (model === 'stock.picking') {
        return [{ id: 91, name: 'WH/IN/02002', state: 'assigned', picking_type_code: 'incoming' }];
      }
      if (model === 'stock.move') {
        return [
          { id: 701, picking_id: [91, 'WH/IN/02002'], product_id: [205, 'WHITE MDF 18mm'], product_uom_qty: 20, quantity: 0, state: 'assigned' },
          { id: 702, picking_id: [91, 'WH/IN/02002'], product_id: [206, 'BLACK MDF 18mm'], product_uom_qty: 5, quantity: 0, state: 'assigned' },
        ];
      }
      if (model === 'stock.move.line') return [];
      if (model === 'sale.order') return [{ id: 402, name: 'S04002', user_id: false }];
      if (model === 'mrp.production') return [{ id: 302, name: 'WH/MO/05502', origin: 'S04002' }];
      return [];
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      if (model === 'stock.picking' && method === 'button_validate') {
        return { res_model: 'stock.backorder.confirmation', res_id: 778, context: {} };
      }
      if (model === 'stock.backorder.confirmation') {
        wizardCalls.push({ model, method, id: ids[0] });
      }
      return true;
    },
    readRecords: async (model: string, ids: number[]) => {
      if (model === 'stock.picking') return [{ id: ids[0], state: 'done' }];
      return [];
    },
    writeRecord: async (model: string, ids: number[], vals: Record<string, unknown>) => {
      if (model === 'stock.move') {
        moveWrites.push({ ids, vals });
      }
      return true;
    },
    populatePickingValidationMetadata: async () => true,
    postModelChatterMessage: async () => 1,
  } as unknown as OdooClient;

  const result = await processBoardIntakePurchaseOrderFulfillment(mockClient, {
    partner_id: 42,
    customer_name: 'Client Multi PO',
    product_id: 205,
    product_name: 'WHITE MDF 18mm',
    quantity: 10,
    actor_name: 'Operator',
    no_backorder: 1,
  });

  assert.ok(result);
  assert.deepEqual(moveWrites[0], { ids: [701], vals: { product_uom_qty: 10, quantity: 10 } });
  assert.deepEqual(moveWrites[1], { ids: [702], vals: { quantity: 0 } });
  assert.deepEqual(wizardCalls, [{ model: 'stock.backorder.confirmation', method: 'process', id: 778 }]);
});

test('buildBoardIntakeChatterHtml renders COMPLETE INTAKE (NO BACKORDER) when noBackorder=true', () => {
  const html = buildBoardIntakeChatterHtml({
    customerName: 'Acme Designs',
    productName: '18mm White MDF',
    quantity: 10,
    qtyNeeded: 20,
    balanceRemaining: 10,
    noBackorder: true,
    moName: 'WH/MO/00100',
  });
  assert.match(html, /COMPLETE INTAKE \(NO BACKORDER\)/);
  assert.doesNotMatch(html, /PARTIAL INTAKE/);
});

test('matchBoardIntakeToClientImmediate updates DB immediately without Odoo wait and closes no-backorder pending process', async () => {
  const intakeId = `test_imm_match_${Date.now()}`;
  const moId = 999456;
  const partnerId = 888456;
  const productId = 777456;

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);
  await upsertPendingShopFloorProcesses([
    {
      id: `test_${moId}_${productId}`,
      process_type: 'board_intake',
      mo_id: moId,
      mo_name: 'WH/MO/999456',
      origin: 'S999456',
      partner_id: partnerId,
      partner_name: 'Matched Immediate Client',
      product_id: productId,
      product_name: '18mm Oak',
      qty_needed: 20,
      qty_reserved: 0,
      qty_missing: 20,
      status: 'pending',
      loaded_at: null,
      loaded_by: null,
      last_synced_at: new Date().toISOString(),
    },
  ]);

  await createBoardIntakeQueueEntry({
    id: intakeId,
    productId,
    productName: '18mm Oak',
    partnerId: 0,
    customerName: 'Pending Client Matching',
    quantity: 10,
    actorName: 'Gate Guard',
    noBackorder: true,
  });

  const prep = await matchBoardIntakeToClientImmediate({
    id: intakeId,
    partnerId,
    customerName: 'Matched Immediate Client',
    matchedBy: 'Supervisor',
    moId,
  });

  assert.equal(prep.customerName, 'Matched Immediate Client');
  assert.equal(prep.loadedRequirements.length, 1);
  assert.equal(prep.loadedRequirements[0].qty_missing, 0);
  assert.equal(prep.loadedRequirements[0].no_backorder_closed, true);

  const saved = await getBoardIntakeQueueEntry(intakeId);
  assert.equal(Number(saved?.partner_id), partnerId);
  assert.equal(saved?.customer_name, 'Matched Immediate Client');
  assert.equal(Number(saved?.no_backorder), 1);

  await execute('DELETE FROM board_intake_queue WHERE id = ?', [intakeId]);
  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [moId]);
});

test('views include instant expecting-more prompt, floating + FAB, and no duplicate match form', () => {
  const boardsView = fs.readFileSync(path.resolve(__dirname, '../views/shop-floor-boards.ejs'), 'utf8');
  assert.match(boardsView, /id="expectingMorePrompt"/);
  assert.match(boardsView, /id="btnExpectingMoreYes"/);
  assert.match(boardsView, /id="btnExpectingMoreNo"/);
  assert.match(boardsView, /id="intakeExpectedQty"/);
  assert.match(boardsView, /id="floatingBoardLogFab"/);

  const publicView = fs.readFileSync(path.resolve(__dirname, '../views/public-board-logs.ejs'), 'utf8');
  const formMatches = publicView.match(/id="publicMatchClientForm"/g) || [];
  assert.equal(formMatches.length, 1, 'public-board-logs.ejs must not have duplicate publicMatchClientForm tags');
});
