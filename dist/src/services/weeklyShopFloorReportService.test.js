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
    await t.test('board logging filters out non-operations employees', () => {
        const operationsNames = new Set(['Janet Awino Amollo', 'Joel Ochango'].map(s => s.toLowerCase().trim()));
        const rawBoardLogging = [
            { name: 'Janet Awino Amollo', records: 5, boards: 10 },
            { name: 'Joel Ochango', records: 3, boards: 6 },
            { name: 'Charles Onyango', records: 1, boards: 2 },
            { name: 'dbadmin', records: 2, boards: 4 },
        ];
        const filtered = rawBoardLogging.filter(b => operationsNames.has(b.name.toLowerCase().trim()));
        strict_1.default.equal(filtered.length, 2);
        strict_1.default.deepEqual(filtered.map(f => f.name), ['Janet Awino Amollo', 'Joel Ochango']);
    });
});
