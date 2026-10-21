import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMoStockShortageReport,
  renderMoStockShortageReportHtml,
  MoStockShortageReportSummary,
} from './moStockShortageReportService';
import { OdooClient } from './odooClient';

test('renderMoStockShortageReportHtml renders critical alert when board mismatches exist', () => {
  const mockSummary: MoStockShortageReportSummary = {
    generatedAt: new Date().toISOString(),
    totalActiveMosScanned: 5,
    totalMosLackingStock: 2,
    criticalBoardMismatchesCount: 1,
    awaitingBoardIntakeCount: 1,
    pendingReceiptCount: 1,
    unprocuredHardwareCount: 0,
    totalUnapprovedPosCount: 0,
    orders: [
      {
        moId: 101,
        moName: 'WH/MO/00101',
        moState: 'confirmed',
        origin: 'S02182',
        clientId: 42,
        clientName: 'Jane Smith Interiors',
        salespersonName: 'Charles',
        totalComponentsNeeded: 2,
        hasBoardMismatch: true,
        hasAwaitingBoardIntake: false,
        hasPendingReceipt: false,
        hasUnprocuredHardware: false,
        hasUnapprovedPo: false,
        unapprovedPos: [],
        missingComponents: [
          {
            id: 201,
            productId: 501,
            productName: 'WHITE MDF 18mm',
            isBoard: true,
            requiredQty: 10,
            reservedQty: 0,
            missingQty: 10,
            uom: 'Units',
            rootCause: 'board_mismatch',
            badgeLabel: 'WRONG BOARD LOGGED',
            badgeColor: 'danger',
            explanation: 'Client has "WHITE PARTICLE 18mm" logged, but MO requires "WHITE MDF 18mm". Substrate mismatch.',
            mismatchDetails: {
              loggedProductName: 'WHITE PARTICLE 18mm',
              loggedQuantity: 10,
              loggedDate: '2026-10-20',
              discrepancy: 'Substrate mismatch: required MDF vs logged Particle Board',
            },
          },
        ],
      },
    ],
  };

  const html = renderMoStockShortageReportHtml(mockSummary);
  assert.ok(html.includes('CRITICAL ALERT'));
  assert.ok(html.includes('Wrong Type / Size of Board Logged'));
  assert.ok(html.includes('WHITE MDF 18mm'));
  assert.ok(html.includes('WHITE PARTICLE 18mm'));
  assert.ok(html.includes('Jane Smith Interiors'));
  assert.ok(html.includes('WH/MO/00101'));
});

test('renderMoStockShortageReportHtml renders clean banner when 100% of stock is available', () => {
  const mockSummary: MoStockShortageReportSummary = {
    generatedAt: new Date().toISOString(),
    totalActiveMosScanned: 4,
    totalMosLackingStock: 0,
    criticalBoardMismatchesCount: 0,
    awaitingBoardIntakeCount: 0,
    pendingReceiptCount: 0,
    unprocuredHardwareCount: 0,
    totalUnapprovedPosCount: 0,
    orders: [],
  };

  const html = renderMoStockShortageReportHtml(mockSummary);
  assert.ok(html.includes('All Active Manufacturing Orders Have 100% Stock Reserved!'));
  assert.ok(!html.includes('CRITICAL ALERT'));
});

