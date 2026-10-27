import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCuttingProductOrWorkOrder,
  extractThicknessMm,
  findMatchingSheetMaterial,
  determineTargetCuttingQuantity,
  reconcileWorkOrderQuantitiesForMo,
} from './workOrderQuantityReconciliationService';
import { ParsedJobSummaryResult, ParsedSheetMaterial, PendingShopFloorProcess } from '../models/types';
import { OdooClient } from './odooClient';

test('isCuttingProductOrWorkOrder correctly identifies cutting products and operations', () => {
  // Positive cases (MO product names)
  assert.equal(isCuttingProductOrWorkOrder('Cutting White Mdf 18mm 6 panels'), true);
  assert.equal(isCuttingProductOrWorkOrder('Cutting White MDF 18mm'), true);
  assert.equal(isCuttingProductOrWorkOrder('Cutting - White MDF 18mm'), true);
  assert.equal(isCuttingProductOrWorkOrder('CUTTING WHITE MDF 18MM'), true);
  assert.equal(isCuttingProductOrWorkOrder('Cutting Chipboard 16mm'), true);
  assert.equal(isCuttingProductOrWorkOrder('Cut panels'), true);

  // Positive cases (Work order operations)
  assert.equal(isCuttingProductOrWorkOrder(undefined, 'Table Saw Cutting'), true);
  assert.equal(isCuttingProductOrWorkOrder(undefined, 'Panel Saw Operation'), true);
  assert.equal(isCuttingProductOrWorkOrder(undefined, 'Sawing and grooving'), true);

  // Negative cases
  assert.equal(isCuttingProductOrWorkOrder('Edge Banding Service White'), false);
  assert.equal(isCuttingProductOrWorkOrder('Hinges and Screws'), false);
  assert.equal(isCuttingProductOrWorkOrder('Transport Delivery'), false);
  assert.equal(isCuttingProductOrWorkOrder(undefined, 'Edge Banding Area'), false);
});

test('extractThicknessMm extracts thickness reliably', () => {
  assert.equal(extractThicknessMm('Cutting White Mdf 18mm 6 panels'), 18);
  assert.equal(extractThicknessMm('WHITE MDF 18 mm'), 18);
  assert.equal(extractThicknessMm('Particle Board 16mm'), 16);
  assert.equal(extractThicknessMm('Plywood 9mm'), 9);
  assert.equal(extractThicknessMm('No thickness board'), null);
  assert.equal(extractThicknessMm(null), null);
});

test('findMatchingSheetMaterial matches MO product and components against Job Summary', () => {
  const sheetMaterials: ParsedSheetMaterial[] = [
    {
      name: 'WHITE MDF',
      thickness_mm: 18,
      sheets: 4,
      panels: 4,
      length_mm: 2440,
      width_mm: 1220,
    },
    {
      name: 'OAK VENEER',
      thickness_mm: 18,
      sheets: 2,
      panels: 2,
      length_mm: 2440,
      width_mm: 1220,
    },
  ];

  // Case 1: Match from MO product name ("Cutting White Mdf 18mm 6 panels")
  const match1 = findMatchingSheetMaterial({
    moProductName: 'Cutting White Mdf 18mm 6 panels',
    sheetMaterials,
  });
  assert.ok(match1);
  assert.equal(match1.material.name, 'WHITE MDF');
  assert.equal(match1.material.sheets, 4);

  // Case 2: Match from raw material component move
  const match2 = findMatchingSheetMaterial({
    moProductName: 'Cutting Operation',
    componentNames: ['OAK VENEER 18mm', 'Contact Adhesive'],
    sheetMaterials,
  });
  assert.ok(match2);
  assert.equal(match2.material.name, 'OAK VENEER');
  assert.equal(match2.material.sheets, 2);

  // Case 3: Single sheet material fallback
  const singleMaterial: ParsedSheetMaterial[] = [
    {
      name: 'GREY PARTICLE',
      thickness_mm: 16,
      sheets: 5,
      panels: 5,
      length_mm: 2440,
      width_mm: 1220,
    },
  ];
  const match3 = findMatchingSheetMaterial({
    moProductName: 'Generic Cutting Job',
    sheetMaterials: singleMaterial,
  });
  assert.ok(match3);
  assert.equal(match3.material.name, 'GREY PARTICLE');
  assert.equal(match3.material.sheets, 5);
});

