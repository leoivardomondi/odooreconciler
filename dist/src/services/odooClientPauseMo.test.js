"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const odooClient_1 = require("./odooClient");
(0, node_test_1.default)('OdooClient: pauseManufacturingOrder executes end_previous(doall=True), closes timers, stops employees, and calls button_pending', async () => {
    const calledMethods = [];
    const writtenRecords = [];
    const postedChatters = [];
    const client = new odooClient_1.OdooClient({
        baseUrl: 'https://odoo.fake.local',
        database: 'fake-db',
        username: 'admin',
        apiKey: 'pwd',
    });
    client.searchReadRecords = async (model, options) => {
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
    client.callRecordMethod = async (model, method, ids, kwargs) => {
        calledMethods.push({ model, method, ids, kwargs });
        return true;
    };
    client.writeRecord = async (model, ids, values) => {
        writtenRecords.push({ model, ids, values });
        return true;
    };
    client.postModelChatterMessage = async (model, id, message) => {
        postedChatters.push({ model, id, message });
        return 1;
    };
    const result = await client.pauseManufacturingOrder(6668, { createBackorder: true, qtyProduced: 2 }, 4);
    strict_1.default.equal(result.state, 'paused');
    strict_1.default.equal(result.backorderRequested, true);
    // 1. Check end_previous called with doall: true
    const endPreviousCall = calledMethods.find((c) => c.method === 'end_previous');
    strict_1.default.ok(endPreviousCall, 'Must call end_previous');
    strict_1.default.deepEqual(endPreviousCall.ids, [6203]);
    strict_1.default.equal(endPreviousCall.kwargs?.doall, true, 'end_previous must pass doall: true');
    // 2. Check open productivity timer forcefully closed
    const closedProdRecord = writtenRecords.find((w) => w.model === 'mrp.workcenter.productivity');
    strict_1.default.ok(closedProdRecord, 'Must close open mrp.workcenter.productivity records');
    strict_1.default.deepEqual(closedProdRecord.ids, [6902]);
    strict_1.default.ok(closedProdRecord.values.date_end, 'Must set date_end');
    // 3. Check stop_employee stopped both employee 4 and employee 6
    const stopEmployeeCall = calledMethods.find((c) => c.method === 'stop_employee');
    strict_1.default.ok(stopEmployeeCall, 'Must call stop_employee');
    strict_1.default.deepEqual(stopEmployeeCall.ids, [6203]);
    const stoppedEmployees = stopEmployeeCall.kwargs?.employee_ids;
    strict_1.default.ok(stoppedEmployees.includes(4), 'Must stop employee 4');
    strict_1.default.ok(stoppedEmployees.includes(6), 'Must stop employee 6');
    // 4. Check button_pending called
    const buttonPendingCall = calledMethods.find((c) => c.method === 'button_pending');
    strict_1.default.ok(buttonPendingCall, 'Must call button_pending');
    strict_1.default.deepEqual(buttonPendingCall.ids, [6203]);
    // 5. Check qty_producing updated on both workorder and production
    const woQtyWrite = writtenRecords.find((w) => w.model === 'mrp.workorder');
    strict_1.default.ok(woQtyWrite, 'Must update qty_producing on mrp.workorder');
    strict_1.default.equal(woQtyWrite.values.qty_producing, 2);
    const moQtyWrite = writtenRecords.find((w) => w.model === 'mrp.production');
    strict_1.default.ok(moQtyWrite, 'Must update qty_producing on mrp.production');
    strict_1.default.equal(moQtyWrite.values.qty_producing, 2);
    // 6. Check audit chatter message
    strict_1.default.equal(postedChatters.length, 1);
    strict_1.default.equal(postedChatters[0].model, 'mrp.production');
    strict_1.default.equal(postedChatters[0].id, 6668);
    strict_1.default.ok(postedChatters[0].message.includes('2 unit(s) completed so far'));
    strict_1.default.ok(postedChatters[0].message.includes('backorder requested for remaining units'));
});
