import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileBoardRegistrationWithStockAlerts } from './shopFloor';

test('reconcileBoardRegistrationWithStockAlerts corrects false 100% coverage and 0 unlogged when stock alerts exist', () => {
  // Scenario described by user:
  // Odoo or cache returned: expected: 104, registered: 104, missing: 0, coverage: 100%
  // But Stock Needed has 2 undone items of 12 total boards
  const falseSummary = {
    monthLabel: 'October 2026',
    registeredBoards: 104,
    expectedBoards: 104,
    missingBoards: 0,
    registeredMoves: 104,
    expectedMoves: 104,
    coveragePercent: 100,
    details: 'Period 2026-10-01 to 2026-10-31 | Cutting MOs due on SO confirmation day: 104 | MOs with physical inventory logged: 104 | Missing same-day MO board entries: 0',
  };

  const activeStockAlerts = [
    {
      moName: 'WH/MO/00101',
      product: 'Cutting White MDF 18mm 6 panels',
      component: 'WHITE MDF 18mm',
      qtyNeeded: 6,
      client: 'Alpha Interiors',
      moId: 101,
      confirmedAt: null,
      overdueDays: 0,
    },
    {
      moName: 'WH/MO/00102',
      product: 'Cutting Walnut MDF 18mm 6 panels',
      component: 'WALNUT MDF 18mm',
      qtyNeeded: 6,
      client: 'Beta Living',
      moId: 102,
      confirmedAt: null,
      overdueDays: 0,
    },
  ];

  const reconciled = reconcileBoardRegistrationWithStockAlerts(falseSummary, activeStockAlerts);
  assert.ok(reconciled, 'Reconciled summary must be present');

  // Must reflect the 2 undone items (12 boards)
  assert.equal(reconciled.missingBoards, 2, 'Unlogged count must reflect the 2 undone items');
  assert.equal(reconciled.missingMoves, 2, 'Missing moves must be 2');
  assert.equal(reconciled.missingBoardSheets, 12, 'Missing board sheets must be 12 boards needed');

  // Must reflect registered = expected - missing
  assert.equal(reconciled.expectedBoards, 104, 'Expected boards remains 104');
  assert.equal(reconciled.registeredBoards, 102, 'Registered boards must be 102');

  // Coverage must strictly be less than 100%
  assert.equal(reconciled.coveragePercent, 98, 'Coverage must be 98% (102/104)');
  assert.ok(reconciled.coveragePercent < 100, 'Coverage must not be 100%');

  // Details string must document the active pending stock alerts
  assert.match(reconciled.details, /Active pending gate stock alerts: 2 items \(12 boards\)/);
});

test('reconcileBoardRegistrationWithStockAlerts leaves summary unchanged when stockAlerts is empty', () => {
  const perfectSummary = {
    monthLabel: 'October 2026',
    registeredBoards: 100,
    expectedBoards: 100,
    missingBoards: 0,
    registeredMoves: 100,
    expectedMoves: 100,
    coveragePercent: 100,
    details: 'Period 2026-10-01 to 2026-10-31',
  };

  const reconciled = reconcileBoardRegistrationWithStockAlerts(perfectSummary, []);
  assert.deepEqual(reconciled, perfectSummary);
});

test('reconcileBoardRegistrationWithStockAlerts ignores alerts that are currently syncing', () => {
  const summary = {
    monthLabel: 'October 2026',
    registeredBoards: 50,
    expectedBoards: 50,
    missingBoards: 0,
    registeredMoves: 50,
    expectedMoves: 50,
    coveragePercent: 100,
    details: 'Period 2026-10-01 to 2026-10-31',
  };

  const syncingAlerts = [
    {
      moName: 'WH/MO/00101',
      product: 'Cutting White MDF 18mm',
      component: 'WHITE MDF 18mm',
      qtyNeeded: 5,
      client: 'Gamma Deco',
      moId: 101,
      confirmedAt: null,
      overdueDays: 0,
      isSyncing: true, // currently syncing to Odoo
    },
  ];

  const reconciled = reconcileBoardRegistrationWithStockAlerts(summary, syncingAlerts as any);
  assert.deepEqual(reconciled, summary, 'Syncing alerts should not count as undone unlogged shortages');
});
