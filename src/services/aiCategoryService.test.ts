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

test('tuktuk service -> transport_expense', async () => {
  const result = await categorizeWithAi({
    details: 'Completed Pay Merchant',
    counterparty: 'Tuktuk Rider',
    direction: 'out',
    paidIn: null,
    withdrawn: 350,
    notes: 'tuktuk service',
  });
  assert.equal(result.category, 'transport_expense', `Expected transport_expense, got ${result.category} (reason: ${result.reason})`);
});

test('pickup -> transport_expense', async () => {
  const result = await categorizeWithAi({
    details: 'Pay Merchant',
    counterparty: 'Pickup Driver',
    direction: 'out',
    paidIn: null,
    withdrawn: 1200,
    notes: 'pick up to site',
  });
  assert.equal(result.category, 'transport_expense', `Expected transport_expense, got ${result.category} (reason: ${result.reason})`);
});

test('deposited to bank -> bank_transfer', async () => {
  const result = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'KCB Bank',
    direction: 'out',
    paidIn: null,
    withdrawn: 50000,
    notes: 'deposited to bank',
  });
  assert.equal(result.category, 'bank_transfer', `Expected bank_transfer, got ${result.category} (reason: ${result.reason})`);
});

test('deposited to ABC bank -> bank_transfer', async () => {
  const result = await categorizeWithAi({
    details: 'Pay Merchant',
    counterparty: 'ABC Bank Account',
    direction: 'out',
    paidIn: null,
    withdrawn: 25000,
    notes: 'deposited to ABC bank',
  });
  assert.equal(result.category, 'bank_transfer', `Expected bank_transfer, got ${result.category} (reason: ${result.reason})`);
});

test('advance salary -> advance_salary', async () => {
  const result = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'Peter Omondi',
    direction: 'out',
    paidIn: null,
    withdrawn: 4000,
    notes: 'advance salary',
  });
  assert.equal(result.category, 'advance_salary', `Expected advance_salary, got ${result.category} (reason: ${result.reason})`);
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

test('casuals offloaded -> staff_loading_expense', async () => {
  const result = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'Casual Crew',
    direction: 'out',
    paidIn: null,
    withdrawn: 2000,
    notes: 'casuals offloaded Odera\'s order',
  });
  assert.equal(result.category, 'staff_loading_expense', `Expected staff_loading_expense, got ${result.category} (reason: ${result.reason})`);
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

test('refund to customer -> refunds', async () => {
  const result = await categorizeWithAi({
    details: 'Customer Refund',
    counterparty: 'Jane Doe',
    direction: 'out',
    paidIn: null,
    withdrawn: 3000,
    notes: 'refund to customer',
  });
  assert.equal(result.category, 'refunds', `Expected refunds, got ${result.category} (reason: ${result.reason})`);
});
