"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const odooActivityService_1 = require("./odooActivityService");
const odooClient_1 = require("./odooClient");
(0, node_test_1.default)('Activity and Chatter Deduplication Suite', async (t) => {
    await t.test('createTodoActivity returns existing activity ID without creating duplicate when open activity exists', async () => {
        let createRecordCalls = 0;
        const mockClient = {
            searchReadRecords: async (model, args) => {
                if (model === 'mail.activity') {
                    return [
                        {
                            id: 501,
                            summary: 'UPLOAD JOB SUMMARY',
                            note: '<p>Existing note</p>',
                            user_id: [10, 'Charles'],
                        },
                    ];
                }
                return [];
            },
            createRecord: async () => {
                createRecordCalls++;
                return 999;
            },
        };
        const resultId = await (0, odooActivityService_1.createTodoActivity)(mockClient, {
            modelName: 'sale.order',
            recordId: 1001,
            userId: 10,
            summary: 'Upload Job Summary', // case-insensitive match
            noteLines: ['Sales Order: S0001', 'Please attach job summary'],
        });
        strict_1.default.equal(resultId, 501, 'Must return the existing activity id');
        strict_1.default.equal(createRecordCalls, 0, 'Must NOT call createRecord when open activity already exists');
    });
    await t.test('createTodoActivity creates new activity when no matching open activity exists', async () => {
        let createdValues = null;
        const mockClient = {
            searchReadRecords: async (model) => {
                if (model === 'mail.activity') {
                    return [];
                }
                if (model === 'ir.model') {
                    return [{ id: 45, model: 'purchase.order' }];
                }
                if (model === 'mail.activity.type') {
                    return [{ id: 4, name: 'To Do' }];
                }
                return [];
            },
            createRecord: async (model, values) => {
                createdValues = values;
                return 777;
            },
        };
        const resultId = await (0, odooActivityService_1.createTodoActivity)(mockClient, {
            modelName: 'purchase.order',
            recordId: 2002,
            userId: 12,
            summary: 'PO APPROVAL REQUIRED',
            noteLines: ['Please review and approve PO P00050'],
        });
        strict_1.default.equal(resultId, 777);
        strict_1.default.ok(createdValues);
        strict_1.default.equal(createdValues.res_id, 2002);
        strict_1.default.match(String(createdValues.summary), /^PO APPROVAL REQUIRED/);
        strict_1.default.match(String(createdValues.summary), /·/);
        strict_1.default.match(String(createdValues.note), /Timestamp:\s+\d{4}-\d{2}-\d{2}/);
    });
    await t.test('createTodoActivity deduplicates open activities that have timestamps attached', async () => {
        let createRecordCalls = 0;
        const mockClient = {
            searchReadRecords: async (model) => {
                if (model === 'mail.activity') {
                    return [
                        {
                            id: 602,
                            summary: 'Upload Job Summary · 18 Nov 14:30',
                            note: '<p>Existing note with timestamp</p>',
                            user_id: [10, 'Charles'],
                        },
                    ];
                }
                return [];
            },
            createRecord: async () => {
                createRecordCalls++;
                return 999;
            },
        };
        const resultId = await (0, odooActivityService_1.createTodoActivity)(mockClient, {
            modelName: 'sale.order',
            recordId: 1001,
            userId: 10,
            summary: 'Upload Job Summary',
            noteLines: ['Sales Order: S0001', 'Please attach job summary'],
        });
        strict_1.default.equal(resultId, 602, 'Must match and return existing activity id regardless of timestamp in existing summary');
        strict_1.default.equal(createRecordCalls, 0, 'Must NOT call createRecord when timestamped open activity exists');
    });
    await t.test('hasModelChatterMessage correctly queries mail.message for matching text snippets', async () => {
        const client = new odooClient_1.OdooClient({
            baseUrl: 'https://odoo.fake.local',
            database: 'fake-db',
            username: 'admin',
            apiKey: 'pwd',
        });
        let queriedDomain = null;
        client.searchReadRecords = async (model, kwargs) => {
            if (model === 'mail.message') {
                queriedDomain = kwargs.domain;
                return [{ id: 888 }];
            }
            return [];
        };
        const hasMsg = await client.hasModelChatterMessage('purchase.order', 3003, 'PO Approval Check Required');
        strict_1.default.equal(hasMsg, true);
        strict_1.default.ok(queriedDomain);
        strict_1.default.deepEqual(queriedDomain[0], ['model', '=', 'purchase.order']);
        strict_1.default.deepEqual(queriedDomain[1], ['res_id', '=', 3003]);
        strict_1.default.deepEqual(queriedDomain[2], ['body', 'ilike', 'PO Approval Check Required']);
    });
    await t.test('postModelChatterMessage with dedupeSnippet skips posting when message already exists in Odoo', async () => {
        let postCalls = 0;
        const client = new odooClient_1.OdooClient({
            baseUrl: 'https://odoo.fake.local',
            database: 'fake-db',
            username: 'admin',
            apiKey: 'pwd',
        });
        client.searchReadRecords = async (model) => {
            if (model === 'mail.message') {
                return [{ id: 999 }]; // Message already exists!
            }
            return [];
        };
        client.request = async (model, method) => {
            if (method === 'message_post') {
                postCalls++;
                return 1;
            }
            return 1;
        };
        const result = await client.postModelChatterMessage('purchase.order', 4004, '<p>⚠️ <strong>PO Approval Check Required (@Charles):</strong></p><p>Please approve PO P00099.</p>', undefined, { dedupeSnippet: 'PO Approval Check Required' });
        strict_1.default.equal(result, 0, 'Must return 0 and skip posting duplicate message');
        strict_1.default.equal(postCalls, 0, 'Must not post chatter when dedupeSnippet already exists');
    });
    await t.test('postModelChatterMessage respects dedupeWindowMs across any model to prevent repeating overtime', async () => {
        const posted = [];
        const client = new odooClient_1.OdooClient({
            baseUrl: 'https://odoo.fake.local',
            database: 'fake-db',
            username: 'admin',
            apiKey: 'pwd',
        });
        client.searchReadRecords = async () => [];
        client.getTargetCompanyIdValue = async () => 1;
        client.readRecords = async () => [];
        client.request = async (model, method, kwargs) => {
            if (method === 'message_post') {
                posted.push({ model, id: kwargs.ids[0], body: kwargs.body });
                return 1;
            }
            return 1;
        };
        const msg = '<p>⚠️ <strong>PO Approval Check Required:</strong> Urgent.</p>';
        // 1st call: Should post
        await client.postModelChatterMessage('purchase.order', 5005, msg, undefined, { dedupeWindowMs: 86400000 });
        strict_1.default.equal(posted.length, 1);
        // 2nd call: Should be deduplicated by dedupeWindowMs
        await client.postModelChatterMessage('purchase.order', 5005, msg, undefined, { dedupeWindowMs: 86400000 });
        strict_1.default.equal(posted.length, 1, 'Must NOT post duplicate message within dedupeWindowMs');
    });
});
