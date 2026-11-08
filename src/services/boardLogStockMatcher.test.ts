import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findMatchingBoardLog,
  isMatchingBoardProduct,
  isMatchingClient,
} from './boardLogStockMatcher';

test('boardLogStockMatcher: correctly matches board product names despite casing or minor spacing differences', () => {
  assert.equal(isMatchingBoardProduct('Harbour Grey Waterproof 18mm', 'harbour grey waterproof 18mm'), true);
  assert.equal(isMatchingBoardProduct('Harbour Grey Waterproof 18mm', 'Harbour Grey Waterproof'), true);
  assert.equal(isMatchingBoardProduct('Dark Grey Particle 18mm', 'Dark Grey Particle 18mm', 39, 39), true);
  assert.equal(isMatchingBoardProduct('Dark Grey Particle 18mm', 'White Particle 18mm', 39, 37), false);
});

test('boardLogStockMatcher: correctly matches client names case-insensitively and by substring or partnerId', () => {
  assert.equal(isMatchingClient('JUSTUS OCHIENG', 'Justus Ochieng'), true);
  assert.equal(isMatchingClient('JUSTUS OCHIENG', 'JUSTUS', 498, 498), true);
  assert.equal(isMatchingClient('Sharon Araka', 'Sharon Araka'), true);
  assert.equal(isMatchingClient('JUSTUS OCHIENG', 'Different Customer', 498, 999), false);
});

test('boardLogStockMatcher: matches board requirement from loaded pending processes in shop_floor_pending_processes', () => {
  const match = findMatchingBoardLog({
    moId: 6668,
    moName: 'WH/MO/06016',
    origin: 'S03823',
    partnerName: 'JUSTUS OCHIENG',
    partnerId: 498,
    productId: 752,
    productName: 'Harbour Grey Waterproof 18mm',
    loadedProcesses: [
      {
        id: '6668_752',
        mo_id: 6668,
        mo_name: 'WH/MO/06016',
        origin: 'S03823',
        partner_id: 498,
        partner_name: 'JUSTUS OCHIENG',
        product_id: 752,
        product_name: 'Harbour Grey Waterproof 18mm',
        status: 'loaded',
        qty_missing: 0,
        qty_needed: 9,
        qty_reserved: 9,
      },
    ],
  });

  assert.equal(match.hasMatch, true);
  assert.equal(match.source, 'shop_floor_pending_processes');
  assert.equal(match.matchedQuantity, 9);
});

test('boardLogStockMatcher: matches board requirement from active non-reverted board intake logs by client and product', () => {
  const match = findMatchingBoardLog({
    moId: 6668,
    moName: 'WH/MO/06016',
    origin: 'S03823',
    partnerName: 'JUSTUS OCHIENG',
    partnerId: 498,
    productId: 752,
    productName: 'Harbour Grey Waterproof 18mm',
    activeLogs: [
      {
        id: 'log-101',
        partner_id: 498,
        customer_name: 'JUSTUS OCHIENG',
        product_id: 752,
        product_name: 'Harbour Grey Waterproof 18mm',
        quantity: 3,
      },
    ],
  });

  assert.equal(match.hasMatch, true);
  assert.equal(match.source, 'board_intake_queue');
  assert.equal(match.matchedQuantity, 3);
});

test('boardLogStockMatcher: matches company-purchased board intake log via PO reference', () => {
  const match = findMatchingBoardLog({
    moId: 6668,
    moName: 'WH/MO/06016',
    origin: 'S03823',
    partnerName: 'Unknown Client',
    productId: 752,
    productName: 'Harbour Grey Waterproof 18mm',
    relatedPoNames: ['P01372', 'P01371'],
    activeLogs: [
      {
        id: 'log-po-101',
        partner_id: 44,
        customer_name: 'TIP TOP',
        product_id: 752,
        product_name: 'Harbour Grey Waterproof 18mm',
        quantity: 3,
        purchase_order_reference: 'P01372',
      },
    ],
  });

  assert.equal(match.hasMatch, true);
  assert.equal(match.source, 'board_intake_queue');
  assert.equal(match.matchedQuantity, 3);
});

test('boardLogStockMatcher: matches when PO line for this board has already been received in Odoo', () => {
  const match = findMatchingBoardLog({
    moId: 6668,
    moName: 'WH/MO/06016',
    origin: 'S03823',
    partnerName: 'JUSTUS OCHIENG',
    productId: 752,
    productName: 'Harbour Grey Waterproof 18mm',
    poLines: [
      {
        orderName: 'P01372',
        productId: 752,
        productName: 'Harbour Grey Waterproof 18mm',
        productQty: 3,
        qtyReceived: 3,
      },
    ],
  });

  assert.equal(match.hasMatch, true);
  assert.equal(match.source, 'purchase_receipt');
  assert.equal(match.matchedQuantity, 3);
});

test('boardLogStockMatcher: returns hasMatch = false when board has not been logged and PO has not been received', () => {
  const match = findMatchingBoardLog({
    moId: 6668,
    moName: 'WH/MO/06016',
    origin: 'S03823',
    partnerName: 'JUSTUS OCHIENG',
    productId: 752,
    productName: 'Harbour Grey Waterproof 18mm',
    activeLogs: [
      {
        id: 'log-diff',
        partner_id: 888,
        customer_name: 'Another Customer',
        product_id: 37,
        product_name: 'White Particle 18mm',
        quantity: 10,
      },
    ],
    poLines: [
      {
        orderName: 'P01372',
        productId: 752,
        productName: 'Harbour Grey Waterproof 18mm',
        productQty: 3,
        qtyReceived: 0,
      },
    ],
  });

  assert.equal(match.hasMatch, false);
  assert.equal(match.source, 'none');
  assert.equal(match.matchedQuantity, 0);
});