test('determineTargetCuttingQuantity derives required sheets/panels accurately', () => {
  const material: ParsedSheetMaterial = {
    name: 'WHITE MDF',
    thickness_mm: 18,
    sheets: 4,
    panels: 4,
    length_mm: 2440,
    width_mm: 1220,
  };

  const parsedJobSummary: ParsedJobSummaryResult = {
    items: [],
    sectionFound: true,
    sectionText: '',
    rawText: '',
    logs: [],
    optimizedSheets: 4,
    totalPanels: 4,
    sheetMaterials: [material],
  };

  // Case 1: Primary from matched material sheets
  const qty1 = determineTargetCuttingQuantity({
    matchedMaterial: material,
    parsedJobSummary,
  });
  assert.equal(qty1, 4);

  // Case 2: Approved PO quantity confirms 4
  const qty2 = determineTargetCuttingQuantity({
    matchedMaterial: material,
    parsedJobSummary,
    approvedPoQuantity: 4,
  });
  assert.equal(qty2, 4);

  // Case 3: Fallback to optimizedSheets when material has no explicit sheet count
  const qty3 = determineTargetCuttingQuantity({
    matchedMaterial: { ...material, sheets: null, panels: null },
    parsedJobSummary: { ...parsedJobSummary, optimizedSheets: 3 },
  });
  assert.equal(qty3, 3);
});

test('reconcileWorkOrderQuantitiesForMo updates MO, work order, and component stock moves when Sales Order has 6 but Job Summary has 4', async () => {
  const writtenRecords: Array<{ model: string; ids: number[]; values: Record<string, unknown> }> = [];
  const calledMethods: Array<{ model: string; method: string; ids: number[] }> = [];
  const chatterMessages: Array<{ model: string; recordId: number; message: string }> = [];

  // Mock OdooClient
  const mockClient = {
    searchReadRecords: async (model: string, options: any) => {
      if (model === 'mrp.production') {
        return [
          {
            id: 501,
            name: 'WH/MO/00501',
            product_id: [1052, 'Cutting White Mdf 18mm 6 panels'],
            product_qty: 6,
            qty_producing: 6,
            qty_produced: 0,
            state: 'confirmed',
            origin: 'S02182',
            company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
          },
        ];
      }
      if (model === 'stock.move') {
        return [
          {
            id: 881,
            product_id: [843, 'WHITE MDF 18mm'],
            product_uom_qty: 6,
            state: 'confirmed',
          },
        ];
      }
      if (model === 'mrp.workorder') {
        return [
          {
            id: 701,
            name: 'Table Saw Cutting',
            qty_production: 6,
            qty_producing: 6,
            state: 'ready',
          },
        ];
      }
      if (model === 'sale.order') {
        return [{ id: 301, name: 'S02182' }];
      }
      if (model === 'purchase.order') {
        return [];
      }
      return [];
    },
    writeRecord: async (model: string, ids: number[], values: Record<string, unknown>) => {
      writtenRecords.push({ model, ids, values });
      return true;
    },
    callRecordMethod: async (model: string, method: string, ids: number[]) => {
      calledMethods.push({ model, method, ids });
      return true;
    },
    postModelChatterMessage: async (model: string, recordId: number, message: string) => {
      chatterMessages.push({ model, recordId, message });
      return 1;
    },
  } as unknown as OdooClient;

  const parsedJobSummary: ParsedJobSummaryResult = {
    items: [],
    sectionFound: true,
    sectionText: '',
    rawText: '',
    logs: [],
    optimizedSheets: 4,
    totalPanels: 4,
    sheetMaterials: [
      {
        name: 'WHITE MDF',
        thickness_mm: 18,
        sheets: 4,
        panels: 4,
        length_mm: 2440,
        width_mm: 1220,
      },
    ],
  };

  const result = await reconcileWorkOrderQuantitiesForMo(mockClient, 501, {
    parsedJobSummary,
    soId: 301,
    soName: 'S02182',
  });

  assert.ok(result);
  assert.equal(result.actionTaken, 'updated_quantities');
  assert.equal(result.previousQty, 6);
  assert.equal(result.updatedQty, 4);
  assert.equal(result.workordersUpdated, 1);
  assert.equal(result.componentsUpdated, 1);

  // Verify mrp.production was written with product_qty = 4 and qty_producing = 4
  const moWrite = writtenRecords.find((w) => w.model === 'mrp.production');
  assert.ok(moWrite);
  assert.deepEqual(moWrite.ids, [501]);
  assert.equal(moWrite.values.product_qty, 4);
  assert.equal(moWrite.values.qty_producing, 4);

  // Verify mrp.workorder was written with qty_production = 4 and qty_producing = 4
  const woWrite = writtenRecords.find((w) => w.model === 'mrp.workorder');
  assert.ok(woWrite);
  assert.deepEqual(woWrite.ids, [701]);
  assert.equal(woWrite.values.qty_production, 4);
  assert.equal(woWrite.values.qty_producing, 4);

  // Verify stock.move was written with product_uom_qty = 4
  const moveWrite = writtenRecords.find((w) => w.model === 'stock.move');
  assert.ok(moveWrite);
  assert.deepEqual(moveWrite.ids, [881]);
  assert.equal(moveWrite.values.product_uom_qty, 4);

  // Verify action_assign was called on mrp.production
  const assignCall = calledMethods.find((c) => c.model === 'mrp.production' && c.method === 'action_assign');
  assert.ok(assignCall);
  assert.deepEqual(assignCall.ids, [501]);

  // Verify chatter notes were posted on MO and SO
  assert.ok(chatterMessages.some((c) => c.model === 'mrp.production' && c.recordId === 501));
  assert.ok(chatterMessages.some((c) => c.model === 'sale.order' && c.recordId === 301));
});

