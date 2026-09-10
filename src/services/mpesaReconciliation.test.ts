import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { extractMpesaSpreadsheet } from './mpesaSpreadsheetService';
import { categorizeWithAi, categorizeByKeywords } from './aiCategoryService';
import { buildNotesExportPayload } from '../routes/mpesaReconciliation';

test('spreadsheet extraction: reliably extracts Other Party Info column and maps to counterparty, userSupplier and raw.otherPartyText', async () => {
  const sampleData = [
    ['Receipt No.', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance', 'Transaction Type', 'Other Party Info'],
    ['UEPTQBVEI1', '2026-03-01 10:15:00', 'Customer Merchant Payment', 'Completed', '', '5000.00', '45000.00', 'Merchant Payment', '400200 - TIMSALES LTD'],
    ['UEPTQBVEI2', '2026-03-01 11:30:00', 'Pay Merchant', 'Completed', '', '1200.00', '43800.00', 'Paybill', '254717***721 - JEREMIAH ODERA'],
    ['UEPTQBVEI3', '2026-03-01 12:00:00', 'Merchant Customer Payment', 'Completed', '', '350.00', '43450.00', 'B2C', '0712345678 - JOHN MWANGI'],
    ['UEPTQBVEI4', '2026-03-01 14:20:00', 'Customer Payment', 'Completed', '15000.00', '', '58450.00', 'C2B', 'KEVIN OKUMAYIA AMALANDA'],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sampleData);
  XLSX.utils.book_append_sheet(wb, ws, 'Statement');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const result = await extractMpesaSpreadsheet({
    buffer,
    originalFilename: 'mpesa_statement_test.xlsx',
  });

  assert.equal(result.transactions.length, 4, 'Should extract 4 transaction rows');

  // Row 1: Till prefix (TIMSALES LTD)
  const tx1 = result.transactions[0];
  assert.equal(tx1.counterparty, 'TIMSALES LTD');
  assert.equal(tx1.userSupplier, 'TIMSALES LTD');
  assert.equal(tx1.raw.otherPartyText, '400200 - TIMSALES LTD');
  assert.equal(tx1.withdrawn, 5000);

  // Row 2: Masked phone prefix (JEREMIAH ODERA)
  const tx2 = result.transactions[1];
  assert.equal(tx2.counterparty, 'JEREMIAH ODERA');
  assert.equal(tx2.userSupplier, 'JEREMIAH ODERA');
  assert.equal(tx2.phoneNumber, '254717***721');
  assert.equal(tx2.raw.otherPartyText, '254717***721 - JEREMIAH ODERA');

  // Row 3: Standard phone prefix (JOHN MWANGI)
  const tx3 = result.transactions[2];
  assert.equal(tx3.counterparty, 'JOHN MWANGI');
  assert.equal(tx3.phoneNumber, '0712345678');
  assert.equal(tx3.raw.otherPartyText, '0712345678 - JOHN MWANGI');

  // Row 4: Standalone name (KEVIN OKUMAYIA AMALANDA)
  const tx4 = result.transactions[3];
  assert.equal(tx4.counterparty, 'KEVIN OKUMAYIA AMALANDA');
  assert.equal(tx4.paidIn, 15000);
  assert.equal(tx4.direction, 'in');
});

test('spreadsheet extraction: recognizes alternative header names for other party', async () => {
  const sampleData = [
    ['Receipt No.', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance', 'Type', 'Counterparty'],
    ['UEPTQBVEI5', '2026-03-02 09:00:00', 'Payment to Vendor', 'Completed', '', '2500.00', '40000.00', 'Paybill', 'ELGON HARDWARE LTD'],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(sampleData);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const result = await extractMpesaSpreadsheet({
    buffer,
    originalFilename: 'counterparty_test.xlsx',
  });

  assert.equal(result.transactions.length, 1);
  const tx = result.transactions[0];
  assert.equal(tx.counterparty, 'ELGON HARDWARE LTD');
  assert.equal(tx.userSupplier, 'ELGON HARDWARE LTD');
  assert.equal(tx.raw.otherPartyText, 'ELGON HARDWARE LTD');
});

test('categorization from user notes: identifies Kenyan operational expense categories', async () => {
  // Staff lunch expense
  const lunchResult = await categorizeWithAi({
    details: 'Completed Pay Merchant',
    counterparty: 'Kibandaski Cafe',
    direction: 'out',
    paidIn: null,
    withdrawn: 450,
    notes: 'lunch for staff',
  });
  assert.equal(lunchResult.category, 'staff_lunch_expense');

  // Transport expense via tuktuk
  const transportResult = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'Rider',
    direction: 'out',
    paidIn: null,
    withdrawn: 300,
    notes: 'tuktuk transport carrying boards from timsales',
  });
  assert.equal(transportResult.category, 'transport_expense');

  // Staff overtime expense
  const overtimeResult = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'Brian',
    direction: 'out',
    paidIn: null,
    withdrawn: 1200,
    notes: 'overtime on 24th',
  });
  assert.equal(overtimeResult.category, 'staff_overtime_expense');

  // Staff loading / offloading expense
  const loadingResult = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'Casual Workers',
    direction: 'out',
    paidIn: null,
    withdrawn: 1500,
    notes: 'payment for loading order',
  });
  assert.equal(loadingResult.category, 'staff_loading_expense');

  // Office water expense
  const waterResult = await categorizeWithAi({
    details: 'Pay Merchant',
    counterparty: 'Maifan',
    direction: 'out',
    paidIn: null,
    withdrawn: 600,
    notes: 'water dispenser refills for office',
  });
  assert.equal(waterResult.category, 'office_water_expense');

  // Salary advance
  const advanceResult = await categorizeWithAi({
    details: 'Customer Payment',
    counterparty: 'John',
    direction: 'out',
    paidIn: null,
    withdrawn: 5000,
    notes: 'advance salary for march',
  });
  assert.equal(advanceResult.category, 'advance_salary');
});

