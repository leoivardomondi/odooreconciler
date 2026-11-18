import test from 'node:test';
import assert from 'node:assert/strict';
import { createTodoActivity } from './odooActivityService';
import { OdooClient } from './odooClient';

test('Activity and Chatter Deduplication Suite', async (t) => {
  await t.test('createTodoActivity returns existing activity ID without creating duplicate when open activity exists', async () => {
    let createRecordCalls = 0;
    const mockClient = {
      searchReadRecords: async (model: string, args: any) => {
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
    } as unknown as OdooClient;

    const resultId = await createTodoActivity(mockClient, {
      modelName: 'sale.order',
      recordId: 1001,
      userId: 10,
      summary: 'Upload Job Summary', // case-insensitive match
      noteLines: ['Sales Order: S0001', 'Please attach job summary'],
    });

    assert.equal(resultId, 501, 'Must return the existing activity id');
    assert.equal(createRecordCalls, 0, 'Must NOT call createRecord when open activity already exists');
  });

  await t.test('createTodoActivity creates new activity when no matching open activity exists', async () => {
    let createdValues: Record<string, unknown> | null = null;
    const mockClient = {
      searchReadRecords: async (model: string) => {
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
      createRecord: async (model: string, values: any) => {
        createdValues = values;
        return 777;
      },
    } as unknown as OdooClient;

    const resultId = await createTodoActivity(mockClient, {
      modelName: 'purchase.order',
      recordId: 2002,
      userId: 12,
      summary: 'PO APPROVAL REQUIRED',
      noteLines: ['Please review and approve PO P00050'],
    });

    assert.equal(resultId, 777);
    assert.ok(createdValues);
    assert.equal((createdValues as any).res_id, 2002);
    assert.equal((createdValues as any).summary, 'PO APPROVAL REQUIRED');
  });

  await t.test('hasModelChatterMessage correctly queries mail.message for matching text snippets', async () => {
    const client = new OdooClient({
      baseUrl: 'https://odoo.fake.local',
      database: 'fake-db',
      username: 'admin',
      apiKey: 'pwd',
    });

    let queriedDomain: any = null;
    (client as any).searchReadRecords = async (model: string, kwargs: any) => {
      if (model === 'mail.message') {
        queriedDomain = kwargs.domain;
        return [{ id: 888 }];
      }
      return [];
    };

    const hasMsg = await client.hasModelChatterMessage('purchase.order', 3003, 'PO Approval Check Required');
    assert.equal(hasMsg, true);
    assert.ok(queriedDomain);
    assert.deepEqual(queriedDomain[0], ['model', '=', 'purchase.order']);
    assert.deepEqual(queriedDomain[1], ['res_id', '=', 3003]);
    assert.deepEqual(queriedDomain[2], ['body', 'ilike', 'PO Approval Check Required']);
  });

  await t.test('postModelChatterMessage with dedupeSnippet skips posting when message already exists in Odoo', async () => {
    let postCalls = 0;
    const client = new OdooClient({
      baseUrl: 'https://odoo.fake.local',
      database: 'fake-db',
      username: 'admin',
      apiKey: 'pwd',
    });

    (client as any).searchReadRecords = async (model: string) => {
      if (model === 'mail.message') {
        return [{ id: 999 }]; // Message already exists!
      }
      return [];
    };

    (client as any).request = async (model: string, method: string) => {
      if (method === 'message_post') {
        postCalls++;
        return 1;
      }
      return 1;
    };

    const result = await client.postModelChatterMessage(
      'purchase.order',
      4004,
      '<p>⚠️ <strong>PO Approval Check Required (@Charles):</strong></p><p>Please approve PO P00099.</p>',
      undefined,
      { dedupeSnippet: 'PO Approval Check Required' },
    );

    assert.equal(result, 0, 'Must return 0 and skip posting duplicate message');
    assert.equal(postCalls, 0, 'Must not post chatter when dedupeSnippet already exists');
  });

  await t.test('postModelChatterMessage respects dedupeWindowMs across any model to prevent repeating overtime', async () => {
    const posted: any[] = [];
    const client = new OdooClient({
      baseUrl: 'https://odoo.fake.local',
      database: 'fake-db',
      username: 'admin',
      apiKey: 'pwd',
    });

    (client as any).searchReadRecords = async () => [];
    (client as any).getTargetCompanyIdValue = async () => 1;
    (client as any).readRecords = async () => [];
    (client as any).request = async (model: string, method: string, kwargs: any) => {
      if (method === 'message_post') {
        posted.push({ model, id: kwargs.ids[0], body: kwargs.body });
        return 1;
      }
      return 1;
    };

    const msg = '<p>⚠️ <strong>PO Approval Check Required:</strong> Urgent.</p>';

    // 1st call: Should post
    await client.postModelChatterMessage('purchase.order', 5005, msg, undefined, { dedupeWindowMs: 86400000 });
    assert.equal(posted.length, 1);

    // 2nd call: Should be deduplicated by dedupeWindowMs
    await client.postModelChatterMessage('purchase.order', 5005, msg, undefined, { dedupeWindowMs: 86400000 });
    assert.equal(posted.length, 1, 'Must NOT post duplicate message within dedupeWindowMs');
  });
});

