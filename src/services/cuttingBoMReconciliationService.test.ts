import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterSingleBoardComponentForCuttingMo,
  selectBestBoardComponent,
  clearDuplicateBomNotifiedCache,
  notifyLeoivardDuplicateBoardComponent,
  BoardComponentMove,
  CuttingMoInfo,
} from './cuttingBoMReconciliationService';
import { pruneStalePendingProcessesForActiveMos } from '../models/repositories';
import { queryOne, execute } from '../models/db';

test('selectBestBoardComponent: selects single best component matching Job Summary sheet materials', () => {
  const moProductName = 'Cutting Backer White MDF 3mm';
  const boardMoves: BoardComponentMove[] = [
    {
      id: 101,
      product_id: [501, 'Backer White MDF 3mm'],
      product_uom_qty: 4,
      quantity: 0,
    },
    {
      id: 102,
      product_id: [502, 'Royal Teak MDF 18mm'],
      product_uom_qty: 7,
      quantity: 0,
    },
  ];

  const sheetMaterials = [
    {
      name: 'Backer White MDF 3mm',
      thickness_mm: 3,
      sheets: 4,
      panels: 8,
      length_mm: 2440,
      width_mm: 1220,
    },
  ];

  const result = selectBestBoardComponent({
    moProductName,
    moQty: 4,
    boardMoves,
    sheetMaterials,
  });

  assert.equal(result.chosenMove.id, 101, 'Should select Backer White MDF 3mm move matching Job Summary');
  assert.equal(result.alignedQty, 4, 'Should align quantity to 4 sheets');
  assert.equal(result.matchedMaterialName, 'Backer White MDF 3mm');
});

test('selectBestBoardComponent: falls back to cutting MO product name when no Job Summary', () => {
  const moProductName = 'Cutting Harbour Grey waterproof 18mm';
  const boardMoves: BoardComponentMove[] = [
    {
      id: 201,
      product_id: [601, 'White MDF 18mm'],
      product_uom_qty: 9,
      quantity: 0,
    },
    {
      id: 202,
      product_id: [602, 'Harbour Grey waterproof 18mm'],
      product_uom_qty: 9,
      quantity: 0,
    },
  ];

  const result = selectBestBoardComponent({
    moProductName,
    moQty: 9,
    boardMoves,
    sheetMaterials: [],
  });

  assert.equal(result.chosenMove.id, 202, 'Should select Harbour Grey waterproof 18mm matching cutting product');
  assert.equal(result.alignedQty, 9);
});

test('filterSingleBoardComponentForCuttingMo: returns only 1 component for cutting MO with 2 components and alerts Leoivard', async () => {
  clearDuplicateBomNotifiedCache();

  const mo: CuttingMoInfo = {
    id: 99991,
    name: 'WH/MO/99991',
    origin: 'SO-TEST-001',
    product_id: [701, 'Cutting Backer White MDF 3mm'],
    product_qty: 4,
  };

  const boardMoves: BoardComponentMove[] = [
    {
      id: 301,
      product_id: [801, 'Backer White MDF 3mm'],
      product_uom_qty: 4,
      quantity: 0,
      state: 'confirmed',
    },
    {
      id: 302,
      product_id: [802, 'Royal Teak MDF 18mm'],
      product_uom_qty: 7,
      quantity: 0,
      state: 'confirmed',
    },
  ];

  const postedChatters: Array<{ model: string; id: number; message: string; partnerIds?: number[] }> = [];

  const mockClient: any = {
    postModelChatterMessage: async (model: string, id: number, message: string, partnerIds?: number[]) => {
      postedChatters.push({ model, id, message, partnerIds });
      return true;
    },
    searchReadRecords: async (model: string) => {
      if (model === 'res.users') {
        return [{ id: 88, name: 'Leoivard Ongule', partner_id: [188, 'Leoivard Ongule'] }];
      }
      return [];
    },
  };

  const filtered = await filterSingleBoardComponentForCuttingMo({
    mo,
    boardMoves,
    client: mockClient,
    parsedJobSummary: {
      items: [],
      sectionFound: true,
      sectionText: '',
      rawText: '',
      logs: [],
      sheetMaterials: [
        {
          name: 'Backer White MDF 3mm',
          thickness_mm: 3,
          sheets: 4,
          panels: 8,
          length_mm: 2440,
          width_mm: 1220,
        },
      ],
    },
  });

  assert.equal(filtered.length, 1, 'Cutting BoM must strictly return exactly 1 board component move');
  assert.equal(filtered[0].id, 301, 'Must choose Backer White MDF 3mm');
  assert.equal(filtered[0].product_uom_qty, 4, 'Must align quantity with Job Summary');

  // Verify Leoivard was notified in chatter
  assert.equal(postedChatters.length, 1, 'Should post a chatter notification on MO');
  assert.equal(postedChatters[0].model, 'mrp.production');
  assert.equal(postedChatters[0].id, 99991);
  assert.ok(postedChatters[0].message.includes('Duplicate Board Component Detected'));
  assert.deepEqual(postedChatters[0].partnerIds, [188], 'Must cc Leoivard Ongule');
});

test('filterSingleBoardComponentForCuttingMo: leaves non-cutting products untouched', async () => {
  const mo: CuttingMoInfo = {
    id: 99992,
    name: 'WH/MO/99992',
    origin: 'SO-TEST-002',
    product_id: [702, 'Assembly Cabinet Unit'],
    product_qty: 1,
  };

  const boardMoves: BoardComponentMove[] = [
    {
      id: 401,
      product_id: [801, 'Backer White MDF 3mm'],
      product_uom_qty: 2,
    },
    {
      id: 402,
      product_id: [802, 'White MDF 18mm'],
      product_uom_qty: 5,
    },
  ];

  const filtered = await filterSingleBoardComponentForCuttingMo({
    mo,
    boardMoves,
  });

  assert.equal(filtered.length, 2, 'Non-cutting MOs can legitimately use multiple board components');
});

