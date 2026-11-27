import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPublicShopFloorOperators,
  groupWorkOrdersByAreaAndClient,
  handlePublicShopFloorVerifyPin,
  handlePublicWorkOrderAction,
  inFlightWorkOrderSyncs,
} from './shopFloor';

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

function createMockRes() {
  let statusCode = 200;
  let payload: any = null;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: any) {
      payload = body;
      return res;
    },
  };
  return { res, getStatus: () => statusCode, getPayload: () => payload };
}

test('handlePublicWorkOrderAction rejects start/pause/finish without an authorized operatorId', async () => {
  for (const action of ['start', 'pause', 'finish']) {
    const req: any = { params: { id: '7063' }, body: { action, operatorName: 'Factory Operator' } };
    const { res, getStatus, getPayload } = createMockRes();
    await handlePublicWorkOrderAction(req, res);
    assert.equal(getStatus(), 401);
    assert.equal(getPayload()?.ok, false);
    assert.equal(getPayload()?.code, 'operator_required');
  }

  // Non-factory-operator ID (e.g. director/admin) is also rejected on public kiosk
  const nonOp = createMockRes();
  await handlePublicWorkOrderAction({ params: { id: '7063' }, body: { action: 'start', operatorId: 1 } } as any, nonOp.res);
  assert.equal(nonOp.getStatus(), 401);
  assert.equal(nonOp.getPayload()?.code, 'operator_required');
});

test('handlePublicShopFloorVerifyPin validates 4-digit PIN format', async () => {
  const emptyPin = createMockRes();
  await handlePublicShopFloorVerifyPin({ body: { pin: '' } } as any, emptyPin.res);
  assert.equal(emptyPin.getStatus(), 400);
  assert.equal(emptyPin.getPayload()?.code, 'invalid_pin_format');

  const shortPin = createMockRes();
  await handlePublicShopFloorVerifyPin({ body: { pin: '12' } } as any, shortPin.res);
  assert.equal(shortPin.getStatus(), 400);
  assert.equal(shortPin.getPayload()?.code, 'invalid_pin_format');
});

test('handlePublicWorkOrderAction rejects invalid moId and unsupported actions', async () => {
  const badId = createMockRes();
  await handlePublicWorkOrderAction({ params: { id: '0' }, body: { action: 'start', operatorId: 4 } } as any, badId.res);
  assert.equal(badId.getStatus(), 400);
  assert.equal(badId.getPayload()?.ok, false);

  const badAction = createMockRes();
  await handlePublicWorkOrderAction({ params: { id: '7063' }, body: { action: 'delete', operatorId: 4 } } as any, badAction.res);
  assert.equal(badAction.getStatus(), 400);
  assert.equal(badAction.getPayload()?.ok, false);
});

test('filterPublicShopFloorOperators keeps only Bitcher, Joel, Thomas, and Michael', () => {
  const all = [
    { odoo_employee_id: 1, name: 'Charles Ogola', job_title: 'Managing Director' },
    { odoo_employee_id: 2, name: 'Raphael Onyango', job_title: 'Director' },
    { odoo_employee_id: 5, name: 'Joel Ochango', job_title: 'Junior Operator' },
    { odoo_employee_id: 4, name: 'Leoivard Ongule', job_title: 'Information Systems' },
    { odoo_employee_id: 23, name: 'Michael Ochieng Okoth', job_title: 'Helper' },
    { odoo_employee_id: 6, name: 'Onyango Bitcher Akulo', job_title: 'Senior Operator' },
    { odoo_employee_id: 7, name: 'Thomas Ollinga', job_title: 'Assistant Jr Operator' },
    { odoo_employee_id: 9, name: 'Janet Awino Amollo', job_title: 'Operations Assistant' },
  ];

  const filtered = filterPublicShopFloorOperators(all);
  assert.deepEqual(
    filtered.map((op) => op.name),
    ['Onyango Bitcher Akulo', 'Joel Ochango', 'Thomas Ollinga', 'Michael Ochieng Okoth'],
  );
});

test('handlePublicWorkOrderAction rejects with 409 and locked mode notification when action is already syncing in-flight', async () => {
  const moId = 98765;
  inFlightWorkOrderSyncs.set(moId, {
    moId,
    action: 'pause',
    targetState: 'paused',
    operatorId: 6,
    operatorName: 'Onyango Bitcher Akulo',
    startedAt: Date.now(),
  });

  const syncRes = createMockRes();
  await handlePublicWorkOrderAction({ params: { id: String(moId) }, body: { action: 'pause', operatorId: 6 } } as any, syncRes.res);
  assert.equal(syncRes.getStatus(), 409);
  assert.equal(syncRes.getPayload()?.code, 'sync_in_progress');
  assert.equal(syncRes.getPayload()?.syncLocked, true);
  assert.match(syncRes.getPayload()?.message, /locked mode/i);

  inFlightWorkOrderSyncs.delete(moId);
});
