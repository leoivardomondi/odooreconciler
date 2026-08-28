import assert from 'node:assert/strict';
import test from 'node:test';
import { categorizeWithAi } from './aiCategoryService';

test('boda service -> staff_transport_expense', async () => {
  const result = await categorizeWithAi({
    details: 'Completed Pay Merchant',
    counterparty: 'Boda Driver',
    direction: 'out',
    paidIn: null,
    withdrawn: 200,
    notes: 'boda service',
  });
  assert.equal(result.category, 'staff_transport_expense', `Expected staff_transport_expense, got ${result.category} (reason: ${result.reason})`);
});

test('overtime 24th -> staff_overtime_expense', async () => {
  const result = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'John Mwangi',
    direction: 'out',
    paidIn: null,
    withdrawn: 1500,
    notes: 'overtime 24th',
  });
  assert.equal(result.category, 'staff_overtime_expense', `Expected staff_overtime_expense, got ${result.category} (reason: ${result.reason})`);
});

test('casuals offloaded -> staff_overtime_expense', async () => {
  const result = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'Casual Crew',
    direction: 'out',
    paidIn: null,
    withdrawn: 2000,
    notes: 'casuals offloaded Odera\'s order',
  });
  assert.equal(result.category, 'staff_overtime_expense', `Expected staff_overtime_expense, got ${result.category} (reason: ${result.reason})`);
});

test('luch for staff -> staff_lunch_expense', async () => {
  const result = await categorizeWithAi({
    details: 'Pay Merchant',
    counterparty: 'Kibandaski Cafe',
    direction: 'out',
    paidIn: null,
    withdrawn: 500,
    notes: 'luch for staff',
  });
  assert.equal(result.category, 'staff_lunch_expense', `Expected staff_lunch_expense, got ${result.category} (reason: ${result.reason})`);
});