test('reconcileWorkOrderQuantitiesForMo skips closed orders and excluded company', async () => {
  // Case 1: Closed MO
  const closedMoClient = {
    searchReadRecords: async (model: string) => {
      if (model === 'mrp.production') {
        return [
          {
            id: 502,
            name: 'WH/MO/00502',
            product_id: [1052, 'Cutting White Mdf 18mm'],
            product_qty: 6,
            state: 'done',
            company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
          },
        ];
      }
      return [];
    },
  } as unknown as OdooClient;

  const resClosed = await reconcileWorkOrderQuantitiesForMo(closedMoClient, 502);
  assert.ok(resClosed);
  assert.equal(resClosed.actionTaken, 'skipped_closed_order');

  // Case 2: Excluded Company (Company 3, URBAN VIBE 2)
  const excludedCompanyClient = {
    searchReadRecords: async (model: string) => {
      if (model === 'mrp.production') {
        return [
          {
            id: 503,
            name: 'VA/WH/MO/00503',
            product_id: [1052, 'Cutting White Mdf 18mm'],
            product_qty: 6,
            state: 'confirmed',
            company_id: [3, 'URBAN VIBE 2'],
          },
        ];
      }
      return [];
    },
  } as unknown as OdooClient;

  const resExcluded = await reconcileWorkOrderQuantitiesForMo(excludedCompanyClient, 503);
  assert.ok(resExcluded);
  assert.equal(resExcluded.actionTaken, 'skipped_excluded_company');
});

test('Artec Interiors Job Summary 61: correctly matches 6mm, 9mm, and 18mm MOs without scrambling quantities', () => {
  const sheetMaterials: ParsedSheetMaterial[] = [
    {
      name: '6MM PLY',
      thickness_mm: 6,
      sheets: 2,
      panels: 18,
      length_mm: 2440,
      width_mm: 1220,
    },
    {
      name: '9MM PLY',
      thickness_mm: 9,
      sheets: 4,
      panels: 9,
      length_mm: 2440,
      width_mm: 1220,
    },
    {
      name: 'CAPPUCCINO WATERPROOF',
      thickness_mm: 18,
      sheets: 5,
      panels: 40,
      length_mm: 2440,
      width_mm: 1220,
    },
    {
      name: 'DARK GREY MDF',
      thickness_mm: 18,
      sheets: 5,
      panels: 56,
      length_mm: 2440,
      width_mm: 1220,
    },
    {
      name: 'WHITE MDF',
      thickness_mm: 16,
      sheets: 19,
      panels: 164,
      length_mm: 2440,
      width_mm: 1220,
    },
  ];

  // MO 1: WH/MO/05554 (Cutting White Mdf 6mm, qty 2)
  const match6mm = findMatchingSheetMaterial({
    moProductName: 'Cutting White Mdf 6mm',
    sheetMaterials,
    currentMoQty: 2,
  });
  assert.ok(match6mm);
  assert.equal(match6mm.material.name, '6MM PLY');
  assert.equal(match6mm.material.sheets, 2);

  // MO 2: WH/MO/05555 (Cutting White MDF 9mm, qty 4)
  const match9mm = findMatchingSheetMaterial({
    moProductName: 'Cutting White MDF 9mm',
    sheetMaterials,
    currentMoQty: 4,
    excludedMaterialNames: [match6mm.material.name],
  });
  assert.ok(match9mm);
  assert.equal(match9mm.material.name, '9MM PLY');
  assert.equal(match9mm.material.sheets, 4);

  // MO 3: WH/MO/05558 (Cutting White MDF 18mm, qty 19)
  const match18mm = findMatchingSheetMaterial({
    moProductName: 'Cutting White MDF 18mm',
    sheetMaterials,
    currentMoQty: 19,
    excludedMaterialNames: [match6mm.material.name, match9mm.material.name],
  });
  assert.ok(match18mm);
  assert.equal(match18mm.material.name, 'WHITE MDF');
  assert.equal(match18mm.material.sheets, 19);
});

