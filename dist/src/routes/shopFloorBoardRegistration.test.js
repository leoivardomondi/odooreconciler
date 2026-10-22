"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const shopFloor_1 = require("./shopFloor");
(0, node_test_1.default)('reconcileBoardRegistrationWithStockAlerts corrects false 100% coverage and 0 unlogged when stock alerts exist', () => {
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
    const reconciled = (0, shopFloor_1.reconcileBoardRegistrationWithStockAlerts)(falseSummary, activeStockAlerts);
    strict_1.default.ok(reconciled, 'Reconciled summary must be present');
    // Must reflect the 2 undone items (12 boards)
    strict_1.default.equal(reconciled.missingBoards, 2, 'Unlogged count must reflect the 2 undone items');
    strict_1.default.equal(reconciled.missingMoves, 2, 'Missing moves must be 2');
    strict_1.default.equal(reconciled.missingBoardSheets, 12, 'Missing board sheets must be 12 boards needed');
    // Must reflect registered = expected - missing
    strict_1.default.equal(reconciled.expectedBoards, 104, 'Expected boards remains 104');
    strict_1.default.equal(reconciled.registeredBoards, 102, 'Registered boards must be 102');
    // Coverage must strictly be less than 100%
    strict_1.default.equal(reconciled.coveragePercent, 98, 'Coverage must be 98% (102/104)');
    strict_1.default.ok(reconciled.coveragePercent < 100, 'Coverage must not be 100%');
    // Details string must document the active pending stock alerts
    strict_1.default.match(reconciled.details, /Active pending gate stock alerts: 2 items \(12 boards\)/);
});
(0, node_test_1.default)('reconcileBoardRegistrationWithStockAlerts leaves summary unchanged when stockAlerts is empty', () => {
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
    const reconciled = (0, shopFloor_1.reconcileBoardRegistrationWithStockAlerts)(perfectSummary, []);
    strict_1.default.deepEqual(reconciled, perfectSummary);
});
(0, node_test_1.default)('reconcileBoardRegistrationWithStockAlerts ignores alerts that are currently syncing', () => {
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
    const reconciled = (0, shopFloor_1.reconcileBoardRegistrationWithStockAlerts)(summary, syncingAlerts);
    strict_1.default.deepEqual(reconciled, summary, 'Syncing alerts should not count as undone unlogged shortages');
});
