import test from 'node:test';
import assert from 'node:assert/strict';
import { OdooClient } from './odooClient';

test('OdooClient: postModelChatterMessage on mrp.production automatically cross-posts to linked sale.order', async () => {
  const chatterCalls: Array<{ model: string; id: number; message: string; partnerIds?: number[] }> = [];

  const client = new OdooClient({
    baseUrl: 'https://odoo.fake.local',
    database: 'fake-db',
    username: 'admin',
    apiKey: 'pwd',
  });

  // Mock internal methods
  (client as any).getTargetCompanyIdValue = async () => 1;

  (client as any).request = async (model: string, method: string, kwargs: any) => {
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

  (client as any).readRecords = async (model: string, ids: number[]) => {
    if (model === 'mrp.production' && ids[0] === 505) {
      return [{ id: 505, name: 'WH/MO/00789', origin: 'S04001' }];
    }
    return [];
  };

  (client as any).searchReadRecords = async (model: string, options: any) => {
    if (model === 'sale.order') {
      return [{ id: 999, name: 'S04001' }];
    }
    return [];
  };

  await client.postModelChatterMessage('mrp.production', 505, '<p>Operator started cutting work order.</p>', [45]);

  // Primary post on mrp.production
  assert.equal(chatterCalls.length, 2, 'Must have primary post on MO and auto cross-post on SO');
  assert.equal(chatterCalls[0].model, 'mrp.production');
  assert.equal(chatterCalls[0].id, 505);
  assert.ok(chatterCalls[0].message.includes('Operator started cutting'));

  // Cross-post on sale.order
  assert.equal(chatterCalls[1].model, 'sale.order');
  assert.equal(chatterCalls[1].id, 999);
  assert.ok(chatterCalls[1].message.includes('Manufacturing Order Note'));
  assert.ok(chatterCalls[1].message.includes('WH/MO/00789'));
  assert.ok(chatterCalls[1].message.includes('Operator started cutting'));
  assert.deepEqual(chatterCalls[1].partnerIds, [45]);
});

test('OdooClient: postModelChatterMessage on purchase.order automatically cross-posts to linked sale.order', async () => {
  const chatterCalls: Array<{ model: string; id: number; message: string; partnerIds?: number[] }> = [];

  const client = new OdooClient({
    baseUrl: 'https://odoo.fake.local',
    database: 'fake-db',
    username: 'admin',
    apiKey: 'pwd',
  });

  (client as any).getTargetCompanyIdValue = async () => 1;

  (client as any).request = async (model: string, method: string, kwargs: any) => {
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

  (client as any).readRecords = async (model: string, ids: number[]) => {
    if (model === 'purchase.order' && ids[0] === 888) {
      return [{ id: 888, name: 'P01378', origin: 'S04002' }];
    }
    return [];
  };

  (client as any).searchReadRecords = async (model: string) => {
    if (model === 'sale.order') {
      return [{ id: 1002, name: 'S04002' }];
    }
    return [];
  };

  await client.postModelChatterMessage('purchase.order', 888, '<p>Confirmed board delivery expected tomorrow.</p>');

  assert.equal(chatterCalls.length, 2);
  assert.equal(chatterCalls[0].model, 'purchase.order');
  assert.equal(chatterCalls[0].id, 888);

  assert.equal(chatterCalls[1].model, 'sale.order');
  assert.equal(chatterCalls[1].id, 1002);
  assert.ok(chatterCalls[1].message.includes('Purchase Order Note'));
  assert.ok(chatterCalls[1].message.includes('P01378'));
  assert.ok(chatterCalls[1].message.includes('Confirmed board delivery expected tomorrow.'));
});

test('OdooClient: Deduplication prevents duplicate chatter posts to sale.order within 120 seconds', async () => {
  const chatterCalls: Array<{ model: string; id: number; message: string }> = [];

  const client = new OdooClient({
    baseUrl: 'https://odoo.fake.local',
    database: 'fake-db',
    username: 'admin',
    apiKey: 'pwd',
  });

  (client as any).getTargetCompanyIdValue = async () => 1;

  (client as any).request = async (model: string, method: string, kwargs: any) => {
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

  (client as any).readRecords = async (model: string, ids: number[]) => {
    if (model === 'purchase.order' && ids[0] === 888) {
      return [{ id: 888, name: 'P01378', origin: 'S04003' }];
    }
    return [];
  };

  (client as any).searchReadRecords = async (model: string) => {
    if (model === 'sale.order') {
      return [{ id: 1003, name: 'S04003' }];
    }
    return [];
  };

  const message = '<p>Procurement status: all items verified.</p>';

  // 1. First call: PO posts and auto cross-posts to SO
  await client.postModelChatterMessage('purchase.order', 888, message);
  assert.equal(chatterCalls.length, 2);
  assert.equal(chatterCalls[0].model, 'purchase.order');
  assert.equal(chatterCalls[1].model, 'sale.order');

  // 2. Immediate direct call on sale.order with the same message (e.g. caller legacy cross-post)
  await client.postModelChatterMessage('sale.order', 1003, message);
  assert.equal(chatterCalls.length, 2, 'Duplicate post on sale.order must be deduplicated and skipped');
});

test('OdooClient: skipSoSync option skips cross-posting to sale.order', async () => {
  const chatterCalls: Array<{ model: string; id: number; message: string }> = [];

  const client = new OdooClient({
    baseUrl: 'https://odoo.fake.local',
    database: 'fake-db',
    username: 'admin',
    apiKey: 'pwd',
  });

  (client as any).getTargetCompanyIdValue = async () => 1;

  (client as any).request = async (model: string, method: string, kwargs: any) => {
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

  await client.postModelChatterMessage(
    'mrp.production',
    505,
    '<p>Internal machine calibration note.</p>',
    undefined,
    { skipSoSync: true },
  );

  assert.equal(chatterCalls.length, 1);
  assert.equal(chatterCalls[0].model, 'mrp.production');
});