test('reconcileWorkOrderQuantitiesForMo updates shop_floor_pending_processes and fulfills requirement when logged boards satisfy new target', async () => {
  const { execute, queryOne } = await import('../models/db');
  const { upsertPendingShopFloorProcesses, getPendingShopFloorProcesses } = await import('../models/repositories');

  const testMoId = 6235;
  const testProdId = 294;
  const key = `${testMoId}_${testProdId}`;

  await execute('DELETE FROM shop_floor_pending_processes WHERE mo_id = ?', [testMoId]);

  // Seed pending process: MO originally needed 8 boards, 6 were logged (leaving 2 balance unlogged)
  const initialPending: PendingShopFloorProcess = {
    id: key,
    process_type: 'board_intake',
    mo_id: testMoId,
    mo_name: 'WH/MO/05664',
    origin: 'S03686',
    partner_id: 539,
    partner_name: 'PAMBA INTERIORS',
    product_id: testProdId,
    product_name: 'Backer White MDF 3mm',
    qty_needed: 8,
    qty_reserved: 6,
    qty_missing: 2,
    status: 'pending',
    loaded_at: null,
    loaded_by: null,
    last_synced_at: new Date().toISOString(),
  };

  await upsertPendingShopFloorProcesses([initialPending]);

  // Verify initially pending
  const before = await getPendingShopFloorProcesses({ status: 'pending' });
  const pendingBefore = before.find((p) => p.id === key);
  assert.ok(pendingBefore);
  assert.equal(pendingBefore.qty_needed, 8);
  assert.equal(pendingBefore.qty_reserved, 6);
  assert.equal(pendingBefore.qty_missing, 2);

  // Mock OdooClient for MO 6235 currently having product_qty = 8
  const mockClient = {
    searchReadRecords: async (model: string) => {
      if (model === 'mrp.production') {
        return [
          {
            id: testMoId,
            name: 'WH/MO/05664',
            product_id: [597, 'Cutting Backer White Mdf 3mm'],
            product_qty: 8,
            state: 'confirmed',
            origin: 'S03686',
            move_raw_ids: [62882],
            company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'],
          },
        ];
      }
      if (model === 'mrp.workorder') {
        return [
          {
            id: 5801,
            name: 'PAMBA INTERIORS - Cutting Backer White Mdf 3mm',
            qty_production: 8,
            qty_producing: 0,
            state: 'ready',
          },
        ];
      }
      if (model === 'stock.move') {
        return [
          {
            id: 62882,
            product_id: [testProdId, 'Backer White MDF 3mm'],
            product_uom_qty: 8,
            quantity: 0,
            state: 'confirmed',
          },
        ];
      }
      return [];
    },
    readRecords: async () => [],
    writeRecord: async () => true,
    callRecordMethod: async () => true,
    postModelChatterMessage: async () => 1,
  } as unknown as OdooClient;

  const parsedJobSummary: ParsedJobSummaryResult = {
    items: [],
    sectionFound: true,
    sectionText: '',
    rawText: '',
    logs: [],
    optimizedSheets: 4,
    totalPanels: 4,
    sheetMaterials: [
      {
        name: 'BACKER WHITE',
        thickness_mm: 3,
        sheets: 4,
        panels: 4,
        length_mm: 2440,
        width_mm: 1220,
      },
    ],
  };

  // Run reconciliation
  const result = await reconcileWorkOrderQuantitiesForMo(mockClient, testMoId, {
    parsedJobSummary,
    soId: 3837,
    soName: 'S03686',
  });

  assert.ok(result);
  assert.equal(result.actionTaken, 'updated_quantities');
  assert.equal(result.previousQty, 8);
  assert.equal(result.updatedQty, 4);

  // Check database state: shop_floor_pending_processes must now have qty_needed = 4, qty_missing = 0, status = 'loaded'
  const rowAfter = await queryOne<{
    qty_needed: number;
    qty_reserved: number;
    qty_missing: number;
    status: string;
  }>('SELECT qty_needed, qty_reserved, qty_missing, status FROM shop_floor_pending_processes WHERE id = ?', [key]);

  assert.ok(rowAfter);
  assert.equal(rowAfter.qty_needed, 4, 'Target requirement must be adjusted to 4');
  assert.equal(rowAfter.qty_reserved, 4, 'Reserved quantity capped at required 4');
  assert.equal(rowAfter.qty_missing, 0, 'No balance missing since 6 were logged for 4 needed');
  assert.equal(rowAfter.status, 'loaded', 'Status must transition to loaded');

  // Verify it is no longer returned in pending list for Board Needed page
  const afterPending = await getPendingShopFloorProcesses({ status: 'pending' });
  assert.ok(!afterPending.some((p) => p.id === key), 'Process must disappear from pending list on boards needed page');
});