test('generateMoStockShortageReport correctly categorizes shortage causes and filters company 3', async () => {
  const mockClient = {
    searchReadRecords: async (model: string, args: any) => {
      if (model === 'mrp.production') {
        return [
          {
            id: 1,
            name: 'WH/MO/00001',
            state: 'confirmed',
            origin: 'S01001',
            product_id: [100, 'Test Wardrobe'],
            product_qty: 1,
          },
          {
            id: 2,
            name: 'VA/WH/MO/00002', // Company 3 / URBAN VIBE 2 -> Must be excluded!
            state: 'confirmed',
            origin: 'S01002',
            product_id: [100, 'Test Wardrobe'],
            product_qty: 1,
          },
        ];
      }
      if (model === 'sale.order') {
        return [
          {
            name: 'S01001',
            partner_id: [201, 'Test Client Ltd'],
            user_id: [12, 'Charles'],
          },
        ];
      }
      if (model === 'stock.picking') {
        return [
          {
            id: 301,
            name: 'WH/IN/00301',
            partner_id: [401, 'Hardware Supplier Ltd'],
            state: 'assigned',
            scheduled_date: '2026-10-21 10:00:00',
          },
        ];
      }
      if (model === 'stock.move') {
        // Moves for picking 301
        return [
          {
            picking_id: [301, 'WH/IN/00301'],
            product_id: [502, 'Soft Close Slide 450mm'],
            product_uom_qty: 20,
            quantity: 0,
          },
        ];
      }
      return [];
    },
    getBulkManufacturingOrderComponents: async (moIds: number[]) => {
      return [
        {
          id: 11,
          raw_material_production_id: [1, 'WH/MO/00001'],
          product_id: [501, 'WHITE MDF 18mm'],
          product_uom_qty: 8,
          quantity: 0,
          state: 'confirmed',
          forecast_availability: 0,
        },
        {
          id: 12,
          raw_material_production_id: [1, 'WH/MO/00001'],
          product_id: [502, 'Soft Close Slide 450mm'],
          product_uom_qty: 4,
          quantity: 0,
          state: 'confirmed',
          forecast_availability: 0,
        },
        {
          id: 13,
          raw_material_production_id: [1, 'WH/MO/00001'],
          product_id: [503, 'Edge Banding Service White 1mm'], // Service exempt!
          product_uom_qty: 20,
          quantity: 0,
          state: 'confirmed',
          forecast_availability: 0,
        },
      ];
    },
    getVerifiedTargetWarehouse: async () => ({ id: 1, code: 'WH', companyId: 1 }),
    getTargetCompanyIdValue: async () => 1,
  };

  const mockSettings = {
    odoo: {},
    stock: { warehouseId: 1 },
  };

  // Test Case 1: No board logged for client -> flags awaiting_board_intake
  const summaryNoLogged = await generateMoStockShortageReport(mockClient as unknown as OdooClient, {
    forceRefresh: true,
    settings: mockSettings,
    boardIntakes: [],
  });

  assert.equal(summaryNoLogged.totalActiveMosScanned, 1);
  assert.equal(summaryNoLogged.orders.length, 1);

  const order1 = summaryNoLogged.orders[0];
  assert.equal(order1.moName, 'WH/MO/00001');
  assert.equal(order1.clientName, 'Test Client Ltd');
  assert.equal(order1.salespersonName, 'Charles');
  assert.equal(order1.missingComponents.length, 2);

  const boardComp1 = order1.missingComponents.find((c) => c.productName === 'WHITE MDF 18mm');
  assert.ok(boardComp1);
  assert.equal(boardComp1.isBoard, true);
  assert.equal(boardComp1.rootCause, 'awaiting_board_intake');

  const hardwareComp1 = order1.missingComponents.find((c) => c.productName === 'Soft Close Slide 450mm');
  assert.ok(hardwareComp1);
  assert.equal(hardwareComp1.isBoard, false);
  assert.equal(hardwareComp1.rootCause, 'pending_receipt');
  assert.equal(hardwareComp1.receiptDetails?.receiptName, 'WH/IN/00301');

  // Test Case 2: Client has "WHITE PARTICLE 18mm" logged, but MO requires "WHITE MDF 18mm"
  // -> MUST flag critical board mismatch (substrate mismatch)!
  const mockBoardIntakes = [
    {
      id: 'intake-1',
      product_id: 999,
      product_name: 'WHITE PARTICLE 18mm',
      partner_id: 201, // Test Client Ltd
      customer_name: 'Test Client Ltd',
      quantity: 8,
      status: 'synced',
      created_at: '2026-10-20 14:00:00',
    },
  ];

  const summaryWithMismatch = await generateMoStockShortageReport(mockClient as unknown as OdooClient, {
    forceRefresh: true,
    settings: mockSettings,
    boardIntakes: mockBoardIntakes,
  });

  assert.equal(summaryWithMismatch.criticalBoardMismatchesCount, 1);
  const order2 = summaryWithMismatch.orders[0];
  assert.equal(order2.hasBoardMismatch, true);

  const boardComp2 = order2.missingComponents.find((c) => c.productName === 'WHITE MDF 18mm');
  assert.ok(boardComp2);
  assert.equal(boardComp2.rootCause, 'board_mismatch');
  assert.equal(boardComp2.badgeLabel, 'WRONG BOARD LOGGED');
  assert.ok(boardComp2.explanation.includes('WHITE PARTICLE 18mm'));
  assert.ok(boardComp2.explanation.includes('Substrate mismatch'));
  assert.ok(boardComp2.mismatchDetails);
  assert.equal(boardComp2.mismatchDetails?.loggedProductName, 'WHITE PARTICLE 18mm');
});

test('renderMoStockShortageReportHtml renders amber alert when unapproved POs exist for active MOs', () => {
  const mockSummary: MoStockShortageReportSummary = {
    generatedAt: new Date().toISOString(),
    totalActiveMosScanned: 3,
    totalMosLackingStock: 1,
    criticalBoardMismatchesCount: 0,
    awaitingBoardIntakeCount: 1,
    pendingReceiptCount: 0,
    unprocuredHardwareCount: 0,
    totalUnapprovedPosCount: 1,
    orders: [
      {
        moId: 105,
        moName: 'WH/MO/00105',
        moState: 'progress',
        origin: 'S02200',
        clientId: 50,
        clientName: 'Modern Spaces Ltd',
        salespersonName: 'Charles',
        totalComponentsNeeded: 1,
        hasBoardMismatch: false,
        hasAwaitingBoardIntake: true,
        hasPendingReceipt: false,
        hasUnprocuredHardware: false,
        hasUnapprovedPo: true,
        unapprovedPos: [
          {
            id: 88,
            name: 'P00088',
            state: 'to approve',
            supplierName: 'Hardware Depot',
          },
        ],
        missingComponents: [
          {
            id: 301,
            productId: 601,
            productName: 'GREY MDF 18mm',
            isBoard: true,
            requiredQty: 5,
            reservedQty: 0,
            missingQty: 5,
            uom: 'Units',
            rootCause: 'awaiting_board_intake',
            badgeLabel: 'BOARD NOT LOGGED',
            badgeColor: 'info',
            explanation: 'Client has no board logged yet.',
          },
        ],
      },
    ],
  };

  const html = renderMoStockShortageReportHtml(mockSummary);
  assert.ok(html.includes('PO APPROVAL REQUIRED'));
  assert.ok(html.includes('P00088'));
  assert.ok(html.includes('to approve'));
  assert.ok(html.includes('Modern Spaces Ltd'));
  assert.ok(html.includes('Save Schedule &amp; Recipients') || html.includes('Save Schedule & Recipients'));
});

