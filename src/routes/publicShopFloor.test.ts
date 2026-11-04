import test from 'node:test';
import assert from 'node:assert/strict';
import { groupWorkOrdersByAreaAndClient } from './shopFloor';

test('groupWorkOrdersByAreaAndClient groups work orders by operation area and then by client name', () => {
  const sampleWorkOrders = [
    {
      id: 101,
      name: 'WH/MO/0101',
      product: 'Cutting Dark Grey MDF 18mm',
      qty: 10,
      produced: 0,
      state: 'ready',
      client: 'ARTEC INTERIORS',
      area: 'Table Saw Area',
      stockStatus: 'ready',
      hasStockIssue: false,
    },
    {
      id: 102,
      name: 'WH/MO/0102',
      product: 'Cutting White MDF 18mm',
      qty: 5,
      produced: 2,
      state: 'progress',
      client: 'ARTEC INTERIORS',
      area: 'Table Saw Area',
      stockStatus: 'ready',
      hasStockIssue: false,
    },
    {
      id: 103,
      name: 'WH/MO/0103',
      product: 'Cutting Walnut MDF 18mm',
      qty: 8,
      produced: 0,
      state: 'ready',
      client: 'STEPHENE OILE',
      area: 'Table Saw Area',
      stockStatus: 'no_stock',
      hasStockIssue: true,
    },
    {
      id: 201,
      name: 'WH/MO/0201',
      product: 'Edging 2mm PVC',
      qty: 50,
      produced: 10,
      state: 'paused',
      client: 'ARTEC INTERIORS',
      area: 'Edge Banding Area',
      stockStatus: 'ready',
      hasStockIssue: false,
    },
    {
      id: 301,
      name: 'WH/MO/0301',
      product: 'Optimised Panels Racking',
      qty: 30,
      produced: 30,
      state: 'done',
      client: 'STEPHENE OILE',
      area: 'Panel Rack Area',
      stockStatus: 'ready',
      hasStockIssue: false,
    },
  ];

  const result = groupWorkOrdersByAreaAndClient(sampleWorkOrders);

  assert.ok(Array.isArray(result));
  assert.ok(result.length >= 3, 'Should include at least Table Saw, Edge Banding, and Panel Rack');

  const tableSaw = result.find((g) => g.areaName === 'Table Saw Area');
  assert.ok(tableSaw, 'Table Saw Area group must exist');
  assert.equal(tableSaw.totalOrders, 3);
  assert.equal(tableSaw.inProgressOrders, 1);
  assert.equal(tableSaw.readyOrders, 2);
  assert.equal(tableSaw.totalQuantity, 23);

  // Check client grouping within Table Saw Area
  assert.equal(tableSaw.clientGroups.length, 2);
  // Artec Interiors has an in-progress order, so it should be sorted first
  assert.equal(tableSaw.clientGroups[0].clientName, 'ARTEC INTERIORS');
  assert.equal(tableSaw.clientGroups[0].totalOrders, 2);
  assert.equal(tableSaw.clientGroups[0].inProgressOrders, 1);
  assert.equal(tableSaw.clientGroups[0].totalQuantity, 15);

  assert.equal(tableSaw.clientGroups[1].clientName, 'STEPHENE OILE');
  assert.equal(tableSaw.clientGroups[1].totalOrders, 1);
  assert.equal(tableSaw.clientGroups[1].readyOrders, 1);
  assert.equal(tableSaw.clientGroups[1].totalQuantity, 8);

  // Check Edge Banding Area
  const edgeBanding = result.find((g) => g.areaName === 'Edge Banding Area');
  assert.ok(edgeBanding, 'Edge Banding Area group must exist');
  assert.equal(edgeBanding.totalOrders, 1);
  assert.equal(edgeBanding.pausedOrders, 1);
  assert.equal(edgeBanding.clientGroups[0].clientName, 'ARTEC INTERIORS');

  // Check Panel Rack Area
  const panelRack = result.find((g) => g.areaName === 'Panel Rack Area');
  assert.ok(panelRack, 'Panel Rack Area group must exist');
  assert.equal(panelRack.totalOrders, 1);
  assert.equal(panelRack.doneOrders, 1);
  assert.equal(panelRack.clientGroups[0].clientName, 'STEPHENE OILE');
});

test('groupWorkOrdersByAreaAndClient handles empty lists gracefully', () => {
  const result = groupWorkOrdersByAreaAndClient([]);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 3);
  result.forEach((group) => {
    assert.equal(group.totalOrders, 0);
    assert.equal(group.clientGroups.length, 0);
  });
});

test('groupWorkOrdersByAreaAndClient normalizes fallback client names', () => {
  const sample = [
    {
      id: 501,
      name: 'WH/MO/0501',
      product: 'Cutting Test',
      qty: 2,
      state: 'ready',
      client: null,
      area: 'Table Saw Area',
      stockStatus: 'ready',
    },
  ];
  const result = groupWorkOrdersByAreaAndClient(sample);
  const ts = result.find((g) => g.areaName === 'Table Saw Area');
  assert.ok(ts);
  assert.equal(ts.clientGroups.length, 1);
  assert.equal(ts.clientGroups[0].clientName, 'Direct / Unassigned Client');
});
