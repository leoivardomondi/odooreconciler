"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const shopFloor_1 = require("./shopFloor");
(0, node_test_1.default)('groupWorkOrdersByAreaAndClient groups work orders by operation area and then by client name', () => {
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
    const result = (0, shopFloor_1.groupWorkOrdersByAreaAndClient)(sampleWorkOrders);
    strict_1.default.ok(Array.isArray(result));
    strict_1.default.ok(result.length >= 3, 'Should include at least Table Saw, Edge Banding, and Panel Rack');
    const tableSaw = result.find((g) => g.areaName === 'Table Saw Area');
    strict_1.default.ok(tableSaw, 'Table Saw Area group must exist');
    strict_1.default.equal(tableSaw.totalOrders, 3);
    strict_1.default.equal(tableSaw.inProgressOrders, 1);
    strict_1.default.equal(tableSaw.readyOrders, 2);
    strict_1.default.equal(tableSaw.totalQuantity, 23);
    // Check client grouping within Table Saw Area
    strict_1.default.equal(tableSaw.clientGroups.length, 2);
    // Artec Interiors has an in-progress order, so it should be sorted first
    strict_1.default.equal(tableSaw.clientGroups[0].clientName, 'ARTEC INTERIORS');
    strict_1.default.equal(tableSaw.clientGroups[0].totalOrders, 2);
    strict_1.default.equal(tableSaw.clientGroups[0].inProgressOrders, 1);
    strict_1.default.equal(tableSaw.clientGroups[0].totalQuantity, 15);
    strict_1.default.equal(tableSaw.clientGroups[1].clientName, 'STEPHENE OILE');
    strict_1.default.equal(tableSaw.clientGroups[1].totalOrders, 1);
    strict_1.default.equal(tableSaw.clientGroups[1].readyOrders, 1);
    strict_1.default.equal(tableSaw.clientGroups[1].totalQuantity, 8);
    // Check Edge Banding Area
    const edgeBanding = result.find((g) => g.areaName === 'Edge Banding Area');
    strict_1.default.ok(edgeBanding, 'Edge Banding Area group must exist');
    strict_1.default.equal(edgeBanding.totalOrders, 1);
    strict_1.default.equal(edgeBanding.pausedOrders, 1);
    strict_1.default.equal(edgeBanding.clientGroups[0].clientName, 'ARTEC INTERIORS');
    // Check Panel Rack Area
    const panelRack = result.find((g) => g.areaName === 'Panel Rack Area');
    strict_1.default.ok(panelRack, 'Panel Rack Area group must exist');
    strict_1.default.equal(panelRack.totalOrders, 1);
    strict_1.default.equal(panelRack.doneOrders, 1);
    strict_1.default.equal(panelRack.clientGroups[0].clientName, 'STEPHENE OILE');
});
(0, node_test_1.default)('groupWorkOrdersByAreaAndClient handles empty lists gracefully', () => {
    const result = (0, shopFloor_1.groupWorkOrdersByAreaAndClient)([]);
    strict_1.default.ok(Array.isArray(result));
    strict_1.default.equal(result.length, 3);
    result.forEach((group) => {
        strict_1.default.equal(group.totalOrders, 0);
        strict_1.default.equal(group.clientGroups.length, 0);
    });
});
(0, node_test_1.default)('groupWorkOrdersByAreaAndClient normalizes fallback client names', () => {
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
    const result = (0, shopFloor_1.groupWorkOrdersByAreaAndClient)(sample);
    const ts = result.find((g) => g.areaName === 'Table Saw Area');
    strict_1.default.ok(ts);
    strict_1.default.equal(ts.clientGroups.length, 1);
    strict_1.default.equal(ts.clientGroups[0].clientName, 'Direct / Unassigned Client');
});
