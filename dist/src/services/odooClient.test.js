"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const odooClient_1 = require("./odooClient");
(0, node_test_1.default)('attributes a board inventory adjustment move and lines to the operator name', async () => {
    const client = new odooClient_1.OdooClient({
        baseUrl: 'https://odoo.example.test',
        database: 'test',
        username: 'test@example.test',
        apiKey: 'test',
    });
    const writes = [];
    const mockedClient = client;
    mockedClient.searchReadRecords = async (model, options) => {
        if (model === 'stock.move')
            return [{ id: 42, reference: 'INV/2026/0001', origin: 'Inventory adjustment' }];
        if (model === 'stock.move.line')
            return [{ id: 84 }];
        if (model === 'ir.model.fields') {
            const domain = options.domain;
            const targetModel = Array.isArray(domain[0]) ? String(domain[0][2] || '') : '';
            return [{ name: targetModel === 'stock.move' ? 'x_studio_operator_online' : 'x_operator_online', field_description: 'Operator online' }];
        }
        return [];
    };
    mockedClient.writeRecord = async (model, ids, values) => {
        writes.push({ model, ids, values });
        return true;
    };
    strict_1.default.equal(await client.populateInventoryAdjustmentOperator(123, 'Leovard Ongule'), true);
    strict_1.default.deepEqual(writes, [
        { model: 'stock.move', ids: [42], values: { x_studio_operator_online: 'Leovard Ongule' } },
        { model: 'stock.move.line', ids: [84], values: { x_operator_online: 'Leovard Ongule' } },
    ]);
});