test('checkAndAlertUnapprovedPurchaseOrders alerts Charles and Leoivard and respects cooldown', async () => {
  const chatterCalls: Array<{ model: string; id: number; message: string; partnerIds?: number[] }> = [];

  const mockClient = {
    getTargetCompanyIdValue: async () => 1,
    searchReadRecords: async (model: string, args: any) => {
      if (model === 'purchase.order') {
        return [
          {
            id: 77,
            name: 'P00077',
            state: 'to approve',
            origin: 'S02199',
            partner_id: [301, 'Board World Ltd'],
          },
        ];
      }
      if (model === 'res.users') {
        const domainStr = JSON.stringify(args?.domain || []);
        if (domainStr.includes('Charles')) {
          return [{ id: 10, name: 'Charles', login: 'charles', partner_id: [110, 'Charles'] }];
        }
        if (domainStr.includes('Leoivard')) {
          return [{ id: 20, name: 'Leoivard Ongule', login: 'leoivard', partner_id: [120, 'Leoivard Ongule'] }];
        }
      }
      return [];
    },
    postModelChatterMessage: async (model: string, id: number, message: string, partnerIds?: number[]) => {
      chatterCalls.push({ model, id, message, partnerIds });
      return true;
    },
  };

  const activeMos = [
    {
      id: 55,
      name: 'WH/MO/00055',
      state: 'progress',
      origin: 'S02199',
    },
  ];

  const soPartnerMap = new Map([
    ['S02199', { partnerId: 401, partnerName: 'Acme Interiors', salesperson: 'Charles' }],
  ]);

  const { checkAndAlertUnapprovedPurchaseOrders, unapprovedPoAlertCooldown } = await import('./moStockShortageReportService');

  // Clear any existing cooldown for clean test
  unapprovedPoAlertCooldown.clear();

  // 1st Run: Should alert both PO and MO
  const result = await checkAndAlertUnapprovedPurchaseOrders(
    mockClient as unknown as OdooClient,
    activeMos,
    soPartnerMap,
  );

  assert.equal(result.size, 1);
  const unapprovedPos = result.get(55);
  assert.ok(unapprovedPos);
  assert.equal(unapprovedPos.length, 1);
  assert.equal(unapprovedPos[0].name, 'P00077');
  assert.equal(unapprovedPos[0].state, 'to approve');

  // Verify chatter calls were made
  assert.equal(chatterCalls.length, 2);
  const poChatter = chatterCalls.find((c) => c.model === 'purchase.order');
  const moChatter = chatterCalls.find((c) => c.model === 'mrp.production');

  assert.ok(poChatter);
  assert.equal(poChatter.id, 77);
  assert.ok(poChatter.message.includes('PO Approval Check Required'));
  assert.ok(poChatter.message.includes('Charles'));
  assert.ok(poChatter.message.includes('Leoivard'));
  assert.ok(poChatter.message.includes('WH/MO/00055'));
  assert.ok(poChatter.message.includes('IN PROGRESS'));
  assert.deepEqual(poChatter.partnerIds, [110, 120]);

  assert.ok(moChatter);
  assert.equal(moChatter.id, 55);
  assert.ok(moChatter.message.includes('P00077'));
  assert.ok(moChatter.message.includes('to approve'));

  // 2nd Run immediately: Cooldown should prevent redundant chatter calls
  chatterCalls.length = 0;
  const result2 = await checkAndAlertUnapprovedPurchaseOrders(
    mockClient as unknown as OdooClient,
    activeMos,
    soPartnerMap,
  );
  assert.equal(result2.size, 1);
  assert.equal(chatterCalls.length, 0); // Suppressed by 24h cooldown!

  // 3rd Run with forceAlert: true: Should bypass cooldown
  const result3 = await checkAndAlertUnapprovedPurchaseOrders(
    mockClient as unknown as OdooClient,
    activeMos,
    soPartnerMap,
    { forceAlert: true },
  );
  assert.equal(result3.size, 1);
  assert.equal(chatterCalls.length, 2); // Dispatched again!
});
