"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const odooClient_1 = require("./odooClient");
(0, node_test_1.default)('OdooClient: postModelChatterMessage on mrp.production automatically cross-posts to linked sale.order', async () => {
    const chatterCalls = [];
    const client = new odooClient_1.OdooClient({
        baseUrl: 'https://odoo.fake.local',
        database: 'fake-db',
        username: 'admin',
        apiKey: 'pwd',
    });
    // Mock internal methods
    client.getTargetCompanyIdValue = async () => 1;
    client.request = async (model, method, kwargs) => {
        if (method === 'message_post') {
            chatterCalls.push({
                model,
                id: kwargs.ids[0],
                message: kwargs.body,
                partnerIds: kwargs.partner_ids,
            });
            return 101;
        }
        return 1;
    };
    client.readRecords = async (model, ids) => {
        if (model === 'mrp.production' && ids[0] === 505) {
            return [{ id: 505, name: 'WH/MO/00789', origin: 'S04001' }];
        }
        return [];
    };
    client.searchReadRecords = async (model, options) => {
        if (model === 'sale.order') {
            return [{ id: 999, name: 'S04001' }];
        }
        return [];
    };
    await client.postModelChatterMessage('mrp.production', 505, '<p>Operator started cutting work order.</p>', [45]);
    // Primary post on mrp.production
    strict_1.default.equal(chatterCalls.length, 2, 'Must have primary post on MO and auto cross-post on SO');
    strict_1.default.equal(chatterCalls[0].model, 'mrp.production');
    strict_1.default.equal(chatterCalls[0].id, 505);
    strict_1.default.ok(chatterCalls[0].message.includes('Operator started cutting'));
    // Cross-post on sale.order
    strict_1.default.equal(chatterCalls[1].model, 'sale.order');
    strict_1.default.equal(chatterCalls[1].id, 999);
    strict_1.default.ok(chatterCalls[1].message.includes('Manufacturing Order Note'));
    strict_1.default.ok(chatterCalls[1].message.includes('WH/MO/00789'));
    strict_1.default.ok(chatterCalls[1].message.includes('Operator started cutting'));
    strict_1.default.deepEqual(chatterCalls[1].partnerIds, [45]);
});
(0, node_test_1.default)('OdooClient: postModelChatterMessage on purchase.order automatically cross-posts to linked sale.order', async () => {
    const chatterCalls = [];
    const client = new odooClient_1.OdooClient({
        baseUrl: 'https://odoo.fake.local',
        database: 'fake-db',
        username: 'admin',
        apiKey: 'pwd',
    });
    client.getTargetCompanyIdValue = async () => 1;
    client.request = async (model, method, kwargs) => {
        if (method === 'message_post') {
            chatterCalls.push({
                model,
                id: kwargs.ids[0],
                message: kwargs.body,
                partnerIds: kwargs.partner_ids,
            });
            return 102;
        }
        return 1;
    };
    client.readRecords = async (model, ids) => {
        if (model === 'purchase.order' && ids[0] === 888) {
            return [{ id: 888, name: 'P01378', origin: 'S04002' }];
        }
        return [];
    };
    client.searchReadRecords = async (model) => {
        if (model === 'sale.order') {
            return [{ id: 1002, name: 'S04002' }];
        }
        return [];
    };
    await client.postModelChatterMessage('purchase.order', 888, '<p>Confirmed board delivery expected tomorrow.</p>');
    strict_1.default.equal(chatterCalls.length, 2);
    strict_1.default.equal(chatterCalls[0].model, 'purchase.order');
    strict_1.default.equal(chatterCalls[0].id, 888);
    strict_1.default.equal(chatterCalls[1].model, 'sale.order');
    strict_1.default.equal(chatterCalls[1].id, 1002);
    strict_1.default.ok(chatterCalls[1].message.includes('Purchase Order Note'));
    strict_1.default.ok(chatterCalls[1].message.includes('P01378'));
    strict_1.default.ok(chatterCalls[1].message.includes('Confirmed board delivery expected tomorrow.'));
});
(0, node_test_1.default)('OdooClient: Deduplication prevents duplicate chatter posts to sale.order within 120 seconds', async () => {
    const chatterCalls = [];
    const client = new odooClient_1.OdooClient({
        baseUrl: 'https://odoo.fake.local',
        database: 'fake-db',
        username: 'admin',
        apiKey: 'pwd',
    });
    client.getTargetCompanyIdValue = async () => 1;
    client.request = async (model, method, kwargs) => {
        if (method === 'message_post') {
            chatterCalls.push({
                model,
                id: kwargs.ids[0],
                message: kwargs.body,
            });
            return 1;
        }
        return 1;
    };
    client.readRecords = async (model, ids) => {
        if (model === 'purchase.order' && ids[0] === 888) {
            return [{ id: 888, name: 'P01378', origin: 'S04003' }];
        }
        return [];
    };
    client.searchReadRecords = async (model) => {
        if (model === 'sale.order') {
            return [{ id: 1003, name: 'S04003' }];
        }
        return [];
    };
    const message = '<p>Procurement status: all items verified.</p>';
    // 1. First call: PO posts and auto cross-posts to SO
    await client.postModelChatterMessage('purchase.order', 888, message);
    strict_1.default.equal(chatterCalls.length, 2);
    strict_1.default.equal(chatterCalls[0].model, 'purchase.order');
    strict_1.default.equal(chatterCalls[1].model, 'sale.order');
    // 2. Immediate direct call on sale.order with the same message (e.g. caller legacy cross-post)
    await client.postModelChatterMessage('sale.order', 1003, message);
    strict_1.default.equal(chatterCalls.length, 2, 'Duplicate post on sale.order must be deduplicated and skipped');
});
(0, node_test_1.default)('OdooClient: skipSoSync option skips cross-posting to sale.order', async () => {
    const chatterCalls = [];
    const client = new odooClient_1.OdooClient({
        baseUrl: 'https://odoo.fake.local',
        database: 'fake-db',
        username: 'admin',
        apiKey: 'pwd',
    });
    client.getTargetCompanyIdValue = async () => 1;
    client.request = async (model, method, kwargs) => {
        if (method === 'message_post') {
            chatterCalls.push({
                model,
                id: kwargs.ids[0],
                message: kwargs.body,
            });
            return 1;
        }
        return 1;
    };
    await client.postModelChatterMessage('mrp.production', 505, '<p>Internal machine calibration note.</p>', undefined, { skipSoSync: true });
    strict_1.default.equal(chatterCalls.length, 1);
    strict_1.default.equal(chatterCalls[0].model, 'mrp.production');
});
