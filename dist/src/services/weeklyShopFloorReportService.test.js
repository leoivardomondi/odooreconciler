"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const weeklyShopFloorReportService_1 = require("./weeklyShopFloorReportService");
(0, node_test_1.default)('weeklyShopFloorReportService - Wednesday Report Attendance Operations Department Filter', async (t) => {
    await t.test('isOperationsDept correctly identifies Operations across various formats', () => {
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)('Operations'), true);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)('operations'), true);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)('OPERATIONS'), true);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)('Administration / Operations'), true);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)([2, 'Administration / Operations']), true);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)([2, 'Operations']), true);
    });
    await t.test('isOperationsDept rejects other departments or empty values', () => {
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)('Management'), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)('Administration / Sales'), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)([3, 'Administration / Sales']), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)('Administration / Information Technology'), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)([4, 'Administration / Information Technology']), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)(''), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)(null), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)(undefined), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isOperationsDept)(false), false);
    });
    await t.test('getOperators filters out non-operations employees from Odoo batch queries', async () => {
        const mockClient = {
            searchReadRecords: async (model) => {
                if (model === 'hr.department') {
                    return [{ id: 2, name: 'Operations', complete_name: 'Administration / Operations' }];
                }
                if (model === 'hr.employee') {
                    return [
                        { id: 9, name: 'Janet Awino Amollo', department_id: [2, 'Administration / Operations'] },
                        { id: 5, name: 'Joel Ochango', department_id: [2, 'Administration / Operations'] },
                        { id: 4, name: 'Leoivard Ongule', department_id: [4, 'Administration / Information Technology'] },
                        { id: 1, name: 'Sharon Araka', department_id: [3, 'Administration / Sales'] },
                        { id: 2, name: 'Charles Onyango', department_id: false },
                    ];
                }
                return [];
            },
        };
        const operators = await (0, weeklyShopFloorReportService_1.getOperators)(mockClient, 1);
        const names = operators.map((o) => o.name);
        strict_1.default.equal(operators.length, 2);
        strict_1.default.deepEqual(names, ['Janet Awino Amollo', 'Joel Ochango']);
        strict_1.default.ok(!names.includes('Leoivard Ongule'));
        strict_1.default.ok(!names.includes('Sharon Araka'));
        strict_1.default.ok(!names.includes('Charles Onyango'));
    });
    await t.test('isSharonOrCandyName matches Sharon and Candy reliably', () => {
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isSharonOrCandyName)('Sharon Araka'), true);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isSharonOrCandyName)('Candy Venesa'), true);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isSharonOrCandyName)('Joel Ochango'), false);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.isSharonOrCandyName)(''), false);
    });
});
(0, node_test_1.default)('weeklyShopFloorReportService - Monday to Saturday PO vs Finance Documents', async (t) => {
    await t.test('getMondayToSaturdayPoWindows selects latest completed Mon-Sat week for a Wed-Tue weekly report', () => {
        // Wednesday Nov 25 report covers Wed 2026-11-18 to Tue 2026-11-24
        const result = (0, weeklyShopFloorReportService_1.getMondayToSaturdayPoWindows)('2026-11-18', '2026-11-24', 4);
        strict_1.default.equal(result.primaryMonday, '2026-11-16');
        strict_1.default.equal(result.primarySaturday, '2026-11-21');
        strict_1.default.equal(result.windows.length, 4);
        strict_1.default.equal(result.windows[0].monday, '2026-10-26');
        strict_1.default.equal(result.windows[0].saturday, '2026-10-31');
        strict_1.default.equal(result.windows[3].monday, '2026-11-16');
        strict_1.default.equal(result.windows[3].saturday, '2026-11-21');
        strict_1.default.equal(result.windows[3].isPrimary, true);
    });
    await t.test('aggregateMonSatPoVsFinanceDocs excludes Sundays, VA/ POs, Delivery Notes, and excluded vendors', () => {
        const { windows } = (0, weeklyShopFloorReportService_1.getMondayToSaturdayPoWindows)('2026-11-18', '2026-11-24', 1);
        const summary = (0, weeklyShopFloorReportService_1.aggregateMonSatPoVsFinanceDocs)({
            windows,
            purchaseOrders: [
                // Mon 2026-11-16 EAT (confirmed, unbilled)
                { name: 'P00101', state: 'purchase', create_date: '2026-11-16 07:00:00', partner_id: [10, 'Wood Supplier'], invoice_count: 0, invoice_status: 'to invoice' },
                // Sat 2026-11-21 23:30 EAT = 20:30 UTC (confirmed, billed)
                { name: 'P00102', state: 'purchase', create_date: '2026-11-21 20:30:00', partner_id: [11, 'Panel Mart'], invoice_count: 1, invoice_status: 'invoiced' },
                // Sun 2026-11-22 10:00 EAT = 07:00 UTC -> MUST be excluded from Mon-Sat
                { name: 'P00103', state: 'purchase', create_date: '2026-11-22 07:00:00', partner_id: [11, 'Panel Mart'], invoice_count: 0, invoice_status: 'to invoice' },
                // Urban Vibe 2 VA/ prefix -> MUST be excluded
                { name: 'VA/P00104', state: 'purchase', create_date: '2026-11-18 09:00:00', partner_id: [12, 'Other'], invoice_count: 0, invoice_status: 'to invoice' },
                // Draft PO -> counted under draft/cancel, not confirmed
                { name: 'P00105', state: 'draft', create_date: '2026-11-18 10:00:00', partner_id: [12, 'Other'], invoice_count: 0, invoice_status: 'no' },
            ],
            financeDocuments: [
                // Eligible invoice on Tue 2026-11-17
                { name: 'INV-9001.pdf', create_date: '2026-11-17 08:00:00', tag_ids: [1] },
                // Delivery Note -> excluded from eligible invoices
                { name: 'Delivery Note 201.pdf', create_date: '2026-11-18 08:00:00', tag_ids: [2] },
                // Excluded vendor -> excluded from eligible invoices
                { name: 'Quickmart Receipt.pdf', create_date: '2026-11-19 08:00:00', tag_ids: [] },
                // Sunday document -> excluded from Mon-Sat
                { name: 'INV-SUN.pdf', create_date: '2026-11-22 08:00:00', tag_ids: [] },
            ],
            validatedTagIds: new Set([1]),
            deliveryNoteTagIds: new Set([2]),
            unfiledNoFolderDates: ['2026-11-18', '2026-11-22'],
        });
        strict_1.default.equal(summary.primaryWeek.posConfirmed, 2);
        strict_1.default.equal(summary.primaryWeek.posDraftOrCancel, 1);
        strict_1.default.equal(summary.primaryWeek.posBilledInOdoo, 1);
        strict_1.default.equal(summary.primaryWeek.posUnbilledInOdoo, 1);
        strict_1.default.equal(summary.primaryWeek.docsTotal, 3);
        strict_1.default.equal(summary.primaryWeek.docsEligibleInvoices, 1);
        strict_1.default.equal(summary.primaryWeek.docsValidated, 1);
        strict_1.default.equal(summary.primaryWeek.docsDeliveryNotes, 1);
        strict_1.default.equal(summary.primaryWeek.docsExcludedVendor, 1);
        strict_1.default.equal(summary.primaryWeek.netGap, -1);
        strict_1.default.equal(summary.primaryWeek.minMissingReceipts, 1);
        strict_1.default.equal(summary.unfiledNoFolderDocsPrimaryWeek, 1); // Sunday unfiled doc excluded
    });
});
(0, node_test_1.default)('weeklyShopFloorReportService - Work Orders Started/Finished Before Board Logs', async (t) => {
    await t.test('detects compliant, started-before-log, started-and-finished-before-log, and no-log violations accurately across UTC vs EAT', () => {
        const audit = (0, weeklyShopFloorReportService_1.detectWorkOrdersStartedBeforeBoardLogs)({
            reportStart: '2026-11-18',
            reportEnd: '2026-11-24',
            mos: [
                // 1. COMPLIANT: Board logged at 09:00 EAT (06:00 UTC), WO started at 10:00 EAT (07:00 UTC)
                { id: 101, name: 'WH/MO/06001', product_id: [1, 'Cutting White Particle 18mm'], origin: 'S03901', state: 'done', create_date: '2026-11-19 05:00:00', date_start: '2026-11-19 07:00:00', date_finished: '2026-11-19 09:00:00' },
                // 2. VIOLATION (Started & Finished before board log): WO 07:00-08:00 UTC (10:00-11:00 EAT), board logged at 13:00 EAT
                { id: 102, name: 'WH/MO/06002', product_id: [2, 'Cutting White MDF 18mm'], origin: 'S03902', state: 'done', create_date: '2026-11-20 05:00:00', date_start: '2026-11-20 07:00:00', date_finished: '2026-11-20 08:00:00' },
                // 3. VIOLATION (Started before board log): WO started 07:00 UTC (10:00 EAT), still in progress, logged at 11:30 EAT
                { id: 103, name: 'WH/MO/06003', product_id: [3, 'Cutting Dark Grey Particle 18mm'], origin: 'S03903', state: 'progress', create_date: '2026-11-21 05:00:00', date_start: '2026-11-21 07:00:00', date_finished: false },
                // 4. VIOLATION (Started & finished with NO board log at all)
                { id: 104, name: 'WH/MO/06004', product_id: [4, 'Cutting Backer White MDF 3mm'], origin: 'S03904', state: 'done', create_date: '2026-11-21 06:00:00', date_start: '2026-11-21 08:00:00', date_finished: '2026-11-21 09:00:00' },
                // 5. COMPLIANT VIA PO RECEIPT: Board received via PO before start
                { id: 105, name: 'WH/MO/06005', product_id: [5, 'Cutting Beech Waterproof 18mm'], origin: 'S03905', state: 'done', create_date: '2026-11-21 06:00:00', date_start: '2026-11-21 10:00:00', date_finished: '2026-11-21 11:00:00' },
                // 6. IGNORED: Edge Banding & Cutting Off Cuts are not board-log cutting jobs
                { id: 106, name: 'WH/MO/06006', product_id: [6, 'Edge Banding White 18mm'], origin: 'S03906', state: 'done', create_date: '2026-11-21 06:00:00', date_start: '2026-11-21 07:00:00', date_finished: '2026-11-21 08:00:00' },
                { id: 107, name: 'WH/MO/06007', product_id: [7, 'Cutting Off Cuts'], origin: 'S03907', state: 'done', create_date: '2026-11-21 06:00:00', date_start: '2026-11-21 07:00:00', date_finished: '2026-11-21 08:00:00' },
            ],
            components: [
                { raw_material_production_id: [101, 'WH/MO/06001'], product_id: [37, 'White Particle 18mm'], product_uom_qty: 5 },
                { raw_material_production_id: [102, 'WH/MO/06002'], product_id: [169, 'White MDF 18mm'], product_uom_qty: 4 },
                { raw_material_production_id: [103, 'WH/MO/06003'], product_id: [608, 'Dark Grey Particle 18mm'], product_uom_qty: 2 },
                { raw_material_production_id: [104, 'WH/MO/06004'], product_id: [294, 'Backer White MDF 3mm'], product_uom_qty: 3 },
                { raw_material_production_id: [105, 'WH/MO/06005'], product_id: [2651, 'Beech Waterproof 18mm'], product_uom_qty: 6 },
            ],
            workorders: [
                { id: 201, name: 'CLIENT ONE - Cutting', production_id: [101, 'WH/MO/06001'], state: 'done', date_start: '2026-11-19 07:00:00', date_finished: '2026-11-19 09:00:00' },
                { id: 202, name: 'CLIENT TWO - Cutting', production_id: [102, 'WH/MO/06002'], state: 'done', date_start: '2026-11-20 07:00:00', date_finished: '2026-11-20 08:00:00' },
                { id: 203, name: 'CLIENT THREE - Cutting', production_id: [103, 'WH/MO/06003'], state: 'progress', date_start: '2026-11-21 07:00:00', date_finished: false },
                { id: 204, name: 'CLIENT FOUR - Cutting', production_id: [104, 'WH/MO/06004'], state: 'done', date_start: '2026-11-21 08:00:00', date_finished: '2026-11-21 09:00:00' },
                { id: 205, name: 'CLIENT FIVE - Cutting', production_id: [105, 'WH/MO/06005'], state: 'done', date_start: '2026-11-21 10:00:00', date_finished: '2026-11-21 11:00:00' },
            ],
            productivityRows: [
                { workorder_id: [202, 'WO202'], employee_id: [6, 'Onyango Bitcher Akulo'], date_start: '2026-11-20 07:00:00', date_end: '2026-11-20 08:00:00' },
                { workorder_id: [203, 'WO203'], employee_id: [5, 'Joel Ochango'], date_start: '2026-11-21 07:00:00', date_end: false },
                { workorder_id: [204, 'WO204'], employee_id: [6, 'Onyango Bitcher Akulo'], date_start: '2026-11-21 08:00:00', date_end: '2026-11-21 09:00:00' },
            ],
            saleOrders: [
                { id: 1, name: 'S03901', partner_id: [11, 'Client One'], date_order: '2026-11-18 08:00:00' },
                { id: 2, name: 'S03902', partner_id: [12, 'Client Two'], date_order: '2026-11-19 08:00:00' },
                { id: 3, name: 'S03903', partner_id: [13, 'Client Three'], date_order: '2026-11-20 08:00:00' },
                { id: 4, name: 'S03904', partner_id: [14, 'Client Four'], date_order: '2026-11-20 08:00:00' },
                { id: 5, name: 'S03905', partner_id: [15, 'Client Five'], date_order: '2026-11-20 08:00:00' },
            ],
            purchaseOrders: [
                { id: 901, name: 'P00901', origin: 'S03905' },
            ],
            incomingPoMoves: [
                { origin: 'P00901', product_id: [2651, 'Beech Waterproof 18mm'], date: '2026-11-21 09:00:00', state: 'done' },
            ],
            boardIntakeLogs: [
                // Logged at 09:00 EAT (= 06:00 UTC), 1 hour BEFORE WO 101 started (07:00 UTC)
                { id: 'log1', product_id: 37, product_name: 'White Particle 18mm', partner_id: 11, customer_name: 'Client One', quantity: 5, status: 'synced', reverted_at: null, created_at: '2026-11-19 09:00:00' },
                // Logged at 13:00 EAT (= 10:00 UTC), AFTER WO 102 finished (08:00 UTC)
                { id: 'log2', product_id: 169, product_name: 'White MDF 18mm', partner_id: 12, customer_name: 'Client Two', quantity: 4, status: 'synced', reverted_at: null, created_at: '2026-11-20 13:00:00' },
                // Logged at 11:30 EAT (= 08:30 UTC), AFTER WO 103 started (07:00 UTC) while still in progress
                { id: 'log3', product_id: 608, product_name: 'Dark Grey Particle 18mm', partner_id: 13, customer_name: 'Client Three', quantity: 2, status: 'synced', reverted_at: null, created_at: '2026-11-21 11:30:00' },
            ],
        });
        strict_1.default.equal(audit.totalChecked, 5);
        strict_1.default.equal(audit.compliantCount, 2);
        strict_1.default.equal(audit.violations.length, 3);
        strict_1.default.equal(audit.startedBeforeLogCount, 1);
        strict_1.default.equal(audit.startedAndFinishedBeforeLogCount, 2);
        strict_1.default.equal(audit.noBoardLogCount, 1);
        strict_1.default.equal(audit.loggedAfterStartCount, 2);
        const byMo = new Map(audit.violations.map((v) => [v.moName, v]));
        strict_1.default.equal(byMo.get('WH/MO/06002')?.violationType, 'started_and_finished_before_log');
        strict_1.default.equal(byMo.get('WH/MO/06002')?.operatorName, 'Onyango Bitcher Akulo');
        strict_1.default.equal(byMo.get('WH/MO/06003')?.violationType, 'started_before_log');
        strict_1.default.equal(byMo.get('WH/MO/06003')?.operatorName, 'Joel Ochango');
        strict_1.default.equal(byMo.get('WH/MO/06004')?.violationType, 'started_and_finished_no_log');
    });
});
(0, node_test_1.default)('weeklyShopFloorReportService - Sharon & Candy Attendance & Board Logging Encouragement', async (t) => {
    await t.test('summarizeNamedStaffAttendance flags normal, late, open, and multi-day unclosed shifts', () => {
        const summary = (0, weeklyShopFloorReportService_1.summarizeNamedStaffAttendance)([
            { id: 1, name: 'Sharon Araka', roleLabel: 'Sales Optimizer' },
            { id: 22, name: 'Candy Venesa', roleLabel: 'Sales Optimizer' },
        ], [
            // Sharon: normal shift Nov 18 (07:50 EAT -> 17:10 EAT) + open check-in Nov 23 (08:55 EAT = late + no checkout)
            { employee_id: [1, 'Sharon Araka'], check_in: '2026-11-18 04:50:00', check_out: '2026-11-18 14:10:00', worked_hours: 9.33 },
            { employee_id: [1, 'Sharon Araka'], check_in: '2026-11-23 05:55:00', check_out: false, worked_hours: 0 },
            // Candy: multi-day unclosed shift spanning Nov 17 -> Nov 25
            { employee_id: [22, 'Candy Venesa'], check_in: '2026-11-17 05:19:19', check_out: '2026-11-25 15:08:04', worked_hours: 201.8 },
        ], ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-23', '2026-11-24'], '2026-11-18', '2026-11-24');
        const sharon = summary.find((s) => s.id === 1);
        const candy = summary.find((s) => s.id === 22);
        strict_1.default.equal(sharon.sessions.length, 2);
        strict_1.default.equal(sharon.daysWithCheckIn, 2);
        strict_1.default.equal(sharon.daysWithSameDayCheckOut, 1);
        strict_1.default.equal(sharon.lateCount, 1);
        strict_1.default.equal(sharon.missingCheckoutCount, 1);
        strict_1.default.equal(sharon.sessions[1].status, 'No check-out');
        strict_1.default.equal(candy.sessions.length, 1);
        strict_1.default.equal(candy.multiDaySessionCount, 1);
        strict_1.default.equal(candy.sessions[0].status, 'Multi-day (unclosed)');
    });
    await t.test('mergeOperationsBoardLoggingRows excludes Janet Awino Amollo and includes 0-log eligible Operations operators', () => {
        const merged = (0, weeklyShopFloorReportService_1.mergeOperationsBoardLoggingRows)([
            { id: 9, name: 'Janet Awino Amollo' },
            { id: 6, name: 'Onyango Bitcher Akulo' },
            { id: 5, name: 'Joel Ochango' },
            { id: 7, name: 'Thomas Ollinga' },
            { id: 23, name: 'Michael Ochieng Okoth' },
        ], [
            { name: 'Janet Awino Amollo', email: 'janetamollo01@gmail.com', records: 12, boards: 40, synced: 12, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-24 14:00:00' },
            { name: 'Onyango Bitcher Akulo', email: 'bitcher@example.com', records: 12, boards: 40, synced: 12, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-24 14:00:00' },
            { name: 'Joel Ochango', email: 'joel@example.com', records: 10, boards: 25, synced: 10, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-24 12:00:00' },
            { name: 'Thomas Ollinga', email: 'thomas@example.com', records: 1, boards: 2, synced: 1, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-20 10:00:00' },
            { name: 'Charles Onyango', email: 'charles@example.com', records: 2, boards: 4, synced: 2, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-21 10:00:00' },
        ]);
        strict_1.default.equal(merged.length, 4); // Janet Awino Amollo & non-operations Charles excluded; 0-log Michael included
        strict_1.default.ok(!merged.some((m) => /janet/i.test(m.name)));
        strict_1.default.equal(merged.find((m) => m.name === 'Michael Ochieng Okoth')?.records, 0);
        const note = (0, weeklyShopFloorReportService_1.buildBoardLoggingEncouragementNote)(merged);
        strict_1.default.ok(!/janet/i.test(note));
        strict_1.default.match(note, /Onyango Bitcher Akulo/i);
        strict_1.default.match(note, /Thomas Ollinga/i);
        strict_1.default.match(note, /Michael Ochieng Okoth/i);
        strict_1.default.match(note, /lock in/i);
        strict_1.default.match(note, /emulate/i);
    });
    await t.test('renderWeeklyShopFloorReportPdf generates a valid PDF with all new sections', async () => {
        const { windows } = (0, weeklyShopFloorReportService_1.getMondayToSaturdayPoWindows)('2026-11-18', '2026-11-24', 2);
        const poVsFinanceDocs = (0, weeklyShopFloorReportService_1.aggregateMonSatPoVsFinanceDocs)({
            windows,
            purchaseOrders: [
                { name: 'P001', state: 'purchase', create_date: '2026-11-18 08:00:00', partner_id: [1, 'Supplier'], invoice_count: 0, invoice_status: 'to invoice' },
            ],
            financeDocuments: [],
            validatedTagIds: new Set(),
            deliveryNoteTagIds: new Set(),
        });
        const pdf = await (0, weeklyShopFloorReportService_1.renderWeeklyShopFloorReportPdf)({
            generatedAt: new Date('2026-11-25T04:00:00Z'),
            start: '2026-11-18',
            end: '2026-11-24',
            reportingBaseline: '2026-07-25',
            companyName: 'URBAN VIBE INTERIOR DESIGN COMPANY LTD',
            warehouseId: 1,
            boardSummary: {
                monthLabel: '2026-11-18 to 2026-11-24',
                registeredBoards: 18,
                expectedBoards: 20,
                missingBoards: 2,
                registeredMoves: 18,
                expectedMoves: 20,
                coveragePercent: 90,
                details: '',
            },
            boardLoggingByOperator: [
                { name: 'Janet Awino Amollo', email: 'janet@example.com', records: 12, boards: 40, synced: 12, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-24 14:00:00' },
                { name: 'Michael Ochieng Okoth', email: '', records: 0, boards: 0, synced: 0, failed: 0, reverted: 0, pending: 0, lastLoggedAt: null },
            ],
            boardLoggingEncouragementNote: 'ENCOURAGEMENT NOTE: Great pace set by Janet Awino Amollo (12 logs, 40 boards). Michael Ochieng Okoth (0 logs) recorded low board log activity — lock in and emulate your teammates.',
            penalties: { undoneReceipts: 1 },
            moCompletion: { created: 20, eligible: 20, completed: 18, open: 2, cancelled: 0, draft: 0, completionPercent: 90, details: '' },
            poVsFinanceDocs,
            workOrdersBeforeBoardLogs: {
                totalChecked: 5,
                compliantCount: 4,
                startedBeforeLogCount: 0,
                startedAndFinishedBeforeLogCount: 1,
                noBoardLogCount: 1,
                loggedAfterStartCount: 0,
                byOperator: [{ operatorName: 'Onyango Bitcher Akulo', total: 1, startedOnly: 0, startedAndFinished: 1 }],
                violations: [
                    {
                        moId: 104,
                        moName: 'WH/MO/06004',
                        origin: 'S03904',
                        clientName: 'Client Four',
                        productName: 'Cutting White Particle 18mm',
                        missingBoardNames: ['White Particle 18mm'],
                        operatorName: 'Onyango Bitcher Akulo',
                        moState: 'done',
                        startedAt: '2026-11-21 08:00:00',
                        finishedAt: '2026-11-21 09:00:00',
                        firstBoardLogAt: null,
                        firstBoardLogAtDisplay: null,
                        violationType: 'started_and_finished_no_log',
                        violationLabel: 'Started & finished (no board log)',
                        delayMinutes: null,
                    },
                ],
            },
            attendance: [
                {
                    name: 'Janet Awino Amollo',
                    overtimeRecords: [],
                    totalOvertimeHours: 0,
                    days: [
                        { date: '2026-11-18', status: 'Present', late: false, checkIn: '2026-11-18 05:00:00', checkOut: '2026-11-18 14:00:00', workedHours: 9, missingCheckoutRecords: [], overnight: false },
                    ],
                },
            ],
            salesTeamAttendance: (0, weeklyShopFloorReportService_1.summarizeNamedStaffAttendance)([{ id: 1, name: 'Sharon Araka', roleLabel: 'Sales Optimizer' }], [{ employee_id: [1, 'Sharon Araka'], check_in: '2026-11-23 05:55:00', check_out: false, worked_hours: 0 }], ['2026-11-18', '2026-11-23'], '2026-11-18', '2026-11-24'),
        });
        strict_1.default.ok(Buffer.isBuffer(pdf));
        strict_1.default.ok(pdf.length > 2000, 'Expected rendered PDF to have substantial content');
        strict_1.default.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
    });
    await t.test('computeOperatorSystemUsageSummary calculates usage share percentages, knowledge tiers, and excludes Leoivard', () => {
        const summary = (0, weeklyShopFloorReportService_1.computeOperatorSystemUsageSummary)({
            operators: [
                { id: 4, name: 'Leoivard Ongule', email: 'dbadmin@urbanvibeinteriordesign.co.ke' },
                { id: 6, name: 'Onyango Bitcher Akulo', email: 'onyangoakulo@gmail.com' },
                { id: 5, name: 'Joel Ochango', email: 'joelochango22@gmail.com' },
                { id: 23, name: 'Michael Ochieng Okoth', email: 'okothmike578@gmail.com' },
            ],
            workcenterSessionsByOperatorId: new Map([
                [6, { sessions: 8, workOrdersWorked: 5, openTimers: 0 }],
                [5, { sessions: 3, workOrdersWorked: 2, openTimers: 1 }],
            ]),
            boardLoggingByOperator: [
                { name: 'Onyango Bitcher Akulo', email: 'onyangoakulo@gmail.com', records: 6, boards: 30, synced: 6, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-24 14:00:00' },
                { name: 'Joel Ochango', email: 'joelochango22@gmail.com', records: 2, boards: 10, synced: 2, failed: 0, reverted: 0, pending: 0, lastLoggedAt: '2026-11-24 12:00:00' },
                { name: 'Michael Ochieng Okoth', email: 'okothmike578@gmail.com', records: 0, boards: 0, synced: 0, failed: 0, reverted: 0, pending: 0, lastLoggedAt: null },
            ],
            attendance: [
                {
                    name: 'Onyango Bitcher Akulo',
                    days: [
                        { status: 'Present', checkIn: '2026-11-23 05:00:00', checkOut: '2026-11-23 14:00:00' },
                        { status: 'Present', checkIn: '2026-11-24 05:00:00', checkOut: '2026-11-24 14:00:00' },
                    ],
                },
                {
                    name: 'Joel Ochango',
                    days: [
                        { status: 'Present', checkIn: '2026-11-23 05:00:00', checkOut: '2026-11-23 14:00:00' },
                        { status: 'Absent', checkIn: null, checkOut: null },
                    ],
                },
                {
                    name: 'Michael Ochieng Okoth',
                    days: [
                        { status: 'Absent', checkIn: null, checkOut: null },
                        { status: 'Absent', checkIn: null, checkOut: null },
                    ],
                },
            ],
            appActivityByEmail: new Map([['onyangoakulo@gmail.com', 5]]),
        });
        strict_1.default.equal(summary.operators.length, 3); // Leoivard excluded
        strict_1.default.ok(!summary.operators.some((o) => /leoivard/i.test(o.name)));
        strict_1.default.equal(summary.operators[0].name, 'Onyango Bitcher Akulo');
        strict_1.default.equal(summary.operators[0].knowledgeLevel, 'Advanced');
        strict_1.default.ok(summary.operators[0].usageSharePercent > 50);
        const michael = summary.operators.find((o) => o.name === 'Michael Ochieng Okoth');
        strict_1.default.equal(michael.totalUsageActions, 0);
        strict_1.default.equal(michael.knowledgeLevel, 'Needs Training');
        strict_1.default.match(summary.insightNote, /Onyango Bitcher Akulo/i);
        strict_1.default.match(summary.insightNote, /Michael Ochieng Okoth/i);
    });
    await t.test('director report summary omits unbilled Odoo POs and explains pending receipts via board intake auto-validation', () => {
        const poSummary = (0, weeklyShopFloorReportService_1.buildWeeklyPoSummaryPoint)({
            monday: '2026-11-16',
            saturday: '2026-11-21',
            label: '2026-11-16 – 2026-11-21',
            isPrimary: true,
            posTotal: 37,
            posConfirmed: 35,
            posDraftOrCancel: 2,
            posBilledInOdoo: 3,
            posUnbilledInOdoo: 32,
            docsTotal: 25,
            docsEligibleInvoices: 20,
            docsValidated: 18,
            docsDeliveryNotes: 3,
            docsExcludedVendor: 2,
            netGap: -15,
            minMissingReceipts: 15,
        });
        strict_1.default.ok(!/unbilled/i.test(poSummary), 'PO summary must not mention unbilled POs in Odoo');
        strict_1.default.match(poSummary, /35 confirmed PO\(s\) created vs 20 eligible Finance invoice\/receipt doc\(s\) uploaded \(15 min\. missing receipt\(s\)\)\./);
        const receiptSummary = (0, weeklyShopFloorReportService_1.buildWeeklyReceiptsAndMoPoint)({
            undoneReceipts: 29,
            completed: 77,
            eligible: 141,
            completionPercent: 55,
            end: '2026-11-28',
        });
        strict_1.default.match(receiptSummary, /29 purchased-board receipt\(s\) need validation; 77 of 141 eligible MO\(s\) created in the period were completed by 2026-11-28 \(55%\)\./);
        strict_1.default.match(receiptSummary, /Reason:.*board intake logs automatically validate purchased-board receipts/i);
        strict_1.default.match(receiptSummary, /assistants\/helpers/i);
        strict_1.default.equal((0, weeklyShopFloorReportService_1.getWeeklyReportCacheKey)('2026-11-18', '2026-11-24'), 'shop-floor:weekly-report-pdf:v4:2026-11-18:2026-11-24');
    });
    await t.test('overtime summary counts distinct overtimes covered by the production team instead of inflated hours/reminders', () => {
        const sampleAttendance = [
            {
                name: 'Joel Ochango',
                overtimeRecords: [
                    { dateRange: '2026-11-25 -> 2026-11-26', checkIn: '2026-11-25 15:43:27', checkOut: '2026-11-26 16:17:55', workedHours: 24.57, shiftType: 'Overnight Shift' },
                    { dateRange: '2026-11-27 -> 2026-11-28', checkIn: '2026-11-27 17:41:36', checkOut: '2026-11-28 04:39:46', workedHours: 10.97, shiftType: 'Overnight Shift' },
                ],
            },
            {
                name: 'Onyango Bitcher Akulo',
                overtimeRecords: [
                    { dateRange: '2026-11-24 -> 2026-11-25', checkIn: '2026-11-24 17:25:06', checkOut: '2026-11-24 22:52:33', workedHours: 5.46, shiftType: 'Overnight Shift' },
                    { dateRange: '2026-11-27 -> 2026-11-28', checkIn: '2026-11-27 17:41:05', checkOut: '2026-11-28 04:40:16', workedHours: 10.99, shiftType: 'Overnight Shift' },
                ],
            },
            {
                name: 'Michael Ochieng Okoth',
                overtimeRecords: [
                    { dateRange: '2026-11-27 -> 2026-11-28', checkIn: '2026-11-27 07:27:26', checkOut: '2026-11-28 04:36:05', workedHours: 21.14, shiftType: 'Overnight Shift' },
                ],
            },
        ];
        const summary = (0, weeklyShopFloorReportService_1.summarizeProductionTeamOvertimes)(sampleAttendance);
        strict_1.default.equal(summary.teamOvertimeCount, 3);
        strict_1.default.equal(summary.operatorShiftCount, 5);
        strict_1.default.deepEqual(summary.overtimeDates, ['2026-11-24', '2026-11-25', '2026-11-27']);
        strict_1.default.deepEqual(summary.byOperator, [
            { name: 'Joel Ochango', count: 2 },
            { name: 'Onyango Bitcher Akulo', count: 2 },
            { name: 'Michael Ochieng Okoth', count: 1 },
        ]);
        const bullet = (0, weeklyShopFloorReportService_1.buildWeeklyOvertimeSummaryPoint)(sampleAttendance);
        strict_1.default.equal(bullet, 'Production team covered 3 overtime(s) during the period (2026-11-24, 2026-11-25, 2026-11-27) — covered by Joel Ochango (2), Onyango Bitcher Akulo (2), Michael Ochieng Okoth (1).');
        strict_1.default.ok(!/exceeded 8h/i.test(bullet));
        strict_1.default.ok(!/73\.1h/i.test(bullet));
        strict_1.default.equal((0, weeklyShopFloorReportService_1.buildWeeklyOvertimeSummaryPoint)([{ name: 'Joel Ochango', overtimeRecords: [] }]), 'Production team covered 0 overtimes during the period.');
    });
});
