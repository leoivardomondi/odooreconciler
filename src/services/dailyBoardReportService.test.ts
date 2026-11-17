import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DailyBoardReportSummary,
  renderDailyBoardReportPdf,
} from './dailyBoardReportService';

test('dailyBoardReportService: renderDailyBoardReportPdf generates valid PDF with purchased and client sections', async () => {
  const mockReport: DailyBoardReportSummary = {
    reportDate: '2026-11-17',
    reportDateFormatted: 'Tuesday, 17 Nov 2026',
    companyId: 1,
    companyName: 'Urban Vibe Interior Design LTD',
    generatedAt: new Date().toISOString(),
    totalClientsWithOrders: 2,
    totalConfirmedMos: 3,
    totalBoardsNeeded: 45,
    totalBoardsLoggedToday: 20,
    totalBoardsNotYetLogged: 25,
    purchasedTotals: {
      expected: 25,
      logged: 10,
      notYetLogged: 15,
      activePoCount: 2,
      unapprovedPoCount: 1,
      pendingDeliveryCount: 1,
    },
    clientSupplyTotals: {
      expected: 20,
      logged: 10,
      notYetLogged: 10,
    },
    unknownOwnerLogs: [
      {
        id: 'intake_unknown_1',
        productName: 'White MDF 18mm',
        quantity: 5,
        gate: 'Gate 1',
        time: '08:30',
        vehicle: 'KDA 123A',
        actorName: 'Gate Operator',
      },
    ],
    unknownOwnerTotalSheets: 5,
    clients: [
      {
        clientId: 101,
        clientName: 'Apex Woodcraft Ltd',
        confirmedMoCount: 2,
        totalBoardsNeeded: 25,
        totalBoardsReserved: 10,
        totalBoardsNotYetLogged: 15,
        requiredComponents: [
          {
            moId: 1001,
            moName: 'WH/MO/01001',
            soName: 'SO1001',
            productId: 50,
            productName: 'Black MDF 18mm',
            qtyNeeded: 25,
            qtyReserved: 10,
            qtyMissing: 15,
            isPurchase: true,
            purchaseDetails: {
              poId: 201,
              poName: 'P00201',
              supplierName: 'Premier Timber Suppliers',
              poState: 'purchase',
              isApproved: true,
            },
          },
        ],
        purchased: {
          expected: 25,
          logged: 10,
          notYetLogged: 15,
          items: [
            {
              moName: 'WH/MO/01001',
              soName: 'SO1001',
              productName: 'Black MDF 18mm',
              qtyNeeded: 25,
              qtyMissing: 15,
              poName: 'P00201',
              supplierName: 'Premier Timber Suppliers',
              poState: 'purchase',
              receiptState: 'Approved · Awaiting Receipt',
            },
          ],
        },
        clientSupply: {
          expected: 0,
          logged: 0,
          notYetLogged: 0,
          items: [],
        },
        loggedEntriesToday: [
          {
            id: 'log_apex_1',
            productName: 'Black MDF 18mm',
            quantity: 10,
            isPurchase: true,
            purchaseOrderReference: 'P00201',
            gate: 'Gate 2',
            time: '09:15',
            vehicle: 'KBZ 999Z',
            actorName: 'Gate Operator',
            source: 'gate_intake',
          },
        ],
        totalLoggedToday: 10,
      },
      {
        clientId: 102,
        clientName: 'Modern Spaces Interiors',
        confirmedMoCount: 1,
        totalBoardsNeeded: 20,
        totalBoardsReserved: 10,
        totalBoardsNotYetLogged: 10,
        requiredComponents: [
          {
            moId: 1002,
            moName: 'WH/MO/01002',
            soName: 'SO1002',
            productId: 51,
            productName: 'White Melamine 18mm',
            qtyNeeded: 20,
            qtyReserved: 10,
            qtyMissing: 10,
            isPurchase: false,
          },
        ],
        purchased: {
          expected: 0,
          logged: 0,
          notYetLogged: 0,
          items: [],
        },
        clientSupply: {
          expected: 20,
          logged: 10,
          notYetLogged: 10,
          items: [
            {
              moName: 'WH/MO/01002',
              soName: 'SO1002',
              productName: 'White Melamine 18mm',
              qtyNeeded: 20,
              qtyMissing: 10,
            },
          ],
        },
        loggedEntriesToday: [
          {
            id: 'log_modern_1',
            productName: 'White Melamine 18mm',
            quantity: 10,
            isPurchase: false,
            gate: 'Gate 1',
            time: '11:00',
            vehicle: 'KDC 456Y',
            actorName: 'Gate Operator',
            source: 'gate_intake',
          },
        ],
        totalLoggedToday: 10,
      },
    ],
  };

  const pdfBuffer = await renderDailyBoardReportPdf(mockReport);
  assert.ok(pdfBuffer, 'PDF buffer must be returned');
  assert.ok(pdfBuffer.length > 1000, 'PDF buffer must contain content');
  // Check PDF signature %PDF-
  const header = pdfBuffer.subarray(0, 5).toString('utf-8');
  assert.equal(header, '%PDF-');
});