test('keyword fallback: accurately scores and reasons notes without AI', () => {
  const result = categorizeByKeywords({
    details: 'Completed Pay Merchant',
    counterparty: 'Jane',
    direction: 'out',
    paidIn: null,
    withdrawn: 300,
    notes: 'food for staff',
  });
  assert.equal(result.category, 'staff_lunch_expense');
  assert.ok(result.confidence >= 0.4);
  assert.equal(result.method, 'keyword');
});

test('buildNotesExportPayload: outputs txt column with distinct frequencies and full column', () => {
  const sampleRows = [
    { notes: 'Lunch for staff', userCategory: 'staff_lunch_expense', amount: 800, direction: 'out', counterparty: 'Janet Ochieng' },
    { notes: 'Tuktuk transport', userCategory: 'transport_expense', amount: 200, direction: 'out', counterparty: 'George Okullo' },
    { notes: 'Lunch for staff', userCategory: 'staff_lunch_expense', amount: 600, direction: 'out', counterparty: 'Janet Ochieng' },
    { notes: '', userCategory: 'outgoing_payment', amount: 1500, direction: 'out' }, // empty note
  ];

  // Full mode
  const full = buildNotesExportPayload(sampleRows, { format: 'txt', mode: 'full' });
  assert.equal(full.contentType, 'text/plain; charset=utf-8');
  assert.ok(full.content.includes('[2x] "Lunch for staff" -> Category: [staff_lunch_expense]'));
  assert.ok(full.content.includes('[1x] "Tuktuk transport" -> Category: [transport_expense]'));
  assert.ok(full.content.includes('Total Rows with Notes: 3'));
  assert.ok(full.content.includes('Unique Distinct Notes: 2'));

  // Raw mode (for clean copy-paste / feeding directly into prompt)
  const raw = buildNotesExportPayload(sampleRows, { format: 'txt', mode: 'raw' });
  assert.equal(raw.content.trim(), 'Lunch for staff\r\nTuktuk transport\r\nLunch for staff');

  // CSV mode
  const csv = buildNotesExportPayload(sampleRows, { format: 'csv' });
  assert.equal(csv.contentType, 'text/csv; charset=utf-8');
  assert.ok(csv.content.startsWith('\uFEFF"Note","Category"'));
  assert.ok(csv.content.includes('"Lunch for staff","staff_lunch_expense"'));

  // JSON mode
  const json = buildNotesExportPayload(sampleRows, { format: 'json' });
  assert.equal(json.contentType, 'application/json; charset=utf-8');
  const parsed = JSON.parse(json.content);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].note, 'Lunch for staff');
});