test('filterSingleBoardComponentForCuttingMo: deduplicates Leoivard notifications within 24h', async () => {
  clearDuplicateBomNotifiedCache();

  const mo: CuttingMoInfo = {
    id: 99993,
    name: 'WH/MO/99993',
    origin: 'SO-TEST-003',
    product_id: [703, 'Cutting Backer White MDF 3mm'],
    product_qty: 5,
  };

  const boardMoves: BoardComponentMove[] = [
    { id: 501, product_id: [801, 'Backer White MDF 3mm'], product_uom_qty: 5 },
    { id: 502, product_id: [802, 'White MDF 18mm'], product_uom_qty: 5 },
  ];

  let postCount = 0;
  const mockClient: any = {
    postModelChatterMessage: async () => {
      postCount++;
      return true;
    },
    searchReadRecords: async () => [{ id: 88, name: 'Leoivard Ongule', partner_id: [188, 'Leoivard Ongule'] }],
  };

  // First call -> triggers notification
  await filterSingleBoardComponentForCuttingMo({ mo, boardMoves, client: mockClient });
  assert.equal(postCount, 1, 'First call must trigger notification');

  // Second call immediately -> suppressed by 24h cooldown
  await filterSingleBoardComponentForCuttingMo({ mo, boardMoves, client: mockClient });
  assert.equal(postCount, 1, 'Second call must be suppressed by cooldown');
});

test('pruneStalePendingProcessesForActiveMos: immediately deletes cancelled MOs so they no longer need stock', async () => {
  const cancelledMoId = 88881;
  const cancelledRowId = `${cancelledMoId}_901`;

  // Insert a test pending process for a cancelled MO
  await execute(
    `INSERT INTO shop_floor_pending_processes (
      id, process_type, mo_id, mo_name, origin, partner_id, partner_name,
      product_id, product_name, qty_needed, qty_reserved, qty_missing,
      status, is_mo_closed, created_at, updated_at
    ) VALUES (?, 'board_intake', ?, 'WH/MO/88881', 'SO88881', 10, 'Test Customer',
      901, 'White MDF 18mm', 10, 0, 10, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )`,
    [cancelledRowId, cancelledMoId],
  );

  // Check it was inserted
  const before = await queryOne<{ id: string }>(
    `SELECT id FROM shop_floor_pending_processes WHERE id = ?`,
    [cancelledRowId],
  );
  assert.ok(before, 'Pending process must exist before pruning');

  // Prune with cancelledMoIds containing cancelledMoId
  await pruneStalePendingProcessesForActiveMos(
    [], // activeMoIds
    [], // validKeys
    [], // poCoveredKeys
    [cancelledMoId], // cancelledMoIds
  );

  // Check it was completely purged
  const after = await queryOne<{ id: string }>(
    `SELECT id FROM shop_floor_pending_processes WHERE id = ?`,
    [cancelledRowId],
  );
  assert.equal(after, null, 'Cancelled MO must be deleted and not linger needing stock');
});

test('upsertPendingShopFloorProcesses: adjusts qty_needed and qty_missing when MO quantity is reduced from 10 to 5', async () => {
  const { upsertPendingShopFloorProcesses } = await import('../models/repositories');

  const moId = 88882;
  const rowId = `${moId}_902`;

  // Initially required 10 boards
  await upsertPendingShopFloorProcesses([
    {
      id: rowId,
      process_type: 'board_intake',
      mo_id: moId,
      mo_name: 'WH/MO/88882',
      origin: 'SO88882',
      partner_id: 11,
      partner_name: 'Customer A',
      product_id: 902,
      product_name: 'Dark Grey MDF 18mm',
      qty_needed: 10,
      qty_reserved: 0,
      qty_missing: 10,
      status: 'pending',
      loaded_at: null,
      loaded_by: null,
      is_mo_closed: false,
      last_synced_at: new Date().toISOString(),
    },
  ]);

  const initial = await queryOne<{ qty_needed: number; qty_missing: number }>(
    `SELECT qty_needed, qty_missing FROM shop_floor_pending_processes WHERE id = ?`,
    [rowId],
  );
  assert.equal(Number(initial?.qty_needed), 10);
  assert.equal(Number(initial?.qty_missing), 10);

  // Operator edits in Odoo and reduces quantity to 5
  await upsertPendingShopFloorProcesses([
    {
      id: rowId,
      process_type: 'board_intake',
      mo_id: moId,
      mo_name: 'WH/MO/88882',
      origin: 'SO88882',
      partner_id: 11,
      partner_name: 'Customer A',
      product_id: 902,
      product_name: 'Dark Grey MDF 18mm',
      qty_needed: 5,
      qty_reserved: 0,
      qty_missing: 5,
      status: 'pending',
      loaded_at: null,
      loaded_by: null,
      is_mo_closed: false,
      last_synced_at: new Date().toISOString(),
    },
  ]);

  const adjusted = await queryOne<{ qty_needed: number; qty_missing: number }>(
    `SELECT qty_needed, qty_missing FROM shop_floor_pending_processes WHERE id = ?`,
    [rowId],
  );
  assert.equal(Number(adjusted?.qty_needed), 5, 'Must recognize quantity reduction and adjust qty_needed to 5');
  assert.equal(Number(adjusted?.qty_missing), 5, 'Must recognize quantity reduction and adjust qty_missing to 5');

  // Clean up test row
  await execute(`DELETE FROM shop_floor_pending_processes WHERE id = ?`, [rowId]);
});
