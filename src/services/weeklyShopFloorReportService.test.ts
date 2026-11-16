import test from 'node:test';
import assert from 'node:assert/strict';
import { isOperationsDept, getOperators } from './weeklyShopFloorReportService';

test('weeklyShopFloorReportService - Wednesday Report Attendance Operations Department Filter', async (t) => {
  await t.test('isOperationsDept correctly identifies Operations across various formats', () => {
    assert.equal(isOperationsDept('Operations'), true);
    assert.equal(isOperationsDept('operations'), true);
    assert.equal(isOperationsDept('OPERATIONS'), true);
    assert.equal(isOperationsDept('Administration / Operations'), true);
    assert.equal(isOperationsDept([2, 'Administration / Operations']), true);
    assert.equal(isOperationsDept([2, 'Operations']), true);
  });

  await t.test('isOperationsDept rejects other departments or empty values', () => {
    assert.equal(isOperationsDept('Management'), false);
    assert.equal(isOperationsDept('Administration / Sales'), false);
    assert.equal(isOperationsDept([3, 'Administration / Sales']), false);
    assert.equal(isOperationsDept('Administration / Information Technology'), false);
    assert.equal(isOperationsDept([4, 'Administration / Information Technology']), false);
    assert.equal(isOperationsDept(''), false);
    assert.equal(isOperationsDept(null), false);
    assert.equal(isOperationsDept(undefined), false);
    assert.equal(isOperationsDept(false), false);
  });

  await t.test('getOperators filters out non-operations employees from Odoo batch queries', async () => {
    const mockClient = {
      searchReadRecords: async (model: string) => {
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
    } as any;

    const operators = await getOperators(mockClient, 1);
    const names = operators.map((o) => o.name);

    assert.equal(operators.length, 2);
    assert.deepEqual(names, ['Janet Awino Amollo', 'Joel Ochango']);
    assert.ok(!names.includes('Leoivard Ongule'));
    assert.ok(!names.includes('Sharon Araka'));
    assert.ok(!names.includes('Charles Onyango'));
  });
});
