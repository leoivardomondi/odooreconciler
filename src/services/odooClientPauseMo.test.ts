import test from 'node:test';
import assert from 'node:assert/strict';
import { OdooClient } from './odooClient';

test('OdooClient: pauseManufacturingOrder executes end_previous(doall=True), closes timers, stops employees, and calls button_pending', async () => {
  const calledMethods: Array<{ model: string; method: string; ids: number[]; kwargs?: any }> = [];
  const writtenRecords: Array<{ model: string; ids: number[]; values: Record<string, any> }> = [];
  const postedChatters: Array<{ model: string; id: number; message: string }> = [];

  const client = new OdooClient({
    baseUrl: 'https://odoo.fake.local',
    database: 'fake-db',
    username: 'admin',
    apiKey: 'pwd',
  });

  (client as any).searchReadRecords = async (model: string, options: any) => {
    if (model === 'mrp.production') {
      return [{ id: 6668, name: 'WH/MO/06016', state: 'progress', qty_producing: 9 }];
    }
    if (model === 'mrp.workorder') {
      return [
        {
          id: 6203,
          state: 'progress',
          workcenter_id: [1, 'Table Saw Area'],
          employee_ids: [4],
        },
      ];
    }
    if (model === 'mrp.workcenter.productivity') {
      // Simulate that after end_previous, one open timer lingered
      return [
        {
          id: 6902,
          employee_id: [6, 'Onyango Bitcher Akulo'],
          user_id: [13, 'Candy Venesa'],
        },
      ];
    }
    return [];
  };

  (client as any).callRecordMethod = async (model: string, method: string, ids: number[], kwargs?: any) => {
    calledMethods.push({ model, method, ids, kwargs });
    return true;
  };

  (client as any).writeRecord = async (model: string, ids: number[], values: Record<string, any>) => {
    writtenRecords.push({ model, ids, values });
    return true;
  };

  (client as any).postModelChatterMessage = async (model: string, id: number, message: string) => {
    postedChatters.push({ model, id, message });
    return 1;
  };

  const result = await client.pauseManufacturingOrder(
    6668,
    { createBackorder: true, qtyProduced: 2 },
    4,
  );

  assert.equal(result.state, 'paused');
  assert.equal(result.backorderRequested, true);

  // 1. Check end_previous called with doall: true
  const endPreviousCall = calledMethods.find((c) => c.method === 'end_previous');
  assert.ok(endPreviousCall, 'Must call end_previous');
  assert.deepEqual(endPreviousCall.ids, [6203]);
  assert.equal(endPreviousCall.kwargs?.doall, true, 'end_previous must pass doall: true');

  // 2. Check open productivity timer forcefully closed
  const closedProdRecord = writtenRecords.find((w) => w.model === 'mrp.workcenter.productivity');
  assert.ok(closedProdRecord, 'Must close open mrp.workcenter.productivity records');
  assert.deepEqual(closedProdRecord.ids, [6902]);
  assert.ok(closedProdRecord.values.date_end, 'Must set date_end');

  // 3. Check stop_employee stopped both employee 4 and employee 6
  const stopEmployeeCall = calledMethods.find((c) => c.method === 'stop_employee');
  assert.ok(stopEmployeeCall, 'Must call stop_employee');
  assert.deepEqual(stopEmployeeCall.ids, [6203]);
  const stoppedEmployees = stopEmployeeCall.kwargs?.employee_ids;
  assert.ok(stoppedEmployees.includes(4), 'Must stop employee 4');
  assert.ok(stoppedEmployees.includes(6), 'Must stop employee 6');

  // 4. Check button_pending called
  const buttonPendingCall = calledMethods.find((c) => c.method === 'button_pending');
  assert.ok(buttonPendingCall, 'Must call button_pending');
  assert.deepEqual(buttonPendingCall.ids, [6203]);

  // 5. Check qty_producing updated on both workorder and production
  const woQtyWrite = writtenRecords.find((w) => w.model === 'mrp.workorder');
  assert.ok(woQtyWrite, 'Must update qty_producing on mrp.workorder');
  assert.equal(woQtyWrite.values.qty_producing, 2);

  const moQtyWrite = writtenRecords.find((w) => w.model === 'mrp.production');
  assert.ok(moQtyWrite, 'Must update qty_producing on mrp.production');
  assert.equal(moQtyWrite.values.qty_producing, 2);

  // 6. Check audit chatter message
  assert.equal(postedChatters.length, 1);
  assert.equal(postedChatters[0].model, 'mrp.production');
  assert.equal(postedChatters[0].id, 6668);
  assert.ok(postedChatters[0].message.includes('2 unit(s) completed so far'));
  assert.ok(postedChatters[0].message.includes('backorder requested for remaining units'));
});

